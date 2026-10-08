"""MySQLCheckpointSaver round-trips LangGraph state, and threads are scoped per user."""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app import threads
from app.graphs.checkpointer import MySQLCheckpointSaver
from tests.conftest import OTHER, UID


class S(TypedDict, total=False):
    n: int
    answer: str


def build(engine):
    async def add(state):
        return {"n": state.get("n", 0) + 1}

    async def ask(state):
        decision = interrupt({"question": "ok?"})
        return {"answer": "yes" if decision["approved"] else "no"}

    g = StateGraph(S)
    g.add_node("add", add)
    g.add_node("ask", ask)
    g.add_edge(START, "add")
    g.add_edge("add", "ask")
    g.add_edge("ask", END)
    return g.compile(checkpointer=MySQLCheckpointSaver(engine))


async def test_state_persists_across_graph_instances_and_interrupt_resumes(engine):
    cfg = {"configurable": {"thread_id": "t-1"}}
    out = await build(engine).ainvoke({"n": 41}, cfg)
    assert "__interrupt__" in out and out["__interrupt__"][0].value == {"question": "ok?"}

    fresh = build(engine)  # a new process would build a new graph over the same tables
    state = await fresh.aget_state(cfg)
    assert state.values["n"] == 42 and state.next == ("ask",)
    assert state.tasks[0].interrupts[0].value == {"question": "ok?"}

    done = await fresh.ainvoke(Command(resume={"approved": True}), cfg)
    assert done["answer"] == "yes" and done["n"] == 42
    assert (await fresh.aget_state(cfg)).next == ()


async def test_history_and_delete(engine):
    cfg = {"configurable": {"thread_id": "t-2"}}
    graph = build(engine)
    await graph.ainvoke({"n": 1}, cfg)
    history = [s async for s in graph.aget_state_history(cfg)]
    assert len(history) >= 2
    saver = graph.checkpointer
    await saver.adelete_thread("t-2")
    assert (await graph.aget_state(cfg)).values == {}


async def test_threads_are_scoped_to_their_owner(engine):
    from app.db import pool

    async with pool.connection() as conn:
        tid = await threads.create_thread(conn, UID, "  How do I   start a quest?  ")
        assert (await threads.get_thread(conn, UID, tid))["title"] == "How do I start a quest?"
        assert await threads.get_thread(conn, OTHER, tid) is None
        assert await threads.list_threads(conn, OTHER) == []
        assert await threads.delete_thread(conn, OTHER, tid) is False
        assert await threads.delete_thread(conn, UID, tid) is True


def test_title_is_truncated():
    assert threads.title_from("x" * 100).endswith("…") and len(threads.title_from("x" * 100)) == 61
