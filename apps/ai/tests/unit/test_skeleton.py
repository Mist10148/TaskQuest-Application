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
