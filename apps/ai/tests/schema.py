"""Simplified SQLite copy of the TaskQuest schema, shared by the tests and the eval runner."""

from __future__ import annotations

import contextlib
import os
import tempfile

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

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
    "CREATE TABLE ai_chat_threads (id TEXT PRIMARY KEY, discord_id TEXT, title TEXT DEFAULT 'New chat', source TEXT DEFAULT 'web',"
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


async def create_engine() -> AsyncEngine:
    """A fresh temporary SQLite database with the schema applied. Release it with ``drop_engine``.

    A file (not ``:memory:`` + StaticPool) so every ``engine.begin()`` gets its own connection, like
    MySQL in production. LangGraph saves checkpoints and writes from concurrent tasks; on one shared
    connection their transactions interleave and writes (e.g. interrupts) can be lost.
    """
    fd, path = tempfile.mkstemp(prefix="taskquest-ai-", suffix=".db")
    os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{path}", poolclass=NullPool, connect_args={"timeout": 30})
    async with eng.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
    return eng


async def drop_engine(eng: AsyncEngine) -> None:
    """Dispose the engine and delete its database file."""
    await eng.dispose()
    if eng.url.database:
        with contextlib.suppress(OSError):
            os.remove(eng.url.database)
