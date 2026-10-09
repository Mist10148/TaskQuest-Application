"""Feature 3: the chat agent (LangGraph) with RAG, tools, memory and human-in-the-loop writes.

    fold_memory -> router -> [task_question|app_help] rewrite_query -> retrieve -> agent
                          -> [action|analysis|chitchat] ----------------------> agent
    agent -> (no tool calls) END
          -> (read tools only)  tools -> agent
          -> (any write tool)   confirm (interrupt) -> tools -> agent

``discord_id`` lives in graph state (set by the service from the trusted header); tools get
it from there and the model can never supply or change it.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
)
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field, ValidationError

from app.config import get_settings
from app.llm import BLOCKED_REPLY, is_blocked
from app.llm_call import structured_call
from app.prompts import load_prompt
from app.rag.retriever import Retrieved, TaskRetriever, format_context
from app.tools.specs import TOOLS, ToolContext, langchain_tools
from app.tools.web_client import ToolError, WebClient

log = logging.getLogger("taskquest.ai.chat")

WINDOW = 20  # messages sent to the model
FOLD_AT = 30  # fold older messages into a running summary beyond this many
KEEP = 10  # messages kept verbatim after folding
Intent = Literal["task_question", "app_help", "action", "analysis", "chitchat"]


class RouterOut(BaseModel):
    intent: Intent
    status: Literal["open", "done"] | None = None
    category: str | None = None


class Rewrite(BaseModel):
    query: str = Field(description="Standalone search query for the user's latest message")


@dataclass
class ChatDeps:
    """Everything the graph needs from the outside world (swapped for fakes in tests)."""

    llm_factory: Callable[..., Any]
    web: WebClient
    retriever: TaskRetriever | None = None
    tokens: list[int] = field(default_factory=lambda: [0, 0])  # (input, output) across the run

    def add_tokens(self, message: Any) -> None:
        meta = getattr(message, "usage_metadata", None) or {}
        self.tokens[0] += int(meta.get("input_tokens", 0) or 0)
        self.tokens[1] += int(meta.get("output_tokens", 0) or 0)


class ChatState(MessagesState):
    discord_id: str
    intent: str
    filters: dict[str, Any]
    query: str
    retrieved: list[dict[str, Any]]
    approvals: dict[str, Any]
    tool_events: list[dict[str, Any]]
    summary: str


# ── pure helpers (unit-tested) ───────────────────────────────────────────────


def text_of(content: Any) -> str:
    """Plain text of a message's content (Gemini may return a list of parts)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else p.get("text", "") for p in content if isinstance(p, (str, dict)))
    return ""


def last_human_text(messages: Sequence[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return text_of(m.content)
    return ""


def window(messages: Sequence[BaseMessage], size: int = WINDOW) -> list[BaseMessage]:
    """Last ``size`` messages, never starting mid tool-call (a ToolMessage without its AI call)."""
    recent = list(messages[-size:])
    for i, m in enumerate(recent):
        if isinstance(m, HumanMessage):
            return recent[i:]
    return recent


def tool_rounds_this_turn(messages: Sequence[BaseMessage]) -> int:
    n = 0
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            break
        if isinstance(m, AIMessage) and m.tool_calls:
            n += 1
    return n


def pending_tool_calls(messages: Sequence[BaseMessage]) -> list[ToolCall]:
    """Tool calls of the latest message (only AI messages carry them)."""
    last = messages[-1] if messages else None
    return list(last.tool_calls) if isinstance(last, AIMessage) else []


def _json(data: Any) -> str:
    text = json.dumps(data, default=str, ensure_ascii=False)
    return text if len(text) <= 6000 else text[:6000] + "…[truncated]"


# ── graph ────────────────────────────────────────────────────────────────────


def build_chat_graph(deps: ChatDeps, checkpointer: Any):
    chat_prompt, chat_version = load_prompt("chat_system")
    router_prompt, _ = load_prompt("router_system")
    tools = langchain_tools()
    max_rounds = get_settings().max_tool_iterations

    def ctx_for(state: ChatState) -> ToolContext:
        return ToolContext(
            discord_id=state["discord_id"],  # trusted: set by the service, never by the model
            llm_factory=deps.llm_factory,
            web=deps.web,
            retriever=deps.retriever,
            today=datetime.now(UTC).date(),
        )

    async def fold_memory(state: ChatState) -> dict:
        messages = state["messages"]
        if len(messages) <= FOLD_AT:
            return {}
        humans = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage) and i >= len(messages) - KEEP]
        cut = humans[0] if humans else max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))
        old = messages[:cut]
        if not old:
            return {}
        transcript = "\n".join(f"{m.type}: {text_of(m.content)[:400]}" for m in old if text_of(m.content))
        try:
            result = await deps.llm_factory().ainvoke(
                [
                    SystemMessage("Summarize this conversation in under 120 words. Keep task ids and decisions."),
                    HumanMessage(f"Earlier summary: {state.get('summary', '')}\n\n{transcript}"),
                ]
            )
            deps.add_tokens(result)
            summary = text_of(result.content).strip()
        except Exception:  # noqa: BLE001 - never block a turn on memory housekeeping
            log.warning("conversation fold failed; keeping full history")
            return {}
        return {"messages": [RemoveMessage(id=m.id) for m in old if m.id], "summary": summary}

    async def router(state: ChatState) -> dict:
        text = last_human_text(state["messages"])
        try:
            out, (i, o) = await structured_call(
                deps.llm_factory(), RouterOut, [SystemMessage(router_prompt), HumanMessage(text)]
            )
            deps.tokens[0] += i
            deps.tokens[1] += o
        except Exception:  # noqa: BLE001 - routing is an optimisation; default to a task question
            out = RouterOut(intent="task_question")
        return {"intent": out.intent, "filters": {"status": out.status, "category": out.category}}

    def after_router(state: ChatState) -> str:
        return "rewrite_query" if state["intent"] in ("task_question", "app_help") else "agent"

    async def rewrite_query(state: ChatState) -> dict:
        messages = state["messages"]
        latest = last_human_text(messages)
        if sum(isinstance(m, HumanMessage) for m in messages) <= 1:
            return {"query": latest}
        history = "\n".join(f"{m.type}: {text_of(m.content)[:300]}" for m in window(messages, 8) if text_of(m.content))
        try:
            out, (i, o) = await structured_call(
                deps.llm_factory(),
                Rewrite,
                [
                    SystemMessage(
                        "Rewrite the user's latest message as a standalone search query about their quests or TaskQuest."
                    ),
                    HumanMessage(history),
                ],
            )
            deps.tokens[0] += i
            deps.tokens[1] += o
            return {"query": out.query}
        except Exception:  # noqa: BLE001
            return {"query": latest}

    async def retrieve(state: ChatState) -> dict:
        if deps.retriever is None:
            return {"retrieved": []}
        types = frozenset({"doc"}) if state["intent"] == "app_help" else frozenset({"list", "item", "history"})
        filters = state.get("filters") or {}
        try:
            from app.db import pool

            async with pool.get_engine().connect() as conn:
                hits = await deps.retriever.retrieve(
                    conn,
                    state["discord_id"],
                    state.get("query") or last_human_text(state["messages"]),
                    k=6,
                    source_types=types,
                    status=filters.get("status"),
                    category=filters.get("category"),
                )
        except Exception:  # noqa: BLE001 - e.g. embeddings unavailable: the agent can still use tools
            log.warning("retrieval failed; continuing without context")
            hits = []
        return {"retrieved": [asdict(h) for h in hits]}

    async def agent(state: ChatState) -> dict:
        context = format_context([Retrieved(**r) for r in state.get("retrieved", [])])
        system = f"{chat_prompt}\n\nToday: {datetime.now(UTC).date().isoformat()}"
        if state.get("summary"):
            system += f"\n\nConversation so far (summary): {state['summary']}"
        if context:
            system += f"\n\nContext:\n{context}"
        llm = deps.llm_factory()
        exhausted = tool_rounds_this_turn(state["messages"]) >= max_rounds
        model = llm if exhausted else llm.bind_tools(tools)
        if exhausted:
            system += "\n\nTool budget for this turn is used up. Answer now with what you have."
        reply = await model.ainvoke([SystemMessage(system), *window(state["messages"])])
        deps.add_tokens(reply)
        if is_blocked(reply) or (not reply.tool_calls and not text_of(reply.content).strip()):
            log.warning("chat agent reply blocked or empty: %s", reply.response_metadata.get("finish_reason"))
            reply = AIMessage(content=BLOCKED_REPLY, id=reply.id, response_metadata={"taskquest_fallback": True})
        log.info(
            "chat agent prompt=%s intent=%s tool_calls=%d", chat_version, state.get("intent"), len(reply.tool_calls)
        )
        return {"messages": [reply]}

    def after_agent(state: ChatState) -> str:
        calls = pending_tool_calls(state["messages"])
        if not calls:
            return "end"
        if any(c["name"] in TOOLS and TOOLS[c["name"]].write for c in calls):
            return "confirm"
        return "tools"

    async def confirm(state: ChatState) -> dict:
        """Pause for the user. Nothing is written before this returns (the node re-runs on resume)."""
        ctx = ctx_for(state)
        pending: list[dict[str, Any]] = []
        decisions: dict[str, Any] = {}
        for call in pending_tool_calls(state["messages"]):
            spec = TOOLS.get(call["name"])
            if spec is None or not spec.write:
                continue
            call_id = call["id"] or ""
            try:
                args = spec.args(**call["args"])
                preview = await spec.preview(ctx, args) if spec.preview else f"Run {spec.name}?"
            except ValidationError as err:
                decisions[call_id] = f"Invalid arguments: {err.errors()[0]['msg']}"
                continue
            except ToolError as err:
                decisions[call_id] = str(err)
                continue
            pending.append(
                {"id": call_id, "action": spec.name, "args": args.model_dump(exclude_none=True), "preview": preview}
            )
        if pending:
            answer = interrupt({"actions": pending})
            approved = bool(answer.get("approved")) if isinstance(answer, dict) else bool(answer)
            decisions.update({p["id"]: approved for p in pending})
        return {"approvals": decisions}

    async def tools_node(state: ChatState) -> dict:
        ctx = ctx_for(state)
        approvals = state.get("approvals") or {}
        results: list[ToolMessage] = []
        events: list[dict[str, Any]] = []
        for call in pending_tool_calls(state["messages"]):
            spec = TOOLS.get(call["name"])
            call_id = call["id"] or ""
            event: dict[str, Any] = {"name": call["name"], "status": "done"}
            if spec is None:
                content, event["status"] = f"Unknown tool {call['name']}.", "error"
            elif spec.write and approvals.get(call_id) is not True:
                decision = approvals.get(call_id)
                if isinstance(decision, str):  # validation/ownership problem found before asking
                    content, event["status"] = f"Could not do that: {decision}", "error"
                else:
                    content, event["status"] = "The user declined this action. Nothing was changed.", "declined"
            else:
                try:
                    args = spec.args(**call["args"])  # extra fields (e.g. a smuggled discord_id) are rejected
                    result = await spec.handler(ctx, args)
                    content = _json(result)
                    if isinstance(result, dict):
                        for key in ("xpResult", "newAchievements", "sources"):
                            if result.get(key):
                                event[key] = result[key]
                except ValidationError as err:
                    content, event["status"] = f"Invalid arguments: {err.errors()[0]['msg']}", "error"
                except ToolError as err:
                    content, event["status"] = f"Failed: {err}", "error"
                except Exception:  # noqa: BLE001 - tool crashes must not break the conversation
                    log.exception("tool %s crashed", call["name"])
                    content, event["status"] = "That tool failed unexpectedly.", "error"
            results.append(ToolMessage(content=content, tool_call_id=call_id, name=call["name"]))
            events.append(event)
        return {"messages": results, "tool_events": events, "approvals": {}}

    g = StateGraph(ChatState)
    g.add_node("fold_memory", fold_memory)
    g.add_node("router", router)
    g.add_node("rewrite_query", rewrite_query)
    g.add_node("retrieve", retrieve)
    g.add_node("agent", agent)
    g.add_node("confirm", confirm)
    g.add_node("tools", tools_node)
    g.add_edge(START, "fold_memory")
    g.add_edge("fold_memory", "router")
    g.add_conditional_edges("router", after_router, {"rewrite_query": "rewrite_query", "agent": "agent"})
    g.add_edge("rewrite_query", "retrieve")
    g.add_edge("retrieve", "agent")
    g.add_conditional_edges("agent", after_agent, {"end": END, "confirm": "confirm", "tools": "tools"})
    g.add_edge("confirm", "tools")
    g.add_edge("tools", "agent")
    return g.compile(checkpointer=checkpointer)
