"""FastAPI dependencies: service token check and the trusted Discord ID."""

from __future__ import annotations

import hmac
import re
from collections.abc import AsyncIterator
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


@dataclass
class AIAccess:
    """A caller that passed the AI gate, holding one reserved request of its daily quota."""

    caller: Caller
    feature: str
    settled: bool = False  # the reserved request was already refunded or accounted for
    reserved: bool = True  # False: the quota was used up and the route degrades without the model (nothing booked)

    @property
    def discord_id(self) -> str:
        return self.caller.discord_id

    async def refund(self) -> None:
        """Give the request back because the call never reached the model (idempotent)."""
        if self.settled:
            return
        self.settled = True
        async with pool.connection() as conn:
            await usage.release(conn, self.caller.discord_id, self.feature)


def require_ai(feature: str, *, degrade_on_quota: bool = False):
    """THE gate for every route that runs the model: users.ai_enabled plus the daily quota.

    The request is reserved (atomically) before any work starts; routes record tokens afterwards with
    ``requests=0`` and call ``access.refund()`` when they reject the call before using the model.
    ``degrade_on_quota``: for routes with a deterministic fallback (``/v1/prioritize``): an exhausted quota yields
    an unreserved access (``reserved=False``) instead of a 429, and the route answers without the model.
    This is a yield dependency: an exception that reaches it (a 422 for a bad body, an error before the
    response starts) refunds the reservation unless the route already settled it. Errors inside a streamed
    reply happen after the route returned, so they are not refunded (the model already ran).
    """

    async def dependency(caller: Caller = Depends(get_caller)) -> AsyncIterator[AIAccess]:
        reserved = True
        try:
            async with pool.connection() as conn:
                if not await repo.ai_enabled(conn, caller.discord_id):
                    raise AIOptedOut
                await usage.reserve(conn, caller.discord_id, feature)  # raises QuotaExceeded -> rolled back
        except usage.QuotaExceeded:
            if not degrade_on_quota:
                raise
            reserved = False
        access = AIAccess(caller, feature, settled=not reserved, reserved=reserved)
        try:
            yield access
        except Exception:
            await access.refund()
            raise

    return dependency
