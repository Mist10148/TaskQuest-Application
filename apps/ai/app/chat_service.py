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
from app.llm import BLOCKED_REPLY, AIUnavailable

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
                elif node == "agent" and update:
                    # A blocked/empty reply is swapped for a fixed message that never streamed as tokens.
                    for m in update.get("messages", []):
                        if isinstance(m, AIMessage) and m.response_metadata.get("taskquest_fallback"):
                            yield sse("token", {"text": text_of(m.content)})
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


async def converse_turn(
    deps: ChatDeps, discord_id: str, channel_id: str, message: str, image: str | None = None
) -> dict[str, Any]:
    """Run one Discord conversation turn to completion (no streaming: Discord gets one message)."""
    from app.graphs.converse import build_converse_graph, thread_id_for

    thread_id = thread_id_for(discord_id, channel_id)
    async with pool.connection() as conn:
        if await threads.get_thread(conn, discord_id, thread_id, source=threads.DISCORD) is None:
            await threads.create_thread(
                conn, discord_id, f"Discord {channel_id}", thread_id=thread_id, source=threads.DISCORD
            )
    graph = build_converse_graph(deps, MySQLCheckpointSaver(pool.get_engine()))
    config = {"configurable": {"thread_id": thread_id, "image": image}, "recursion_limit": 40}
    text = f"{message}\n[attached an image]" if image else message
    tools: list[dict[str, Any]] = []  # every tool round of this turn (state keeps only the last one)
    try:
        async for update in graph.astream(user_input(discord_id, text), config, stream_mode="updates"):
            for node, data in update.items():
                if node == "tools" and data:
                    tools += [{"name": e["name"], "status": e["status"]} for e in data.get("tool_events", [])]
        state = (await graph.aget_state(config)).values
    except Exception as err:
        log.exception("converse turn failed")
        raise AIUnavailable("conversation failed") from err
    finally:
        async with pool.connection() as conn:
            await usage.record(conn, discord_id, "chat", input_tokens=deps.tokens[0], output_tokens=deps.tokens[1])
            await threads.touch_thread(conn, discord_id, thread_id)

    reply = ""
    for m in reversed(state["messages"]):
        if isinstance(m, HumanMessage):
            break  # only this turn's answer, never an older one
        if isinstance(m, AIMessage) and not m.tool_calls and text_of(m.content).strip():
            reply = text_of(m.content).strip()
            break
    sources = [{"id": r["id"], "title": r["title"]} for r in state.get("retrieved", []) if r["kind"] == "list"]
    return {
        "reply": reply or BLOCKED_REPLY,
        "sources": sources,
        "tools": tools,
        "usage": {"input": deps.tokens[0], "output": deps.tokens[1]},
    }


async def forget_conversation(discord_id: str, channel_id: str) -> bool:
    """Wipe this user's memory in one channel. True if there was anything to forget."""
    from app.graphs.converse import thread_id_for

    thread_id = thread_id_for(discord_id, channel_id)
    async with pool.connection() as conn:
        existed = await threads.delete_thread(conn, discord_id, thread_id, source=threads.DISCORD)
    await MySQLCheckpointSaver(pool.get_engine()).adelete_thread(thread_id)
    return existed
