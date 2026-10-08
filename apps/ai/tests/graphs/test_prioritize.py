"""Prioritizer graph: baseline math and every path (ok / retry / fallback)."""

from __future__ import annotations

from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import text

from app.config import get_settings
from app.graphs import prioritize as P
from app.graphs.prioritize import RankedItem, RankingOut
from app.llm import AIUnavailable, get_llm_factory
from app.main import create_app
from tests.conftest import UID, auth
from tests.fakes import ScriptedLLM

TODAY = date.today()


@pytest.fixture(autouse=True)
def _clear_cache():
    P.clear_cache()


def ranking(*ids, suggest=None):
    return RankingOut(
        ranked=[
            RankedItem(id=i, rank=n, reason=f"because {i}", suggested_priority=suggest) for n, i in enumerate(ids, 1)
        ],
        focus_message="Go!",
    )


def factory_for(llm):
    return lambda **kw: llm


def feats(**kw):
    base = dict(
        id="L1",
        list_id=1,
        name="x",
        description=None,
        category=None,
        priority=None,
        deadline=None,
        days_to_deadline=None,
        is_overdue=False,
        priority_weight=1,
        pct_complete=0.0,
        days_since_activity=None,
        open_items=1,
    )
    return P.TaskFeatures(**{**base, **kw})


# ── deterministic pieces ─────────────────────────────────────────────────────


def test_baseline_orders_overdue_high_above_relaxed_low():
    urgent = feats(is_overdue=True, days_to_deadline=-2, priority="HIGH", priority_weight=3)
    relaxed = feats(priority="LOW", priority_weight=1, days_to_deadline=30, open_items=10)
    assert P.compute_baseline(urgent) > P.compute_baseline(relaxed)
    assert 0 <= P.compute_baseline(relaxed) <= 1 and P.compute_baseline(urgent) <= 1


def test_build_features(seeded):
    import asyncio

    from app.db import repo

    async def go():
        async with seeded.connect() as conn:
            return build(await repo.lists_for_user(conn, UID, open_only=True))

    def build(lists):
        return {f.id: f for f in P.build_features(lists, TODAY)}

    f = asyncio.run(go())
    math = f["L1"]
    assert (
        math.days_to_deadline == 1 and math.priority_weight == 3 and math.pct_complete == 0.5 and math.open_items == 1
    )
    assert f["L3"].days_to_deadline is None and f["L3"].priority_weight == 1


def test_validate_ranking_requires_a_permutation():
    ids = ["L1", "L2", "L3"]
    assert P.validate_ranking(ranking("L2", "L1", "L3"), ids) == []
    assert "unknown" in P.validate_ranking(ranking("L1", "L2", "L9"), ids)[0]
    assert any("missing" in e for e in P.validate_ranking(ranking("L1", "L2"), ids))
    assert any("duplicate" in e for e in P.validate_ranking(ranking("L1", "L1", "L2"), ids))
    bad_ranks = RankingOut(ranked=[RankedItem(id=i, rank=1, reason="r") for i in ids])
    assert any("ranks" in e for e in P.validate_ranking(bad_ranks, ids))


def test_template_reasons():
    assert P.template_reason(feats(is_overdue=True, days_to_deadline=-2)) == "Overdue by 2 day(s)"
    assert P.template_reason(feats(days_to_deadline=0)) == "Due today"
    assert "quick win" in P.template_reason(feats(open_items=1))


# ── graph paths ──────────────────────────────────────────────────────────────


async def run(seeded, llm, **kw):
    async with seeded.begin() as conn:
        return await P.prioritize(conn, UID, factory_for(llm), today=TODAY, **kw)


async def test_ok_path_merges_llm_and_baseline(seeded):
    llm = ScriptedLLM([ranking("L2", "L1", "L3", suggest="MEDIUM")])
    out = await run(seeded, llm)
    assert out["usedFallback"] is False and out["focusMessage"] == "Go!"
    assert [r["id"] for r in out["ranked"]][0] == "L1"  # baseline (due tomorrow, HIGH) keeps it on top
    assert [r["rank"] for r in out["ranked"]] == [1, 2, 3]
    assert set(r["id"] for r in out["ranked"]) == {"L1", "L2", "L3"}
    l1 = next(r for r in out["ranked"] if r["id"] == "L1")
    assert l1["suggestedPriority"] == "MEDIUM"  # differs from the current HIGH, so it is surfaced
    assert l1["reason"] == "because L1"


async def test_suggestion_dropped_when_equal_to_current(seeded):
    out = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3", suggest="HIGH")]))
    by = {r["id"]: r for r in out["ranked"]}
    assert by["L1"]["suggestedPriority"] is None  # already HIGH
    assert by["L2"]["suggestedPriority"] == "HIGH"  # LOW -> HIGH is a real suggestion


async def test_retry_once_then_succeed(seeded):
    llm = ScriptedLLM([ranking("L1", "L2", "L99"), ranking("L1", "L2", "L3")])
    out = await run(seeded, llm)
    assert out["usedFallback"] is False and len(llm.calls) == 2
    assert "unknown ids" in llm.last_text()  # error fed back to the model


async def test_invalid_twice_falls_back(seeded):
    llm = ScriptedLLM([ranking("L1", "L2"), ranking("L1")])
    out = await run(seeded, llm)
    assert out["usedFallback"] is True and len(llm.calls) == 2
    assert [r["id"] for r in out["ranked"]][0] == "L1"
    assert out["ranked"][0]["reason"].startswith("Due in 1 day")


async def test_llm_exception_falls_back(seeded):
    out = await run(seeded, ScriptedLLM([RuntimeError("503 from gemini")]))
    assert out["usedFallback"] is True and len(out["ranked"]) == 3


async def test_gemini_not_configured_falls_back(seeded):
    def boom(**kw):
        raise AIUnavailable("no key")

    async with seeded.begin() as conn:
        out = await P.prioritize(conn, UID, boom, today=TODAY)
    assert out["usedFallback"] is True


async def test_quota_exhausted_falls_back_instead_of_failing(seeded, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 0)
    llm = ScriptedLLM([])
    out = await run(seeded, llm)
    assert out["usedFallback"] is True and llm.calls == []


async def test_overdue_high_priority_cannot_be_buried(seeded):
    async with seeded.begin() as conn:
        await conn.execute(
            text("UPDATE lists SET deadline = :d, priority = 'HIGH' WHERE id = 2"),
            {"d": str(TODAY - timedelta(days=3))},
        )
    out = await run(seeded, ScriptedLLM([ranking("L1", "L3", "L2")]))  # LLM puts the overdue quest last
    assert out["ranked"][0]["id"] == "L2" and out["ranked"][0]["isOverdue"] is True


async def test_limit_and_cache(seeded):
    llm = ScriptedLLM([ranking("L1", "L2", "L3")])
    first = await run(seeded, llm, limit=2)
    assert len(first["ranked"]) == 2 and first["cached"] is False
    second = await run(seeded, ScriptedLLM([]), limit=2)  # would fail if it called the LLM
    assert second["cached"] is True and second["ranked"] == first["ranked"]
    async with seeded.begin() as conn:  # editing a task changes the signature => cache miss
        await conn.execute(text("UPDATE lists SET priority = 'HIGH' WHERE id = 3"))
    third = await run(seeded, ScriptedLLM([ranking("L1", "L3", "L2")]), limit=2)
    assert third["cached"] is False


async def test_no_open_quests_makes_no_llm_call(engine):
    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO users (discord_id) VALUES ('333')"))
        out = await P.prioritize(conn, "333", lambda **kw: (_ for _ in ()).throw(AssertionError("no LLM")), today=TODAY)
    assert out["ranked"] == [] and out["usedFallback"] is False


async def test_only_own_quests_are_ranked(seeded):
    out = await run(seeded, ScriptedLLM([ranking("L1", "L2", "L3")]))
    assert "L4" not in {r["id"] for r in out["ranked"]}


async def test_endpoint(seeded):
    app = create_app()
    app.dependency_overrides[get_llm_factory] = lambda: factory_for(ScriptedLLM([ranking("L1", "L2", "L3")]))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        r = await c.post("/v1/prioritize", json={"limit": 2}, headers=auth(UID))
        assert r.status_code == 200 and len(r.json()["ranked"]) == 2
        assert (await c.post("/v1/prioritize", json={"limit": 99}, headers=auth(UID))).status_code == 422
        assert (await c.post("/v1/prioritize", json={})).status_code == 401
