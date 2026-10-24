"""Service-to-service routes called by Express (re-index hooks). Token-protected."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.db import pool, repo
from app.deps import verify_internal_token
from app.rag import indexer, runtime

log = logging.getLogger("taskquest.ai.internal")

router = APIRouter(prefix="/internal", dependencies=[Depends(verify_internal_token)])

# (user, list) -> the re-index waiting for its delay. A burst of edits (a bulk completion, a quick run of renames) would
# otherwise cost one embedding call each; the waiting run reads the list when it fires, so it sees all of them.
_waiting: dict[tuple[str, int], asyncio.Task] = {}
_tasks: set[asyncio.Task] = set()  # strong references: a task nobody holds can be collected mid-run


async def _reindex_later(key: tuple[str, int], delay: float) -> None:
    try:
        await asyncio.sleep(delay)
    finally:
        _waiting.pop(key, None)  # an edit during the run below schedules a fresh one
    try:
        await indexer.reindex_list(*key)
    except Exception:  # noqa: BLE001 - nobody is waiting on this call; the reconcile loop catches what was missed
        log.exception("delayed re-index failed for list %s", key[1])


class IndexBody(BaseModel):
    discordId: str = Field(pattern=r"^\d{1,32}$")
    listId: int | None = Field(default=None, gt=0, le=2_147_483_647)


@router.post("/index", status_code=204)
async def index(body: IndexBody):
    """Re-embed one list (or a user's whole library when listId is omitted).

    Users who opted out of AI are never sent to Gemini; any vectors they had are removed.
    """
    async with pool.connection() as conn:
        if not await repo.ai_enabled(conn, body.discordId):
            await runtime.get_store().delete(conn, body.discordId)
            return Response(status_code=204)
    if not get_settings().gemini_api_key:
        return Response(status_code=204)  # nothing to do without embeddings
    if body.listId is None:
        async with pool.connection() as conn:
            await indexer.index_user(conn, runtime.get_store(), runtime.get_embedder(), body.discordId)
        runtime.get_store().invalidate(body.discordId)  # after the commit
    else:
        delay = get_settings().embed_debounce_seconds
        if delay <= 0:
            await indexer.reindex_list(body.discordId, body.listId)
        else:
            key = (body.discordId, body.listId)
            if key not in _waiting:
                task = asyncio.create_task(_reindex_later(key, delay))
                _waiting[key] = task
                _tasks.add(task)
                task.add_done_callback(_tasks.discard)
    return Response(status_code=204)


@router.post("/forget", status_code=204)
async def forget(body: IndexBody):
    """Drop one deleted list's vectors, or (no listId) everything stored about the user.

    The whole-user form backs "Reset progress": vectors, chat threads and cached summaries go.
    """
    if body.listId is not None:
        await indexer.forget_list(body.discordId, body.listId)
        return Response(status_code=204)
    async with pool.connection() as conn:
        await runtime.get_store().delete(conn, body.discordId)
        await repo.delete_user_ai_data(conn, body.discordId)
    return Response(status_code=204)
