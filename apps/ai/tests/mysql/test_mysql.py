"""The service's SQL against real MySQL 8 with the Node migrations applied (CI job "AI service on MySQL").

Everything else runs on SQLite; these cover what SQLite cannot: the real schema and its foreign keys, the
checkpointer's LONGBLOB round trips, ENUM columns and MySQL's UPDATE/INSERT semantics. Skipped unless
AI_TEST_DB_URL is set, for example::

    AI_TEST_DB_URL=mysql://root:pw@127.0.0.1:3306/taskquest_ai_test pytest tests/mysql
"""

from __future__ import annotations

import os
import uuid

import numpy as np
import pytest
import pytest_asyncio
from langchain_core.messages import AIMessage
from langgraph.types import Command
from sqlalchemy import text

from app import chat_service, threads, usage
from app.config import Settings
from app.db import pool, repo
from app.graphs.chat import RouterOut
from app.graphs.checkpointer import MySQLCheckpointSaver
from app.rag import indexer
from app.rag.store import EmbeddingRow, MySQLNumpyStore
from tests.fakes import FakeEmbedder
from tests.graphs.test_chat import call, collect, deps_for, kinds, make_llm, make_web

URL = os.environ.get("AI_TEST_DB_URL")
pytestmark = pytest.mark.skipif(not URL, reason="AI_TEST_DB_URL not set (needs migrated MySQL)")

UID = "990000000000000001"
OTHER = "990000000000000002"


@pytest_asyncio.fixture
async def mysql():
    engine = pool.make_engine(Settings(db_url=URL or "", db_pool_size=5))
    pool.set_engine(engine)

    async def wipe():
        async with engine.begin() as conn:
            for uid in (UID, OTHER):
                await conn.execute(text("DELETE FROM ai_usage WHERE discord_id = :u"), {"u": uid})
                await conn.execute(text("DELETE FROM users WHERE discord_id = :u"), {"u": uid})  # cascades

    await wipe()
    async with engine.begin() as conn:
        for uid in (UID, OTHER):
            await conn.execute(text("INSERT INTO users (discord_id) VALUES (:u)"), {"u": uid})
        await conn.execute(
            text(
                "INSERT INTO lists (discord_id, name, category, priority) VALUES (:u, 'Math homework', 'School', 'HIGH')"
            ),
            {"u": UID},
        )
        list_id = (await conn.execute(text("SELECT LAST_INSERT_ID()"))).scalar()
        await conn.execute(
            text(
                "INSERT INTO items (list_id, name, position) VALUES (:l, 'Problems 1-10', 0), (:l, 'Problems 11-20', 1)"
            ),
            {"l": list_id},
        )
        await conn.execute(text("INSERT INTO lists (discord_id, name) VALUES (:u, 'Secret plans')"), {"u": OTHER})
    try:
        yield engine, int(list_id)
    finally:
        await wipe()
        pool.set_engine(None)
        await engine.dispose()


async def test_repo_reads_the_real_schema(mysql):
    engine, list_id = mysql
    async with engine.connect() as conn:
        lst = await repo.get_list_with_items(conn, UID, list_id)
        assert lst is not None and lst["items_total"] == 2 and lst["priority"] == "HIGH"
        assert await repo.get_list_with_items(conn, OTHER, list_id) is None
        assert await repo.ai_enabled(conn, UID)


async def test_store_and_reconcile_on_mysql(mysql):
    engine, list_id = mysql
    store, emb = MySQLNumpyStore("fake-embed-ci"), FakeEmbedder()
    async with engine.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        assert (UID, list_id) not in await indexer.stale_lists(conn, store)
        vec = np.array(await emb.aembed_query("math homework problems"), dtype=np.float32)
        hits = await store.search(conn, UID, vec, 3)
        assert hits and hits[0].source_id == f"L{list_id}"
        assert all(h.source_id != f"L{list_id}" for h in await store.search(conn, OTHER, vec, 3))  # scoped by user
        await store.upsert(
            conn,
            [EmbeddingRow(UID, "list", f"L{list_id}", list_id, "changed", "f" * 64, vec.tolist(), store.model)],
        )  # upsert over the unique key
        await conn.execute(text("UPDATE users SET ai_enabled = 0 WHERE discord_id = :u"), {"u": UID})
        await indexer.reconcile(conn, store, emb)
        left = await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE discord_id = :u"), {"u": UID})
        assert left.scalar() == 0


async def test_usage_update_then_insert(mysql):
    engine, _ = mysql
    async with engine.begin() as conn:
        await usage.record(conn, UID, "chat", input_tokens=5, output_tokens=1)
        await usage.record(conn, UID, "chat", input_tokens=5, output_tokens=1)
        await usage.record(conn, UID, "chat", input_tokens=3, requests=0)
        assert await usage.requests_today(conn, UID) == 2


async def test_confirmation_checkpoints_survive_a_fresh_graph(mysql):
    engine, _ = mysql
    calls: list = []
    async with engine.begin() as conn:
        thread_id = await threads.create_thread(conn, UID, "mark it done")
        item_id = (
            await conn.execute(
                text("SELECT MIN(i.id) FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = :u"),
                {"u": UID},
            )
        ).scalar()
    web = make_web({f"/internal/items/{item_id}/toggle": (200, {"completed": True})}, calls)
    llm = make_llm(
        [call("complete_item", {"item_id": f"I{item_id}"}), AIMessage("Done.")], [RouterOut(intent="action")]
    )
    deps = deps_for(llm, web)
    first = await collect(chat_service.stream_turn(deps, UID, thread_id, chat_service.user_input(UID, "mark it done")))
    assert "confirm" in kinds(first) and calls == []

    graph = chat_service.make_graph(deps)
    pending = await chat_service.pending_actions(graph, {"configurable": {"thread_id": thread_id}})
    assert [p["action"] for p in pending] == ["complete_item"]

    await collect(chat_service.stream_turn(deps, UID, thread_id, Command(resume={"approved": True})))
    assert len(calls) == 1
    assert await chat_service.pending_actions(graph, {"configurable": {"thread_id": thread_id}}) == []

    await MySQLCheckpointSaver(engine).adelete_thread(thread_id)
    async with engine.connect() as conn:
        n = await conn.execute(text("SELECT COUNT(*) FROM ai_checkpoints WHERE thread_id = :t"), {"t": thread_id})
        assert n.scalar() == 0


async def test_discord_conversation_threads_on_mysql(mysql):
    channel = str(uuid.uuid4().int)[:18]
    llm = make_llm([AIMessage("Hey."), AIMessage("Still here.")], [RouterOut(intent="chitchat")] * 2)
    out = await chat_service.converse_turn(deps_for(llm), UID, channel, "hi")
    assert out["reply"] == "Hey."
    assert (await chat_service.converse_turn(deps_for(llm), UID, channel, "again"))["reply"] == "Still here."
    async with pool.get_engine().connect() as conn:
        assert await threads.list_threads(conn, UID) == []  # source='discord' stays out of the web list
    assert await chat_service.forget_conversation(UID, channel) is True


async def test_forgetting_a_user_removes_threads_checkpoints_and_summaries_but_keeps_usage(mysql):
    engine, _ = mysql
    async with engine.begin() as conn:
        mine = await threads.create_thread(conn, UID, "my chat")
        theirs = await threads.create_thread(conn, OTHER, "their chat")
        for tid in (mine, theirs):
            await conn.execute(
                text(
                    "INSERT INTO ai_checkpoints (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint) "
                    "VALUES (:t, '', 'c1', 'msgpack', :blob)"
                ),
                {"t": tid, "blob": b"\x00\x01"},
            )
            await conn.execute(
                text(
                    "INSERT INTO ai_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value) "
                    "VALUES (:t, '', 'c1', 'task', 0, 'messages', :blob)"
                ),
                {"t": tid, "blob": b"\x02"},
            )
        for uid in (UID, OTHER):
            await conn.execute(
                text("INSERT INTO ai_summary_cache (discord_id, scope_key, input_hash, summary_json) VALUES (:u, 'digest', 'h', '{}')"),
                {"u": uid},
            )
        await usage.record(conn, UID, "chat", input_tokens=1, output_tokens=1)

    async with engine.begin() as conn:
        await repo.delete_user_ai_data(conn, UID)

    async with engine.connect() as conn:
        count = lambda sql, **p: conn.execute(text(sql), p)  # noqa: E731
        assert (await count("SELECT COUNT(*) FROM ai_chat_threads WHERE discord_id = :u", u=UID)).scalar() == 0
        assert (await count("SELECT COUNT(*) FROM ai_checkpoints WHERE thread_id = :t", t=mine)).scalar() == 0
        assert (await count("SELECT COUNT(*) FROM ai_checkpoint_writes WHERE thread_id = :t", t=mine)).scalar() == 0
        assert (await count("SELECT COUNT(*) FROM ai_summary_cache WHERE discord_id = :u", u=UID)).scalar() == 0
        # another user's data is untouched, and the daily quota counter is not refunded
        assert (await count("SELECT COUNT(*) FROM ai_chat_threads WHERE discord_id = :u", u=OTHER)).scalar() == 1
        assert (await count("SELECT COUNT(*) FROM ai_checkpoints WHERE thread_id = :t", t=theirs)).scalar() == 1
        assert (await count("SELECT COUNT(*) FROM ai_summary_cache WHERE discord_id = :u", u=OTHER)).scalar() == 1
        assert await usage.requests_today(conn, UID) == 1


async def test_quota_reservation_and_idempotent_threads_on_mysql(mysql, monkeypatch):
    """ON DUPLICATE KEY UPDATE / INSERT IGNORE: the real-MySQL spellings of what the SQLite tests cover."""
    import asyncio

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 3)

    async def attempt() -> bool:
        try:
            async with pool.connection() as conn:
                await usage.reserve(conn, UID, "chat")
            return True
        except usage.QuotaExceeded:
            return False

    assert sum(await asyncio.gather(*(attempt() for _ in range(8)))) == 3
    async with pool.connection() as conn:
        await usage.release(conn, UID, "chat")
        assert await usage.requests_today(conn, UID) == 2

    tid = str(uuid.uuid4())

    async def make() -> None:
        async with pool.connection() as conn:
            await threads.create_thread(conn, UID, "x", thread_id=tid, source=threads.DISCORD)

    await asyncio.gather(make(), make(), make())
    async with pool.get_engine().connect() as conn:
        n = (await conn.execute(text("SELECT COUNT(*) FROM ai_chat_threads WHERE id = :t"), {"t": tid})).scalar()
    assert n == 1
