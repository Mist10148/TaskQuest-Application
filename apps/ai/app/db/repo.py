"""Scoped, read-oriented queries. EVERY function takes ``discord_id`` and filters by it.

A unit test enforces this signature rule, so a new query cannot accidentally read
across users. Writes here are limited to ``ai_*`` tables; task changes go through
Express (``/internal/*``) so XP and achievements stay correct.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


def to_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def to_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    return datetime.fromisoformat(str(value))


def _rows(result) -> list[dict[str, Any]]:
    return [dict(r) for r in result.mappings().all()]


# ── lists / items ────────────────────────────────────────────────────────────

_LIST_COLUMNS = """
    l.id, l.name, l.description, l.category, l.deadline, l.priority, l.created_at,
    (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS items_total,
    (SELECT COALESCE(SUM(i.completed), 0) FROM items i WHERE i.list_id = l.id) AS items_completed,
    (SELECT MAX(COALESCE(i.completed_at, i.updated_at)) FROM items i WHERE i.list_id = l.id) AS last_activity
"""


async def _load_lists(conn: AsyncConnection, discord_id: str, list_id: int | None = None) -> list[dict[str, Any]]:
    where = "l.discord_id = :uid" + (" AND l.id = :lid" if list_id is not None else "")
    rows = _rows(
        await conn.execute(
            text(f"SELECT {_LIST_COLUMNS} FROM lists l WHERE {where} ORDER BY l.id"),
            {"uid": discord_id, "lid": list_id},
        )
    )
    for r in rows:
        r["items_total"] = int(r["items_total"] or 0)
        r["items_completed"] = int(r["items_completed"] or 0)
        r["deadline"] = to_date(r["deadline"])
        r["created_at"] = to_datetime(r["created_at"])
        r["last_activity"] = to_datetime(r["last_activity"])
    return rows


async def lists_for_user(conn: AsyncConnection, discord_id: str, *, open_only: bool = False) -> list[dict[str, Any]]:
    """The user's lists with item counts. ``open_only`` keeps lists with no items or unfinished items."""
    rows = await _load_lists(conn, discord_id)
    if open_only:
        rows = [r for r in rows if r["items_total"] == 0 or r["items_completed"] < r["items_total"]]
    return rows


async def items_for_list(conn: AsyncConnection, discord_id: str, list_id: int) -> list[dict[str, Any]]:
    result = await conn.execute(
        text(
            "SELECT i.id, i.list_id, i.name, i.description, i.completed, i.completed_at, i.position "
            "FROM items i JOIN lists l ON l.id = i.list_id "
            "WHERE l.discord_id = :uid AND i.list_id = :lid ORDER BY i.position, i.id"
        ),
        {"uid": discord_id, "lid": list_id},
    )
    rows = _rows(result)
    for r in rows:
        r["completed"] = bool(r["completed"])
        r["completed_at"] = to_datetime(r["completed_at"])
    return rows


async def get_list_with_items(conn: AsyncConnection, discord_id: str, list_id: int) -> dict[str, Any] | None:
    """One of the user's lists with its items, or None (also when it belongs to someone else)."""
    rows = await _load_lists(conn, discord_id, list_id)
    if not rows:
        return None
    lst = rows[0]
    lst["items"] = await items_for_list(conn, discord_id, list_id)
    return lst


async def all_items_for_user(conn: AsyncConnection, discord_id: str) -> list[dict[str, Any]]:
    result = await conn.execute(
        text(
            "SELECT i.id, i.list_id, i.name, i.description, i.completed, i.completed_at, i.position "
            "FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = :uid ORDER BY i.list_id, i.position, i.id"
        ),
        {"uid": discord_id},
    )
    rows = _rows(result)
    for r in rows:
        r["completed"] = bool(r["completed"])
        r["completed_at"] = to_datetime(r["completed_at"])
    return rows


async def completions_since(conn: AsyncConnection, discord_id: str, since: datetime) -> list[dict[str, Any]]:
    """Subtasks completed at or after ``since``, with their quest name."""
    result = await conn.execute(
        text(
            "SELECT i.id, i.list_id, i.name, i.completed_at, l.name AS list_name "
            "FROM items i JOIN lists l ON l.id = i.list_id "
            "WHERE l.discord_id = :uid AND i.completed = 1 AND i.completed_at >= :since ORDER BY i.completed_at"
        ),
        {"uid": discord_id, "since": since},
    )
    rows = _rows(result)
    for r in rows:
        r["completed_at"] = to_datetime(r["completed_at"])
    return rows


async def xp_events_since(conn: AsyncConnection, discord_id: str, since: datetime) -> list[tuple[datetime, int]]:
    """Positive XP grants at or after ``since`` as (created_at, amount)."""
    result = await conn.execute(
        text(
            "SELECT created_at, amount FROM xp_transactions "
            "WHERE discord_id = :uid AND amount > 0 AND created_at >= :since ORDER BY created_at"
        ),
        {"uid": discord_id, "since": since},
    )
    out = []
    for created_at, amount in result.all():
        at = to_datetime(created_at)
        if at is not None:
            out.append((at, int(amount)))
    return out


async def xp_since(conn: AsyncConnection, discord_id: str, since: datetime) -> int:
    result = await conn.execute(
        text(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM xp_transactions "
            "WHERE discord_id = :uid AND amount > 0 AND created_at >= :since"
        ),
        {"uid": discord_id, "since": since},
    )
    return int(result.scalar() or 0)


async def get_user_stats(conn: AsyncConnection, discord_id: str) -> dict[str, Any] | None:
    result = await conn.execute(
        text("SELECT player_xp, lifetime_xp, player_level, streak_count FROM users WHERE discord_id = :uid"),
        {"uid": discord_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def ai_enabled(conn: AsyncConnection, discord_id: str) -> bool:
    result = await conn.execute(text("SELECT ai_enabled FROM users WHERE discord_id = :uid"), {"uid": discord_id})
    row = result.first()
    return bool(row and row[0])
