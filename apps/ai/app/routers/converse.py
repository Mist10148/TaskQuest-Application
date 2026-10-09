"""Discord conversation endpoints (mention / reply / DM chat). Called by the bot, never by browsers."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import chat_service, images, usage
from app.db import pool
from app.deps import Caller, get_caller
from app.graphs.chat import ChatDeps
from app.routers.chat import get_chat_deps

router = APIRouter(prefix="/v1")

CHANNEL_ID = r"^\d{1,32}$"


class ConverseBody(BaseModel):
    channelId: str = Field(pattern=CHANNEL_ID)
    message: str = Field(min_length=1, max_length=4000)
    imageUrl: str | None = Field(default=None, max_length=2000)


def get_image_transport():
    """httpx transport for attachment downloads (overridden in tests)."""
    return None


@router.post("/converse")
async def converse(
    body: ConverseBody,
    caller: Caller = Depends(get_caller),
    deps: ChatDeps = Depends(get_chat_deps),
    transport=Depends(get_image_transport),
):
    async with pool.connection() as conn:
        await usage.check(conn, caller.discord_id)
    image = None
    if body.imageUrl:
        try:
            image = await images.fetch_data_url(body.imageUrl, transport)
        except images.ImageRejected as err:
            raise HTTPException(status_code=400, detail=str(err)) from None
        except Exception:  # noqa: BLE001 - a CDN hiccup should not fail the whole message
            raise HTTPException(status_code=400, detail="Could not download the image.") from None
    return await chat_service.converse_turn(deps, caller.discord_id, body.channelId, body.message, image)


@router.delete("/converse/{channel_id}")
async def forget(channel_id: str, caller: Caller = Depends(get_caller)):
    if not channel_id.isdigit() or len(channel_id) > 32:
        return {"success": True, "forgotten": False}
    return {"success": True, "forgotten": await chat_service.forget_conversation(caller.discord_id, channel_id)}
