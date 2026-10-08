"""Public-facing (via Express) routes. Every route requires X-AI-Token and X-Discord-Id."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps import Caller, get_caller

router = APIRouter(prefix="/v1")


@router.get("/ping")
async def ping(caller: Caller = Depends(get_caller)):
    return {"pong": True}
