"""HTTP client for Express ``/internal/*``: the only way the AI service changes tasks.

Going through Express means the normal ``db.tasks.*`` services run, so XP, achievements and
validation are identical to the web UI and the Discord bot.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


class ToolError(Exception):
    """A tool failed in a way the model can explain to the user."""


class WebClient:
    def __init__(
        self, base_url: str | None = None, token: str | None = None, transport: httpx.AsyncBaseTransport | None = None
    ):
        s = get_settings()
        self.base_url = (base_url or s.web_internal_url).rstrip("/")
        self.token = token if token is not None else s.ai_internal_token
        self._transport = transport

    async def _request(self, method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=15) as client:
                response = await client.request(
                    method, f"{self.base_url}/internal{path}", json=body, headers={"X-AI-Token": self.token}
                )
        except httpx.HTTPError as err:
            raise ToolError("TaskQuest could not be reached right now.") from err
        data = response.json() if response.content else {}
        if response.status_code >= 400:
            raise ToolError(str(data.get("error") or f"request failed ({response.status_code})"))
        return data

    async def create_list(self, discord_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/lists", {"discordId": discord_id, **fields})

    async def add_item(self, discord_id: str, list_id: int, fields: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", f"/lists/{list_id}/items", {"discordId": discord_id, **fields})

    async def complete_item(self, discord_id: str, item_id: int) -> dict[str, Any]:
        return await self._request("PATCH", f"/items/{item_id}/toggle", {"discordId": discord_id, "completed": True})

    async def update_list(self, discord_id: str, list_id: int, fields: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"/lists/{list_id}", {"discordId": discord_id, **fields})
