"""Feature 2: prioritizer as a LangGraph StateGraph.

    load_tasks -> compute_features -> llm_rank -> validate --ok--------> merge_scores -> END
                                          ^           |--retry (once)--+
                                          |           '--fallback-----> fallback_rank -> END
                                          '--------------------------------'

The LLM can reorder, but it cannot bury an overdue HIGH-priority quest, and any Gemini
failure (down, quota, bad output) degrades to a deterministic ranking.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal, TypedDict

from cachetools import TTLCache
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app import usage
from app.db import pool, repo
from app.db.dialect import is_postgres
from app.llm import AIUnavailable
from app.llm_call import structured_call
from app.prompts import load_prompt
from app.rag.chunking import list_label, prompt_safe

log = logging.getLogger("taskquest.ai.prioritize")

PRIORITY_WEIGHT = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
REASONING_THRESHOLD = 15  # use the Pro model only above this many open quests


def ranking_token_budget(n_tasks: int) -> int:
    """Output tokens a full ranking of ``n_tasks`` needs: the answer lists every id (about 60 tokens each) and thinking
    models spend part of the same limit, so the default 800 only fitted about a dozen quests."""
    return min(8192, 1024 + 80 * n_tasks)
CACHE_TTL_SECONDS = 300
# Level 1: this process's memory. Level 2 is ai_prioritize_cache, which other AI instances share.
_cache: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=500, ttl=CACHE_TTL_SECONDS)


# ── LLM schema ───────────────────────────────────────────────────────────────


class RankedItem(BaseModel):
    id: str = Field(description='Quest id such as "L42"')
    rank: int = Field(description="1 = do first")
    reason: str = Field(description="Max 140 characters, cites a fact from the input")
    suggested_priority: Literal["LOW", "MEDIUM", "HIGH"] | None = None


class RankingOut(BaseModel):
    ranked: list[RankedItem]
    focus_message: str = ""


# ── deterministic features ───────────────────────────────────────────────────


@dataclass
class TaskFeatures:
    id: str
    list_id: int
    name: str
    description: str | None
    category: str | None
    priority: str | None
    deadline: str | None
    days_to_deadline: int | None
    is_overdue: bool
    priority_weight: int
    pct_complete: float
    days_since_activity: int | None
    open_items: int
    baseline: float = 0.0
    next_item_due: str | None = None  # earliest due date among the open subtasks
    days_to_next_item: int | None = None
    high_items: int = 0  # open subtasks marked HIGH


def compute_baseline(f: TaskFeatures) -> float:
    """0.4*urgency + 0.3*priority + 0.2*momentum + 0.1*size, each in 0..1."""
    days = [d for d in (f.days_to_deadline, f.days_to_next_item) if d is not None]  # the nearer of the two dates
    if f.is_overdue or (days and min(days) < 0):
        urgency = 1.0
    elif not days:
        urgency = 0.1
    else:
        urgency = max(0.0, 1.0 - min(days) / 14)
    priority = f.priority_weight / 3
    if f.high_items and f.priority_weight < 3:
        priority = max(priority, 2 / 3)  # a HIGH subtask lifts a quest that is not marked HIGH itself
    recent = 1.0 if f.days_since_activity is not None and f.days_since_activity <= 3 else 0.0
    momentum = 0.6 * f.pct_complete + 0.4 * recent
    size = 1 / (1 + max(f.open_items - 1, 0) / 5)  # fewer open subtasks => quicker win
    return round(0.4 * urgency + 0.3 * priority + 0.2 * momentum + 0.1 * size, 6)


def build_features(lists: list[dict[str, Any]], today: date) -> list[TaskFeatures]:
    out = []
    for lst in lists:
        total, done = lst["items_total"], lst["items_completed"]
        deadline = lst["deadline"]
        days = (deadline - today).days if deadline else None
        next_due = lst.get("next_item_due")
        last = lst["last_activity"] or lst["created_at"]
        feats = TaskFeatures(
            id=list_label(lst["id"]),
            list_id=lst["id"],
            name=lst["name"],
            description=lst.get("description"),
            category=lst.get("category"),
            priority=lst.get("priority"),
            deadline=deadline.isoformat() if deadline else None,
            days_to_deadline=days,
            is_overdue=days is not None and days < 0,
            priority_weight=PRIORITY_WEIGHT.get(lst.get("priority") or "", 1),
            pct_complete=round(done / total, 3) if total else 0.0,
            days_since_activity=(today - last.date()).days if last else None,
            open_items=total - done,
            next_item_due=next_due.isoformat() if next_due else None,
            days_to_next_item=(next_due - today).days if next_due else None,
            high_items=int(lst.get("high_items") or 0),
        )
        feats.baseline = compute_baseline(feats)
        out.append(feats)
    return out


def template_reason(f: TaskFeatures) -> str:
    if f.is_overdue and f.days_to_deadline is not None:
        return f"Overdue by {-f.days_to_deadline} day(s)"
    if f.days_to_deadline == 0:
        return "Due today"
    if f.days_to_deadline is not None and f.days_to_deadline <= 7:
        return f"Due in {f.days_to_deadline} day(s)"
    if f.priority == "HIGH":
        return "High priority quest"
    if f.open_items == 1:
        return "One subtask left: a quick win"
    return f"{f.open_items} subtasks remaining"


def rank_score(rank: int, n: int) -> float:
    return 1.0 if n <= 1 else 1 - (rank - 1) / (n - 1)


def is_pinned(f: TaskFeatures) -> bool:
    """Overdue HIGH-priority quests can never be reordered below other quests."""
    return f.is_overdue and f.priority == "HIGH"


def validate_ranking(ranking: RankingOut, ids: list[str]) -> list[str]:
    """Errors if the ids are not exactly a permutation of the input ids (or ranks are off)."""
    errors = []
    got = [r.id for r in ranking.ranked]
    unknown = sorted(set(got) - set(ids))
    missing = sorted(set(ids) - set(got))
    dupes = sorted({i for i in got if got.count(i) > 1})
    if unknown:
        errors.append(f"unknown ids: {unknown}")
    if missing:
        errors.append(f"missing ids: {missing}")
    if dupes:
        errors.append(f"duplicate ids: {dupes}")
    if not errors and sorted(r.rank for r in ranking.ranked) != list(range(1, len(ids) + 1)):
        errors.append("ranks must be the unique integers 1..N")
    return errors


# ── graph ────────────────────────────────────────────────────────────────────


class PrioritizeState(TypedDict, total=False):
    discord_id: str
    today: date
    limit: int | None
    lists: list[dict[str, Any]]
    tasks: list[TaskFeatures]
    llm_ranking: RankingOut | None
    llm_failed: bool
    valid: bool
    errors: list[str]
    retries: int
    focus_message: str
    used_fallback: bool
    result: list[dict[str, Any]]


def _feature_table(tasks: list[TaskFeatures]) -> str:
    rows = []
    for t in tasks:
        rows.append(
            f'[{t.id}] "{t.name}" category={t.category or "none"} priority={t.priority or "none"} '
            f"deadline={t.deadline or 'none'} days_to_deadline={t.days_to_deadline} overdue={t.is_overdue} "
            f"progress={t.pct_complete:.0%} open_items={t.open_items} days_since_activity={t.days_since_activity}"
            + (
                f" next_subtask_due={t.next_item_due} days_to_next_subtask={t.days_to_next_item}"
                if t.next_item_due
                else ""
            )
            + (f" high_priority_subtasks={t.high_items}" if t.high_items else "")
            + (f"\n  description: {t.description}" if t.description else "")
        )
    return "\n".join(rows)


def build_graph(llm_factory: Callable[..., Any], *, reserved: bool = False):
    """``reserved``: the caller already reserved the request (deps.require_ai), so no quota check here and
    only tokens are booked. No connection is held while the model runs: each DB step opens its own."""
    system, version = load_prompt("prioritize_system")

    async def load_tasks(state: PrioritizeState) -> dict:
        # prioritize() passes the lists it already loaded for the cache key.
        lists = state.get("lists")
        if not lists:
            async with pool.connection() as conn:
                lists = await repo.lists_for_user(conn, state["discord_id"], open_only=True)
        return {"lists": lists, "errors": [], "retries": 0, "llm_failed": False, "used_fallback": False}

    async def compute_features(state: PrioritizeState) -> dict:
        return {"tasks": build_features(state["lists"], state["today"])}

    async def llm_rank(state: PrioritizeState) -> dict:
        tasks = state["tasks"]
        retries = state.get("retries", 0)
        try:
            if not reserved:
                async with pool.connection() as conn:
                    await usage.check(conn, state["discord_id"])
            llm = llm_factory(reasoning=len(tasks) > REASONING_THRESHOLD, max_output_tokens=ranking_token_budget(len(tasks)))
        except (usage.QuotaExceeded, AIUnavailable) as err:
            log.info("prioritize fallback: %s", type(err).__name__)
            return {"llm_ranking": None, "llm_failed": True, "errors": [type(err).__name__]}

        extra = ""
        if state.get("errors"):
            extra = f"\n\nYour previous answer was invalid: {'; '.join(state['errors'])}. Rank every id exactly once."
        messages = [
            SystemMessage(system),
            HumanMessage(f"Today: {state['today'].isoformat()}\n<tasks>\n{prompt_safe(_feature_table(tasks))}\n</tasks>{extra}"),
        ]
        try:
            ranking, (i, o) = await structured_call(llm, RankingOut, messages)
        except Exception as err:  # noqa: BLE001 - any provider failure degrades gracefully
            log.warning("prioritize llm failed: %s", type(err).__name__)
            return {"llm_ranking": None, "llm_failed": True, "errors": [type(err).__name__]}
        async with pool.connection() as conn:
            await usage.record(
                conn, state["discord_id"], "prioritize", input_tokens=i, output_tokens=o, requests=0 if reserved else 1
            )
        log.info("prioritize prompt=%s n=%d attempt=%d tokens=%s", version, len(tasks), retries + 1, (i, o))
        return {"llm_ranking": ranking, "retries": retries + 1}

    async def validate(state: PrioritizeState) -> dict:
        ranking = state.get("llm_ranking")
        if state.get("llm_failed") or ranking is None:
            return {"valid": False}
        errors = validate_ranking(ranking, [t.id for t in state["tasks"]])
        return {"valid": not errors, "errors": errors}

    def route_after_validate(state: PrioritizeState) -> str:
        if state.get("valid"):
            return "ok"
        if state.get("llm_failed") or state.get("retries", 0) > 1:
            return "fallback"
        return "retry"  # first invalid answer: one more try with the error appended

    async def merge_scores(state: PrioritizeState) -> dict:
        tasks, ranking = state["tasks"], state["llm_ranking"]
        if ranking is None:  # only reached after validate; kept for type safety
            return await fallback_rank(state)
        n = len(tasks)
        by_base = {t.id: i + 1 for i, t in enumerate(sorted(tasks, key=lambda t: -t.baseline))}
        llm_by_id = {r.id: r for r in ranking.ranked}
        final = {t.id: 0.5 * rank_score(by_base[t.id], n) + 0.5 * rank_score(llm_by_id[t.id].rank, n) for t in tasks}
        ordered = sorted(tasks, key=lambda t: (not is_pinned(t), -final[t.id], -t.baseline))
        result = []
        for pos, t in enumerate(ordered, 1):
            r = llm_by_id[t.id]
            suggestion = r.suggested_priority if r.suggested_priority != t.priority else None
            result.append(_row(t, pos, final[t.id], r.reason[:140], suggestion))
        return {"result": result[: state.get("limit") or n], "focus_message": ranking.focus_message}

    async def fallback_rank(state: PrioritizeState) -> dict:
        ordered = sorted(state["tasks"], key=lambda t: -t.baseline)
        result = [_row(t, pos, t.baseline, template_reason(t), None) for pos, t in enumerate(ordered, 1)]
        top = ordered[0].name if ordered else None
        message = f"Start with “{top}”." if top else ""
        return {"result": result[: state.get("limit") or len(result)], "focus_message": message, "used_fallback": True}

    def after_features(state: PrioritizeState) -> str:
        return "llm_rank" if state["tasks"] else "empty"

    async def empty(state: PrioritizeState) -> dict:
        return {"result": [], "focus_message": "No open quests. Time to start a new adventure!"}

    g = StateGraph(PrioritizeState)
    g.add_node("load_tasks", load_tasks)
    g.add_node("compute_features", compute_features)
    g.add_node("llm_rank", llm_rank)
    g.add_node("validate", validate)
    g.add_node("merge_scores", merge_scores)
    g.add_node("fallback_rank", fallback_rank)
    g.add_node("empty", empty)
    g.add_edge(START, "load_tasks")
    g.add_edge("load_tasks", "compute_features")
    g.add_conditional_edges("compute_features", after_features, {"llm_rank": "llm_rank", "empty": "empty"})
    g.add_edge("llm_rank", "validate")
    g.add_conditional_edges(
        "validate", route_after_validate, {"ok": "merge_scores", "retry": "llm_rank", "fallback": "fallback_rank"}
    )
    g.add_edge("merge_scores", END)
    g.add_edge("fallback_rank", END)
    g.add_edge("empty", END)
    return g.compile()


def _row(t: TaskFeatures, rank: int, score: float, reason: str, suggestion: str | None) -> dict[str, Any]:
    return {
        "id": t.id,
        "listId": t.list_id,
        "name": t.name,
        "rank": rank,
        "score": round(score, 4),
        "reason": reason,
        "priority": t.priority,
        "deadline": t.deadline,
        "isOverdue": t.is_overdue,
        "progress": t.pct_complete,
        "suggestedPriority": suggestion,
    }


def _stamp(conn: AsyncConnection, moment: datetime) -> Any:
    """A timestamp parameter for this dialect: a datetime for asyncpg, UTC text for SQLite (what its CURRENT_TIMESTAMP writes)."""
    return moment if is_postgres(conn) else moment.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


async def _shared_get(discord_id: str, digest: str) -> dict[str, Any] | None:
    """A fresh ranking another instance (or an earlier life of this one) stored, or None. Never raises: the cache is an
    optimisation, so a missing table (migration not applied yet) or a database hiccup is just a miss."""
    try:
        async with pool.connection() as conn:
            cutoff = _stamp(conn, datetime.now(UTC) - timedelta(seconds=CACHE_TTL_SECONDS))
            row = (
                await conn.execute(
                    text(
                        "SELECT result_json FROM ai_prioritize_cache "
                        "WHERE discord_id = :uid AND cache_key = :k AND created_at > :cutoff"
                    ),
                    {"uid": discord_id, "k": digest, "cutoff": cutoff},
                )
            ).first()
    except Exception:
        log.warning("prioritize cache read failed; computing instead", exc_info=True)
        return None
    if not row:
        return None
    data = row[0]
    value = json.loads(data) if isinstance(data, (str, bytes)) else data
    return value if isinstance(value, dict) else None


async def _shared_put(discord_id: str, digest: str, value: dict[str, Any]) -> None:
    """Store a ranking for the other instances, and drop this user's expired rows. Best effort, like _shared_get."""
    try:
        async with pool.connection() as conn:
            now = datetime.now(UTC)
            await conn.execute(
                text("DELETE FROM ai_prioritize_cache WHERE discord_id = :uid AND created_at <= :cutoff"),
                {"uid": discord_id, "cutoff": _stamp(conn, now - timedelta(seconds=CACHE_TTL_SECONDS))},
            )
            await conn.execute(
                text(
                    "INSERT INTO ai_prioritize_cache (discord_id, cache_key, result_json, created_at) "
                    "VALUES (:uid, :k, :j, :at) "
                    "ON CONFLICT (discord_id, cache_key) DO UPDATE SET "
                    "result_json = excluded.result_json, created_at = excluded.created_at"
                ),
                {"uid": discord_id, "k": digest, "j": json.dumps(value, default=str), "at": _stamp(conn, now)},
            )
    except Exception:
        log.warning("prioritize cache write failed; the result is still returned", exc_info=True)


async def prioritize(
    discord_id: str,
    llm_factory: Callable[..., Any],
    *,
    limit: int | None = None,
    today: date | None = None,
    reserved: bool = False,
) -> dict[str, Any]:
    """Run the graph. Results are cached for 5 minutes per (user, open-task set): in this process's memory and in
    ai_prioritize_cache, so several AI instances share one answer.

    ``reserved``: the request was reserved up front; it is handed back when the model gave no answer
    (cache hit, nothing to rank, provider failure).
    """
    today = today or await usage.user_today(discord_id)
    graph = build_graph(llm_factory, reserved=reserved)

    async def give_back() -> None:
        if reserved:
            async with pool.connection() as conn:
                await usage.release(conn, discord_id, "prioritize")

    # Cache key = hash of the same features the model sees, so any edit invalidates it.
    async with pool.connection() as conn:
        lists = await repo.lists_for_user(conn, discord_id, open_only=True)
    sig = json.dumps([asdict(f) for f in build_features(lists, today)], sort_keys=True, default=str)
    digest = hashlib.sha256(f"{limit}:{sig}".encode()).hexdigest()
    key = f"{discord_id}:{digest}"
    if key in _cache:
        await give_back()
        return {**_cache[key], "cached": True}
    shared = await _shared_get(discord_id, digest)
    if shared is not None:
        _cache[key] = shared
        await give_back()
        return {**shared, "cached": True}

    try:
        state = await graph.ainvoke({"discord_id": discord_id, "today": today, "limit": limit, "lists": lists})
    except Exception:
        await give_back()
        raise
    if not lists or state.get("retries", 0) == 0:  # the model never answered
        await give_back()
    out = {
        "ranked": state["result"],
        "focusMessage": state.get("focus_message", ""),
        "usedFallback": bool(state.get("used_fallback")),
        "cached": False,
    }
    if not out["usedFallback"] and out["ranked"]:
        value = {k: v for k, v in out.items() if k != "cached"}
        _cache[key] = value
        await _shared_put(discord_id, digest, value)
    return out


def clear_cache() -> None:
    """Forget this process's memory (the shared rows stay until they expire, as they would for another instance)."""
    _cache.clear()
