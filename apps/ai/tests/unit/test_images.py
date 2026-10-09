from __future__ import annotations

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app import images
from app.graphs.chat import with_image

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
CDN = "https://cdn.discordapp.com/attachments/1/2/cat.png"


def transport(status=200, content_type="image/png", body=PNG):
    return httpx.MockTransport(lambda r: httpx.Response(status, headers={"content-type": content_type}, content=body))


@pytest.mark.parametrize(
    "url",
    [
        "http://cdn.discordapp.com/x.png",  # not https
        "https://evil.example/x.png",
        "https://cdn.discordapp.com.evil.example/x.png",
        "https://169.254.169.254/latest/meta-data",
        "file:///etc/passwd",
    ],
)
def test_only_discord_cdn_urls_are_allowed(url):
    with pytest.raises(images.ImageRejected):
        images.check_url(url)


async def test_fetch_returns_a_data_url():
    url = await images.fetch_data_url(CDN, transport())
    assert url.startswith("data:image/png;base64,")


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"status": 404}, "404"),
        ({"content_type": "text/html"}, "not a PNG"),
        ({"body": b"0" * (images.MAX_BYTES + 1)}, "too large"),
    ],
)
async def test_fetch_rejects_bad_downloads(kwargs, message):
    with pytest.raises(images.ImageRejected, match=message):
        await images.fetch_data_url(CDN, transport(**kwargs))


def test_with_image_attaches_to_the_latest_human_message_only():
    msgs = [HumanMessage("first", id="1"), AIMessage("ok"), HumanMessage("look at this", id="2")]
    out = with_image(msgs, "data:image/png;base64,AAAA")
    assert out[0].content == "first" and msgs[2].content == "look at this"  # input untouched
    assert out[2].content == [
        {"type": "text", "text": "look at this"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
    ]
    assert with_image(msgs, None) == msgs
