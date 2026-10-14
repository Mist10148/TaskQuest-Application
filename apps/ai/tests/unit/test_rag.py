"""Chunking, store math, indexer idempotency and hybrid retrieval (no network)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import numpy as np
from sqlalchemy import text

from app.rag import indexer
from app.rag.chunking import doc_chunks, history_chunks, item_chunks, list_chunk, sha256
from app.rag.embed import from_blob, to_blob
from app.rag.retriever import TaskRetriever, format_context, keyword_overlap, urgency_boost
from app.rag.store import EmbeddingRow, MySQLNumpyStore
from tests.conftest import OTHER, UID
from tests.fakes import FakeEmbedder


def make_store() -> MySQLNumpyStore:
    return MySQLNumpyStore("fake-embed")


# ── chunking ─────────────────────────────────────────────────────────────────


def test_list_chunk_is_natural_language_with_absolute_dates():
    lst = {
        "id": 7,
        "name": "Math",
        "category": "School",
        "priority": "HIGH",
        "deadline": date(2026, 10, 12),
        "description": "ch4",
    }
    chunk = list_chunk(lst, [{"id": 1, "name": "p1", "completed": True}, {"id": 2, "name": "p2", "completed": False}])
    assert chunk.source_id == "L7" and chunk.list_id == 7
    assert "Deadline: 2026-10-12" in chunk.text
    assert "- [x] p1" in chunk.text and "- [ ] p2" in chunk.text
    assert chunk.content_hash == sha256(chunk.text)


def test_long_item_descriptions_get_their_own_chunk():
    lst = {"id": 1, "name": "Big"}
    items = [{"id": 5, "name": "short", "description": "x"}, {"id": 6, "name": "long", "description": "y" * 400}]
    chunks = item_chunks(lst, items)
    assert [c.source_id for c in chunks] == ["I6"]


def test_history_chunks_group_by_week():
    comps = [
        {"name": "a", "list_name": "Q", "completed_at": datetime(2026, 10, 5, 9)},  # Monday
        {"name": "b", "list_name": "Q", "completed_at": datetime(2026, 10, 7, 9)},  # same week
        {"name": "c", "list_name": "Q", "completed_at": datetime(2026, 10, 13, 9)},  # next week
    ]
    chunks = history_chunks("111", comps)
    assert len(chunks) == 2
    assert "completed 2 subtasks" in chunks[0].text and chunks[0].source_id == "H111:2026-10-05"


def test_doc_chunks_split_by_heading_with_path_prefix_and_overlap():
    md = "# Guide\nintro\n## Games\n" + ("blackjack rules. " * 400) + "\n## Quests\nmake a quest"
    chunks = doc_chunks("gameplay", md)
    assert chunks[0].text.startswith("GAMEPLAY / Guide")
    assert any(c.text.startswith("GAMEPLAY / Guide > Games") for c in chunks)
    assert chunks[-1].text.startswith("GAMEPLAY / Guide > Quests")
    assert len({c.source_id for c in chunks}) == len(chunks)
    games = [c for c in chunks if "Guide > Games" in c.text.split("\n")[0]]
    assert len(games) >= 2  # long section was split


# ── scoring and store ────────────────────────────────────────────────────────


def test_blob_roundtrip():
    v = np.array([0.1, -0.5, 2.0], dtype=np.float32)
    assert np.allclose(from_blob(to_blob(v)), v)


def test_urgency_and_keyword_scoring():
    today = date(2026, 10, 8)
    assert urgency_boost(date(2026, 10, 7), today) == 1.0
    assert urgency_boost(date(2026, 10, 9), today) > urgency_boost(date(2026, 10, 14), today) > 0
    assert urgency_boost(date(2026, 12, 1), today) == 0.0
    assert urgency_boost(None, today) == 0.0 and urgency_boost(date(2026, 10, 9), today, open_=False) == 0.0
    assert keyword_overlap("math homework", "Quest: Math homework") == 1.0
    assert keyword_overlap("garage", "Quest: Math") == 0.0


async def test_store_cosine_top_k_and_user_isolation(engine):
    store = make_store()
    e = FakeEmbedder()
    texts = ["apple pie recipe", "quantum physics notes", "apple orchard visit"]
    vecs = [np.array(v, dtype=np.float32) for v in await e.aembed_documents(texts)]
    async with engine.begin() as conn:
        for uid in (UID, OTHER):
            await conn.execute(text("INSERT INTO users (discord_id) VALUES (:u)"), {"u": uid})
        rows = [
            EmbeddingRow(UID, "list", f"L{i}", i, t, sha256(t), v, store.model)
            for i, (t, v) in enumerate(zip(texts, vecs, strict=True), 1)
        ]
        rows.append(EmbeddingRow(OTHER, "list", "L99", 99, "apple secret", sha256("x"), vecs[0], store.model))
        await store.upsert(conn, rows)
        hits = await store.search(conn, UID, np.array(await e.aembed_query("apple pie"), dtype=np.float32), 2)
    assert [h.source_id for h in hits][0] == "L1"
    assert "L99" not in {h.source_id for h in hits}  # other user's vector never returned
    assert hits[0].score >= hits[1].score


class _Spy:
    """Wraps a connection so a test can run code around ``execute`` (AsyncConnection attributes are read-only)."""

    def __init__(self, conn, before=None, after=None):
        self._conn, self._before, self._after = conn, before, after

    def __getattr__(self, name):
        return getattr(self._conn, name)

    async def execute(self, statement, params=None, *a, **kw):
        if self._before:
            await self._before(self._conn, str(statement), params)
        result = await self._conn.execute(statement, params, *a, **kw)
        if self._after:
            await self._after(self._conn, str(statement), params)
        return result


async def test_a_load_that_straddles_an_invalidation_is_not_cached(engine):
    store = make_store()
    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO users (discord_id) VALUES (:u)"), {"u": UID})
        # a writer commits (and invalidates) while this reader is loading
        async def invalidate(*_):
            store.invalidate(UID)

        await store._matrix(_Spy(conn, after=invalidate), UID)
    assert UID not in store._cache


async def test_upsert_survives_losing_the_insert_race(engine):
    """Another index call inserts the same row between our UPDATE and INSERT: update it instead of failing."""
    store = make_store()
    vec = np.ones(4, dtype=np.float32)
    raced = []

    async def competitor(conn, sql, params):
        # right after our UPDATE matched nothing, the other index call inserts the row
        if sql.startswith("UPDATE ai_embeddings") and not raced:
            raced.append(True)
            await conn.execute(
                text(
                    "INSERT INTO ai_embeddings (discord_id, source_type, source_id, list_id, content, content_hash, "
                    "embedding, model) VALUES (:uid, :st, :sid, :lid, :content, :hash, :emb, :model)"
                ),
                params,
            )

    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO users (discord_id) VALUES (:u)"), {"u": UID})
        row = EmbeddingRow(UID, "list", "L1", 1, "new text", sha256("new"), vec, store.model)
        await store.upsert(_Spy(conn, after=competitor), [row])
        rows = [tuple(r) for r in (await conn.execute(text("SELECT content, content_hash FROM ai_embeddings"))).all()]
    assert raced and rows == [("new text", sha256("new"))]


# ── indexer ──────────────────────────────────────────────────────────────────


async def test_index_list_skips_unchanged_content(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        assert await indexer.index_list(conn, store, emb, UID, 1) == 1
        calls = emb.doc_calls
        assert await indexer.index_list(conn, store, emb, UID, 1) == 0  # same hash => no embed
        assert emb.doc_calls == calls
        await conn.execute(text("UPDATE items SET completed = 1 WHERE id = 1"))
        assert await indexer.index_list(conn, store, emb, UID, 1) == 1  # changed => re-embedded
        # A list id that is not the caller's is never indexed for them
        assert await indexer.index_list(conn, store, emb, UID, 4) == 0
        n = (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE source_id = 'L4'"))).scalar()
        assert n == 0


async def test_forget_removes_rows(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.index_list(conn, store, emb, UID, 2)
        await store.delete(conn, UID, list_id=2)
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings"))).scalar() == 0


async def test_reconcile_finds_missing_and_stale(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        missing = await indexer.stale_lists(conn, store)
        assert {lid for _, lid in missing} == {1, 2, 3, 4}
        assert await indexer.reconcile(conn, store, emb) == 4
        assert await indexer.stale_lists(conn, store) == []
        # opt-out users are skipped
        await conn.execute(text("UPDATE users SET ai_enabled = 0 WHERE discord_id = :u"), {"u": OTHER})
        await conn.execute(text("DELETE FROM ai_embeddings"))
        assert {lid for _, lid in await indexer.stale_lists(conn, store)} == {1, 2, 3}


async def test_reconcile_catches_list_only_edits(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        old, edited = "2000-01-01 00:00:00", "2001-01-01 00:00:00"
        await conn.execute(text("UPDATE ai_embeddings SET updated_at = :t"), {"t": old})
        await conn.execute(text("UPDATE items SET updated_at = :t"), {"t": old})
        await conn.execute(text("UPDATE lists SET updated_at = :t"), {"t": old})
        assert await indexer.stale_lists(conn, store) == []
        # Renaming a quest touches only the list row, not its subtasks
        await conn.execute(
            text("UPDATE lists SET name = 'Algebra homework', updated_at = :t WHERE id = 1"), {"t": edited}
        )
        assert await indexer.stale_lists(conn, store) == [(UID, 1)]
        calls = emb.doc_calls
        assert await indexer.reconcile(conn, store, emb) == 1
        assert emb.doc_calls == calls + 2  # the list, and the history week that names the quest
        content = (await conn.execute(text("SELECT content FROM ai_embeddings WHERE source_id = 'L1'"))).scalar()
        assert "Algebra homework" in content
        assert await indexer.stale_lists(conn, store) == []


async def test_unchanged_text_is_not_stale_twice(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        await conn.execute(text("UPDATE ai_embeddings SET updated_at = '2000-01-01 00:00:00'"))
        # A change that does not alter the chunk text (e.g. a reorder) still bumps the timestamp
        await conn.execute(text("UPDATE lists SET updated_at = '2001-01-01 00:00:00' WHERE id = 2"))
        assert (UID, 2) in await indexer.stale_lists(conn, store)
        calls = emb.doc_calls
        await indexer.reconcile(conn, store, emb)
        assert emb.doc_calls == calls  # nothing re-embedded
        assert (UID, 2) not in await indexer.stale_lists(conn, store)


async def test_index_docs_is_idempotent_and_global(engine):
    store, emb = make_store(), FakeEmbedder()
    docs = {"gameplay": "# Games\nBlackjack pays 3:2.\n# Quests\nComplete subtasks for XP."}
    async with engine.begin() as conn:
        assert await indexer.index_docs(conn, store, emb, docs) == 2
        assert await indexer.index_docs(conn, store, emb, docs) == 0
        nulls = (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE discord_id IS NULL"))).scalar()
        assert nulls == 2


# ── retrieval ────────────────────────────────────────────────────────────────


async def test_retrieval_is_fresh_scoped_and_filtered(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        r = TaskRetriever(store, emb)
        results = await r.retrieve(conn, UID, "math homework problems", k=3, today=datetime.now(UTC).date())
        ids = [x.id for x in results]
        assert ids[0] == "L1"
        assert "L4" not in ids  # other user's quest ("Secret plans")
        # Fresh re-read: completion state comes from MySQL, not the stale chunk
        await conn.execute(text("UPDATE items SET completed = 1 WHERE list_id = 1"))
        done = await r.retrieve(conn, UID, "math homework", k=3, status="done")
        done = [x for x in done if x.kind == "list"]  # weekly history chunks are "done" too
        assert [x.id for x in done] == ["L1"] and "- [x] Problems 1-10" in done[0].text
        open_ = await r.retrieve(conn, UID, "math homework", k=3, status="open")
        assert "L1" not in [x.id for x in open_]
        cat = await r.retrieve(conn, UID, "garage tools", k=3, category="Home")
        assert [x.id for x in cat] == ["L2"]


def test_format_context_delimits_task_data():
    from app.rag.retriever import Retrieved

    out = format_context(
        [
            Retrieved("list", "L1", "Math", "Quest: Math", 0.9, 1),
            Retrieved("doc", "gameplay#0", "x", "How XP works", 0.5),
        ]
    )
    assert '<task id="L1">' in out and "</task>" in out and '<doc section="gameplay#0">' in out


async def test_internal_routes_require_token_and_noop_without_gemini(client):
    body = {"discordId": UID, "listId": 1}
    assert (await client.post("/internal/index", json=body)).status_code == 401
    ok = {"X-AI-Token": "t" * 40}
    assert (await client.post("/internal/index", json=body, headers=ok)).status_code == 204
    assert (await client.post("/internal/index", json={"discordId": "x;"}, headers=ok)).status_code == 422


async def test_opted_out_users_are_not_embedded_and_lose_their_vectors(seeded, monkeypatch):
    from app.config import get_settings
    from app.rag import runtime

    store, emb = make_store(), FakeEmbedder()
    runtime.set_runtime(store, emb)
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    try:
        async with seeded.begin() as conn:
            await indexer.index_list(conn, store, emb, UID, 1)
            await conn.execute(text("UPDATE users SET ai_enabled = 0 WHERE discord_id = :u"), {"u": UID})
        import httpx

        from app.main import create_app

        calls_before = emb.doc_calls
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://ai") as c:
            r = await c.post("/internal/index", json={"discordId": UID, "listId": 1}, headers={"X-AI-Token": "t" * 40})
        assert r.status_code == 204 and emb.doc_calls == calls_before  # nothing sent to the embedding model
        async with seeded.connect() as conn:
            n = (
                await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE discord_id = :u"), {"u": UID})
            ).scalar()
        assert n == 0
    finally:
        runtime.set_runtime(None, None)


async def test_history_chunks_carry_weekly_xp_and_reconcile_keeps_them_fresh(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        assert UID in await indexer.stale_history_users(conn, store)
        await indexer.reconcile(conn, store, emb)
        content = (await conn.execute(text("SELECT content FROM ai_embeddings WHERE source_type = 'history'"))).scalar()
        assert "Problems 11-20" in content and "earned 25 XP" in content
        assert await indexer.stale_history_users(conn, store) == []

        # New XP after the chunk was written makes the user stale again; reconcile re-embeds once.
        await conn.execute(text("UPDATE ai_embeddings SET updated_at = '2000-01-01 00:00:00'"))
        assert await indexer.stale_history_users(conn, store) == [UID]
        calls = emb.doc_calls
        await indexer.reconcile(conn, store, emb)
        assert emb.doc_calls == calls  # same text: touched, not re-embedded
        assert await indexer.stale_history_users(conn, store) == []

        # Opted-out users are skipped
        await conn.execute(text("UPDATE users SET ai_enabled = 0 WHERE discord_id = :u"), {"u": UID})
        await conn.execute(text("DELETE FROM ai_embeddings"))
        assert await indexer.stale_history_users(conn, store) == []


async def test_reconcile_purges_vectors_of_opted_out_users(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        await conn.execute(text("UPDATE users SET ai_enabled = 0 WHERE discord_id = :u"), {"u": OTHER})
        await indexer.reconcile(conn, store, emb)
        left = (
            await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE discord_id = :u"), {"u": OTHER})
        ).scalar()
        assert left == 0
        mine = (
            await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE discord_id = :u"), {"u": UID})
        ).scalar()
        assert mine > 0


async def test_forget_without_list_wipes_vectors_threads_and_summaries_but_keeps_usage(seeded):
    from app.rag import runtime

    store, emb = make_store(), FakeEmbedder()
    runtime.set_runtime(store, emb)
    try:
        async with seeded.begin() as conn:
            await indexer.index_list(conn, store, emb, UID, 1)
            for uid, tid in ((UID, "t-mine"), (OTHER, "t-other")):
                await conn.execute(
                    text("INSERT INTO ai_chat_threads (id, discord_id) VALUES (:t, :u)"), {"t": tid, "u": uid}
                )
                await conn.execute(
                    text("INSERT INTO ai_checkpoints (thread_id, checkpoint_id, checkpoint) VALUES (:t, 'c1', x'00')"),
                    {"t": tid},
                )
                await conn.execute(
                    text(
                        "INSERT INTO ai_summary_cache (discord_id, scope_key, input_hash, summary_json) VALUES (:u, 'd', 'h', '{}')"
                    ),
                    {"u": uid},
                )
            await conn.execute(
                text("INSERT INTO ai_usage (discord_id, day, feature, requests) VALUES (:u, '2030-01-01', 'chat', 3)"),
                {"u": UID},
            )
        import httpx

        from app.main import create_app

        ok = {"X-AI-Token": "t" * 40}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://ai") as c:
            r = await c.post("/internal/forget", json={"discordId": UID}, headers=ok)
        assert r.status_code == 204

        async def count(table: str, uid: str) -> int:
            async with seeded.connect() as conn:
                return (
                    await conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE discord_id = :u"), {"u": uid})
                ).scalar()

        for table in ("ai_embeddings", "ai_chat_threads", "ai_summary_cache"):
            assert await count(table, UID) == 0, table
        async with seeded.connect() as conn:
            leftover = (
                await conn.execute(text("SELECT COUNT(*) FROM ai_checkpoints WHERE thread_id = 't-mine'"))
            ).scalar()
        assert leftover == 0
        assert await count("ai_chat_threads", OTHER) == 1 and await count("ai_summary_cache", OTHER) == 1
        assert await count("ai_usage", UID) == 1  # the daily quota is not refunded by a reset
    finally:
        runtime.set_runtime(None, None)


# ── shared quests are never the owner's AI context ───────────────────────────


async def _share(conn, list_id: int, member: str = "999") -> None:
    await conn.execute(
        text("INSERT INTO list_members (list_id, discord_id, role) VALUES (:l, :m, 'editor')"),
        {"l": list_id, "m": member},
    )


async def test_shared_lists_are_invisible_to_every_owner_read(seeded):
    from app.db import repo

    async with seeded.begin() as conn:
        await conn.execute(
            text("UPDATE items SET completed = 1, completed_at = :t WHERE list_id = 1"),
            {"t": datetime.now(UTC).replace(tzinfo=None)},
        )
        before = {lst["id"] for lst in await repo.lists_for_user(conn, UID)}
        assert before == {1, 2, 3}
        assert await repo.items_for_list(conn, UID, 1)
        assert await repo.get_list_with_items(conn, UID, 1) is not None
        done_before = await repo.completions_since(conn, UID, datetime(2000, 1, 1))
        assert done_before

        await _share(conn, 1)  # somebody else is on quest 1 now: its text is no longer only the owner's
        assert {lst["id"] for lst in await repo.lists_for_user(conn, UID)} == {2, 3}
        assert {lst["id"] for lst in await repo.lists_for_user(conn, UID, open_only=True)} <= {2, 3}
        assert await repo.get_list_with_items(conn, UID, 1) is None
        assert await repo.items_for_list(conn, UID, 1) == []
        assert 1 not in {i["list_id"] for i in await repo.all_items_for_user(conn, UID)}
        assert all(d["list_id"] != 1 for d in await repo.completions_since(conn, UID, datetime(2000, 1, 1)))
        # Unshared quests are exactly as before.
        assert await repo.items_for_list(conn, UID, 2)


async def test_a_quest_shared_after_indexing_is_purged_and_never_indexed_again(seeded):
    store, emb = make_store(), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE list_id = 1"))).scalar() >= 1
        assert await indexer.stale_lists(conn, store) == []

        await _share(conn, 1)
        assert (UID, 1) in await indexer.stale_lists(conn, store), (
            "an indexed quest that became shared is stale until purged"
        )
        await indexer.reconcile(conn, store, emb)
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE list_id = 1"))).scalar() == 0
        assert await indexer.stale_lists(conn, store) == [], "and a shared quest is not picked up again"
        assert await indexer.index_list(conn, store, emb, UID, 1) == 0
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE list_id = 1"))).scalar() == 0

        # Retrieval cannot reach it either.
        results = await TaskRetriever(store, emb).retrieve(
            conn, UID, "math homework problems", k=5, today=datetime.now(UTC).date()
        )
        assert "L1" not in [r.id for r in results]

        # index_user also sweeps up leftovers of a quest that is shared (or gone).
        await conn.execute(text("UPDATE ai_embeddings SET list_id = 1 WHERE source_id = 'L2'"))
        await indexer.index_user(conn, store, emb, UID)
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_embeddings WHERE list_id = 1"))).scalar() == 0
