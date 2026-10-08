"""Turn lists, items, history and docs into embeddable natural-language chunks.

Dates are absolute (``2026-10-12``); relative wording ("due tomorrow") is computed
at query time and never stored, so embeddings do not go stale overnight.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

LONG_ITEM_CHARS = 300
DOC_CHUNK_CHARS = 3200  # about 800 tokens
DOC_OVERLAP_CHARS = 400  # about 100 tokens


@dataclass(frozen=True)
class Chunk:
    source_type: str  # list | item | history | doc
    source_id: str
    list_id: int | None
    text: str

    @property
    def content_hash(self) -> str:
        return sha256(self.text)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def list_label(list_id: int) -> str:
    return f"L{list_id}"


def item_label(item_id: int) -> str:
    return f"I{item_id}"


def render_list(lst: dict[str, Any], items: list[dict[str, Any]]) -> str:
    """Canonical text for a quest and its subtasks (also used for fresh re-reads and prompts)."""
    lines = [
        f"Quest: {lst['name']}",
        f"Category: {lst.get('category') or 'none'}",
        f"Priority: {lst.get('priority') or 'none'}",
        f"Deadline: {lst['deadline'].isoformat() if lst.get('deadline') else 'none'}",
    ]
    if lst.get("description"):
        lines.append(f"Description: {lst['description']}")
    if items:
        lines.append("Subtasks:")
        lines.extend(f"- [{'x' if it['completed'] else ' '}] {it['name']}" for it in items)
    else:
        lines.append("Subtasks: none yet")
    return "\n".join(lines)


def list_chunk(lst: dict[str, Any], items: list[dict[str, Any]]) -> Chunk:
    return Chunk("list", list_label(lst["id"]), lst["id"], render_list(lst, items))


def item_chunks(lst: dict[str, Any], items: list[dict[str, Any]]) -> list[Chunk]:
    """Subtasks with long descriptions get their own chunk so they stay retrievable."""
    out = []
    for it in items:
        if it.get("description") and len(it["description"]) > LONG_ITEM_CHARS:
            text = f'Subtask of "{lst["name"]}": {it["name"]}\n{it["description"]}'
            out.append(Chunk("item", item_label(it["id"]), lst["id"], text))
    return out


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def history_chunks(
    discord_id: str, completions: list[dict[str, Any]], xp_by_week: dict[date, int] | None = None
) -> list[Chunk]:
    """One chunk per user per week summarising completed subtasks."""
    xp_by_week = xp_by_week or {}
    weeks: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for c in completions:
        if c.get("completed_at"):
            weeks[week_start(c["completed_at"].date())].append(c)
    out = []
    for start, rows in sorted(weeks.items()):
        names = "; ".join(f'"{r["name"]}" ({r["list_name"]})' for r in rows[:30])
        xp = xp_by_week.get(start)
        xp_text = f"; earned {xp} XP" if xp else ""
        text = f"Week of {start.isoformat()}: completed {len(rows)} subtasks: {names}{xp_text}"
        out.append(Chunk("history", f"H{discord_id}:{start.isoformat()}", None, text))
    return out


_HEADING = re.compile(r"^(#{1,4})\s+(.*)$")


def doc_chunks(slug: str, markdown: str) -> list[Chunk]:
    """Split markdown by heading (prefixing the heading path), then by size with overlap."""
    sections: list[tuple[str, list[str]]] = []
    path: list[str] = []
    current: list[str] = []
    in_code = False

    def flush():
        body = "\n".join(current).strip()
        if body:
            sections.append((" > ".join(path), [body]))

    for line in markdown.splitlines():
        if line.startswith("```"):
            in_code = not in_code
        m = None if in_code else _HEADING.match(line)
        if m:
            flush()
            current = []
            level = len(m.group(1))
            path[:] = path[: level - 1] + [m.group(2).strip()]
        else:
            current.append(line)
    flush()

    chunks: list[Chunk] = []
    n = 0
    for heading, (body,) in sections:
        prefix = f"{slug.upper()} / {heading}\n" if heading else f"{slug.upper()}\n"
        start = 0
        while start < len(body):
            piece = body[start : start + DOC_CHUNK_CHARS]
            chunks.append(Chunk("doc", f"{slug}#{n}", None, prefix + piece))
            n += 1
            if start + DOC_CHUNK_CHARS >= len(body):
                break
            start += DOC_CHUNK_CHARS - DOC_OVERLAP_CHARS
    return chunks
