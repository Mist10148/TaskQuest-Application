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
from app.deps import Caller, get_caller
from app.graphs.chat import ChatDeps
from app.graphs.checkpointer import MySQLCheckpointSaver
from app.llm import AIUnavailable, chat_model
from app.rag import runtime
from app.rag.retriever import TaskRetriever
from app.tools.web_client import WebClient

log = logging.getLogger("taskquest.ai.chat")
router = APIRouter(prefix="/v1")


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
        if title:
            async with pool.connection() as conn:
                await threads.rename_thread(conn, discord_id, thread_id, title)
    except Exception:  # noqa: BLE001 - the truncated title is already good enough
        log.debug("title generation skipped")


@router.post("/chat")
async def chat(body: ChatBody, caller: Caller = Depends(get_caller), deps: ChatDeps = Depends(get_chat_deps)):
    new_thread = body.threadId is None
    async with pool.connection() as conn:
        await usage.check(conn, caller.discord_id)  # 429 before any stream starts
        if new_thread:
            thread_id = await threads.create_thread(conn, caller.discord_id, body.message)
        else:
            thread_id = _valid_uuid(body.threadId)
            if await threads.get_thread(conn, caller.discord_id, thread_id) is None:
                raise HTTPException(status_code=404, detail="Thread not found")
    if new_thread:
        asyncio.create_task(_title_in_background(deps, caller.discord_id, thread_id, body.message))  # noqa: RUF006
    return EventSourceResponse(
        chat_service.stream_turn(
            deps, caller.discord_id, thread_id, chat_service.user_input(caller.discord_id, body.message)
        )
    )


@router.post("/chat/{thread_id}/resume")
async def resume(
    thread_id: str, body: ResumeBody, caller: Caller = Depends(get_caller), deps: ChatDeps = Depends(get_chat_deps)
):
    thread_id = _valid_uuid(thread_id)
    async with pool.connection() as conn:
        if await threads.get_thread(conn, caller.discord_id, thread_id) is None:
            raise HTTPException(status_code=404, detail="Thread not found")
    graph = chat_service.make_graph(deps)
    if not await chat_service.pending_actions(graph, {"configurable": {"thread_id": thread_id}}):
        raise HTTPException(status_code=409, detail="Nothing is waiting for confirmation")
    return EventSourceResponse(
        chat_service.stream_turn(deps, caller.discord_id, thread_id, Command(resume={"approved": body.approved}))
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
    await MySQLCheckpointSaver(pool.get_engine()).adelete_thread(thread_id)
    return {"success": True}
