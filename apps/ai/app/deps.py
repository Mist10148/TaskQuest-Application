"""FastAPI dependencies: service token check and the trusted Discord ID."""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from app import usage
from app.config import get_settings
from app.db import pool, repo

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


class AIOptedOut(Exception):
    """The user turned AI off in their settings (users.ai_enabled = 0)."""


@dataclass(frozen=True)
class AIAccess:
    """A caller that passed the AI gate, holding one reserved request of its daily quota."""

    caller: Caller
    feature: str

    @property
    def discord_id(self) -> str:
        return self.caller.discord_id

    async def refund(self) -> None:
        """Give the request back because the call never reached the model."""
        async with pool.connection() as conn:
            await usage.release(conn, self.caller.discord_id, self.feature)


def require_ai(feature: str):
    """THE gate for every route that runs the model: users.ai_enabled plus the daily quota.

    The request is reserved (atomically) before any work starts; routes record tokens afterwards with
    ``requests=0`` and call ``access.refund()`` when they reject the call before using the model.
    """

    async def dependency(caller: Caller = Depends(get_caller)) -> AIAccess:
        async with pool.connection() as conn:
            if not await repo.ai_enabled(conn, caller.discord_id):
                raise AIOptedOut
            await usage.reserve(conn, caller.discord_id, feature)  # raises QuotaExceeded -> rolled back
        return AIAccess(caller, feature)

    return dependency
