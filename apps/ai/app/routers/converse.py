"""Discord conversation endpoints (mention / reply / DM chat). Called by the bot, never by browsers."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import chat_service, usage
from app.db import pool
from app.deps import Caller, get_caller
from app.graphs.chat import ChatDeps
from app.routers.chat import get_chat_deps

router = APIRouter(prefix="/v1")

CHANNEL_ID = r"^\d{1,32}$"


class ConverseBody(BaseModel):
    channelId: str = Field(pattern=CHANNEL_ID)
    message: str = Field(min_length=1, max_length=4000)


@router.post("/converse")
async def converse(body: ConverseBody, caller: Caller = Depends(get_caller), deps: ChatDeps = Depends(get_chat_deps)):
    async with pool.connection() as conn:
        await usage.check(conn, caller.discord_id)
    return await chat_service.converse_turn(deps, caller.discord_id, body.channelId, body.message)


@router.delete("/converse/{channel_id}")
async def forget(channel_id: str, caller: Caller = Depends(get_caller)):
    if not channel_id.isdigit() or len(channel_id) > 32:
        return {"success": True, "forgotten": False}
    return {"success": True, "forgotten": await chat_service.forget_conversation(caller.discord_id, channel_id)}
