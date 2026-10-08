"""Process-wide singletons for the vector store and embedder (overridable in tests)."""

from __future__ import annotations

from app.config import get_settings
from app.rag.embed import Embedder
from app.rag.store import MySQLNumpyStore

_store: MySQLNumpyStore | None = None
_embedder: Embedder | None = None


def get_store() -> MySQLNumpyStore:
    global _store
    if _store is None:
        _store = MySQLNumpyStore(get_settings().gemini_embed_model)
    return _store


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        from app.llm import embeddings_model

        _embedder = embeddings_model()
    return _embedder


def set_runtime(store: MySQLNumpyStore | None, embedder: Embedder | None) -> None:
    global _store, _embedder
    _store, _embedder = store, embedder
