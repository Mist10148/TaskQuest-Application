"""Keeps ``ai_embeddings`` in sync with lists, items, history and docs.

Only changed text is re-embedded (``content_hash``), so re-indexing is cheap and idempotent.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db import pool, repo
from app.rag import runtime
from app.rag.chunking import Chunk, doc_chunks, history_chunks, item_chunks, list_chunk, week_start
from app.rag.embed import Embedder, embed_documents
from app.rag.store import EmbeddingRow, MySQLNumpyStore

log = logging.getLogger("taskquest.ai.indexer")

HISTORY_WEEKS = 12


async def _sync(
    conn: AsyncConnection,
    store: MySQLNumpyStore,
    embedder: Embedder,
    discord_id: str | None,
    chunks: list[Chunk],
    existing: dict[tuple[str, str], str],
    *,
    stale_type: str | None = None,
) -> int:
    """Embed+upsert chunks whose hash changed; delete rows no longer produced. Returns #embedded."""
    changed = [c for c in chunks if existing.get((c.source_type, c.source_id)) != c.content_hash]
    if changed:
        vectors = await embed_documents(embedder, [c.text for c in changed])
        await store.upsert(
            conn,
            [
                EmbeddingRow(discord_id, c.source_type, c.source_id, c.list_id, c.text, c.content_hash, v, store.model)
                for c, v in zip(changed, vectors, strict=True)
            ],
        )
    if stale_type:
        keep = {c.source_id for c in chunks if c.source_type == stale_type}
        stale = [sid for (st, sid) in existing if st == stale_type and sid not in keep]
        if stale:
            await store.delete_sources(conn, discord_id, stale, stale_type)
    return len(changed)


async def index_list(
    conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder, discord_id: str, list_id: int
) -> int:
    """(Re)index one quest and its long subtasks. Removes the rows if the quest is gone."""
    lst = await repo.get_list_with_items(conn, discord_id, list_id)
    if lst is None:
        await store.delete(conn, discord_id, list_id=list_id)
        return 0
    items = lst.pop("items")
    chunks = [list_chunk(lst, items), *item_chunks(lst, items)]
    existing = await store.existing_hashes(conn, discord_id, list_id=list_id)
    n = await _sync(conn, store, embedder, discord_id, chunks, existing)
    # Long subtasks that became short (or were deleted) no longer have a chunk.
    stale_items = [sid for (st, sid) in existing if st == "item" and sid not in {c.source_id for c in chunks}]
    if stale_items:
        await store.delete_sources(conn, discord_id, stale_items, "item")
    return n


async def index_history(conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder, discord_id: str) -> int:
    since = datetime.combine(week_start(datetime.now().date()) - timedelta(weeks=HISTORY_WEEKS), datetime.min.time())
    completions = await repo.completions_since(conn, discord_id, since)
    chunks = history_chunks(discord_id, completions)
    existing = await store.existing_hashes(conn, discord_id, source_type="history")
    return await _sync(conn, store, embedder, discord_id, chunks, existing, stale_type="history")


async def index_user(conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder, discord_id: str) -> int:
    total = 0
    for lst in await repo.lists_for_user(conn, discord_id):
        total += await index_list(conn, store, embedder, discord_id, lst["id"])
    total += await index_history(conn, store, embedder, discord_id)
    return total


async def index_docs(conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder, docs: dict[str, str]) -> int:
    """Index global help docs (``discord_id IS NULL``). ``docs`` maps slug -> markdown."""
    total = 0
    for slug, markdown in docs.items():
        chunks = doc_chunks(slug, markdown)
        existing = {
            k: v
            for k, v in (await store.existing_hashes(conn, None, source_type="doc")).items()
            if k[1].startswith(f"{slug}#")
        }
        total += await _sync(conn, store, embedder, None, chunks, existing, stale_type="doc")
    store.invalidate(None)
    return total


async def stale_lists(conn: AsyncConnection, store: MySQLNumpyStore) -> list[tuple[str, int]]:
    """Lists (of users who allow AI) missing an embedding or edited after it was written."""
    lists = (
        await conn.execute(
            text(
                "SELECT l.discord_id, l.id, (SELECT MAX(i.updated_at) FROM items i WHERE i.list_id = l.id) AS last_item "
                "FROM lists l JOIN users u ON u.discord_id = l.discord_id WHERE u.ai_enabled = 1"
            )
        )
    ).all()
    embedded = {
        r[0]: repo.to_datetime(r[1])
        for r in (
            await conn.execute(
                text("SELECT source_id, updated_at FROM ai_embeddings WHERE source_type = 'list' AND model = :m"),
                {"m": store.model},
            )
        ).all()
    }
    out = []
    for discord_id, list_id, last_item in lists:
        at = embedded.get(f"L{list_id}")
        last = repo.to_datetime(last_item)
        if at is None or (last is not None and last > at):
            out.append((discord_id, list_id))
    return out


async def reconcile(conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder) -> int:
    """Catch lists whose fire-and-forget re-index call was missed."""
    fixed = 0
    for discord_id, list_id in await stale_lists(conn, store):
        await index_list(conn, store, embedder, discord_id, list_id)
        fixed += 1
    return fixed


async def reindex_list(discord_id: str, list_id: int) -> None:
    async with pool.connection() as conn:
        await index_list(conn, runtime.get_store(), runtime.get_embedder(), discord_id, list_id)


async def forget_list(discord_id: str, list_id: int) -> None:
    async with pool.connection() as conn:
        await runtime.get_store().delete(conn, discord_id, list_id=list_id)


async def reconcile_loop() -> None:
    minutes = get_settings().ai_reconcile_minutes
    while True:
        await asyncio.sleep(minutes * 60)
        try:
            async with pool.connection() as conn:
                fixed = await reconcile(conn, runtime.get_store(), runtime.get_embedder())
            if fixed:
                log.info("reconcile re-indexed %d lists", fixed)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a failed pass must not kill the loop
            log.exception("reconcile pass failed")
