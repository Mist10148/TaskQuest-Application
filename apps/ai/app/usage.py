"""Per-user daily quotas and token accounting (``ai_usage``)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db.dialect import is_postgres

FEATURES = ("summary", "prioritize", "chat", "embed")


class QuotaExceeded(Exception):
    """The user used up today's AI requests (resets at midnight UTC)."""


def today_utc() -> str:
    return datetime.now(UTC).date().isoformat()


async def requests_today(conn: AsyncConnection, discord_id: str) -> int:
    result = await conn.execute(
        text("SELECT COALESCE(SUM(requests), 0) FROM ai_usage WHERE discord_id = :uid AND day = :day"),
        {"uid": discord_id, "day": today_utc()},
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


async def _add(conn: AsyncConnection, discord_id: str, feature: str, requests: int, i: int, o: int) -> None:
    """Atomic upsert (no read-then-write race between concurrent requests)."""
    params = {"uid": discord_id, "day": today_utc(), "f": feature, "n": requests, "i": i, "o": o}
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


async def reserve(conn: AsyncConnection, discord_id: str, feature: str) -> None:
    """Spend one request up front, atomically, or raise QuotaExceeded (and leave nothing booked).

    The increment happens before the limit is read, so concurrent requests cannot all slip under
    the limit. Each feature has its own row, so on Postgres the user's row is locked first: reservations of one user
    queue up (a plain read would miss another feature's booking, and locking the usage rows one by one deadlocks).
    Run it inside a transaction that rolls back when this raises.
    """
    assert feature in FEATURES
    if is_postgres(conn):
        await conn.execute(text("SELECT 1 FROM users WHERE discord_id = :uid FOR UPDATE"), {"uid": discord_id})
    await _add(conn, discord_id, feature, 1, 0, 0)
    if await requests_today(conn, discord_id) > get_settings().ai_daily_request_limit:
        raise QuotaExceeded


async def release(conn: AsyncConnection, discord_id: str, feature: str) -> None:
    """Hand back a reserved request when the call never reached the model (404, cache hit, LLM down)."""
    await conn.execute(
        text(
            "UPDATE ai_usage SET requests = CASE WHEN requests > 0 THEN requests - 1 ELSE 0 END "
            "WHERE discord_id = :uid AND day = :day AND feature = :f"
        ),
        {"uid": discord_id, "day": today_utc(), "f": feature},
    )


def tokens_from(message: Any) -> tuple[int, int]:
    """(input, output) tokens from a LangChain message's ``usage_metadata`` (0, 0 if absent)."""
    meta = getattr(message, "usage_metadata", None) or {}
    return int(meta.get("input_tokens", 0) or 0), int(meta.get("output_tokens", 0) or 0)
