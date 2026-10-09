"""Chunking, store math, indexer idempotency and hybrid retrieval (no network)."""

from __future__ import annotations

from datetime import date, datetime

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
        results = await r.retrieve(conn, UID, "math homework problems", k=3, today=date.today())
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
