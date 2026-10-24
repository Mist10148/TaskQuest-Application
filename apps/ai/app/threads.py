"""Chat thread rows (``ai_chat_threads``). Every function takes ``discord_id`` and scopes by it.

``source`` separates web chat threads ("web") from Discord conversation memory ("discord"); the web
endpoints only ever see "web" threads.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

DEFAULT_TITLE = "New chat"
WEB = "web"
DISCORD = "discord"


def title_from(message: str) -> str:
    one_line = " ".join(message.split())
    return one_line[:60] + ("…" if len(one_line) > 60 else "")


async def create_thread(
    conn: AsyncConnection, discord_id: str, first_message: str, *, thread_id: str | None = None, source: str = WEB
) -> str:
    """Insert a thread. A row that already exists is left alone, so concurrent first messages of the
    same (user, channel) conversation cannot fail with a duplicate key."""
    thread_id = thread_id or str(uuid.uuid4())
    await conn.execute(
        text(
            "INSERT INTO ai_chat_threads (id, discord_id, title, source) "
            "VALUES (:id, :uid, :title, :src) ON CONFLICT DO NOTHING"
        ),
        {"id": thread_id, "uid": discord_id, "title": title_from(first_message) or DEFAULT_TITLE, "src": source},
    )
    return thread_id


async def get_thread(
    conn: AsyncConnection, discord_id: str, thread_id: str, *, source: str = WEB
) -> dict[str, Any] | None:
    row = (
        (
            await conn.execute(
                text(
                    "SELECT id, title, created_at, updated_at FROM ai_chat_threads "
                    "WHERE id = :id AND discord_id = :uid AND source = :src"
                ),
                {"id": thread_id, "uid": discord_id, "src": source},
            )
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


async def list_threads(conn: AsyncConnection, discord_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        (
            await conn.execute(
                text(
                    "SELECT id, title, created_at, updated_at FROM ai_chat_threads "
                    "WHERE discord_id = :uid AND source = :src ORDER BY updated_at DESC LIMIT :limit"
                ),
                {"uid": discord_id, "limit": limit, "src": WEB},
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


async def touch_thread(conn: AsyncConnection, discord_id: str, thread_id: str) -> None:
    await conn.execute(
        text("UPDATE ai_chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = :id AND discord_id = :uid"),
        {"id": thread_id, "uid": discord_id},
    )


async def rename_thread(conn: AsyncConnection, discord_id: str, thread_id: str, title: str) -> None:
    await conn.execute(
        text(
            "UPDATE ai_chat_threads SET title = :title, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND discord_id = :uid"
        ),
        {"id": thread_id, "uid": discord_id, "title": title[:120]},
    )


async def delete_thread(conn: AsyncConnection, discord_id: str, thread_id: str, *, source: str = WEB) -> bool:
    """Delete the thread row (checkpoints cascade in Postgres; callers also clear them explicitly)."""
    result = await conn.execute(
        text("DELETE FROM ai_chat_threads WHERE id = :id AND discord_id = :uid AND source = :src"),
        {"id": thread_id, "uid": discord_id, "src": source},
    )
    return result.rowcount > 0


KEEP_CHECKPOINTS = 3
"""Checkpoints kept per thread: the latest (the only one read) and a little history behind it."""
DISCORD_IDLE_DAYS = 30
WEB_IDLE_DAYS = 90


async def prune_checkpoints(conn: AsyncConnection, thread_id: str, keep: int = KEEP_CHECKPOINTS) -> None:
    """Drop all but the newest ``keep`` checkpoints of a thread, with their writes.

    Every graph step stores a full copy of the state, and only the latest is ever loaded, so the rest is
    dead weight that grows with every message. Checkpoint ids are time-ordered, so "newest" is the greatest id.
    """
    newest = (
        "SELECT checkpoint_id FROM ai_checkpoints WHERE thread_id = :t ORDER BY checkpoint_id DESC LIMIT :keep"
    )
    for table in ("ai_checkpoint_writes", "ai_checkpoints"):
        await conn.execute(
            text(f"DELETE FROM {table} WHERE thread_id = :t AND checkpoint_id NOT IN ({newest})"),  # noqa: S608
            {"t": str(thread_id), "keep": keep},
        )


async def prune_idle_threads(conn: AsyncConnection, now: datetime | None = None) -> int:
    """Delete threads nobody has used for a long time (Discord memory: 30 days, web chats: 90), with their checkpoints.

    Returns how many threads went. The checkpoint tables are cleared explicitly as well, since only
    PostgreSQL cascades.
    """
    now = now or datetime.now(UTC)
    removed = 0
    for source, days in ((DISCORD, DISCORD_IDLE_DAYS), (WEB, WEB_IDLE_DAYS)):
        params = {"src": source, "cutoff": now - timedelta(days=days)}
        stale = "SELECT id FROM ai_chat_threads WHERE source = :src AND updated_at < :cutoff"
        for table in ("ai_checkpoint_writes", "ai_checkpoints"):
            await conn.execute(text(f"DELETE FROM {table} WHERE thread_id IN ({stale})"), params)  # noqa: S608
        result = await conn.execute(text(f"DELETE FROM ai_chat_threads WHERE id IN ({stale})"), params)  # noqa: S608
        removed += result.rowcount or 0
    return removed
