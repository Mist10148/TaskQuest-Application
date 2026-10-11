"""Chat tools: scoping, argument safety, and write calls through Express (mocked)."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.tools import specs
from app.tools.specs import TOOLS, ToolContext
from app.tools.web_client import ToolError, WebClient
from tests.conftest import OTHER, UID

TODAY = datetime.now(UTC).date()  # the service works in UTC; date.today() is the machine's local date


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
    assert writes == {"create_list", "add_item", "update_item", "break_down_task", "complete_item", "update_list"}
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


async def test_stats_report_the_never_reset_lifetime_xp_after_prestige(seeded):
    async with seeded.begin() as conn:  # prestige restarted lifetime_xp; the total keeps growing
        await conn.execute(
            text("UPDATE users SET lifetime_xp = 40, lifetime_xp_total = 900 WHERE discord_id = :u"), {"u": UID}
        )
    assert (await run("get_stats"))["lifetime_xp"] == 900
    async with seeded.begin() as conn:  # an old row whose total was never filled in: the larger column wins
        await conn.execute(
            text("UPDATE users SET lifetime_xp = 40, lifetime_xp_total = 0 WHERE discord_id = :u"), {"u": UID}
        )
    assert (await run("get_stats"))["lifetime_xp"] == 40


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


@pytest.mark.parametrize(
    ("status", "content", "message"),
    [
        (502, b"<html>Bad gateway</html>", "failed (502)"),
        (200, b"<html>not json</html>", "unexpected response"),
        (200, b"[1, 2]", "unexpected response"),
        (400, b'{"error": "Quest name is required."}', "Quest name is required."),
    ],
)
async def test_web_client_turns_bad_responses_into_tool_errors(status, content, message):
    web = WebClient(
        base_url="http://web",
        token="secret-token",
        transport=httpx.MockTransport(lambda request: httpx.Response(status, content=content)),
    )
    with pytest.raises(ToolError, match=re.escape(message)):
        await web.create_list(UID, {"name": "x"})


# ── per-task fields and break_down_task ──────────────────────────────────────


async def test_add_item_sends_the_per_task_fields_in_the_internal_api_names(seeded):
    calls: list = []
    await run(
        "add_item",
        web=make_web(calls=calls),
        list_id="L1",
        name="Essay",
        due_date="2030-06-01",
        priority="HIGH",
        tags=["#school", "essay"],
        repeat="weekly",
        parent_id="I1",
    )
    method, path, body, token = calls[0]
    assert (method, path, token) == ("POST", "/internal/lists/1/items", "secret-token")
    assert body == {
        "discordId": UID,
        "name": "Essay",
        "due_date": "2030-06-01",
        "priority": "HIGH",
        "tags": ["school", "essay"],
        "recurrence": "weekly",
        "parent_id": 1,
    }


async def test_plain_add_item_still_sends_only_the_name(seeded):
    calls: list = []
    await run("add_item", web=make_web(calls=calls), list_id="L1", name="Just this")
    assert calls[0][2] == {"discordId": UID, "name": "Just this"}


def test_per_task_arguments_are_strictly_validated():
    add = TOOLS["add_item"].args
    bad_args = [
        {"due_date": "2030-02-30"},  # not a real date
        {"due_date": "tomorrow"},
        {"priority": "URGENT"},
        {"repeat": "yearly"},
        {"tags": ["a", "b", "c", "d", "e", "f"]},  # more than 5
        {"tags": ["has space"]},
        {"tags": ["x" * 21]},
        {"xp": 99},  # unknown field
        {"discord_id": "222"},
    ]
    for extra in bad_args:
        with pytest.raises(ValidationError):
            add(list_id="L1", name="x", **extra)
    assert add(list_id="L1", name="x", tags=["a", "b", "c", "d", "e"], due_date="2030-02-28").tags
    update = TOOLS["update_item"].args
    with pytest.raises(ValidationError):  # nothing to change
        update(item_id="I1")
    with pytest.raises(ValidationError):
        update(item_id="I1", position=0)  # moving is not a tool
    assert update(item_id="I1", priority="LOW").priority == "LOW"


async def test_update_item_calls_express_and_the_preview_lists_every_change(seeded):
    calls: list = []
    out = await run(
        "update_item", web=make_web(calls=calls), item_id="I1", priority="LOW", due_date="2030-07-01", repeat="daily"
    )
    assert out == {"ok": True}
    method, path, body, _ = calls[0]
    assert (method, path) == ("PATCH", "/internal/items/1")
    assert body == {"discordId": UID, "priority": "LOW", "due_date": "2030-07-01", "recurrence": "daily"}
    spec = TOOLS["update_item"]
    text_ = await spec.preview(
        ctx(), spec.args(item_id="I1", name="Renamed", priority="LOW", tags=["x"], repeat="daily")
    )
    for expected in ("Problems 1-10", "Renamed", "Priority: LOW", "Tags: x", "Repeats: daily", "Approve?"):
        assert expected in text_
    with pytest.raises(ToolError):
        await spec.preview(ctx(), spec.args(item_id="I4", priority="LOW"))  # another user's subtask


async def test_break_down_task_validates_bounds_and_uses_the_trusted_id(seeded):
    spec = TOOLS["break_down_task"]
    assert spec.write and spec.preview
    for names in (["only one"], [f"s{i}" for i in range(9)], ["ok", ""], ["ok", "x" * 201]):
        with pytest.raises(ValidationError):
            spec.args(item_id="I1", subtasks=names)
    with pytest.raises(ValidationError):
        spec.args(item_id="I1", subtasks=["a", "b"], discord_id="222")
    calls: list = []
    web = make_web({"/internal/items/1/subtasks": (201, {"items": [{"id": 9}, {"id": 10}]})}, calls)
    out = await run("break_down_task", web=web, item_id="I1", subtasks=["Outline", "Draft"])
    assert out["items"][0]["id"] == 9
    method, path, body, token = calls[0]
    assert (method, path, token) == ("POST", "/internal/items/1/subtasks", "secret-token")
    assert body == {"discordId": UID, "names": ["Outline", "Draft"]}


async def test_break_down_preview_lists_the_steps_and_rejects_foreign_items(seeded):
    spec = TOOLS["break_down_task"]
    text_ = await spec.preview(ctx(), spec.args(item_id="I1", subtasks=["Outline", "Draft", "Edit"]))
    assert 'Break "Problems 1-10" into 3 subtasks' in text_
    assert "1. Outline" in text_ and "3. Edit" in text_ and text_.endswith("Approve?")
    with pytest.raises(ToolError):
        await spec.preview(ctx(), spec.args(item_id="I4", subtasks=["a", "b"]))  # belongs to user 222
    with pytest.raises(ToolError):
        await spec.preview(ctx(uid=OTHER), spec.args(item_id="I1", subtasks=["a", "b"]))  # not theirs either


async def test_add_item_preview_shows_per_task_fields_and_the_parent(seeded):
    spec = TOOLS["add_item"]
    text_ = await spec.preview(
        ctx(),
        spec.args(
            list_id="L1",
            name="Extra",
            due_date="2030-01-05",
            priority="MEDIUM",
            tags=["a"],
            repeat="monthly",
            parent_id="I1",
        ),
    )
    for expected in (
        "Extra",
        "Math homework",
        "Due: 2030-01-05",
        "Priority: MEDIUM",
        "Tags: a",
        "Repeats: monthly",
        "Problems 1-10",
    ):
        assert expected in text_
