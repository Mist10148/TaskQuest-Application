"""The daily AI quota follows the user's own day: it refills at their local midnight (``users.timezone``)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app import usage
from app.config import get_settings
from tests.conftest import OTHER, UID


def at(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


# ─── the pure day computation ─────────────────────────────────────────────────────


def test_a_day_starts_at_the_users_midnight_not_utc_midnight():
    moment = at("2030-03-12T20:00:00")  # 20:00 UTC on the 12th
    assert usage.day_in_zone(None, moment) == "2030-03-12"
    assert usage.day_in_zone("UTC", moment) == "2030-03-12"
    assert usage.day_in_zone("Asia/Manila", moment) == "2030-03-13", "04:00 on the 13th in Manila (UTC+8)"
    assert usage.day_in_zone("America/New_York", moment) == "2030-03-12", "16:00 on the 12th (EDT, UTC-4)"
    assert usage.day_in_zone("Pacific/Kiritimati", moment) == "2030-03-13", "UTC+14"
    assert usage.day_in_zone("Pacific/Pago_Pago", at("2030-03-12T05:00:00")) == "2030-03-11", "UTC-11, still the 11th"


def test_the_day_changes_exactly_at_local_midnight():
    # Manila is UTC+8: local midnight on the 13th is 16:00 UTC on the 12th.
    assert usage.day_in_zone("Asia/Manila", at("2030-03-12T15:59:59")) == "2030-03-12"
    assert usage.day_in_zone("Asia/Manila", at("2030-03-12T16:00:00")) == "2030-03-13"


def test_daylight_saving_follows_the_zone_rules():
    # New York springs forward on 2030-03-10: before it UTC-5, after it UTC-4.
    assert usage.day_in_zone("America/New_York", at("2030-03-10T04:59:00")) == "2030-03-09"  # 23:59 EST on the 9th
    assert usage.day_in_zone("America/New_York", at("2030-03-10T05:00:00")) == "2030-03-10"  # 00:00 EST
    assert usage.day_in_zone("America/New_York", at("2030-03-11T03:59:00")) == "2030-03-10"  # 23:59 EDT on the 10th


@pytest.mark.parametrize("zone", [None, "", "Mars/Base", "../etc/passwd", "not a zone", "UTC+8"])
def test_a_missing_or_unknown_zone_falls_back_to_utc(zone):
    assert usage.day_in_zone(zone, at("2030-03-12T20:00:00")) == "2030-03-12"


def test_today_utc_is_the_utc_day():
    assert usage.today_utc() == datetime.now(UTC).date().isoformat()


# ─── the quota against the database ────────────────────────────────────────────────


@pytest.fixture
def clock(monkeypatch):
    """Move the service clock: ``clock.set('2030-03-12T20:00:00')`` (UTC)."""

    class Clock:
        now = at("2030-03-12T12:00:00")

        def set(self, iso: str) -> None:
            self.now = at(iso)

    c = Clock()
    monkeypatch.setattr(usage, "_now", lambda: c.now)
    return c


async def set_zone(engine, uid: str, zone: str | None) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("INSERT OR IGNORE INTO users (discord_id) VALUES (:u)"), {"u": uid})
        await conn.execute(text("UPDATE users SET timezone = :z WHERE discord_id = :u"), {"z": zone, "u": uid})


async def test_the_quota_refills_at_the_users_midnight(engine, clock, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 2)
    await set_zone(engine, UID, "Asia/Manila")
    clock.set("2030-03-12T10:00:00")  # 18:00 on the 12th in Manila
    async with engine.begin() as conn:
        await usage.reserve(conn, UID, "chat")
        await usage.reserve(conn, UID, "summary")
    with pytest.raises(usage.QuotaExceeded):
        async with engine.begin() as conn:  # the error leaves the transaction, which rolls the booking back
            await usage.reserve(conn, UID, "prioritize")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 2, "the refused reservation was rolled back"

    clock.set("2030-03-12T15:59:00")  # 23:59 in Manila: still the same day
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 2

    clock.set("2030-03-12T16:00:00")  # midnight in Manila: a new day, a fresh quota
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 0
    async with engine.begin() as conn:
        await usage.reserve(conn, UID, "chat")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 1


async def test_two_users_in_different_zones_have_different_days(engine, clock, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 1)
    await set_zone(engine, UID, "Asia/Manila")
    await set_zone(engine, OTHER, "America/New_York")
    clock.set("2030-03-12T10:00:00")
    for uid in (UID, OTHER):
        async with engine.begin() as conn:
            await usage.reserve(conn, uid, "chat")

    clock.set("2030-03-12T16:00:00")  # Manila's midnight; New York is still on the 12th
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 0, "Manila refilled"
        assert await usage.requests_today(conn, OTHER) == 1, "New York has not"


async def test_a_user_without_a_zone_keeps_the_utc_day(engine, clock, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 5)
    await set_zone(engine, UID, None)
    clock.set("2030-03-12T23:00:00")
    async with engine.begin() as conn:
        await usage.reserve(conn, UID, "chat")
    clock.set("2030-03-12T23:59:59")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 1
    clock.set("2030-03-13T00:00:00")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 0


async def test_release_hands_back_a_request_from_the_users_own_day(engine, clock):
    await set_zone(engine, UID, "Pacific/Auckland")  # UTC+13 in March
    clock.set("2030-03-12T12:00:00")  # already the 13th in Auckland
    async with engine.begin() as conn:
        await usage.reserve(conn, UID, "chat")
        await usage.reserve(conn, UID, "chat")
    async with engine.begin() as conn:
        await usage.release(conn, UID, "chat")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 1
        rows = (await conn.execute(text("SELECT day FROM ai_usage WHERE discord_id = :u"), {"u": UID})).all()
    assert [r[0] for r in rows] == ["2030-03-13"], "booked under Auckland's date, not UTC's"


async def test_a_refund_after_midnight_goes_to_the_day_it_was_reserved_on(engine, clock):
    await set_zone(engine, UID, None)
    clock.set("2030-03-12T23:59:50")
    async with engine.begin() as conn:
        day = await usage.reserve(conn, UID, "summary")
    assert day == "2030-03-12"
    clock.set("2030-03-13T00:00:30")  # the call failed after midnight
    async with engine.begin() as conn:
        await usage.reserve(conn, UID, "summary")  # a new request today
        await usage.release(conn, UID, "summary", day)
    async with engine.connect() as conn:
        rows = dict((await conn.execute(text("SELECT day, requests FROM ai_usage WHERE discord_id = :u"), {"u": UID})).all())
    assert rows == {"2030-03-12": 0, "2030-03-13": 1}, "yesterday handed back, today's request untouched"


async def test_an_unknown_user_or_zone_still_gets_a_working_quota(engine, clock):
    clock.set("2030-03-12T12:00:00")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, "nobody") == 0, "no users row: UTC day, nothing booked"
    await set_zone(engine, UID, "Mars/Base")
    async with engine.begin() as conn:
        await usage.reserve(conn, UID, "chat")
    async with engine.connect() as conn:
        assert await usage.requests_today(conn, UID) == 1


async def test_user_today_is_the_users_calendar_date(seeded, clock):
    clock.set("2030-03-12T20:00:00")  # 04:00 on the 13th in Manila, still the 12th in UTC
    assert (await usage.user_today(UID)).isoformat() == "2030-03-12"
    await set_zone(seeded, UID, "Asia/Manila")
    assert (await usage.user_today(UID)).isoformat() == "2030-03-13"
    assert (await usage.user_today("999999")).isoformat() == "2030-03-12", "an unknown user falls back to UTC"
