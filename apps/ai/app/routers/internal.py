"""Service-to-service routes called by Express (re-index hooks). Token-protected."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.db import pool, repo
from app.deps import verify_internal_token
from app.rag import indexer, runtime

log = logging.getLogger("taskquest.ai.internal")

router = APIRouter(prefix="/internal", dependencies=[Depends(verify_internal_token)])


class IndexBody(BaseModel):
    discordId: str = Field(pattern=r"^\d{1,32}$")
    listId: int | None = None


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
    else:
        await indexer.reindex_list(body.discordId, body.listId)
    return Response(status_code=204)


@router.post("/forget", status_code=204)
async def forget(body: IndexBody):
    if body.listId is not None:
        await indexer.forget_list(body.discordId, body.listId)
    return Response(status_code=204)
