"""Simplified SQLite copy of the TaskQuest schema, shared by the tests and the eval runner."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import StaticPool

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


async def create_engine() -> AsyncEngine:
    """A fresh in-memory database with the schema applied."""
    eng = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        for stmt in SCHEMA:
            await conn.execute(text(stmt))
    return eng
