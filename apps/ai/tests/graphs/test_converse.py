"""Discord conversation: per-user memory, read-only tools, persona prompt, forget, and the HTTP layer."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from app import chat_service
from app.config import get_settings
from app.db import pool
from app.graphs import chat as C
from app.graphs.chat import RouterOut
from app.graphs.checkpointer import MySQLCheckpointSaver
from app.graphs.converse import build_converse_graph, thread_id_for
from tests.conftest import OTHER, UID, auth
from tests.graphs.test_chat import call, deps_for, http, make_llm, make_web  # noqa: F401 - fixture

CHANNEL = "900"


def test_thread_ids_are_per_user_and_per_channel():
    assert thread_id_for(UID, CHANNEL) == thread_id_for(UID, CHANNEL)
    assert thread_id_for(UID, CHANNEL) != thread_id_for(OTHER, CHANNEL)
    assert thread_id_for(UID, CHANNEL) != thread_id_for(UID, "901")


async def test_reply_uses_persona_and_remembers_the_channel(seeded):
    llm = make_llm(
        [AIMessage("*waves* Hey. Math homework (L1) is due tomorrow."), AIMessage("You asked about math.")],
        [RouterOut(intent="task_question"), RouterOut(intent="chitchat")],
    )
    deps = deps_for(llm)
    first = await chat_service.converse_turn(deps, UID, CHANNEL, "what's due?")
    assert first["reply"].startswith("*waves*")
    second = await chat_service.converse_turn(deps_for(llm), UID, CHANNEL, "what did I just ask?")
    assert second["reply"] == "You asked about math."

    graph = build_converse_graph(deps, MySQLCheckpointSaver(pool.get_engine()))
    state = await graph.aget_state({"configurable": {"thread_id": thread_id_for(UID, CHANNEL)}})
    humans = [m.content for m in state.values["messages"] if isinstance(m, HumanMessage)]
    assert humans == ["what's due?", "what did I just ask?"]

    # Another user in the same channel starts from nothing
    other = await graph.aget_state({"configurable": {"thread_id": thread_id_for(OTHER, CHANNEL)}})
    assert not other.values


async def test_writes_are_refused_without_touching_express(seeded):
    calls: list = []
    llm = make_llm(
        [call("complete_item", {"item_id": "I1"}), AIMessage("I can't do that from here; use /ask.")],
        [RouterOut(intent="action")],
    )
    out = await chat_service.converse_turn(deps_for(llm, make_web(calls=calls)), UID, CHANNEL, "mark it done")
    assert calls == []
    assert out["tools"] == [{"name": "complete_item", "status": "declined"}]
    assert "/ask" in out["reply"]


def test_converse_binds_only_read_tools_and_uses_the_persona(monkeypatch):
    bound: list = []

    class Spy:
        def bind_tools(self, tools, **kw):
            bound.extend(t.name for t in tools)
            return self

    prompts: list = []
    real = C.load_prompt
    monkeypatch.setattr(C, "load_prompt", lambda name, **kw: prompts.append((name, kw)) or real(name, **kw))
    build_converse_graph(deps_for(Spy()), None)
    assert ("converse_system", {"persona": True}) in prompts
    tools = {t.name for t in C.langchain_tools() if not C.TOOLS[t.name].write}
    assert tools and not {"create_list", "add_item", "complete_item", "update_list"} & tools


async def test_memory_folds_after_twenty_messages(seeded):
    replies = [AIMessage(f"reply {i}") for i in range(12)] + [AIMessage("Earlier you counted to eleven.")]
    llm = make_llm(replies, [RouterOut(intent="chitchat")] * 20)
    deps = deps_for(llm)
    for i in range(11):
        await chat_service.converse_turn(deps, UID, CHANNEL, f"count {i}")
    graph = build_converse_graph(deps, MySQLCheckpointSaver(pool.get_engine()))
    state = await graph.aget_state({"configurable": {"thread_id": thread_id_for(UID, CHANNEL)}})
    assert len(state.values["messages"]) <= 20
    assert state.values.get("summary")


async def test_http_converse_and_forget(http, monkeypatch):  # noqa: F811
    async with http(make_llm([AIMessage("Hi there.")], [RouterOut(intent="chitchat")])) as c:
        assert (await c.post("/v1/converse", json={"channelId": CHANNEL, "message": "hi"})).status_code == 401
        bad = await c.post("/v1/converse", json={"channelId": "general", "message": "hi"}, headers=auth())
        assert bad.status_code == 422
        r = await c.post("/v1/converse", json={"channelId": CHANNEL, "message": "hi"}, headers=auth())
        assert r.status_code == 200 and r.json()["reply"] == "Hi there."

        # Discord memory never appears among the web chat threads
        assert (await c.get("/v1/threads", headers=auth())).json()["threads"] == []

        assert (await c.delete(f"/v1/converse/{CHANNEL}", headers=auth(OTHER))).json()["forgotten"] is False
        assert (await c.delete(f"/v1/converse/{CHANNEL}", headers=auth())).json()["forgotten"] is True
        assert (await c.delete(f"/v1/converse/{CHANNEL}", headers=auth())).json()["forgotten"] is False

        monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 0)
        r = await c.post("/v1/converse", json={"channelId": CHANNEL, "message": "hi"}, headers=auth())
        assert r.status_code == 429
