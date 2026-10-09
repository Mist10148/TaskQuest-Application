"""Summarizer: modes, id validation + retry, cache, map-reduce, quota, HTTP wiring."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import text

from app import usage
from app.chains import summarize as S
from app.chains.summarize import Summary
from app.config import get_settings
from app.llm import get_llm_factory
from app.main import create_app
from tests.conftest import OTHER, UID, auth
from tests.fakes import ScriptedLLM

TODAY = date.today()


def good(ids=("L1",)):
    return Summary(
        headline="Math is half done",
        highlights=["1 of 2 done"],
        next_steps=["Do problems 1-10"],
        referenced_ids=list(ids),
    )


async def test_list_mode_renders_only_own_data_and_valid_ids(seeded):
    llm = ScriptedLLM([good(["L1", "I1"])])
    async with seeded.begin() as conn:
        out = await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
    assert out["referenced_ids"] == ["L1", "I1"] and out["cached"] is False and out["mode"] == "list"
    prompt = llm.last_text()
    assert "Math homework" in prompt and "Secret plans" not in prompt and "Hidden item" not in prompt


async def test_list_of_another_user_is_not_found(seeded):
    async with seeded.begin() as conn:
        with pytest.raises(S.NotFound):
            await S.summarize(conn, UID, lambda: ScriptedLLM([]), "list", list_id=4)


async def test_invalid_ids_trigger_one_retry_then_are_dropped(seeded):
    llm = ScriptedLLM([good(["L1", "L999"]), good(["L1", "L777"])])
    async with seeded.begin() as conn:
        out = await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
    assert len(llm.calls) == 2
    assert "L999" in llm.last_text()  # retry tells the model what was wrong
    assert out["referenced_ids"] == ["L1"]  # unknown ids never reach the user


async def test_retry_success_keeps_valid_answer(seeded):
    llm = ScriptedLLM([good(["L404"]), good(["L1"])])
    async with seeded.begin() as conn:
        out = await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
    assert out["referenced_ids"] == ["L1"]


async def test_second_identical_call_hits_cache_without_llm_or_quota(seeded):
    llm = ScriptedLLM([good()])
    async with seeded.begin() as conn:
        first = await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
        second = await S.summarize(
            conn, UID, lambda: (_ for _ in ()).throw(AssertionError("no LLM on cache hit")), "list", list_id=1
        )
        assert first["cached"] is False and second["cached"] is True
        assert second["headline"] == first["headline"]
        assert await usage.requests_today(conn, UID) == 1


async def test_changed_input_invalidates_cache(seeded):
    llm = ScriptedLLM([good(), good()])
    async with seeded.begin() as conn:
        await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
        await conn.execute(text("UPDATE items SET completed = 1 WHERE id = 1"))
        again = await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
    assert again["cached"] is False and len(llm.calls) == 2


async def test_digest_lists_open_quests_with_deadline_context(seeded):
    llm = ScriptedLLM([good(["L1", "L2"])])
    async with seeded.begin() as conn:
        out = await S.summarize(conn, UID, lambda: llm, "digest", today=TODAY)
    assert out["mode"] == "digest"
    prompt = llm.last_text()
    assert "Math homework" in prompt and "in 1 days" in prompt and "Clean garage" in prompt
    assert "Problems 11-20" not in prompt  # completed subtasks are left out of the digest


async def test_recap_counts_completions_and_xp(seeded):
    llm = ScriptedLLM([good(["I2"])])
    async with seeded.begin() as conn:
        out = await S.summarize(conn, UID, lambda: llm, "recap", range_="week", today=TODAY)
    assert out["referenced_ids"] == ["I2"]
    assert "XP earned: 25" in llm.last_text() and "Subtasks completed: 1" in llm.last_text()


async def test_nothing_to_summarize_makes_no_llm_call(engine):
    async with engine.begin() as conn:
        await conn.execute(text("INSERT INTO users (discord_id) VALUES ('333')"))
        out = await S.summarize(conn, "333", lambda: (_ for _ in ()).throw(AssertionError("no LLM")), "digest")
    assert out["headline"] == "Nothing to summarize yet"


async def test_map_reduce_for_huge_input(seeded, monkeypatch):
    monkeypatch.setattr(get_settings(), "summary_map_reduce_chars", 200)
    async with seeded.begin() as conn:
        rendered = await S.render_input(conn, UID, "digest", today=TODAY)
        n_parts = len(S.split_blocks(rendered.text, 100))
        assert n_parts >= 2
        llm = ScriptedLLM([good(["L1"])] * n_parts + [good(["L1", "L2"])])
        out = await S.summarize(conn, UID, lambda: llm, "digest", today=TODAY)
    assert len(llm.calls) == n_parts + 1 and "Partial summaries" in llm.last_text()
    assert out["referenced_ids"] == ["L1", "L2"]


def test_split_blocks_respects_limit():
    parts = S.split_blocks("a" * 50 + "\n\n" + "b" * 50 + "\n\n" + "c" * 50, 120)
    assert len(parts) == 2 and all(len(p) <= 120 for p in parts)


async def test_quota_blocks_llm_calls(seeded, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 1)
    llm = ScriptedLLM([good(), good()])
    async with seeded.begin() as conn:
        await S.summarize(conn, UID, lambda: llm, "list", list_id=1)
        with pytest.raises(usage.QuotaExceeded):
            await S.summarize(conn, UID, lambda: llm, "list", list_id=2)  # different input, needs the LLM
        row = (await conn.execute(text("SELECT input_tokens, output_tokens FROM ai_usage"))).first()
        assert tuple(row) == (10, 5)  # token accounting from usage_metadata


# ── HTTP ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def app_with_llm(engine):
    app = create_app()

    def install(llm):
        app.dependency_overrides[get_llm_factory] = lambda: lambda: llm
        return app

    return install


async def _post(app, uid, body):
    import httpx

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        return await c.post("/v1/summary", json=body, headers=auth(uid))


async def test_summary_endpoint(seeded, app_with_llm):
    app = app_with_llm(ScriptedLLM([good()]))
    r = await _post(app, UID, {"mode": "list", "listId": 1})
    assert r.status_code == 200 and r.json()["headline"] == "Math is half done"
    assert (await _post(app, UID, {"mode": "list", "listId": 4})).status_code == 404  # not their list
    assert (await _post(app, UID, {"mode": "bogus"})).status_code == 422
    assert (await _post(app, OTHER, {"mode": "list", "listId": 1})).status_code == 404


async def test_summary_endpoint_maps_quota_to_429(seeded, app_with_llm, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 0)
    r = await _post(app_with_llm(ScriptedLLM([good()])), UID, {"mode": "list", "listId": 1})
    assert r.status_code == 429 and r.json()["code"] == "AI_QUOTA"


async def test_chain_passes_braces_in_task_text_through_untouched():
    from app.chains.summarize import Summarizer

    llm = ScriptedLLM([Summary(headline="ok")])
    s = Summarizer(llm)
    out = await s._ask("list", date(2026, 1, 2), "- {weird} quest {L1}")
    assert out.headline == "ok" and s.llm_calls == 1 and s.tokens == [10, 5]
    system, human = llm.calls[0]
    assert system.type == "system" and human.type == "human"
    assert "- {weird} quest {L1}" in human.content and "Today: 2026-01-02" in human.content
