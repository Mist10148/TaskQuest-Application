"""Vector store: MySQL rows + in-process cosine similarity, behind a small interface.

A user with 2,000 chunks x 768 dims is about 6 MB and a matrix-vector product takes
well under a millisecond, which is fine to roughly 10k chunks per user. Beyond that,
implement ``VectorStore`` on pgvector/Qdrant/TiDB Vector; callers do not change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np
from cachetools import TTLCache
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.rag.embed import from_blob, normalize, to_blob


@dataclass(frozen=True)
class EmbeddingRow:
    discord_id: str | None  # None = global docs
    source_type: str
    source_id: str
    list_id: int | None
    content: str
    content_hash: str
    vector: np.ndarray
    model: str


@dataclass(frozen=True)
class Hit:
    source_type: str
    source_id: str
    list_id: int | None
    content: str
    score: float


@dataclass(frozen=True)
class SearchFilters:
    source_types: frozenset[str] | None = None
    list_ids: frozenset[int] | None = None


class VectorStore(Protocol):
    async def upsert(self, conn: AsyncConnection, rows: list[EmbeddingRow]) -> None: ...

    async def delete(self, conn: AsyncConnection, discord_id: str, *, list_id: int | None = None) -> None: ...

    async def search(
        self,
        conn: AsyncConnection,
        discord_id: str,
        query_vec: np.ndarray,
        k: int,
        filters: SearchFilters | None = None,
    ) -> list[Hit]: ...


_Matrix = tuple[list[dict[str, Any]], np.ndarray]


class MySQLNumpyStore:
    """Loads one user's vectors (plus the global docs) into a matrix and runs cosine top-k."""

    def __init__(self, model: str, *, cache_size: int = 500, ttl: int = 600) -> None:
        self.model = model
        self._cache: TTLCache[str, _Matrix] = TTLCache(maxsize=cache_size, ttl=ttl)

    def invalidate(self, discord_id: str | None) -> None:
        """Drop cached matrices. ``None`` (global docs changed) drops everything."""
        if discord_id is None:
            self._cache.clear()
        else:
            self._cache.pop(discord_id, None)

    async def existing_hashes(
        self,
        conn: AsyncConnection,
        discord_id: str | None,
        *,
        list_id: int | None = None,
        source_type: str | None = None,
    ) -> dict[tuple[str, str], str]:
        """(source_type, source_id) -> content_hash for rows already embedded with this model."""
        sql = "SELECT source_type, source_id, content_hash FROM ai_embeddings WHERE model = :model AND "
        params: dict[str, Any] = {"model": self.model}
        if discord_id is None:
            sql += "discord_id IS NULL"
        else:
            sql += "discord_id = :uid"
            params["uid"] = discord_id
        if list_id is not None:
            sql += " AND list_id = :lid"
            params["lid"] = list_id
        if source_type is not None:
            sql += " AND source_type = :st"
            params["st"] = source_type
        result = await conn.execute(text(sql), params)
        return {(r[0], r[1]): r[2] for r in result.all()}

    async def upsert(self, conn: AsyncConnection, rows: list[EmbeddingRow]) -> None:
        # UPDATE-then-INSERT keeps this portable (MySQL and the SQLite used in tests).
        for row in rows:
            params = {
                "uid": row.discord_id,
                "st": row.source_type,
                "sid": row.source_id,
                "lid": row.list_id,
                "content": row.content,
                "hash": row.content_hash,
                "emb": to_blob(row.vector),
                "model": row.model,
            }
            updated = await conn.execute(
                text(
                    "UPDATE ai_embeddings SET discord_id = :uid, list_id = :lid, content = :content, "
                    "content_hash = :hash, embedding = :emb, updated_at = CURRENT_TIMESTAMP "
                    "WHERE source_type = :st AND source_id = :sid AND model = :model"
                ),
                params,
            )
            if updated.rowcount == 0:
                await conn.execute(
                    text(
                        "INSERT INTO ai_embeddings (discord_id, source_type, source_id, list_id, content, content_hash, "
                        "embedding, model) VALUES (:uid, :st, :sid, :lid, :content, :hash, :emb, :model)"
                    ),
                    params,
                )
            self.invalidate(row.discord_id)

    async def touch(self, conn: AsyncConnection, source_type: str, source_ids: list[str]) -> None:
        """Mark unchanged rows as checked now, so the reconcile job does not flag them again."""
        for sid in source_ids:
            await conn.execute(
                text(
                    "UPDATE ai_embeddings SET updated_at = CURRENT_TIMESTAMP "
                    "WHERE source_type = :st AND source_id = :sid AND model = :model"
                ),
                {"st": source_type, "sid": sid, "model": self.model},
            )

    async def delete(self, conn: AsyncConnection, discord_id: str, *, list_id: int | None = None) -> None:
        if list_id is None:
            await conn.execute(text("DELETE FROM ai_embeddings WHERE discord_id = :uid"), {"uid": discord_id})
        else:
            await conn.execute(
                text(
                    "DELETE FROM ai_embeddings WHERE discord_id = :uid AND list_id = :lid "
                    "AND source_type IN ('list', 'item')"
                ),
                {"uid": discord_id, "lid": list_id},
            )
        self.invalidate(discord_id)

    async def delete_sources(
        self, conn: AsyncConnection, discord_id: str | None, source_ids: list[str], source_type: str
    ) -> None:
        for sid in source_ids:
            await conn.execute(
                text("DELETE FROM ai_embeddings WHERE source_type = :st AND source_id = :sid AND model = :model"),
                {"st": source_type, "sid": sid, "model": self.model},
            )
        self.invalidate(discord_id)

    async def _matrix(self, conn: AsyncConnection, discord_id: str) -> _Matrix:
        cached = self._cache.get(discord_id)
        if cached is not None:
            return cached
        result = await conn.execute(
            text(
                "SELECT source_type, source_id, list_id, content, embedding FROM ai_embeddings "
                "WHERE model = :model AND (discord_id = :uid OR discord_id IS NULL)"
            ),
            {"model": self.model, "uid": discord_id},
        )
        meta: list[dict[str, Any]] = []
        vecs: list[np.ndarray] = []
        for st, sid, lid, content, blob in result.all():
            meta.append({"source_type": st, "source_id": sid, "list_id": lid, "content": content})
            vecs.append(normalize(from_blob(bytes(blob))))
        matrix = np.vstack(vecs) if vecs else np.zeros((0, 1), dtype=np.float32)
        self._cache[discord_id] = (meta, matrix)
        return meta, matrix

    async def search(
        self,
        conn: AsyncConnection,
        discord_id: str,
        query_vec: np.ndarray,
        k: int,
        filters: SearchFilters | None = None,
    ) -> list[Hit]:
        meta, matrix = await self._matrix(conn, discord_id)
        if not meta or matrix.shape[1] != query_vec.shape[0]:
            return []
        mask = np.ones(len(meta), dtype=bool)
        if filters and filters.source_types:
            mask &= np.array([m["source_type"] in filters.source_types for m in meta])
        if filters and filters.list_ids:
            mask &= np.array([m["list_id"] in filters.list_ids for m in meta])
        idx = np.flatnonzero(mask)
        if idx.size == 0:
            return []
        q = normalize(query_vec)
        scores = matrix[idx] @ q
        order = np.argsort(-scores)[:k]
        return [
            Hit(
                source_type=meta[idx[i]]["source_type"],
                source_id=meta[idx[i]]["source_id"],
                list_id=meta[idx[i]]["list_id"],
                content=meta[idx[i]]["content"],
                score=float(scores[i]),
            )
            for i in order
        ]
