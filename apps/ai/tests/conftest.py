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
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db import pool  # noqa: E402

TOKEN = "t" * 40
UID = "111"
OTHER = "222"

SCHEMA = [
    "CREATE TABLE users (discord_id TEXT PRIMARY KEY, player_xp INT DEFAULT 0, lifetime_xp INT DEFAULT 0,"
    " player_level INT DEFAULT 1, streak_count INT DEFAULT 0, ai_enabled INT DEFAULT 1)",
    "CREATE TABLE lists (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, name TEXT, description TEXT,"
    " category TEXT, deadline TEXT, priority TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,"
    " updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INT, name TEXT, description TEXT,"
    " completed INT DEFAULT 0, completed_at TEXT, position INT DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,"
    " updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE xp_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, amount INT, source TEXT,"
    " created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE ai_embeddings (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, source_type TEXT,"
    " source_id TEXT, list_id INT, content TEXT, content_hash TEXT, embedding BLOB, model TEXT,"
    " updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (source_type, source_id, model))",
    "CREATE TABLE ai_chat_threads (id TEXT PRIMARY KEY, discord_id TEXT, title TEXT DEFAULT 'New chat',"
    " created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE ai_checkpoints (thread_id TEXT, checkpoint_ns TEXT DEFAULT '', checkpoint_id TEXT, parent_id TEXT,"
    " type TEXT, checkpoint BLOB, metadata BLOB, created_at TEXT DEFAULT CURRENT_TIMESTAMP,"
    " PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id))",
    "CREATE TABLE ai_checkpoint_writes (thread_id TEXT, checkpoint_ns TEXT DEFAULT '', checkpoint_id TEXT,"
    " task_id TEXT, idx INT, channel TEXT, type TEXT, value BLOB,"
    " PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx))",
    "CREATE TABLE ai_usage (discord_id TEXT, day TEXT, feature TEXT, requests INT DEFAULT 0,"
    " input_tokens INT DEFAULT 0, output_tokens INT DEFAULT 0, PRIMARY KEY (discord_id, day, feature))",
    "CREATE TABLE ai_summary_cache (discord_id TEXT, scope_key TEXT, input_hash TEXT, summary_json TEXT,"
    " created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (discord_id, scope_key))",
]


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
    pool.set_engine(eng)
    yield eng
    pool.set_engine(None)
    await eng.dispose()


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
