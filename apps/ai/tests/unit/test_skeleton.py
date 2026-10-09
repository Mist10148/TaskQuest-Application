"""Auth, health and the 'every repo function is scoped by discord_id' rule."""

from __future__ import annotations

import inspect

from app.db import repo
from tests.conftest import OTHER, UID, auth


async def test_ping_requires_token(client):
    assert (await client.get("/v1/ping")).status_code == 401
    bad = {"X-AI-Token": "wrong", "X-Discord-Id": UID}
    assert (await client.get("/v1/ping", headers=bad)).status_code == 401


async def test_ping_requires_valid_discord_id(client):
    headers = {"X-AI-Token": "t" * 40, "X-Discord-Id": "abc; DROP TABLE"}
    assert (await client.get("/v1/ping", headers=headers)).status_code == 400


async def test_ping_ok(client):
    r = await client.get("/v1/ping", headers=auth())
    assert r.status_code == 200 and r.json() == {"pong": True}


async def test_health_is_public(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["database"] is True


def test_every_repo_query_takes_discord_id():
    for name, fn in inspect.getmembers(repo, inspect.iscoroutinefunction):
        params = list(inspect.signature(fn).parameters)
        assert "discord_id" in params, f"repo.{name} must take discord_id"


async def test_lists_are_scoped_to_user(seeded):
    async with seeded.connect() as conn:
        mine = await repo.lists_for_user(conn, UID)
        theirs = await repo.lists_for_user(conn, OTHER)
        assert [lst["name"] for lst in mine] == ["Math homework", "Clean garage", "Read novel"]
        assert [lst["name"] for lst in theirs] == ["Secret plans"]
        assert await repo.get_list_with_items(conn, UID, 4) is None  # another user's list id


async def test_open_only_and_counts(seeded):
    async with seeded.connect() as conn:
        lists = await repo.lists_for_user(conn, UID, open_only=True)
        math = next(lst for lst in lists if lst["name"] == "Math homework")
        assert (math["items_total"], math["items_completed"]) == (2, 1)


def test_app_code_uses_utc_dates():
    """Express stores timestamps in UTC; local-time "today" shifts deadlines and history weeks."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[2] / "app"
    offenders = [
        f"{path.relative_to(root)}:{n}"
        for path in root.rglob("*.py")
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if re.search(r"\bdate\.today\(\)|datetime\.now\(\)|datetime\.utcnow\(\)", line)
    ]
    assert offenders == []


async def test_get_list_with_items_loads_only_the_callers_list(seeded):
    async with seeded.connect() as conn:
        lst = await repo.get_list_with_items(conn, UID, 1)
        assert lst is not None and lst["name"] == "Math homework" and lst["items_total"] == 2
        assert [i["name"] for i in lst["items"]] == ["Problems 1-10", "Problems 11-20"]
        assert await repo.get_list_with_items(conn, UID, 4) is None  # another user's quest
        assert await repo.get_list_with_items(conn, UID, 999) is None


def test_persona_is_layered_after_the_core_rules():
    from app.prompts import CORE_RULES, load_prompt

    plain, v1 = load_prompt("chat_system")
    voiced, v2 = load_prompt("chat_system", persona=True)
    assert "Persona" not in plain and v1 != v2
    assert voiced.startswith(CORE_RULES) and voiced.index("Never invent ids") < voiced.index("Persona")
    assert "Every other rule above wins" in voiced
    assert "Never use emojis" in voiced and "*italics*" in voiced
    assert "do not claim to be human" in voiced


async def test_discord_threads_are_hidden_from_web_thread_endpoints(engine):
    from app import threads

    async with engine.begin() as conn:
        web = await threads.create_thread(conn, UID, "hello from the web")
        dc = await threads.create_thread(
            conn, UID, "hi", thread_id="d0000000-0000-5000-8000-000000000000", source="discord"
        )
        assert [t["id"] for t in await threads.list_threads(conn, UID)] == [web]
        assert await threads.get_thread(conn, UID, dc) is None
        assert await threads.get_thread(conn, UID, dc, source=threads.DISCORD) is not None
        assert not await threads.delete_thread(conn, UID, dc)  # web delete cannot reach it
        assert await threads.delete_thread(conn, UID, dc, source=threads.DISCORD)
