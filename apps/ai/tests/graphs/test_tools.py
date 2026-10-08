"""Chat tools: scoping, argument safety, and write calls through Express (mocked)."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest
from pydantic import ValidationError

from app.tools import specs
from app.tools.specs import TOOLS, ToolContext
from app.tools.web_client import ToolError, WebClient
from tests.conftest import OTHER, UID

TODAY = date.today()


def make_web(responses=None, calls=None):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        if calls is not None:
            calls.append((request.method, request.url.path, body, request.headers.get("x-ai-token")))
        status, payload = (responses or {}).get(request.url.path, (200, {"ok": True}))
        return httpx.Response(status, json=payload)

    return WebClient(base_url="http://web", token="secret-token", transport=httpx.MockTransport(handler))


def ctx(uid=UID, web=None):
    return ToolContext(discord_id=uid, llm_factory=lambda **kw: None, web=web or make_web(), today=TODAY)


def run(tool, uid=UID, web=None, **args):
    spec = TOOLS[tool]
    return spec.handler(ctx(uid, web), spec.args(**args))


def test_model_facing_schemas_never_expose_discord_id():
    for spec in TOOLS.values():
        assert "discord_id" not in json.dumps(spec.as_langchain_tool().args_schema.model_json_schema()).lower()
        with pytest.raises(ValidationError):  # injected extra args are rejected, not ignored
            spec.args(discord_id="222", **{})  # type: ignore[arg-type]


def test_write_tools_are_flagged_and_have_previews():
    writes = {n for n, t in TOOLS.items() if t.write}
    assert writes == {"create_list", "add_item", "complete_item", "update_list"}
    assert all(TOOLS[n].preview for n in writes)
    assert not any(t.write for n, t in TOOLS.items() if n not in writes)


async def test_get_list_is_scoped_to_the_caller(seeded):
    mine = await run("get_list", list_id="L1")
    assert mine["name"] == "Math homework" and mine["progress"] == "1/2"
    assert [s["name"] for s in mine["subtasks"]] == ["Problems 1-10", "Problems 11-20"]
    with pytest.raises(ToolError):
        await run("get_list", list_id="L4")  # belongs to user 222
    other = await run("get_list", uid=OTHER, list_id="4")
    assert other["name"] == "Secret plans"


async def test_overdue_due_soon_and_stats(seeded):
    due = await run("get_due_soon", days=3)
    assert [x["id"] for x in due["due_soon"]] == ["L1"]
    assert (await run("get_overdue"))["overdue"] == []
    stats = await run("get_stats", range="week")
    assert stats["xp_earned"] == 25 and stats["subtasks_completed"] == 1


async def test_search_falls_back_to_keywords_without_embeddings(seeded):
    out = await run("search_tasks", query="garage cleaning")
    assert [r["id"] for r in out["results"]] == ["L2"] and out["note"] == "keyword search"
    assert "L4" not in json.dumps(await run("search_tasks", query="secret plans"))  # other user's quest


async def test_id_parsing():
    assert specs._parse_id("L42", "L") == 42 and specs._parse_id("42", "L") == 42 and specs._parse_id("i7", "I") == 7
    with pytest.raises(ToolError):
        specs._parse_id("42; DROP", "L")


async def test_complete_item_calls_express_with_token_and_trusted_id(seeded):
    calls: list = []
    web = make_web({"/internal/items/1/toggle": (200, {"completed": True, "xpResult": {"finalXP": 12}})}, calls)
    out = await run("complete_item", web=web, item_id="I1")
    assert out["xpResult"]["finalXP"] == 12
    method, path, body, token = calls[0]
    assert (method, path, token) == ("PATCH", "/internal/items/1/toggle", "secret-token")
    assert body == {"discordId": UID, "completed": True}


async def test_previews_resolve_names_and_reject_foreign_ids(seeded):
    c = ctx()
    assert (
        await TOOLS["complete_item"].preview(c, TOOLS["complete_item"].args(item_id="I1"))
        == 'Mark "Problems 1-10" as done?'
    )
    assert "Math homework" in await TOOLS["add_item"].preview(c, TOOLS["add_item"].args(list_id="L1", name="x"))
    with pytest.raises(ToolError):
        await TOOLS["add_item"].preview(c, TOOLS["add_item"].args(list_id="L4", name="x"))  # not theirs
    with pytest.raises(ToolError):
        await TOOLS["complete_item"].preview(c, TOOLS["complete_item"].args(item_id="I4"))
    assert "priority to HIGH" in await TOOLS["update_list"].preview(
        c, TOOLS["update_list"].args(list_id="L2", priority="HIGH")
    )


async def test_create_list_sends_only_given_fields(seeded):
    calls: list = []
    await run("create_list", web=make_web(calls=calls), name="Trip", items=["pack", "book"], deadline="2026-12-01")
    assert calls[0][2] == {"discordId": UID, "name": "Trip", "items": ["pack", "book"], "deadline": "2026-12-01"}


async def test_express_errors_become_tool_errors(seeded):
    web = make_web({"/internal/lists/1": (404, {"error": "List not found", "code": "NOT_FOUND"})})
    with pytest.raises(ToolError, match="List not found"):
        await run("update_list", web=web, list_id="L1", priority="LOW")
    with pytest.raises(ToolError, match="Nothing to change"):
        await run("update_list", web=web, list_id="L1")


def test_argument_validation():
    with pytest.raises(ValidationError):
        TOOLS["create_list"].args(name="x", deadline="tomorrow")
    with pytest.raises(ValidationError):
        TOOLS["create_list"].args(name="x", priority="URGENT")
