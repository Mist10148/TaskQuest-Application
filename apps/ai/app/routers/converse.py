"""Discord conversation endpoints (mention / reply / DM chat). Called by the bot, never by browsers."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import chat_service, images
from app.deps import AIAccess, Caller, get_caller, require_ai
from app.graphs.chat import ChatDeps
from app.routers.chat import get_chat_deps

router = APIRouter(prefix="/v1")

CHANNEL_ID = r"^\d{1,32}$"


class ConverseBody(BaseModel):
    channelId: str = Field(pattern=CHANNEL_ID)
    message: str = Field(min_length=1, max_length=4000)
    imageUrl: str | None = Field(default=None, max_length=2000)
    public: bool = False  # sent from a guild channel: replies are visible to everyone, so no quest access


def get_image_transport():
    """httpx transport for attachment downloads (overridden in tests)."""
    return None


@router.post("/converse")
async def converse(
    body: ConverseBody,
    access: AIAccess = Depends(require_ai("chat")),
    deps: ChatDeps = Depends(get_chat_deps),
    transport=Depends(get_image_transport),
):
    image = None
    if body.imageUrl:
        try:
            image = await images.fetch_data_url(body.imageUrl, transport)
        except images.ImageRejected as err:
            await access.refund()
            raise HTTPException(status_code=400, detail=str(err)) from None
        except Exception:  # noqa: BLE001 - a CDN hiccup should not fail the whole message
            await access.refund()
            raise HTTPException(status_code=400, detail="Could not download the image.") from None
    try:
        return await chat_service.converse_turn(
            deps, access.discord_id, body.channelId, body.message, image, public=body.public
        )
    except Exception:
        if any(deps.tokens):
            # The model already ran (tokens were booked with the turn): the reserved request is spent, not refunded.
            access.settled = True
        raise


@router.delete("/converse/{channel_id}")
async def forget(channel_id: str, caller: Caller = Depends(get_caller)):
    if not channel_id.isdigit() or len(channel_id) > 32:
        return {"success": True, "forgotten": False}
    return {"success": True, "forgotten": await chat_service.forget_conversation(caller.discord_id, channel_id)}
