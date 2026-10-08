"""Chat thread rows (``ai_chat_threads``). Every function takes ``discord_id`` and scopes by it."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

DEFAULT_TITLE = "New chat"


def title_from(message: str) -> str:
    one_line = " ".join(message.split())
    return one_line[:60] + ("…" if len(one_line) > 60 else "")


async def create_thread(conn: AsyncConnection, discord_id: str, first_message: str) -> str:
    thread_id = str(uuid.uuid4())
    await conn.execute(
        text("INSERT INTO ai_chat_threads (id, discord_id, title) VALUES (:id, :uid, :title)"),
        {"id": thread_id, "uid": discord_id, "title": title_from(first_message) or DEFAULT_TITLE},
    )
    return thread_id


async def get_thread(conn: AsyncConnection, discord_id: str, thread_id: str) -> dict[str, Any] | None:
    row = (
        (
            await conn.execute(
                text(
                    "SELECT id, title, created_at, updated_at FROM ai_chat_threads WHERE id = :id AND discord_id = :uid"
                ),
                {"id": thread_id, "uid": discord_id},
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
                    "SELECT id, title, created_at, updated_at FROM ai_chat_threads WHERE discord_id = :uid "
                    "ORDER BY updated_at DESC LIMIT :limit"
                ),
                {"uid": discord_id, "limit": limit},
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
        text("UPDATE ai_chat_threads SET title = :title WHERE id = :id AND discord_id = :uid"),
        {"id": thread_id, "uid": discord_id, "title": title[:120]},
    )


async def delete_thread(conn: AsyncConnection, discord_id: str, thread_id: str) -> bool:
    """Delete the thread row (checkpoints cascade in MySQL; callers also clear them explicitly)."""
    result = await conn.execute(
        text("DELETE FROM ai_chat_threads WHERE id = :id AND discord_id = :uid"), {"id": thread_id, "uid": discord_id}
    )
    return result.rowcount > 0
