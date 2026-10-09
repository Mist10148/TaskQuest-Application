"""Keeps ``ai_embeddings`` in sync with lists, items, history and docs.

Only changed text is re-embedded (``content_hash``), so re-indexing is cheap and idempotent.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

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
    # The list was checked even if its text did not change (e.g. a subtask was reordered).
    unchanged = [
        c.source_id for c in chunks if c.source_type == "list" and existing.get(("list", c.source_id)) == c.content_hash
    ]
    if unchanged:
        await store.touch(conn, "list", unchanged)
    # Long subtasks that became short (or were deleted) no longer have a chunk.
    stale_items = [sid for (st, sid) in existing if st == "item" and sid not in {c.source_id for c in chunks}]
    if stale_items:
        await store.delete_sources(conn, discord_id, stale_items, "item")
    return n


def history_since() -> datetime:
    """Start of the history window (naive UTC, like the stored timestamps)."""
    return datetime.combine(week_start(datetime.now(UTC).date()) - timedelta(weeks=HISTORY_WEEKS), datetime.min.time())


async def index_history(conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder, discord_id: str) -> int:
    since = history_since()
    completions = await repo.completions_since(conn, discord_id, since)
    xp_by_week: dict[date, int] = defaultdict(int)
    for at, amount in await repo.xp_events_since(conn, discord_id, since):
        xp_by_week[week_start(at.date())] += amount
    chunks = history_chunks(discord_id, completions, dict(xp_by_week))
    existing = await store.existing_hashes(conn, discord_id, source_type="history")
    n = await _sync(conn, store, embedder, discord_id, chunks, existing, stale_type="history")
    unchanged = [c.source_id for c in chunks if existing.get(("history", c.source_id)) == c.content_hash]
    if unchanged:
        await store.touch(conn, "history", unchanged)
    return n


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
    """Lists (of users who allow AI) missing an embedding, or whose list or subtasks changed after it was written."""
    lists = (
        await conn.execute(
            text(
                "SELECT l.discord_id, l.id, l.updated_at, "
                "(SELECT MAX(i.updated_at) FROM items i WHERE i.list_id = l.id) AS last_item "
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
    for discord_id, list_id, list_updated, last_item in lists:
        at = embedded.get(f"L{list_id}")
        changes = [d for d in (repo.to_datetime(list_updated), repo.to_datetime(last_item)) if d is not None]
        if at is None or (changes and max(changes) > at):
            out.append((discord_id, list_id))
    return out


async def stale_history_users(conn: AsyncConnection, store: MySQLNumpyStore) -> list[str]:
    """Users (who allow AI) with completions or XP in the history window newer than their history chunks."""
    since = history_since()
    activity = (
        await conn.execute(
            text(
                "SELECT u.discord_id, "
                "(SELECT MAX(i.completed_at) FROM items i JOIN lists l ON l.id = i.list_id "
                " WHERE l.discord_id = u.discord_id AND i.completed = 1 AND i.completed_at >= :since), "
                "(SELECT MAX(x.created_at) FROM xp_transactions x "
                " WHERE x.discord_id = u.discord_id AND x.amount > 0 AND x.created_at >= :since) "
                "FROM users u WHERE u.ai_enabled = 1"
            ),
            {"since": since},
        )
    ).all()
    embedded = {
        r[0]: repo.to_datetime(r[1])
        for r in (
            await conn.execute(
                text(
                    "SELECT discord_id, MAX(updated_at) FROM ai_embeddings "
                    "WHERE source_type = 'history' AND model = :m GROUP BY discord_id"
                ),
                {"m": store.model},
            )
        ).all()
    }
    out = []
    for discord_id, last_done, last_xp in activity:
        changes = [d for d in (repo.to_datetime(last_done), repo.to_datetime(last_xp)) if d is not None]
        at = embedded.get(discord_id)
        if changes and (at is None or max(changes) > at):
            out.append(discord_id)
    return out


async def purge_opted_out(conn: AsyncConnection) -> int:
    """Delete vectors of users who turned AI off (a missed /internal/index call must not keep them)."""
    result = await conn.execute(
        text("DELETE FROM ai_embeddings WHERE discord_id IN (SELECT discord_id FROM users WHERE ai_enabled = 0)")
    )
    return int(result.rowcount or 0)


async def reconcile(conn: AsyncConnection, store: MySQLNumpyStore, embedder: Embedder) -> int:
    """Catch lists whose fire-and-forget re-index call was missed, and refresh weekly history.

    Returns the number of lists re-indexed.
    """
    await purge_opted_out(conn)
    fixed = 0
    for discord_id, list_id in await stale_lists(conn, store):
        await index_list(conn, store, embedder, discord_id, list_id)
        fixed += 1
    for discord_id in await stale_history_users(conn, store):
        await index_history(conn, store, embedder, discord_id)
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
