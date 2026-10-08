"""Public-facing (via Express) routes. Every route requires X-AI-Token and X-Discord-Id."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.chains import summarize as summarize_chain
from app.db import pool
from app.deps import Caller, get_caller
from app.llm import get_llm_factory

router = APIRouter(prefix="/v1")


@router.get("/ping")
async def ping(caller: Caller = Depends(get_caller)):
    return {"pong": True}


class SummaryBody(BaseModel):
    mode: Literal["list", "digest", "recap"]
    listId: int | None = Field(default=None, gt=0)
    range: Literal["day", "week"] = "week"


@router.post("/summary")
async def summary(
    body: SummaryBody, caller: Caller = Depends(get_caller), llm_factory: Callable[[], Any] = Depends(get_llm_factory)
):
    async with pool.connection() as conn:
        try:
            return await summarize_chain.summarize(
                conn, caller.discord_id, llm_factory, body.mode, list_id=body.listId, range_=body.range
            )
        except summarize_chain.NotFound:
            raise HTTPException(status_code=404, detail="List not found") from None
