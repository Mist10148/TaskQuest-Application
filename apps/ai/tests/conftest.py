"""Shared fixtures: in-memory SQLite with a simplified copy of the TaskQuest schema."""

from __future__ import annotations

import os

os.environ.setdefault("AI_INTERNAL_TOKEN", "t" * 40)
os.environ.setdefault("DB_URL", "sqlite+aiosqlite://")
os.environ.setdefault("GEMINI_API_KEY", "")

from datetime import datetime, timedelta  # noqa: E402

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import pool  # noqa: E402
from tests.schema import create_engine, drop_engine  # noqa: E402

TOKEN = "t" * 40
UID = "111"
OTHER = "222"


@pytest_asyncio.fixture
async def engine():
    eng = await create_engine()
    pool.set_engine(eng)
    yield eng
    pool.set_engine(None)
    await drop_engine(eng)


@pytest_asyncio.fixture
async def seeded(engine):
    """Two users. User 111 has three quests; user 222 has one (must never leak)."""
    now = datetime.now().replace(microsecond=0)
    today = now.date()
    async with engine.begin() as conn:
        for uid in (UID, OTHER):
            await conn.execute(text("INSERT INTO users (discord_id) VALUES (:u)"), {"u": uid})
        lists = [
            (UID, "Math homework", "Chapter 4 problems", "School", str(today + timedelta(days=1)), "HIGH"),
            (UID, "Clean garage", None, "Home", str(today + timedelta(days=20)), "LOW"),
            (UID, "Read novel", "Fiction for fun", "Personal", None, None),
            (OTHER, "Secret plans", "private", "Other", str(today), "HIGH"),
        ]
        for u, n, d, c, dl, p in lists:
            await conn.execute(
                text(
                    "INSERT INTO lists (discord_id, name, description, category, deadline, priority)"
                    " VALUES (:u,:n,:d,:c,:dl,:p)"
                ),
                {"u": u, "n": n, "d": d, "c": c, "dl": dl, "p": p},
            )
        items = [
            (1, "Problems 1-10", 0, None),
            (1, "Problems 11-20", 1, str(now - timedelta(hours=3))),
            (2, "Sort tools", 0, None),
            (4, "Hidden item", 0, None),
        ]
        for lid, n, done, at in items:
            await conn.execute(
                text("INSERT INTO items (list_id, name, completed, completed_at) VALUES (:l,:n,:d,:a)"),
                {"l": lid, "n": n, "d": done, "a": at},
            )
        await conn.execute(
            text(
                "INSERT INTO xp_transactions (discord_id, amount, source, created_at) VALUES (:u, 25, 'item_complete', :t)"
            ),
            {"u": UID, "t": str(now - timedelta(hours=3))},
        )
    return engine


@pytest_asyncio.fixture
async def client(engine):
    from app.main import create_app

    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://ai") as c:
        yield c


def auth(uid: str = UID) -> dict[str, str]:
    return {"X-AI-Token": TOKEN, "X-Discord-Id": uid}
