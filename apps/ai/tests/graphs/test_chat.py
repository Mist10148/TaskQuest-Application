"""Chat agent: routing, RAG, tools, confirmation (approve/reject), scoping, memory and the HTTP/SSE layer."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command

from app import chat_service
from app.config import get_settings
from app.db import pool
from app.graphs import chat as C
from app.graphs.chat import ChatDeps, RouterOut
from app.main import create_app
from app.rag import indexer
from app.rag.retriever import TaskRetriever
from app.rag.store import MySQLNumpyStore
from app.routers.chat import get_chat_deps
from tests.conftest import OTHER, UID, auth
from tests.fakes import FakeChatLLM, FakeEmbedder
from tests.graphs.test_tools import make_web

TODAY = date.today()


def call(name, args, id_="c1"):
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": id_}])


def make_llm(replies, structured=None):
    return FakeChatLLM(messages=iter(replies), structured=list(structured or [RouterOut(intent="task_question")] * 3))


async def collect(stream):
    return [(e["event"], json.loads(e["data"])) async for e in stream]


def kinds(events):
    return [k for k, _ in events]


def text(events):
    return "".join(d["text"] for k, d in events if k == "token")


async def retriever_for(engine):
    store, emb = MySQLNumpyStore("fake-embed"), FakeEmbedder()
    async with engine.begin() as conn:
        await indexer.reconcile(conn, store, emb)
    return TaskRetriever(store, emb)


def deps_for(llm, web=None, retriever=None):
    return ChatDeps(llm_factory=lambda **kw: llm, web=web or make_web(), retriever=retriever)


# ── pure helpers ─────────────────────────────────────────────────────────────


def test_window_never_starts_mid_tool_call():
    msgs = [
        HumanMessage("a"),
        call("get_overdue", {}),
        ToolMessage("r", tool_call_id="c1"),
        AIMessage("ok"),
        HumanMessage("b"),
    ]
    assert C.window(msgs, 3)[0].content == "b"  # slicing at the ToolMessage would orphan it
    assert C.window(msgs, 5)[0].content == "a"


def test_tool_rounds_count_only_this_turn():
    msgs = [
        HumanMessage("old"),
        call("a", {}),
        HumanMessage("new"),
        call("b", {}, "c2"),
        ToolMessage("r", tool_call_id="c2"),
        call("c", {}, "c3"),
    ]
    assert C.tool_rounds_this_turn(msgs) == 2


def test_text_of_handles_gemini_parts():
    assert C.text_of([{"type": "text", "text": "hi "}, {"type": "text", "text": "there"}]) == "hi there"


# ── conversation flows ───────────────────────────────────────────────────────


async def test_task_question_uses_rag_context_and_streams_answer(seeded):
    retriever = await retriever_for(seeded)
    llm = make_llm([AIMessage("Math homework (L1) has one subtask left.")])
    events = await collect(
        chat_service.stream_turn(
            deps_for(llm, retriever=retriever),
            UID,
            "t1",
            chat_service.user_input(UID, "what is left on math homework?"),
        )
    )
    assert text(events) == "Math homework (L1) has one subtask left."
    assert any(k == "sources" and any(src["id"] == "L1" for src in d) for k, d in events)
    assert kinds(events)[-1] == "done"
    # the answer was generated with the user's own quest in context, and nobody else's
    assert all("Secret plans" not in str(d) for _, d in events)


async def test_read_tool_loop(seeded):
    llm = make_llm([call("get_due_soon", {"days": 3}), AIMessage("Math homework is due soon (L1).")])
    events = await collect(
        chat_service.stream_turn(deps_for(llm), UID, "t2", chat_service.user_input(UID, "what is due soon?"))
    )
    tool = [d for k, d in events if k == "tool"]
    assert tool[0]["name"] == "get_due_soon" and tool[0]["status"] == "done"
    assert "L1" in text(events) and "confirm" not in kinds(events)


async def test_write_pauses_for_confirmation_and_changes_nothing_until_approved(seeded):
    calls: list = []
    web = make_web(
        {"/internal/items/1/toggle": (200, {"completed": True, "xpResult": {"finalXP": 12, "newLevel": 1}})}, calls
    )
    llm = make_llm([call("complete_item", {"item_id": "I1"}), AIMessage("Done! +12 XP.")])
    deps = deps_for(llm, web)
    first = await collect(
        chat_service.stream_turn(deps, UID, "t3", chat_service.user_input(UID, "mark problems 1-10 done"))
    )
    confirms = [d for k, d in first if k == "confirm"]
    assert len(confirms) == 1 and confirms[0]["action"] == "complete_item"
    assert confirms[0]["preview"] == 'Mark "Problems 1-10" as done?'
    assert calls == []  # nothing has been written yet
    assert "tool" not in kinds(first)

    graph = chat_service.make_graph(deps)  # a fresh graph, like the next HTTP request would build
    assert (await chat_service.pending_actions(graph, {"configurable": {"thread_id": "t3"}}))[0]["id"] == "c1"

    second = await collect(chat_service.stream_turn(deps, UID, "t3", Command(resume={"approved": True})))
    assert len(calls) == 1 and calls[0][2] == {"discordId": UID, "completed": True}
    tool = next(d for k, d in second if k == "tool")
    assert tool["status"] == "done" and tool["xpResult"]["finalXP"] == 12  # carried to the UI for the XP toast
    assert text(second) == "Done! +12 XP."
    assert await chat_service.pending_actions(graph, {"configurable": {"thread_id": "t3"}}) == []


async def test_rejected_write_is_never_executed(seeded):
    calls: list = []
    llm = make_llm([call("complete_item", {"item_id": "I1"}), AIMessage("Okay, I left it alone.")])
    deps = deps_for(llm, make_web(calls=calls))
    await collect(chat_service.stream_turn(deps, UID, "t4", chat_service.user_input(UID, "mark it done")))
    out = await collect(chat_service.stream_turn(deps, UID, "t4", Command(resume={"approved": False})))
    assert calls == []
    assert next(d for k, d in out if k == "tool")["status"] == "declined"
    snapshot = await chat_service.make_graph(deps).aget_state({"configurable": {"thread_id": "t4"}})
    tool_msg = [m for m in snapshot.values["messages"] if isinstance(m, ToolMessage)][0]
    assert "declined" in tool_msg.content


async def test_smuggled_discord_id_is_rejected_for_reads_and_writes(seeded):
    calls: list = []
    llm = make_llm(
        [
            call("get_list", {"list_id": "L4", "discord_id": OTHER}, "r1"),
            AIMessage("I could not read that."),
        ]
    )
    events = await collect(
        chat_service.stream_turn(
            deps_for(llm, make_web(calls=calls)), UID, "t5", chat_service.user_input(UID, "show user 222's list")
        )
    )
    assert next(d for k, d in events if k == "tool")["status"] == "error"
    assert "Secret plans" not in str(events)

    llm2 = make_llm([call("create_list", {"name": "x", "discord_id": OTHER}), AIMessage("Sorry.")])
    events2 = await collect(
        chat_service.stream_turn(
            deps_for(llm2, make_web(calls=calls)), UID, "t6", chat_service.user_input(UID, "make a list for 222")
        )
    )
    assert "confirm" not in kinds(events2) and calls == []  # invalid write never reaches the user or Express


async def test_writes_on_someone_elses_items_are_not_offered_for_confirmation(seeded):
    calls: list = []
    llm = make_llm([call("complete_item", {"item_id": "I4"}), AIMessage("That item does not exist.")])
    events = await collect(
        chat_service.stream_turn(
            deps_for(llm, make_web(calls=calls)), UID, "t7", chat_service.user_input(UID, "complete I4")
        )
    )
    assert "confirm" not in kinds(events) and calls == []
    assert next(d for k, d in events if k == "tool")["status"] == "error"


async def test_app_help_routes_to_docs_only(seeded):
    store, emb = MySQLNumpyStore("fake-embed"), FakeEmbedder()
    async with seeded.begin() as conn:
        await indexer.reconcile(conn, store, emb)
        await indexer.index_docs(conn, store, emb, {"gameplay": "# XP\nComplete subtasks to earn XP."})
    llm = make_llm([AIMessage("Complete subtasks to earn XP.")], [RouterOut(intent="app_help")])
    deps = deps_for(llm, retriever=TaskRetriever(store, emb))
    events = await collect(chat_service.stream_turn(deps, UID, "t8", chat_service.user_input(UID, "how do I earn XP?")))
    snapshot = await chat_service.make_graph(deps).aget_state({"configurable": {"thread_id": "t8"}})
    assert snapshot.values["intent"] == "app_help"
    assert {r["kind"] for r in snapshot.values["retrieved"]} == {"doc"}
    assert "sources" not in kinds(events)  # docs are not quests


async def test_router_failure_defaults_to_task_question(seeded):
    llm = make_llm([AIMessage("hi")], [RuntimeError("router down")])
    await collect(chat_service.stream_turn(deps_for(llm), UID, "t9", chat_service.user_input(UID, "hello")))
    snap = await chat_service.make_graph(deps_for(llm)).aget_state({"configurable": {"thread_id": "t9"}})
    assert snap.values["intent"] == "task_question"


async def test_agent_failure_becomes_an_error_event(seeded):
    class Boom(FakeChatLLM):
        async def _agenerate(self, *a, **kw):
            raise RuntimeError("gemini 500")

        def _generate(self, *a, **kw):
            raise RuntimeError("gemini 500")

        def _stream(self, *a, **kw):
            raise RuntimeError("gemini 500")

    llm = Boom(messages=iter([]), structured=[RouterOut(intent="chitchat")])
    events = await collect(chat_service.stream_turn(deps_for(llm), UID, "t10", chat_service.user_input(UID, "hi")))
    assert "error" in kinds(events) and kinds(events)[-1] == "done"


async def test_long_conversations_are_folded_into_a_summary(seeded):
    old = []
    for i in range(18):
        old += [HumanMessage(f"question {i}", id=f"h{i}"), AIMessage(f"answer {i}", id=f"a{i}")]
    llm = make_llm(
        [AIMessage("Summary: user asked many things (L1)."), AIMessage("Sure.")], [RouterOut(intent="chitchat")]
    )
    graph = chat_service.make_graph(deps_for(llm))
    cfg = {"configurable": {"thread_id": "t11"}}
    await graph.ainvoke({"messages": [*old, HumanMessage("latest")], "discord_id": UID}, cfg)
    state = (await graph.aget_state(cfg)).values
    assert "Summary:" in state["summary"]
    assert len(state["messages"]) <= C.KEEP + 3 and state["messages"][0].type == "human"


async def test_tokens_are_accounted(seeded):
    llm = make_llm(
        [AIMessage("hi", usage_metadata={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10})],
        [RouterOut(intent="chitchat")],
    )
    deps = deps_for(llm)
    events = await collect(chat_service.stream_turn(deps, UID, "t12", chat_service.user_input(UID, "hello")))
    done = events[-1][1]
    assert done["usage"]["input"] >= 17  # router (10) + agent (7)


# ── HTTP / SSE ───────────────────────────────────────────────────────────────


def parse_sse(body: str):
    events, current = [], {}
    for line in body.splitlines():
        if line.startswith("event:"):
            current["event"] = line[6:].strip()
        elif line.startswith("data:"):
            current["data"] = json.loads(line[5:].strip())
        elif not line.strip() and current:
            events.append((current.get("event"), current.get("data")))
            current = {}
    if current:
        events.append((current.get("event"), current.get("data")))
    return events


@pytest.fixture
def http(seeded, monkeypatch):
    async def no_title(*args, **kwargs):  # the real task would consume scripted fake replies
        return None

    monkeypatch.setattr("app.routers.chat._title_in_background", no_title)
    app = create_app()

    def install(llm, web=None):
        app.dependency_overrides[get_chat_deps] = lambda: deps_for(llm, web)
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")

    return install


async def test_chat_endpoint_full_roundtrip_with_threads(http):
    async with http(make_llm([AIMessage("Hello adventurer!")], [RouterOut(intent="chitchat")])) as c:
        assert (await c.post("/v1/chat", json={"message": "hi"})).status_code == 401
        r = await c.post("/v1/chat", json={"message": "hi there"}, headers=auth())
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        events = parse_sse(r.text)
        thread_id = events[-1][1]["threadId"]
        assert "".join(d["text"] for k, d in events if k == "token") == "Hello adventurer!"

        listed = (await c.get("/v1/threads", headers=auth())).json()["threads"]
        assert [t["id"] for t in listed] == [thread_id] and listed[0]["title"] == "hi there"
        detail = (await c.get(f"/v1/threads/{thread_id}", headers=auth())).json()
        assert [m["role"] for m in detail["messages"]] == ["user", "assistant"] and detail["pendingConfirm"] == []

        # another user cannot see, continue, resume or delete it
        assert (await c.get("/v1/threads", headers=auth(OTHER))).json()["threads"] == []
        assert (await c.get(f"/v1/threads/{thread_id}", headers=auth(OTHER))).status_code == 404
        assert (
            await c.post("/v1/chat", json={"threadId": thread_id, "message": "x"}, headers=auth(OTHER))
        ).status_code == 404
        assert (
            await c.post(f"/v1/chat/{thread_id}/resume", json={"approved": True}, headers=auth(OTHER))
        ).status_code == 404
        assert (await c.delete(f"/v1/threads/{thread_id}", headers=auth(OTHER))).status_code == 404

        assert (
            await c.post(f"/v1/chat/{thread_id}/resume", json={"approved": True}, headers=auth())
        ).status_code == 409
        assert (await c.delete(f"/v1/threads/{thread_id}", headers=auth())).json() == {"success": True}
        assert (await c.get(f"/v1/threads/{thread_id}", headers=auth())).status_code == 404


async def test_confirmation_survives_reload_and_resumes_over_http(http):
    calls: list = []
    llm = make_llm([call("complete_item", {"item_id": "I1"}), AIMessage("All done.")], [RouterOut(intent="action")])
    async with http(llm, make_web(calls=calls)) as c:
        events = parse_sse((await c.post("/v1/chat", json={"message": "complete problems 1-10"}, headers=auth())).text)
        thread_id = events[-1][1]["threadId"]
        assert any(k == "confirm" for k, _ in events) and calls == []

        detail = (await c.get(f"/v1/threads/{thread_id}", headers=auth())).json()
        assert detail["pendingConfirm"][0]["preview"] == 'Mark "Problems 1-10" as done?'  # card re-appears after reload

        resumed = parse_sse(
            (await c.post(f"/v1/chat/{thread_id}/resume", json={"approved": True}, headers=auth())).text
        )
        assert len(calls) == 1 and any(k == "tool" and d["status"] == "done" for k, d in resumed)


async def test_chat_validation_and_quota(http, monkeypatch):
    async with http(make_llm([])) as c:
        assert (await c.post("/v1/chat", json={"message": ""}, headers=auth())).status_code == 422
        assert (await c.post("/v1/chat", json={"message": "x" * 2001}, headers=auth())).status_code == 422
        assert (await c.post("/v1/chat", json={"threadId": "nope", "message": "x"}, headers=auth())).status_code == 404
        monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 0)
        r = await c.post("/v1/chat", json={"message": "hi"}, headers=auth())
        assert r.status_code == 429 and r.json()["code"] == "AI_QUOTA"


async def test_deleting_a_thread_clears_checkpoints(http, seeded):
    from sqlalchemy import text as sql

    async with http(make_llm([AIMessage("yo")], [RouterOut(intent="chitchat")])) as c:
        events = parse_sse((await c.post("/v1/chat", json={"message": "hi"}, headers=auth())).text)
        thread_id = events[-1][1]["threadId"]
        await c.delete(f"/v1/threads/{thread_id}", headers=auth())
    async with pool.get_engine().connect() as conn:
        n = (
            await conn.execute(sql("SELECT COUNT(*) FROM ai_checkpoints WHERE thread_id = :t"), {"t": thread_id})
        ).scalar()
    assert n == 0


async def test_title_generation_renames_the_thread(seeded):
    from app import threads
    from app.routers.chat import _title_in_background

    async with pool.connection() as conn:
        tid = await threads.create_thread(conn, UID, "how do i get started with quests please")
    await _title_in_background(deps_for(make_llm([AIMessage('"Getting started with quests"')])), UID, tid, "x")
    async with pool.get_engine().connect() as conn:
        assert (await threads.get_thread(conn, UID, tid))["title"] == "Getting started with quests"
