"""Hybrid retrieval over a user's quests plus the global help docs.

score = 0.75 * cosine + 0.15 * keyword overlap + 0.10 * urgency boost

Candidates come from the vector store, are re-read fresh from MySQL (so the model
never sees stale completion state), then filtered by status/category and trimmed to k.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db import repo
from app.rag.chunking import item_label, list_label, render_list
from app.rag.embed import Embedder, embed_query
from app.rag.store import Hit, MySQLNumpyStore, SearchFilters

W_COSINE, W_KEYWORD, W_URGENCY = 0.75, 0.15, 0.10
_WORD = re.compile(r"[a-z0-9]{3,}")


@dataclass(frozen=True)
class Retrieved:
    kind: str  # list | item | history | doc
    id: str  # L42 / I311 / doc slug#n / H...
    title: str
    text: str
    score: float
    list_id: int | None = None


def keyword_overlap(query: str, content: str) -> float:
    q = set(_WORD.findall(query.lower()))
    if not q:
        return 0.0
    return len(q & set(_WORD.findall(content.lower()))) / len(q)


def urgency_boost(deadline: date | None, today: date, *, open_: bool = True) -> float:
    """0..1: overdue = 1, due within a week decays towards 0, no deadline or finished = 0."""
    if deadline is None or not open_:
        return 0.0
    days = (deadline - today).days
    if days <= 0:
        return 1.0
    return max(0.0, 1.0 - days / 7)


def _title(content: str) -> str:
    first = content.split("\n", 1)[0]
    return first.removeprefix("Quest: ").strip()[:120]


class TaskRetriever:
    def __init__(self, store: MySQLNumpyStore, embedder: Embedder) -> None:
        self.store = store
        self.embedder = embedder

    async def retrieve(
        self,
        conn: AsyncConnection,
        discord_id: str,
        query: str,
        *,
        k: int = 6,
        source_types: frozenset[str] | None = None,
        status: str | None = None,  # "open" | "done"
        category: str | None = None,
        today: date | None = None,
    ) -> list[Retrieved]:
        today = today or date.today()
        qvec = await embed_query(self.embedder, query)
        hits = await self.store.search(conn, discord_id, qvec, k * 4, SearchFilters(source_types=source_types))
        if not hits:
            return []

        lists = {lst["id"]: lst for lst in await repo.lists_for_user(conn, discord_id)}
        scored: list[tuple[float, Retrieved]] = []
        for hit in hits:
            item = await self._fresh(conn, discord_id, hit, lists)
            if item is None:
                continue
            lst = lists.get(hit.list_id) if hit.list_id else None
            if lst is not None:
                is_open = lst["items_total"] == 0 or lst["items_completed"] < lst["items_total"]
                if status == "open" and not is_open:
                    continue
                if status == "done" and is_open:
                    continue
                if category and (lst.get("category") or "").lower() != category.lower():
                    continue
                urgency = urgency_boost(lst["deadline"], today, open_=is_open)
            else:
                urgency = 0.0
            score = W_COSINE * hit.score + W_KEYWORD * keyword_overlap(query, hit.content) + W_URGENCY * urgency
            scored.append((score, Retrieved(**{**item.__dict__, "score": score})))
        scored.sort(key=lambda t: -t[0])
        return [r for _, r in scored[:k]]

    async def _fresh(
        self, conn: AsyncConnection, discord_id: str, hit: Hit, lists: dict[int, dict]
    ) -> Retrieved | None:
        """Rebuild a hit from current data; None if the source no longer exists."""
        if hit.source_type == "list" and hit.list_id is not None:
            lst = lists.get(hit.list_id)
            if lst is None:
                return None
            items = await repo.items_for_list(conn, discord_id, hit.list_id)
            return Retrieved("list", list_label(lst["id"]), lst["name"], render_list(lst, items), hit.score, lst["id"])
        if hit.source_type == "item" and hit.list_id is not None:
            if hit.list_id not in lists:
                return None
            return Retrieved("item", hit.source_id, _title(hit.content), hit.content, hit.score, hit.list_id)
        if hit.source_type == "item":
            return None
        return Retrieved(hit.source_type, hit.source_id, _title(hit.content), hit.content, hit.score, hit.list_id)


def format_context(results: list[Retrieved]) -> str:
    """Delimited, numbered context blocks. Task text is data, never instructions."""
    blocks = []
    for r in results:
        tag = "doc" if r.kind == "doc" else "task"
        attr = f'section="{r.id}"' if r.kind == "doc" else f'id="{r.id}"'
        blocks.append(f"<{tag} {attr}>\n{r.text}\n</{tag}>")
    return "\n".join(blocks)


class TaskRetrieverLC(BaseRetriever):
    """LangChain adapter so the retriever plugs into chains/tools. Scoped to one user at construction."""

    retriever: TaskRetriever
    discord_id: str
    k: int = 6
    model_config = {"arbitrary_types_allowed": True}

    def _get_relevant_documents(self, query, *, run_manager=None):  # pragma: no cover - async only
        raise NotImplementedError("use ainvoke")

    async def _aget_relevant_documents(self, query, *, run_manager=None):
        from app.db import pool

        async with pool.get_engine().connect() as conn:
            results = await self.retriever.retrieve(conn, self.discord_id, query, k=self.k)
        return [Document(page_content=r.text, metadata={"id": r.id, "kind": r.kind, "score": r.score}) for r in results]


__all__ = ["Retrieved", "TaskRetriever", "TaskRetrieverLC", "format_context", "item_label"]
