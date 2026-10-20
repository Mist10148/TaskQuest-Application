"""Public-facing (via Express) routes. Every route requires X-AI-Token and X-Discord-Id."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.chains import summarize as summarize_chain
from app.deps import AIAccess, Caller, get_caller, require_ai
from app.graphs import prioritize as prioritize_graph
from app.llm import get_llm_factory

router = APIRouter(prefix="/v1")


@router.get("/ping")
async def ping(caller: Caller = Depends(get_caller)):
    return {"pong": True}


class SummaryBody(BaseModel):
    mode: Literal["list", "digest", "recap"]
    listId: int | None = Field(default=None, gt=0, le=2_147_483_647)
    range: Literal["day", "week"] = "week"


@router.post("/summary")
async def summary(
    body: SummaryBody,
    access: AIAccess = Depends(require_ai("summary")),
    llm_factory: Callable[[], Any] = Depends(get_llm_factory),
):
    try:
        return await summarize_chain.summarize(
            access.discord_id,
            llm_factory,
            body.mode,
            list_id=body.listId,
            range_=body.range,
            reserved=True,
        )
    except summarize_chain.NotFound:
        access.settled = True  # the chain already handed the request back
        raise HTTPException(status_code=404, detail="List not found") from None
    except Exception:
        access.settled = True  # the chain already handed the request back; refunding again would erase another one
        raise


class PrioritizeBody(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=20)


@router.post("/prioritize")
async def prioritize(
    body: PrioritizeBody | None = None,
    access: AIAccess = Depends(require_ai("prioritize", degrade_on_quota=True)),
    llm_factory: Callable[..., Any] = Depends(get_llm_factory),
):
    try:
        return await prioritize_graph.prioritize(
            access.discord_id, llm_factory, limit=body.limit if body else None, reserved=access.reserved
        )
    except Exception:
        access.settled = True  # the graph already handed the request back
        raise
