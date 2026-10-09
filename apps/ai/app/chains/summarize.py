"""Feature 1: summarizer (an LCEL chain, no graph needed).

load data -> render compact text -> cache check -> (map-reduce if huge) -> LLM structured
output -> validate ids (retry once, then drop unknown ids) -> cache.

The model call is ``SUMMARY_PROMPT | structured step``; the step goes through ``structured_call``
so token counts and safety-blocked replies are handled like every other feature.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from langchain_core.prompt_values import PromptValue
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable, RunnableLambda
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db import repo
from app.llm_call import structured_call
from app.prompts import load_prompt
from app.rag.chunking import item_label, list_label, sha256

log = logging.getLogger("taskquest.ai.summarize")

Mode = Literal["list", "digest", "recap"]


class Summary(BaseModel):
    headline: str = Field(description="One punchy sentence, max 120 characters")
    highlights: list[str] = Field(default_factory=list, description="Up to 5 short bullets")
    blockers: list[str] = Field(default_factory=list, description="Overdue or stuck items")
    next_steps: list[str] = Field(default_factory=list, description="Up to 3 concrete actions")
    referenced_ids: list[str] = Field(default_factory=list, description='Every task id mentioned, e.g. ["L42", "I311"]')


# Values are substituted as plain text, so braces in the system prompt or task data are safe.
SUMMARY_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "{system}"),
        ("human", "Mode: {mode}\nToday: {today}\n<tasks>\n{body}\n</tasks>{extra}"),
    ]
)


class NotFound(Exception):
    """The requested list does not exist for this user."""


@dataclass
class RenderedInput:
    scope_key: str
    text: str
    valid_ids: set[str]


def _fmt_list(lst: dict[str, Any], items: list[dict[str, Any]] | None, today: date) -> str:
    dl = lst["deadline"]
    when = "no deadline"
    if dl:
        delta = (dl - today).days
        if delta < 0:
            rel = f"OVERDUE by {-delta} days"
        elif delta == 0:
            rel = "due today"
        else:
            rel = f"in {delta} days"
        when = f"deadline {dl.isoformat()} ({rel})"
    head = (
        f'[{list_label(lst["id"])}] "{lst["name"]}" priority={lst.get("priority") or "none"} '
        f"category={lst.get('category') or 'none'} {when} progress={lst['items_completed']}/{lst['items_total']}"
    )
    lines = [head]
    if lst.get("description"):
        lines.append(f"  description: {lst['description']}")
    for it in items or []:
        lines.append(f"  [{item_label(it['id'])}] [{'x' if it['completed'] else ' '}] {it['name']}")
    return "\n".join(lines)


async def render_input(
    conn: AsyncConnection,
    discord_id: str,
    mode: Mode,
    *,
    list_id: int | None = None,
    range_: str = "week",
    today: date | None = None,
) -> RenderedInput:
    today = today or datetime.now(UTC).date()
    if mode == "list":
        if list_id is None:
            raise NotFound
        lst = await repo.get_list_with_items(conn, discord_id, list_id)
        if lst is None:
            raise NotFound
        items = lst.pop("items")
        ids = {list_label(lst["id"]), *(item_label(i["id"]) for i in items)}
        return RenderedInput(f"list:{list_id}", _fmt_list(lst, items, today), ids)

    if mode == "digest":
        lists = await repo.lists_for_user(conn, discord_id, open_only=True)
        blocks: list[str] = []
        ids = set()
        for lst in lists:
            items = [i for i in await repo.items_for_list(conn, discord_id, lst["id"]) if not i["completed"]]
            blocks.append(_fmt_list(lst, items, today))
            ids |= {list_label(lst["id"]), *(item_label(i["id"]) for i in items)}
        soon = [lst for lst in lists if lst["deadline"] and (lst["deadline"] - today).days <= 7]
        header = f"Open quests: {len(lists)}; overdue or due within 7 days: {len(soon)}"
        return RenderedInput(f"digest:{today.isoformat()}", header + "\n\n" + "\n\n".join(blocks), ids)

    # recap
    days = 1 if range_ == "day" else 7
    since = datetime.combine(today - timedelta(days=days - 1), datetime.min.time())
    done = await repo.completions_since(conn, discord_id, since)
    xp = await repo.xp_since(conn, discord_id, since)
    lines = [
        f"Period: last {days} day(s) since {since.date().isoformat()}",
        f"XP earned: {xp}",
        f"Subtasks completed: {len(done)}",
    ]
    ids = set()
    for c in done:
        ids |= {item_label(c["id"]), list_label(c["list_id"])}
        lines.append(
            f'[{item_label(c["id"])}] "{c["name"]}" in [{list_label(c["list_id"])}] "{c["list_name"]}" at {c["completed_at"]:%Y-%m-%d %H:%M}'
        )
    return RenderedInput(f"recap:{range_}:{today.isoformat()}", "\n".join(lines), ids)


def split_blocks(rendered: str, max_chars: int) -> list[str]:
    """Group blank-line separated blocks into parts of at most ``max_chars`` (for map-reduce)."""
    parts, current = [], ""
    for block in rendered.split("\n\n"):
        if current and len(current) + len(block) + 2 > max_chars:
            parts.append(current)
            current = ""
        current += ("\n\n" if current else "") + block
    if current:
        parts.append(current)
    return parts


def clean(summary: Summary, valid_ids: set[str]) -> tuple[Summary, list[str]]:
    """Trim to the contract and drop referenced ids that were not in the input. Returns (summary, dropped)."""
    dropped = [i for i in summary.referenced_ids if i not in valid_ids]
    return (
        Summary(
            headline=summary.headline[:120],
            highlights=summary.highlights[:5],
            blockers=summary.blockers,
            next_steps=summary.next_steps[:3],
            referenced_ids=[i for i in dict.fromkeys(summary.referenced_ids) if i in valid_ids],
        ),
        dropped,
    )


class Summarizer:
    def __init__(self, llm: Any) -> None:
        self.llm = llm
        self.system, self.prompt_version = load_prompt("summarize_system")
        self.tokens = [0, 0]
        self.llm_calls = 0
        self.chain: Runnable[dict[str, Any], Summary] = SUMMARY_PROMPT | RunnableLambda(self._structured)

    async def _structured(self, prompt: PromptValue) -> Summary:
        parsed, (i, o) = await structured_call(self.llm, Summary, prompt.to_messages())
        self.tokens[0] += i
        self.tokens[1] += o
        self.llm_calls += 1
        return parsed

    async def _ask(self, mode: str, today: date, body: str, extra: str = "") -> Summary:
        return await self.chain.ainvoke(
            {"system": self.system, "mode": mode, "today": today.isoformat(), "body": body, "extra": extra}
        )

    async def summarize_text(self, mode: str, today: date, rendered: RenderedInput) -> tuple[Summary, int]:
        """Returns (validated summary, number of unknown ids dropped)."""
        body = rendered.text
        limit = get_settings().summary_map_reduce_chars
        if len(body) > limit:  # map-reduce: summarize each part, then summarize the summaries
            partials = [
                clean(await self._ask(mode, today, part), rendered.valid_ids)[0]
                for part in split_blocks(body, limit // 2)
            ]
            body = "Partial summaries of the user's data:\n" + "\n".join(json.dumps(p.model_dump()) for p in partials)

        summary = await self._ask(mode, today, body)
        summary, dropped = clean(summary, rendered.valid_ids)
        if dropped:  # retry once, telling the model which ids were invalid
            retry = await self._ask(
                mode,
                today,
                body,
                f"\n\nYour previous answer referenced ids that do not exist: {dropped}. Use only ids from the input.",
            )
            summary, dropped = clean(retry, rendered.valid_ids)
        return summary, len(dropped)


async def get_cached(conn: AsyncConnection, discord_id: str, scope_key: str, input_hash: str) -> Summary | None:
    row = (
        await conn.execute(
            text("SELECT input_hash, summary_json FROM ai_summary_cache WHERE discord_id = :uid AND scope_key = :k"),
            {"uid": discord_id, "k": scope_key},
        )
    ).first()
    if row and row[0] == input_hash:
        data = row[1]
        return Summary.model_validate(json.loads(data) if isinstance(data, (str, bytes)) else data)
    return None


async def put_cache(conn: AsyncConnection, discord_id: str, scope_key: str, input_hash: str, summary: Summary) -> None:
    params = {"uid": discord_id, "k": scope_key, "h": input_hash, "j": summary.model_dump_json()}
    updated = await conn.execute(
        text(
            "UPDATE ai_summary_cache SET input_hash = :h, summary_json = :j, created_at = CURRENT_TIMESTAMP "
            "WHERE discord_id = :uid AND scope_key = :k"
        ),
        params,
    )
    if updated.rowcount == 0:
        await conn.execute(
            text(
                "INSERT INTO ai_summary_cache (discord_id, scope_key, input_hash, summary_json) VALUES (:uid, :k, :h, :j)"
            ),
            params,
        )


async def summarize(
    conn: AsyncConnection,
    discord_id: str,
    llm_factory,
    mode: Mode,
    *,
    list_id: int | None = None,
    range_: str = "week",
    today: date | None = None,
) -> dict[str, Any]:
    """Full flow. ``llm_factory`` is only called on a cache miss, so cache hits cost no quota or LLM setup."""
    from app import usage

    today = today or datetime.now(UTC).date()
    rendered = await render_input(conn, discord_id, mode, list_id=list_id, range_=range_, today=today)
    input_hash = sha256(f"{mode}\n{rendered.text}")

    cached = await get_cached(conn, discord_id, rendered.scope_key, input_hash)
    if cached:
        return {**cached.model_dump(), "mode": mode, "cached": True}
    if not rendered.valid_ids:  # nothing to summarize: no LLM call
        empty = Summary(
            headline="Nothing to summarize yet",
            highlights=[],
            blockers=[],
            next_steps=["Create a quest to get started"],
        )
        return {**empty.model_dump(), "mode": mode, "cached": False}

    await usage.check(conn, discord_id)
    summarizer = Summarizer(llm_factory())
    started = time.monotonic()
    summary, dropped = await summarizer.summarize_text(mode, today, rendered)
    await usage.record(
        conn, discord_id, "summary", input_tokens=summarizer.tokens[0], output_tokens=summarizer.tokens[1]
    )
    await put_cache(conn, discord_id, rendered.scope_key, input_hash, summary)
    log.info(
        "summary mode=%s prompt=%s calls=%d dropped_ids=%d tokens=%s ms=%d",
        mode,
        summarizer.prompt_version,
        summarizer.llm_calls,
        dropped,
        tuple(summarizer.tokens),
        (time.monotonic() - started) * 1000,
    )
    return {**summary.model_dump(), "mode": mode, "cached": False}
