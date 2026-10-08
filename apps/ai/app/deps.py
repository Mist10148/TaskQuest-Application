"""FastAPI dependencies: service token check and the trusted Discord ID."""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass

from fastapi import Header, HTTPException

from app.config import get_settings

_DISCORD_ID = re.compile(r"^\d{1,32}$")


def verify_internal_token(x_ai_token: str = Header(default="")) -> None:
    expected = get_settings().ai_internal_token
    if not expected or not hmac.compare_digest(x_ai_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid token")


@dataclass(frozen=True)
class Caller:
    discord_id: str
    request_id: str


def get_caller(
    x_ai_token: str = Header(default=""),
    x_discord_id: str = Header(default=""),
    x_request_id: str = Header(default=""),
) -> Caller:
    """Token + Discord ID set by Express. The browser never supplies either."""
    verify_internal_token(x_ai_token)
    if not _DISCORD_ID.match(x_discord_id):
        raise HTTPException(status_code=400, detail="missing or invalid X-Discord-Id")
    return Caller(discord_id=x_discord_id, request_id=x_request_id or "-")
