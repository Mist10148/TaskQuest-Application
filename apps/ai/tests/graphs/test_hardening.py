"""Concurrency, quota and opt-out guarantees of the AI service (the shared gate in deps.require_ai)."""

from __future__ import annotations

import asyncio
import contextlib

import httpx
import pytest
from langchain_core.messages import AIMessage
from sqlalchemy import text

from app import chat_service, usage
from app.config import get_settings
from app.db import pool
from app.graphs.chat import RouterOut
from app.graphs.prioritize import RankedItem, RankingOut
from app.llm import get_llm_factory
from app.locks import KeyedLocks
from app.main import create_app
from app.routers import chat as chat_router
from tests.conftest import UID, auth
from tests.fakes import ScriptedLLM
from tests.graphs.test_chat import call, collect, deps_for, http, make_llm, make_web, parse_sse  # noqa: F401 - fixture
from tests.graphs.test_converse import CHANNEL


async def usage_row(feature: str = "chat") -> tuple[int, int, int]:
    async with pool.get_engine().connect() as conn:
        row = (
            await conn.execute(
                text(
                    "SELECT COALESCE(SUM(requests), 0), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) "
                    "FROM ai_usage WHERE feature = :f"
                ),
                {"f": feature},
            )
        ).one()
    return int(row[0]), int(row[1]), int(row[2])


# ── the shared gate: ai_enabled + quota ──────────────────────────────────────


async def test_opted_out_users_are_refused_on_every_model_route(seeded):
    async with pool.connection() as conn:
        await conn.execute(text("UPDATE users SET ai_enabled = 0 WHERE discord_id = :u"), {"u": UID})
    app = create_app()
    app.dependency_overrides[get_llm_factory] = lambda: lambda **kw: ScriptedLLM([])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        for path, body in (
            ("/v1/chat", {"message": "hi"}),
            ("/v1/chat/00000000-0000-0000-0000-000000000000/resume", {"approved": True}),
            ("/v1/converse", {"channelId": CHANNEL, "message": "hi"}),
            ("/v1/summary", {"mode": "digest"}),
            ("/v1/prioritize", {}),
        ):
            r = await c.post(path, json=body, headers=auth())
            assert r.status_code == 403 and r.json()["code"] == "AI_OPTED_OUT", path
    assert await usage_row("chat") == (0, 0, 0) and await usage_row("summary") == (0, 0, 0)


async def test_quota_reservation_is_atomic_under_concurrency(seeded, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_daily_request_limit", 3)

    async def attempt() -> bool:
        try:
            async with pool.connection() as conn:
                await usage.reserve(conn, UID, "chat")
            return True
        except usage.QuotaExceeded:
            return False

    results = await asyncio.gather(*(attempt() for _ in range(10)))
    assert sum(results) == 3, "exactly the limit gets through, however the requests interleave"
    assert await usage_row("chat") == (3, 0, 0), "rejected attempts leave nothing booked"


async def test_requests_are_reserved_up_front_and_refunded_when_rejected(http):  # noqa: F811
    async with http(make_llm([AIMessage("Hello!")], [RouterOut(intent="chitchat")])) as c:
        bad = await c.post("/v1/chat", json={"threadId": "nope", "message": "x"}, headers=auth())
        assert bad.status_code == 404
        assert await usage_row() == (0, 0, 0), "a rejected call costs nothing"
        ok = await c.post("/v1/chat", json={"message": "hi"}, headers=auth())
        assert ok.status_code == 200
        requests, _, _ = await usage_row()
        assert requests == 1, "one request per turn, counted once"


# ── chat concurrency ─────────────────────────────────────────────────────────


async def pending_thread(c):
    events = parse_sse((await c.post("/v1/chat", json={"message": "complete problems 1-10"}, headers=auth())).text)
    assert any(k == "confirm" for k, _ in events)
    return events[-1][1]["threadId"]


async def test_chat_returns_409_while_a_confirmation_is_pending(http):  # noqa: F811
    llm = make_llm([call("complete_item", {"item_id": "I1"}), AIMessage("All done.")], [RouterOut(intent="action")])
    async with http(llm, make_web()) as c:
        thread_id = await pending_thread(c)
        before = await usage_row()
        r = await c.post("/v1/chat", json={"threadId": thread_id, "message": "also this"}, headers=auth())
        assert r.status_code == 409
        assert await usage_row() == before, "the rejected message is refunded"


async def test_a_double_approve_runs_the_write_once(http):  # noqa: F811
    calls: list = []
    llm = make_llm([call("complete_item", {"item_id": "I1"}), AIMessage("All done.")], [RouterOut(intent="action")])
    async with http(llm, make_web(calls=calls)) as c:
        thread_id = await pending_thread(c)
        url = f"/v1/chat/{thread_id}/resume"
        first, second = await asyncio.gather(
            c.post(url, json={"approved": True}, headers=auth()), c.post(url, json={"approved": True}, headers=auth())
        )
        assert len(calls) == 1, "the confirmed write must happen exactly once"
        assert sorted([first.status_code, second.status_code]) in ([200, 200], [200, 409])
        losers = [r for r in (first, second) if r.status_code == 200 and "Nothing is waiting" in r.text]
        assert len(losers) <= 1


async def test_a_disconnecting_client_still_pays_for_the_tokens_spent(seeded):
    deps = deps_for(make_llm([AIMessage("A long answer that nobody will read.")], [RouterOut(intent="chitchat")]))
    deps.tokens[:] = [7, 3]  # what the model already spent before the client went away
    stream = chat_service.stream_turn(deps, UID, "t-gone", chat_service.user_input(UID, "hello"))
    await stream.__anext__()  # the client reads one event ...
    await stream.aclose()  # ... then disconnects
    requests, tokens_in, tokens_out = await usage_row()
    assert tokens_in >= 7 and tokens_out >= 3
    async with pool.get_engine().connect() as conn:
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_chat_threads"))).scalar() == 0  # touch only updates


async def test_concurrent_first_messages_create_one_discord_thread(seeded):
    llm = make_llm([AIMessage("one"), AIMessage("two")], [RouterOut(intent="chitchat")] * 2)
    results = await asyncio.gather(
        chat_service.converse_turn(deps_for(llm), UID, CHANNEL, "first"),
        chat_service.converse_turn(deps_for(llm), UID, CHANNEL, "second"),
    )
    assert {r["reply"] for r in results} == {"one", "two"}
    async with pool.get_engine().connect() as conn:
        assert (await conn.execute(text("SELECT COUNT(*) FROM ai_chat_threads"))).scalar() == 1


async def test_keyed_locks_serialise_and_clean_up():
    locks = KeyedLocks()
    order: list[str] = []

    async def worker(name: str, key: str):
        async with locks.hold(key):
            order.append(f"{name}-in")
            await asyncio.sleep(0.01)
            order.append(f"{name}-out")

    await asyncio.gather(worker("a", "k"), worker("b", "k"), worker("c", "other"))
    assert order.index("a-out") < order.index("b-in") or order.index("b-out") < order.index("a-in")
    assert len(locks) == 0, "entries are dropped when nobody holds or waits"
    with contextlib.suppress(RuntimeError):
        async with locks.hold("k"):
            raise RuntimeError
    assert len(locks) == 0


# ── no database connection across model calls ────────────────────────────────


@pytest.fixture
def open_connections(monkeypatch):
    """Counts pool.connection() contexts that are open right now."""
    state = {"open": 0}
    real = pool.connection

    @contextlib.asynccontextmanager
    async def tracked():
        state["open"] += 1
        try:
            async with real() as conn:
                yield conn
        finally:
            state["open"] -= 1

    monkeypatch.setattr(pool, "connection", tracked)
    return state


class WatchingLLM(ScriptedLLM):
    """Records how many pooled connections were open each time the model is called."""

    def __init__(self, responses, state):
        super().__init__(responses)
        self.state = state
        self.open_at_call: list[int] = []

    def with_structured_output(self, schema, include_raw: bool = False, **kwargs):
        inner = super().with_structured_output(schema, include_raw=include_raw, **kwargs)
        outer = self

        class _Wrapped:
            async def ainvoke(self, messages, *a, **kw):
                outer.open_at_call.append(outer.state["open"])
                return await inner.ainvoke(messages, *a, **kw)

        return _Wrapped()


async def test_summary_and_prioritize_hold_no_connection_while_the_model_runs(seeded, open_connections):
    from app.chains.summarize import Summary

    summary_llm = WatchingLLM([Summary(headline="ok", referenced_ids=["L1"])], open_connections)
    rank = RankingOut(
        ranked=[RankedItem(id=i, rank=n, reason="r") for n, i in enumerate(("L1", "L2", "L3"), 1)], focus_message="Go"
    )
    rank_llm = WatchingLLM([rank], open_connections)
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        app.dependency_overrides[get_llm_factory] = lambda: lambda **kw: summary_llm
        assert (await c.post("/v1/summary", json={"mode": "list", "listId": 1}, headers=auth())).status_code == 200
        app.dependency_overrides[get_llm_factory] = lambda: lambda **kw: rank_llm
        assert (await c.post("/v1/prioritize", json={}, headers=auth())).status_code == 200
    assert summary_llm.open_at_call == [0] and rank_llm.open_at_call == [0]
    assert chat_router  # imported for its side effects on the shared app wiring


# ── confirm previews ─────────────────────────────────────────────────────────


async def test_create_list_preview_shows_every_field_and_subtask(seeded):
    from app.tools.specs import TOOLS
    from tests.graphs.test_tools import ctx

    spec = TOOLS["create_list"]
    args = spec.args(
        name="Trip",
        category="Travel",
        priority="HIGH",
        deadline="2030-06-01",
        description="Two weeks away",
        items=["Book flights", "Pack bags", "Rent car"],
    )
    preview = await spec.preview(ctx(), args)
    for expected in ("Trip", "Travel", "HIGH", "2030-06-01", "Two weeks away", "1. Book flights", "3. Rent car"):
        assert expected in preview
    assert "Subtasks (3)" in preview

    add = TOOLS["add_item"]
    text_ = await add.preview(ctx(), add.args(list_id="L1", name="Extra", description="with notes"))
    assert "Extra" in text_ and "Math homework" in text_ and "with notes" in text_


async def test_requests_failing_validation_or_erroring_early_spend_nothing(seeded):
    """The quota is reserved before the body is validated; the gate must hand it back on any early failure."""
    app = create_app()
    app.dependency_overrides[get_llm_factory] = lambda: lambda **kw: ScriptedLLM([])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        for path, body, feature in (
            ("/v1/summary", {"mode": "bogus"}, "summary"),
            ("/v1/prioritize", {"limit": 999}, "prioritize"),
            ("/v1/converse", {"channelId": "not-a-channel", "message": "hi"}, "chat"),
            ("/v1/chat", {"message": ""}, "chat"),
        ):
            r = await c.post(path, json=body, headers=auth())
            assert r.status_code == 422, path
            assert await usage_row(feature) == (0, 0, 0), path
        # a list that is not theirs: 404 from the chain, refunded exactly once (never below zero for a neighbour)
        r = await c.post("/v1/summary", json={"mode": "list", "listId": 4}, headers=auth())
        assert r.status_code == 404
        assert await usage_row("summary") == (0, 0, 0)


async def test_a_failed_model_call_refunds_once_and_keeps_earlier_requests(seeded):
    """The chain and the gate both used to refund, so one failure erased another request's booking."""

    def broken_factory():
        raise RuntimeError("provider down")

    async with pool.connection() as conn:
        await usage.reserve(conn, UID, "summary")  # an earlier, successful request
    app = create_app()
    app.dependency_overrides[get_llm_factory] = lambda: broken_factory
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://ai") as c:
        r = await c.post("/v1/summary", json={"mode": "digest"}, headers=auth())
        assert r.status_code >= 500
    assert (await usage_row("summary"))[0] == 1
