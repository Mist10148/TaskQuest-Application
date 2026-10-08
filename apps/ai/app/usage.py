"""Per-user daily quotas and token accounting (``ai_usage``)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings

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
    conn: AsyncConnection, discord_id: str, feature: str, *, input_tokens: int = 0, output_tokens: int = 0
) -> None:
    assert feature in FEATURES
    params = {
        "uid": discord_id,
        "day": today_utc(),
        "f": feature,
        "i": int(input_tokens),
        "o": int(output_tokens),
    }
    updated = await conn.execute(
        text(
            "UPDATE ai_usage SET requests = requests + 1, input_tokens = input_tokens + :i, "
            "output_tokens = output_tokens + :o WHERE discord_id = :uid AND day = :day AND feature = :f"
        ),
        params,
    )
    if updated.rowcount == 0:
        await conn.execute(
            text(
                "INSERT INTO ai_usage (discord_id, day, feature, requests, input_tokens, output_tokens) "
                "VALUES (:uid, :day, :f, 1, :i, :o)"
            ),
            params,
        )


def tokens_from(message: Any) -> tuple[int, int]:
    """(input, output) tokens from a LangChain message's ``usage_metadata`` (0, 0 if absent)."""
    meta = getattr(message, "usage_metadata", None) or {}
    return int(meta.get("input_tokens", 0) or 0), int(meta.get("output_tokens", 0) or 0)
