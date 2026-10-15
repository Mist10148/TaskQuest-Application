"""Chat and thread endpoints (SSE). Reached only through Express."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from langgraph.types import Command
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import chat_service, threads, usage
from app.db import pool
from app.deps import AIAccess, Caller, get_caller, require_ai
from app.graphs.chat import ChatDeps
from app.graphs.checkpointer import SqlCheckpointSaver
from app.llm import AIUnavailable, chat_model
from app.rag import runtime
from app.rag.retriever import TaskRetriever
from app.tools.web_client import WebClient

log = logging.getLogger("taskquest.ai.chat")
router = APIRouter(prefix="/v1")

# Strong references so background title tasks are not garbage-collected mid-flight.
_background: set[asyncio.Task] = set()


def get_chat_deps() -> ChatDeps:
    """Per-request dependencies (overridden in tests)."""
    retriever = None
    with contextlib.suppress(AIUnavailable):
        retriever = TaskRetriever(runtime.get_store(), runtime.get_embedder())
    return ChatDeps(llm_factory=chat_model, web=WebClient(), retriever=retriever)


class ChatBody(BaseModel):
    threadId: str | None = None
    message: str = Field(min_length=1, max_length=2000)


class ResumeBody(BaseModel):
    approved: bool


def _valid_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(status_code=404, detail="Thread not found") from None


async def _title_in_background(deps: ChatDeps, discord_id: str, thread_id: str, message: str) -> None:
    """Best effort: replace the truncated first message with a short generated title."""
    try:
        reply = await deps.llm_factory().ainvoke(
            [
                (
                    "system",
                    "Write a 3-6 word title for a chat that starts with this message. Reply with the title only.",
                ),
                ("human", message),
            ]
        )
        title = str(reply.content).strip().strip('"')[:80]
        i, o = usage.tokens_from(reply)
        async with pool.connection() as conn:
            await usage.record(conn, discord_id, "chat", input_tokens=i, output_tokens=o, requests=0)
            if title:
                await threads.rename_thread(conn, discord_id, thread_id, title)
    except Exception:  # noqa: BLE001 - the truncated title is already good enough
        log.debug("title generation skipped")


@router.post("/chat")
async def chat(body: ChatBody, access: AIAccess = Depends(require_ai("chat")), deps: ChatDeps = Depends(get_chat_deps)):
    discord_id = access.discord_id
    new_thread = body.threadId is None
    try:
        async with pool.connection() as conn:
            if body.threadId is None:
                thread_id = await threads.create_thread(conn, discord_id, body.message)
            else:
                thread_id = _valid_uuid(body.threadId)
                if await threads.get_thread(conn, discord_id, thread_id) is None:
                    raise HTTPException(status_code=404, detail="Thread not found")
        if not new_thread:
            graph = chat_service.make_graph(deps)
            if await chat_service.pending_actions(graph, {"configurable": {"thread_id": thread_id}}):
                raise HTTPException(status_code=409, detail="Confirm or cancel the pending action first")
    except HTTPException:
        await access.refund()  # rejected before the model ran
        raise
    if new_thread:
        task = asyncio.create_task(_title_in_background(deps, discord_id, thread_id, body.message))
        _background.add(task)
        task.add_done_callback(_background.discard)
    return EventSourceResponse(
        chat_service.stream_turn(
            deps,
            discord_id,
            thread_id,
            chat_service.user_input(discord_id, body.message),
            expect="any" if new_thread else "idle",
        )
    )


@router.post("/chat/{thread_id}/resume")
async def resume(
    thread_id: str,
    body: ResumeBody,
    access: AIAccess = Depends(require_ai("chat")),  # resuming runs the agent again
    deps: ChatDeps = Depends(get_chat_deps),
):
    try:
        thread_id = _valid_uuid(thread_id)
        async with pool.connection() as conn:
            if await threads.get_thread(conn, access.discord_id, thread_id) is None:
                raise HTTPException(status_code=404, detail="Thread not found")
        graph = chat_service.make_graph(deps)
        if not await chat_service.pending_actions(graph, {"configurable": {"thread_id": thread_id}}):
            raise HTTPException(status_code=409, detail="Nothing is waiting for confirmation")
    except HTTPException:
        await access.refund()
        raise
    return EventSourceResponse(
        # "pending" is re-checked under the thread lock, so a second concurrent Approve is rejected there.
        chat_service.stream_turn(
            deps, access.discord_id, thread_id, Command(resume={"approved": body.approved}), expect="pending"
        )
    )


@router.get("/threads")
async def list_threads(caller: Caller = Depends(get_caller)):
    async with pool.get_engine().connect() as conn:
        return {"threads": await threads.list_threads(conn, caller.discord_id)}


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: str, caller: Caller = Depends(get_caller), deps: ChatDeps = Depends(get_chat_deps)):
    thread_id = _valid_uuid(thread_id)
    async with pool.get_engine().connect() as conn:
        thread = await threads.get_thread(conn, caller.discord_id, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {**thread, **await chat_service.history(deps, thread_id)}


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, caller: Caller = Depends(get_caller)):
    thread_id = _valid_uuid(thread_id)
    async with pool.connection() as conn:
        if not await threads.delete_thread(conn, caller.discord_id, thread_id):
            raise HTTPException(status_code=404, detail="Thread not found")
    await SqlCheckpointSaver(pool.get_engine()).adelete_thread(thread_id)
    return {"success": True}
