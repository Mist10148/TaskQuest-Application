"""The prioritizer's shared cache (``ai_prioritize_cache``): a second AI instance reuses a ranking the first computed."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import text

from app import usage
from app.db import pool, repo
from app.graphs import prioritize as P
from tests.conftest import OTHER, UID
from tests.fakes import ScriptedLLM
from tests.graphs.test_prioritize import TODAY, factory_for, ranking, run


@pytest.fixture(autouse=True)
def _clear_cache():
    P.clear_cache()


async def rows(engine, uid=UID):
    async with engine.connect() as conn:
        return (
            await conn.execute(
                text("SELECT cache_key, result_json, created_at FROM ai_prioritize_cache WHERE discord_id = :u"),
                {"u": uid},
            )
        ).all()


async def test_a_ranking_is_stored_for_the_other_instances(seeded):
    first = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    stored = await rows(seeded)
    assert len(stored) == 1
    assert len(stored[0][0]) == 64, "the key is a sha256 hex digest, not the task list"
    payload = json.loads(stored[0][1])
    assert payload["ranked"] == first["ranked"] and "cached" not in payload


async def test_another_instance_with_an_empty_memory_reuses_it(seeded):
    first = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    P.clear_cache()  # a different process: nothing in memory, the same database
    second = await run(seeded, ScriptedLLM([]))  # would fail if it called the model
    assert second["cached"] is True
    assert second["ranked"] == first["ranked"] and second["focusMessage"] == first["focusMessage"]


async def test_a_reserved_request_is_handed_back_on_a_shared_hit(seeded):
    await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))  # the real model call: one request
    P.clear_cache()
    async with seeded.begin() as conn:
        await usage.reserve(conn, UID, "prioritize")
        assert await usage.requests_today(conn, UID) == 2
    await run(seeded, ScriptedLLM([]), reserved=True)
    async with seeded.connect() as conn:
        assert await usage.requests_today(conn, UID) == 1, "the cache hit handed its reservation back"


async def test_an_expired_row_is_not_used_and_is_replaced(seeded):
    await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    P.clear_cache()
    old = (P.datetime.now(P.UTC) - timedelta(seconds=P.CACHE_TTL_SECONDS + 5)).strftime("%Y-%m-%d %H:%M:%S")
    async with seeded.begin() as conn:
        await conn.execute(text("UPDATE ai_prioritize_cache SET created_at = :t"), {"t": old})
    again = await run(seeded, ScriptedLLM([ranking("L3", "L2", "L1")]))
    assert again["cached"] is False, "five minutes are up: ask again"
    stored = await rows(seeded)
    assert len(stored) == 1, "the stale row was cleaned up when the new one was written"
    assert stored[0][2] > old


async def test_a_task_edit_or_another_limit_misses_the_shared_cache(seeded):
    await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]), limit=2)
    P.clear_cache()
    other_limit = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]), limit=3)
    assert other_limit["cached"] is False, "the limit is part of the key"
    P.clear_cache()
    async with seeded.begin() as conn:
        await conn.execute(text("UPDATE lists SET priority = 'HIGH' WHERE id = 3"))
    edited = await run(seeded, ScriptedLLM([ranking("L1", "L3", "L2")]), limit=3)
    assert edited["cached"] is False, "any change to the open tasks changes the key"
    assert len(await rows(seeded)) == 3


async def test_rankings_are_never_shared_between_users(seeded):
    async with seeded.begin() as conn:  # the other user has one open quest, so their key differs anyway
        await conn.execute(text("INSERT OR IGNORE INTO users (discord_id) VALUES (:u)"), {"u": OTHER})
    await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    P.clear_cache()
    out = await P.prioritize(OTHER, factory_for(ScriptedLLM([ranking("L4")])), today=TODAY)
    assert out["cached"] is False
    assert len(await rows(seeded, UID)) == 1 and len(await rows(seeded, OTHER)) == 1


async def test_a_fallback_ranking_is_not_cached(seeded):
    from app.llm import AIUnavailable

    class Down:
        def with_structured_output(self, *_a, **_k):
            raise AIUnavailable("down")

    out = await run(seeded, Down())
    assert out["usedFallback"] is True
    assert await rows(seeded) == []


async def test_the_cache_is_an_optimisation_a_missing_table_does_not_break_ranking(seeded):
    async with seeded.begin() as conn:
        await conn.execute(text("DROP TABLE ai_prioritize_cache"))  # an old database that has not run migration 003
    out = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    assert out["cached"] is False and len(out["ranked"]) == 3
    P.clear_cache()
    again = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    assert again["cached"] is False, "no shared table: it simply asks the model again"


async def test_forgetting_a_user_removes_their_cached_rankings(seeded):
    await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    assert len(await rows(seeded)) == 1
    async with pool.connection() as conn:
        await repo.delete_user_ai_data(conn, UID)
    assert await rows(seeded) == []
