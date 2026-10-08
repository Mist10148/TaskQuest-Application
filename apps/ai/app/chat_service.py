"""Runs one chat turn and turns LangGraph output into Server-Sent Events.

Events (see docs/AI_INTEGRATION.md):
    token    {"text": "..."}                             streamed answer text
    sources  [{"id": "L42", "title": "Math homework"}]  quests the answer drew on
    tool     {"name", "status", "xpResult"?, ...}      a tool finished (also carries XP for toasts)
    confirm  {"id", "action", "args", "preview"}        a write needs approval; the turn is paused
    error    {"message": "..."}
    done     {"threadId", "usage": {"input", "output"}}
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langgraph.types import Command

from app import threads, usage
from app.db import pool
from app.graphs.chat import ChatDeps, build_chat_graph, text_of
from app.graphs.checkpointer import MySQLCheckpointSaver

log = logging.getLogger("taskquest.ai.chat")


def sse(event: str, data: Any) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, default=str, ensure_ascii=False)}


def make_graph(deps: ChatDeps):
    return build_chat_graph(deps, MySQLCheckpointSaver(pool.get_engine()))


async def pending_actions(graph, config) -> list[dict[str, Any]]:
    """Confirmation requests the thread is currently paused on (empty if none)."""
    state = await graph.aget_state(config)
    out: list[dict[str, Any]] = []
    for task in state.tasks:
        for intr in task.interrupts:
            out.extend(intr.value.get("actions", []))
    return out


async def stream_turn(
    deps: ChatDeps, discord_id: str, thread_id: str, graph_input: dict[str, Any] | Command
) -> AsyncIterator[dict[str, str]]:
    graph = make_graph(deps)
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 40}
    try:
        async for mode, payload in graph.astream(graph_input, config, stream_mode=["messages", "updates"]):
            if mode == "messages":
                chunk, meta = payload
                if meta.get("langgraph_node") == "agent" and isinstance(chunk, AIMessageChunk):
                    text = text_of(chunk.content)
                    if text:
                        yield sse("token", {"text": text})
                continue
            for node, update in payload.items():
                if node == "__interrupt__":
                    for intr in update:
                        for action in intr.value.get("actions", []):
                            yield sse("confirm", action)
                elif node == "retrieve" and update:
                    sources = [
                        {"id": r["id"], "title": r["title"]} for r in update.get("retrieved", []) if r["kind"] == "list"
                    ]
                    if sources:
                        yield sse("sources", sources)
                elif node == "tools" and update:
                    for event in update.get("tool_events", []):
                        sources = event.pop("sources", None)
                        yield sse("tool", event)
                        if sources:
                            yield sse("sources", sources)
    except Exception:
        log.exception("chat turn failed")
        yield sse("error", {"message": "Something went wrong talking to the AI. Please try again."})
    async with pool.connection() as conn:
        await usage.record(conn, discord_id, "chat", input_tokens=deps.tokens[0], output_tokens=deps.tokens[1])
        await threads.touch_thread(conn, discord_id, thread_id)
    yield sse("done", {"threadId": thread_id, "usage": {"input": deps.tokens[0], "output": deps.tokens[1]}})


def user_input(discord_id: str, message: str) -> dict[str, Any]:
    return {"messages": [HumanMessage(message)], "discord_id": discord_id}


async def history(deps: ChatDeps, thread_id: str) -> dict[str, Any]:
    """Visible messages (user + assistant text) and any confirmation the thread is waiting on."""
    graph = make_graph(deps)
    config = {"configurable": {"thread_id": thread_id}}
    state = await graph.aget_state(config)
    messages = []
    for m in state.values.get("messages", []):
        if isinstance(m, HumanMessage):
            messages.append({"role": "user", "text": text_of(m.content)})
        elif isinstance(m, AIMessage) and text_of(m.content).strip() and not m.tool_calls:
            messages.append({"role": "assistant", "text": text_of(m.content)})
    return {"messages": messages, "pendingConfirm": await pending_actions(graph, config)}
