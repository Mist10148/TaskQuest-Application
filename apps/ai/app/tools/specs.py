"""Chat tools.

``discord_id`` is NEVER a tool argument: the model-facing schemas do not contain it and
argument models forbid extra fields, so a prompt-injected ``discord_id`` is rejected. The
handlers receive it from trusted graph state through ``ToolContext``.

Read tools run immediately. Write tools (``write=True``) only run after the user approves
a confirmation card, and they go through Express ``/internal/*`` (see web_client.py).
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app import usage
from app.chains import summarize as summarize_chain
from app.db import pool, repo
from app.graphs import prioritize as prioritize_graph
from app.rag.chunking import item_label, list_label
from app.rag.retriever import TaskRetriever
from app.tools.web_client import ToolError, WebClient

Priority = Literal["LOW", "MEDIUM", "HIGH"]
Repeat = Literal["daily", "weekly", "monthly"]
_DATE = r"^\d{4}-\d{2}-\d{2}$"
MAX_TAGS = 5
Tag = Annotated[str, StringConstraints(min_length=1, max_length=20, pattern=r"^#?[\w-]+$")]


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass
class ToolContext:
    discord_id: str
    llm_factory: Callable[..., Any]
    web: WebClient
    retriever: TaskRetriever | None = None
    today: date = field(default_factory=lambda: datetime.now(UTC).date())


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args: type[Args]
    handler: Callable[[ToolContext, Any], Awaitable[dict[str, Any]]]
    write: bool = False
    preview: Callable[[ToolContext, Any], Awaitable[str]] | None = None

    def as_langchain_tool(self) -> StructuredTool:
        """Model-facing declaration only; execution goes through the registry in the graph."""

        async def _never(**_: Any) -> str:  # pragma: no cover - the graph executes tools itself
            raise RuntimeError("tools are executed by the chat graph")

        return StructuredTool.from_function(
            coroutine=_never, name=self.name, description=self.description, args_schema=self.args
        )


def _real_date(value: str | None) -> str | None:
    """A YYYY-MM-DD string that is a real calendar date (the pattern alone lets 2026-02-30 through)."""
    if value is not None:
        try:
            date.fromisoformat(value)
        except ValueError:
            raise ValueError("not a real calendar date") from None
    return value


class ItemFields(Args):
    """A task's own fields. Dates are plain YYYY-MM-DD; the server validates them again."""

    due_date: str | None = Field(default=None, pattern=_DATE, description="Due date, YYYY-MM-DD")
    priority: Priority | None = None
    tags: list[Tag] | None = Field(default=None, max_length=MAX_TAGS, description="Up to 5 short tags")
    repeat: Repeat | None = Field(default=None, description="Repeat when completed: daily, weekly or monthly")

    @field_validator("due_date")
    @classmethod
    def _due_is_real(cls, v: str | None) -> str | None:
        return _real_date(v)

    def item_fields(self) -> dict[str, Any]:
        """The fields in the internal API's names (``repeat`` is stored as ``recurrence``)."""
        out = self.model_dump(exclude_none=True, include={"due_date", "priority", "tags"})
        if self.tags:
            out["tags"] = [t.lstrip("#") for t in self.tags]
        if self.repeat:
            out["recurrence"] = self.repeat
        return out

    def describe_fields(self) -> list[str]:
        """Preview lines for the fields that are set."""
        lines = []
        for label, value in (
            ("Due", self.due_date),
            ("Priority", self.priority),
            ("Tags", ", ".join(self.tags) if self.tags else None),
            ("Repeats", self.repeat),
        ):
            if value:
                lines.append(f"- {label}: {value}")
        return lines


def _parse_id(value: str, prefix: str) -> int:
    """Accept 42, "42" or "L42"/"I42" (the ids the model sees in context)."""
    m = re.fullmatch(rf"(?:{prefix})?(\d+)", str(value).strip(), re.IGNORECASE)
    if not m:
        raise ToolError(f"Invalid id: {value!r}")
    return int(m.group(1))


def _list_view(lst: dict[str, Any], today: date) -> dict[str, Any]:
    dl = lst["deadline"]
    return {
        "id": list_label(lst["id"]),
        "name": lst["name"],
        "category": lst.get("category"),
        "priority": lst.get("priority"),
        "deadline": dl.isoformat() if dl else None,
        "days_to_deadline": (dl - today).days if dl else None,
        "progress": f"{lst['items_completed']}/{lst['items_total']}",
    }


def _sources(lists: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [{"id": list_label(lst["id"]), "title": lst["name"]} for lst in lists]


# ── read tools ───────────────────────────────────────────────────────────────


class SearchTasksArgs(Args):
    query: str = Field(min_length=1, max_length=300, description="What to look for, in natural language")
    status: Literal["open", "done"] | None = Field(default=None, description="Only open or only finished quests")
    category: str | None = Field(default=None, max_length=50)


async def search_tasks(ctx: ToolContext, a: SearchTasksArgs) -> dict[str, Any]:
    try:
        if ctx.retriever is None:
            raise RuntimeError("no retriever")
        async with pool.get_engine().connect() as conn:
            hits = await ctx.retriever.retrieve(
                conn,
                ctx.discord_id,
                a.query,
                k=6,
                source_types=frozenset({"list", "item"}),
                status=a.status,
                category=a.category,
                today=ctx.today,
            )
        return {
            "results": [{"id": h.id, "title": h.title, "text": h.text} for h in hits],
            "sources": [{"id": h.id, "title": h.title} for h in hits if h.kind == "list"],
        }
    except Exception:  # noqa: BLE001 - embeddings down: degrade to keyword matching
        words = {w for w in re.findall(r"[a-z0-9]{3,}", a.query.lower())}
        async with pool.get_engine().connect() as conn:
            lists = await repo.lists_for_user(conn, ctx.discord_id)
        matches = [
            lst
            for lst in lists
            if words & set(re.findall(r"[a-z0-9]{3,}", f"{lst['name']} {lst.get('description') or ''}".lower()))
        ]
        return {
            "results": [_list_view(lst, ctx.today) for lst in matches[:6]],
            "sources": _sources(matches[:6]),
            "note": "keyword search",
        }


class GetListArgs(Args):
    list_id: str = Field(description='Quest id such as "L42" or 42')


async def get_list(ctx: ToolContext, a: GetListArgs) -> dict[str, Any]:
    list_id = _parse_id(a.list_id, "L")
    async with pool.get_engine().connect() as conn:
        lst = await repo.get_list_with_items(conn, ctx.discord_id, list_id)
    if lst is None:
        raise ToolError(f"Quest L{list_id} was not found.")
    items = lst.pop("items")
    return {
        **_list_view(lst, ctx.today),
        "description": lst.get("description"),
        "subtasks": [{"id": item_label(i["id"]), "name": i["name"], "done": i["completed"]} for i in items],
        "sources": _sources([lst]),
    }


class NoArgs(Args):
    pass


async def get_overdue(ctx: ToolContext, a: NoArgs) -> dict[str, Any]:
    async with pool.get_engine().connect() as conn:
        lists = await repo.lists_for_user(conn, ctx.discord_id, open_only=True)
    overdue = [lst for lst in lists if lst["deadline"] and lst["deadline"] < ctx.today]
    return {"overdue": [_list_view(lst, ctx.today) for lst in overdue], "sources": _sources(overdue)}


class DueSoonArgs(Args):
    days: int = Field(default=7, ge=1, le=60)


async def get_due_soon(ctx: ToolContext, a: DueSoonArgs) -> dict[str, Any]:
    async with pool.get_engine().connect() as conn:
        lists = await repo.lists_for_user(conn, ctx.discord_id, open_only=True)
    limit = ctx.today + timedelta(days=a.days)
    soon = [lst for lst in lists if lst["deadline"] and ctx.today <= lst["deadline"] <= limit]
    soon.sort(key=lambda lst: lst["deadline"])
    return {"due_soon": [_list_view(lst, ctx.today) for lst in soon], "sources": _sources(soon)}


class StatsArgs(Args):
    range: Literal["day", "week", "month"] = "week"


async def get_stats(ctx: ToolContext, a: StatsArgs) -> dict[str, Any]:
    days = {"day": 1, "week": 7, "month": 30}[a.range]
    since = datetime.combine(ctx.today - timedelta(days=days - 1), datetime.min.time())
    async with pool.get_engine().connect() as conn:
        stats = await repo.get_user_stats(conn, ctx.discord_id)
        done = await repo.completions_since(conn, ctx.discord_id, since)
        xp = await repo.xp_since(conn, ctx.discord_id, since)
    return {
        "range": a.range,
        "level": stats["player_level"] if stats else None,
        "streak_days": stats["streak_count"] if stats else None,
        "lifetime_xp": stats["lifetime_xp_total"] if stats else None,  # never resets, unlike the level basis
        "subtasks_completed": len(done),
        "xp_earned": xp,
    }


class SummarizeArgs(Args):
    mode: Literal["list", "digest", "recap"]
    list_id: str | None = Field(default=None, description='Required for mode "list"')
    range: Literal["day", "week"] = "week"


async def summarize_tool(ctx: ToolContext, a: SummarizeArgs) -> dict[str, Any]:
    list_id = _parse_id(a.list_id, "L") if a.list_id else None
    try:
        return await summarize_chain.summarize(
            ctx.discord_id, ctx.llm_factory, a.mode, list_id=list_id, range_=a.range, today=ctx.today
        )
    except summarize_chain.NotFound:
        raise ToolError("That quest was not found.") from None
    except usage.QuotaExceeded:
        raise ToolError("Daily AI energy used up.") from None


class PrioritizeArgs(Args):
    limit: int = Field(default=5, ge=1, le=20)


async def prioritize_tool(ctx: ToolContext, a: PrioritizeArgs) -> dict[str, Any]:
    return await prioritize_graph.prioritize(ctx.discord_id, ctx.llm_factory, limit=a.limit, today=ctx.today)


# ── write tools (confirmation required) ──────────────────────────────────────


class CreateListArgs(Args):
    name: str = Field(min_length=1, max_length=100)
    category: str | None = Field(default=None, max_length=50)
    priority: Priority | None = None
    deadline: str | None = Field(default=None, pattern=_DATE, description="YYYY-MM-DD")
    description: str | None = Field(default=None, max_length=500)
    items: list[Annotated[str, StringConstraints(min_length=1, max_length=150)]] | None = Field(
        default=None, max_length=20, description="Initial subtask names"
    )


async def create_list(ctx: ToolContext, a: CreateListArgs) -> dict[str, Any]:
    return await ctx.web.create_list(ctx.discord_id, a.model_dump(exclude_none=True))


async def _preview_create_list(ctx: ToolContext, a: CreateListArgs) -> str:
    """Everything that will be written, so the user approves exactly this."""
    lines = [f'Create quest "{a.name}"']
    for label, value in (
        ("Category", a.category),
        ("Priority", a.priority),
        ("Deadline", a.deadline),
        ("Description", a.description),
    ):
        if value:
            lines.append(f"- {label}: {value}")
    if a.items:
        lines.append(f"- Subtasks ({len(a.items)}):")
        lines.extend(f"  {n}. {name}" for n, name in enumerate(a.items, 1))
    return "\n".join(lines) + "\nApprove?"


class AddItemArgs(ItemFields):
    list_id: str = Field(description='Quest id such as "L42"')
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    parent_id: str | None = Field(
        default=None, description='Make it a subtask of this top-level subtask, such as "I311" (one level only)'
    )


async def add_item(ctx: ToolContext, a: AddItemArgs) -> dict[str, Any]:
    fields: dict[str, Any] = {"name": a.name, **a.item_fields()}
    if a.description:
        fields["description"] = a.description
    if a.parent_id:
        fields["parent_id"] = _parse_id(a.parent_id, "I")
    return await ctx.web.add_item(ctx.discord_id, _parse_id(a.list_id, "L"), fields)


async def _list_name(ctx: ToolContext, list_id: int) -> str:
    async with pool.get_engine().connect() as conn:
        lst = await repo.get_list_with_items(conn, ctx.discord_id, list_id)
    if lst is None:
        raise ToolError(f"Quest L{list_id} was not found.")
    return lst["name"]


async def _item_name(ctx: ToolContext, item_id: int) -> str:
    async with pool.get_engine().connect() as conn:
        for item in await repo.all_items_for_user(conn, ctx.discord_id):
            if item["id"] == item_id:
                return item["name"]
    raise ToolError(f"Subtask I{item_id} was not found.")


async def _preview_add_item(ctx: ToolContext, a: AddItemArgs) -> str:
    quest = await _list_name(ctx, _parse_id(a.list_id, "L"))
    details = ([f"- Description: {a.description}"] if a.description else []) + a.describe_fields()
    if a.parent_id:
        details.append(f'- Under subtask: "{await _item_name(ctx, _parse_id(a.parent_id, "I"))}"')
    if not details:
        return f'Add subtask "{a.name}" to "{quest}"?'
    return "\n".join([f'Add subtask "{a.name}" to "{quest}"', *details, "Approve?"])


class UpdateItemArgs(ItemFields):
    item_id: str = Field(description='Subtask id such as "I311"')
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _something_changes(self) -> UpdateItemArgs:
        if not self.item_fields() and self.name is None and self.description is None:
            raise ValueError("give at least one field to change")
        return self


async def update_item(ctx: ToolContext, a: UpdateItemArgs) -> dict[str, Any]:
    fields = a.item_fields()
    if a.name is not None:
        fields["name"] = a.name
    if a.description is not None:
        fields["description"] = a.description
    return await ctx.web.update_item(ctx.discord_id, _parse_id(a.item_id, "I"), fields)


async def _preview_update_item(ctx: ToolContext, a: UpdateItemArgs) -> str:
    current = await _item_name(ctx, _parse_id(a.item_id, "I"))
    lines = [f'Change subtask "{current}"']
    if a.name is not None:
        lines.append(f'- Rename to: "{a.name}"')
    if a.description is not None:
        lines.append(f"- Description: {a.description}")
    lines.extend(a.describe_fields())
    return "\n".join([*lines, "Approve?"])


class BreakDownArgs(Args):
    item_id: str = Field(description='Top-level subtask id such as "I311" to break down')
    subtasks: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(
        min_length=2, max_length=8, description="2 to 8 smaller steps, in order"
    )


async def break_down_task(ctx: ToolContext, a: BreakDownArgs) -> dict[str, Any]:
    return await ctx.web.add_subtasks(ctx.discord_id, _parse_id(a.item_id, "I"), a.subtasks)


async def _preview_break_down(ctx: ToolContext, a: BreakDownArgs) -> str:
    item_id = _parse_id(a.item_id, "I")
    async with pool.get_engine().connect() as conn:
        match = next((i for i in await repo.all_items_for_user(conn, ctx.discord_id) if i["id"] == item_id), None)
    if match is None:
        raise ToolError(f"Subtask I{item_id} was not found.")
    lines = [f'Break "{match["name"]}" into {len(a.subtasks)} subtasks:']
    lines.extend(f"  {n}. {name}" for n, name in enumerate(a.subtasks, 1))
    return "\n".join([*lines, "Approve?"])


class CompleteItemArgs(Args):
    item_id: str = Field(description='Subtask id such as "I311"')


async def complete_item(ctx: ToolContext, a: CompleteItemArgs) -> dict[str, Any]:
    return await ctx.web.complete_item(ctx.discord_id, _parse_id(a.item_id, "I"))


async def _preview_complete_item(ctx: ToolContext, a: CompleteItemArgs) -> str:
    item_id = _parse_id(a.item_id, "I")
    async with pool.get_engine().connect() as conn:
        for item in await repo.all_items_for_user(conn, ctx.discord_id):
            if item["id"] == item_id:
                return f'Mark "{item["name"]}" as done?'
    raise ToolError(f"Subtask I{item_id} was not found.")


class UpdateListArgs(Args):
    list_id: str = Field(description='Quest id such as "L42"')
    priority: Priority | None = None
    deadline: str | None = Field(default=None, pattern=_DATE, description="YYYY-MM-DD")


async def update_list(ctx: ToolContext, a: UpdateListArgs) -> dict[str, Any]:
    fields = a.model_dump(exclude_none=True, exclude={"list_id"})
    if not fields:
        raise ToolError("Nothing to change: give a priority or a deadline.")
    return await ctx.web.update_list(ctx.discord_id, _parse_id(a.list_id, "L"), fields)


async def _preview_update_list(ctx: ToolContext, a: UpdateListArgs) -> str:
    name = await _list_name(ctx, _parse_id(a.list_id, "L"))
    changes = ", ".join(
        part
        for part in (
            f"priority to {a.priority}" if a.priority else "",
            f"deadline to {a.deadline}" if a.deadline else "",
        )
        if part
    )
    return f'Change {changes or "nothing"} on "{name}"?'


TOOLS: dict[str, ToolSpec] = {
    t.name: t
    for t in [
        ToolSpec(
            "search_tasks",
            "Search the user's quests and subtasks by meaning. Use for 'which/what/when' questions.",
            SearchTasksArgs,
            search_tasks,
        ),
        ToolSpec("get_list", "Get one quest with all its subtasks.", GetListArgs, get_list),
        ToolSpec("get_overdue", "List open quests whose deadline has passed.", NoArgs, get_overdue),
        ToolSpec("get_due_soon", "List open quests due within the next N days.", DueSoonArgs, get_due_soon),
        ToolSpec("get_stats", "XP earned, subtasks completed, level and streak over a period.", StatsArgs, get_stats),
        ToolSpec(
            "summarize",
            "Summarize a quest, a morning digest, or a recap of recent progress.",
            SummarizeArgs,
            summarize_tool,
        ),
        ToolSpec("prioritize", "Rank the user's open quests by what to do next.", PrioritizeArgs, prioritize_tool),
        ToolSpec(
            "create_list",
            "Create a new quest (optionally with subtasks). Needs user confirmation.",
            CreateListArgs,
            create_list,
            True,
            _preview_create_list,
        ),
        ToolSpec(
            "add_item",
            "Add a subtask to an existing quest, optionally with a due date, priority, tags, repeat or a parent subtask. Needs user confirmation.",
            AddItemArgs,
            add_item,
            True,
            _preview_add_item,
        ),
        ToolSpec(
            "update_item",
            "Change a subtask's name, description, due date, priority, tags or repeat. Needs user confirmation.",
            UpdateItemArgs,
            update_item,
            True,
            _preview_update_item,
        ),
        ToolSpec(
            "break_down_task",
            "Break a subtask into 2-8 smaller subtasks under it (one level only). Needs user confirmation.",
            BreakDownArgs,
            break_down_task,
            True,
            _preview_break_down,
        ),
        ToolSpec(
            "complete_item",
            "Mark a subtask as done (awards XP). Needs user confirmation.",
            CompleteItemArgs,
            complete_item,
            True,
            _preview_complete_item,
        ),
        ToolSpec(
            "update_list",
            "Change a quest's priority or deadline. Needs user confirmation.",
            UpdateListArgs,
            update_list,
            True,
            _preview_update_list,
        ),
    ]
}


def langchain_tools() -> list[StructuredTool]:
    return [t.as_langchain_tool() for t in TOOLS.values()]
