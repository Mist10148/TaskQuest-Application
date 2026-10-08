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
from datetime import UTC, date, datetime
from typing import Any, Literal, TypedDict

from cachetools import TTLCache
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncConnection

from app import usage
from app.db import repo
from app.llm import AIUnavailable
from app.llm_call import structured_call
from app.prompts import load_prompt
from app.rag.chunking import list_label

log = logging.getLogger("taskquest.ai.prioritize")

PRIORITY_WEIGHT = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
REASONING_THRESHOLD = 15  # use the Pro model only above this many open quests
_cache: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=500, ttl=300)


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


def compute_baseline(f: TaskFeatures) -> float:
    """0.4*urgency + 0.3*priority + 0.2*momentum + 0.1*size, each in 0..1."""
    if f.is_overdue:
        urgency = 1.0
    elif f.days_to_deadline is None:
        urgency = 0.1
    else:
        urgency = max(0.0, 1.0 - f.days_to_deadline / 14)
    priority = f.priority_weight / 3
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
        )
        feats.baseline = compute_baseline(feats)
        out.append(feats)
    return out


def template_reason(f: TaskFeatures) -> str:
    if f.is_overdue:
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
            + (f"\n  description: {t.description}" if t.description else "")
        )
    return "\n".join(rows)


def build_graph(conn: AsyncConnection, llm_factory: Callable[..., Any]):
    system, version = load_prompt("prioritize_system")

    async def load_tasks(state: PrioritizeState) -> dict:
        lists = await repo.lists_for_user(conn, state["discord_id"], open_only=True)
        return {"lists": lists, "errors": [], "retries": 0, "llm_failed": False, "used_fallback": False}

    async def compute_features(state: PrioritizeState) -> dict:
        return {"tasks": build_features(state["lists"], state["today"])}

    async def llm_rank(state: PrioritizeState) -> dict:
        tasks = state["tasks"]
        retries = state.get("retries", 0)
        try:
            await usage.check(conn, state["discord_id"])
            llm = llm_factory(reasoning=len(tasks) > REASONING_THRESHOLD)
        except (usage.QuotaExceeded, AIUnavailable) as err:
            log.info("prioritize fallback: %s", type(err).__name__)
            return {"llm_ranking": None, "llm_failed": True, "errors": [type(err).__name__]}

        extra = ""
        if state.get("errors"):
            extra = f"\n\nYour previous answer was invalid: {'; '.join(state['errors'])}. Rank every id exactly once."
        messages = [
            SystemMessage(system),
            HumanMessage(f"Today: {state['today'].isoformat()}\n<tasks>\n{_feature_table(tasks)}\n</tasks>{extra}"),
        ]
        try:
            ranking, (i, o) = await structured_call(llm, RankingOut, messages)
        except Exception as err:  # noqa: BLE001 - any provider failure degrades gracefully
            log.warning("prioritize llm failed: %s", type(err).__name__)
            return {"llm_ranking": None, "llm_failed": True, "errors": [type(err).__name__]}
        await usage.record(conn, state["discord_id"], "prioritize", input_tokens=i, output_tokens=o)
        log.info("prioritize prompt=%s n=%d attempt=%d tokens=%s", version, len(tasks), retries + 1, (i, o))
        return {"llm_ranking": ranking, "retries": retries + 1}

    async def validate(state: PrioritizeState) -> dict:
        if state.get("llm_failed") or state.get("llm_ranking") is None:
            return {"valid": False}
        errors = validate_ranking(state["llm_ranking"], [t.id for t in state["tasks"]])
        return {"valid": not errors, "errors": errors}

    def route_after_validate(state: PrioritizeState) -> str:
        if state.get("valid"):
            return "ok"
        if state.get("llm_failed") or state.get("retries", 0) > 1:
            return "fallback"
        return "retry"  # first invalid answer: one more try with the error appended

    async def merge_scores(state: PrioritizeState) -> dict:
        tasks, ranking = state["tasks"], state["llm_ranking"]
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


async def prioritize(
    conn: AsyncConnection,
    discord_id: str,
    llm_factory: Callable[..., Any],
    *,
    limit: int | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Run the graph. Results are cached for 5 minutes per (user, open-task set)."""
    today = today or datetime.now(UTC).date()
    graph = build_graph(conn, llm_factory)

    # Cache key = hash of the same features the model sees, so any edit invalidates it.
    lists = await repo.lists_for_user(conn, discord_id, open_only=True)
    sig = json.dumps([asdict(f) for f in build_features(lists, today)], sort_keys=True, default=str)
    key = f"{discord_id}:{limit}:{hashlib.sha256(sig.encode()).hexdigest()}"
    if key in _cache:
        return {**_cache[key], "cached": True}

    state = await graph.ainvoke({"discord_id": discord_id, "today": today, "limit": limit})
    out = {
        "ranked": state["result"],
        "focusMessage": state.get("focus_message", ""),
        "usedFallback": bool(state.get("used_fallback")),
        "cached": False,
    }
    if not out["usedFallback"] and out["ranked"]:
        _cache[key] = {k: v for k, v in out.items() if k != "cached"}
    return out


def clear_cache() -> None:
    _cache.clear()
