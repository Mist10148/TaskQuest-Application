"""Per-user daily quotas and token accounting (``ai_usage``).

A "day" is the user's own calendar day: it starts at their local midnight (``users.timezone``, UTC until they set one), so
the quota refills when their day starts, like the daily caps and quests in the rest of TaskQuest.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db import pool
from app.db.dialect import is_postgres

FEATURES = ("summary", "prioritize", "chat", "embed")


class QuotaExceeded(Exception):
    """The user used up today's AI requests (resets at their local midnight)."""


def _now() -> datetime:
    """The current instant; tests replace it to move the clock."""
    return datetime.now(UTC)


def day_in_zone(zone_name: str | None, now: datetime | None = None) -> str:
    """The calendar day (``YYYY-MM-DD``) it is in ``zone_name`` at ``now``; UTC for a missing or unknown zone."""
    zone: tzinfo = UTC
    if zone_name:
        try:
            zone = ZoneInfo(zone_name)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            zone = UTC  # a zone this server cannot resolve must not stop the quota from working
    return (now or _now()).astimezone(zone).date().isoformat()


def today_utc() -> str:
    return day_in_zone(None)


async def user_day(conn: AsyncConnection, discord_id: str) -> str:
    """Today's date in the user's time zone (the ``day`` key of their ``ai_usage`` rows)."""
    result = await conn.execute(text("SELECT timezone FROM users WHERE discord_id = :uid"), {"uid": discord_id})
    row = result.first()
    return day_in_zone(row[0] if row else None)


async def user_today(discord_id: str) -> date:
    """The user's calendar date, for "overdue" and "due soon". A lookup failure means UTC rather than no answer."""
    try:
        async with pool.connection() as conn:
            return date.fromisoformat(await user_day(conn, discord_id))
    except Exception:  # noqa: BLE001 - never block a summary or a chat turn on the time zone lookup
        return _now().date()


async def requests_today(conn: AsyncConnection, discord_id: str) -> int:
    result = await conn.execute(
        text("SELECT COALESCE(SUM(requests), 0) FROM ai_usage WHERE discord_id = :uid AND day = :day"),
        {"uid": discord_id, "day": await user_day(conn, discord_id)},
    )
    return int(result.scalar() or 0)


async def check(conn: AsyncConnection, discord_id: str) -> None:
    """Raise QuotaExceeded before an LLM call if the daily limit is reached."""
    if await requests_today(conn, discord_id) >= get_settings().ai_daily_request_limit:
        raise QuotaExceeded


async def record(
    conn: AsyncConnection,
    discord_id: str,
    feature: str,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    requests: int = 1,
) -> None:
    """Add to today's usage. ``requests=0`` books tokens for a side call (e.g. a thread title) without
    spending the user's quota."""
    assert feature in FEATURES
    await _add(conn, discord_id, feature, int(requests), int(input_tokens), int(output_tokens))


async def _add(conn: AsyncConnection, discord_id: str, feature: str, requests: int, i: int, o: int) -> str:
    """Atomic upsert (no read-then-write race between concurrent requests). Returns the day it booked."""
    day = await user_day(conn, discord_id)
    params = {"uid": discord_id, "day": day, "f": feature, "n": requests, "i": i, "o": o}
    clause = (
        "ON CONFLICT (discord_id, day, feature) DO UPDATE SET requests = ai_usage.requests + excluded.requests, "
        "input_tokens = ai_usage.input_tokens + excluded.input_tokens, "
        "output_tokens = ai_usage.output_tokens + excluded.output_tokens"
    )
    await conn.execute(
        text(
            "INSERT INTO ai_usage (discord_id, day, feature, requests, input_tokens, output_tokens) "
            f"VALUES (:uid, :day, :f, :n, :i, :o) {clause}"
        ),
        params,
    )
    return day


async def reserve(conn: AsyncConnection, discord_id: str, feature: str) -> str:
    """Spend one request up front, atomically, or raise QuotaExceeded (and leave nothing booked).

    The increment happens before the limit is read, so concurrent requests cannot all slip under
    the limit. Each feature has its own row, so on Postgres the user's row is locked first: reservations of one user
    queue up (a plain read would miss another feature's booking, and locking the usage rows one by one deadlocks).
    Run it inside a transaction that rolls back when this raises. Returns the day the request was booked on, for release().
    """
    assert feature in FEATURES
    if is_postgres(conn):
        await conn.execute(text("SELECT 1 FROM users WHERE discord_id = :uid FOR UPDATE"), {"uid": discord_id})
    day = await _add(conn, discord_id, feature, 1, 0, 0)
    if await requests_today(conn, discord_id) > get_settings().ai_daily_request_limit:
        raise QuotaExceeded
    return day


async def release(conn: AsyncConnection, discord_id: str, feature: str, day: str | None = None) -> None:
    """Hand back a reserved request when the call never reached the model (404, cache hit, LLM down).

    ``day``: the day reserve() booked it on. A call that crosses the user's midnight refunds that day, not the new one
    (which would leave the old day spent and hand out an extra request today). Without it, today.
    """
    await conn.execute(
        text(
            "UPDATE ai_usage SET requests = CASE WHEN requests > 0 THEN requests - 1 ELSE 0 END "
            "WHERE discord_id = :uid AND day = :day AND feature = :f"
        ),
        {"uid": discord_id, "day": day or await user_day(conn, discord_id), "f": feature},
    )


def tokens_from(message: Any) -> tuple[int, int]:
    """(input, output) tokens from a LangChain message's ``usage_metadata`` (0, 0 if absent)."""
    meta = getattr(message, "usage_metadata", None) or {}
    return int(meta.get("input_tokens", 0) or 0), int(meta.get("output_tokens", 0) or 0)
