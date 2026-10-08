"""Embedding helpers: batching, retries and float32 (de)serialisation."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol

import numpy as np

log = logging.getLogger("taskquest.ai.embed")

BATCH_SIZE = 100


class Embedder(Protocol):
    """The subset of LangChain's Embeddings interface we use (async)."""

    async def aembed_documents(self, texts: list[str], **kwargs: Any) -> list[list[float]]: ...

    async def aembed_query(self, text: str, **kwargs: Any) -> list[float]: ...


def to_blob(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype="<f4").tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype="<f4")


def normalize(vec: np.ndarray) -> np.ndarray:
    vec = np.asarray(vec, dtype=np.float32)
    norm = np.linalg.norm(vec)
    return vec if norm == 0 else vec / norm


async def _with_retries(fn, *, attempts: int = 3, base_delay: float = 0.5):
    for attempt in range(attempts):
        try:
            return await fn()
        except Exception as err:  # noqa: BLE001 - provider errors vary; retry then re-raise
            if attempt == attempts - 1:
                raise
            delay = base_delay * (2**attempt)
            log.warning("embedding call failed (%s); retrying in %.1fs", type(err).__name__, delay)
            await asyncio.sleep(delay)


async def embed_documents(embedder: Embedder, texts: list[str]) -> list[np.ndarray]:
    """Embed texts in batches as retrieval *documents*; returns L2-normalised float32 vectors."""
    out: list[np.ndarray] = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        vectors = await _with_retries(lambda b=batch: embedder.aembed_documents(b, task_type="retrieval_document"))
        out.extend(normalize(np.array(v)) for v in vectors)
    return out


async def embed_query(embedder: Embedder, text: str) -> np.ndarray:
    vec = await _with_retries(lambda: embedder.aembed_query(text, task_type="retrieval_query"))
    return normalize(np.array(vec))
