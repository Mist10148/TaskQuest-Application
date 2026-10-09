"""Load ``seed.json`` into the SQLite eval database and map its symbolic keys to task ids."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.rag.chunking import item_label, list_label

HERE = Path(__file__).parent


def load_json(name: str) -> dict[str, Any]:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


@dataclass
class Seeded:
    now: datetime
    labels: dict[str, str] = field(default_factory=dict)  # "list:math" -> "L1", "item:math_p1" -> "I1"
    owner: dict[str, str] = field(default_factory=dict)  # label -> discord_id
    docs: dict[str, str] = field(default_factory=dict)

    @property
    def today(self) -> date:
        return self.now.date()

    def label(self, ref: str) -> str:
        """``list:<key>`` / ``item:<key>`` -> ``L<id>`` / ``I<id>``."""
        return self.labels[ref]

    def key_of(self, label: str) -> str:
        return next((k for k, v in self.labels.items() if v == label), label)


async def seed(conn: AsyncConnection, data: dict[str, Any] | None = None, now: datetime | None = None) -> Seeded:
    data = data or load_json("seed.json")
    out = Seeded(now=(now or datetime.now()).replace(microsecond=0), docs=dict(data.get("docs", {})))
    for uid, user in data["users"].items():
        await conn.execute(text("INSERT INTO users (discord_id) VALUES (:u)"), {"u": uid})
        for xp in user.get("xp", []):
            await conn.execute(
                text(
                    "INSERT INTO xp_transactions (discord_id, amount, source, created_at) VALUES (:u, :a, 'item_complete', :t)"
                ),
                {"u": uid, "a": xp["amount"], "t": str(out.now - timedelta(hours=xp["hours_ago"]))},
            )
        for lst in user["lists"]:
            deadline = lst.get("deadline")
            result = await conn.execute(
                text(
                    "INSERT INTO lists (discord_id, name, description, category, deadline, priority)"
                    " VALUES (:u, :n, :d, :c, :dl, :p)"
                ),
                {
                    "u": uid,
                    "n": lst["name"],
                    "d": lst.get("description"),
                    "c": lst.get("category"),
                    "dl": str(out.today + timedelta(days=deadline)) if deadline is not None else None,
                    "p": lst.get("priority"),
                },
            )
            list_id = result.lastrowid
            assert list_id is not None
            out.labels[f"list:{lst['key']}"] = list_label(list_id)
            out.owner[list_label(list_id)] = uid
            for pos, item in enumerate(lst.get("items", [])):
                ago = item.get("done_hours_ago")
                res = await conn.execute(
                    text(
                        "INSERT INTO items (list_id, name, description, completed, completed_at, position)"
                        " VALUES (:l, :n, :d, :c, :at, :pos)"
                    ),
                    {
                        "l": list_id,
                        "n": item["name"],
                        "d": item.get("description"),
                        "c": int(ago is not None),
                        "at": str(out.now - timedelta(hours=ago)) if ago is not None else None,
                        "pos": pos,
                    },
                )
                if item.get("key"):
                    assert res.lastrowid is not None
                    out.labels[f"item:{item['key']}"] = item_label(res.lastrowid)
                    out.owner[item_label(res.lastrowid)] = uid
    return out
