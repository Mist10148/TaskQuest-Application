"""Fetch an image a Discord user attached so Gemini can see it.

Only Discord's own CDN hosts are fetched (the service must never be usable to request arbitrary URLs),
over HTTPS, with a size cap and an image content type. The bytes go to the model inline for the
current turn only; they are never written to the conversation checkpoint.
"""

from __future__ import annotations

import base64
from urllib.parse import urlparse

import httpx

ALLOWED_HOSTS = frozenset({"cdn.discordapp.com", "media.discordapp.net"})
ALLOWED_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})
MAX_BYTES = 4 * 1024 * 1024


class ImageRejected(ValueError):
    """The URL or the downloaded file is not an acceptable image."""


def check_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in ALLOWED_HOSTS:
        raise ImageRejected("Only images uploaded to Discord can be read.")
    return url


async def fetch_data_url(url: str, transport: httpx.AsyncBaseTransport | None = None) -> str:
    """Download ``url`` and return it as a ``data:`` URL."""
    check_url(url)
    async with httpx.AsyncClient(transport=transport, timeout=10, follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                raise ImageRejected(f"Could not download the image ({response.status_code}).")
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type not in ALLOWED_TYPES:
                raise ImageRejected("That attachment is not a PNG, JPEG, WebP or GIF image.")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data += chunk
                if len(data) > MAX_BYTES:
                    raise ImageRejected("That image is too large (4 MB max).")
    return f"data:{content_type};base64,{base64.b64encode(bytes(data)).decode()}"
