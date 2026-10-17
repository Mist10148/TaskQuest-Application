"""The pre-flight checks for the first live Gemini run: configuration, models and /health, without a network or a database."""

from __future__ import annotations

import pytest

from app import preflight as P
from app.config import Settings


def settings(**over) -> Settings:
    base = dict(
        gemini_api_key="k" * 30,
        ai_internal_token="t" * 40,
        db_url="postgresql://u:p@localhost/db",
        _env_file=None,
    )
    return Settings(**{**base, **over})


def by_name(checks):
    return {c.name: c for c in checks}


# ── configuration ─────────────────────────────────────────────────────────────────


def test_a_complete_configuration_passes():
    checks = P.check_config(settings())
    assert [c for c in checks if c.status != "ok"] == []
    assert P.exit_code(checks) == 0


def test_a_missing_key_token_or_model_fails_with_a_reason():
    checks = by_name(P.check_config(settings(gemini_api_key="", ai_internal_token="short", gemini_chat_model=" ")))
    assert checks["GEMINI_API_KEY"].status == "fail"
    assert checks["AI_INTERNAL_TOKEN"].status == "fail" and "5 characters" in checks["AI_INTERNAL_TOKEN"].detail
    assert checks["GEMINI_CHAT_MODEL"].status == "fail"
    assert P.exit_code(list(checks.values())) == 1

    empty_token = by_name(P.check_config(settings(ai_internal_token="")))
    assert empty_token["AI_INTERNAL_TOKEN"].status == "fail"


def test_sqlite_is_only_a_warning_and_a_zero_limit_is_a_failure():
    checks = by_name(P.check_config(settings(db_url="sqlite+aiosqlite://", ai_daily_request_limit=0)))
    assert checks["database"].status == "warn"
    assert checks["AI_DAILY_REQUEST_LIMIT"].status == "fail"


async def test_the_database_check_is_skipped_for_sqlite():
    assert await P.check_database(settings(db_url="sqlite+aiosqlite://")) == []


# ── Google's model list ───────────────────────────────────────────────────────────────


def page(*models, token=None):
    out = {"models": [{"name": f"models/{n}", "supportedGenerationMethods": m} for n, m in models]}
    if token:
        out["nextPageToken"] = token
    return out


CHAT = ("gemini-2.5-flash", ["generateContent"])
PRO = ("gemini-2.5-pro", ["generateContent"])
EMBED = ("gemini-embedding-001", ["embedContent"])


async def test_models_that_exist_pass_and_the_key_goes_in_a_header():
    seen = []

    async def fetch(url, headers):
        seen.append((url, headers))
        return page(CHAT, PRO, EMBED)

    checks = await P.check_models(settings(), fetch)
    assert [c.status for c in checks] == ["ok", "ok", "ok"]
    assert all("k" * 30 not in url for url, _ in seen), "the key is never put in the URL"
    assert seen[0][1] == {"x-goog-api-key": "k" * 30}


async def test_a_retired_model_fails_and_names_alternatives():
    async def fetch(url, headers):
        return page(("gemini-3-flash", ["generateContent"]), PRO, EMBED)

    checks = by_name(await P.check_models(settings(), fetch))
    gone = checks["GEMINI_CHAT_MODEL exists"]
    assert gone.status == "fail" and "gemini-2.5-flash" in gone.detail and "gemini-3-flash" in gone.detail
    assert checks["GEMINI_REASONING_MODEL exists"].status == "ok"


async def test_a_model_that_cannot_do_the_job_fails():
    async def fetch(url, headers):
        return page(CHAT, PRO, ("gemini-embedding-001", ["generateContent"]))

    checks = by_name(await P.check_models(settings(), fetch))
    assert checks["GEMINI_EMBED_MODEL exists"].status == "fail"
    assert "embedContent" in checks["GEMINI_EMBED_MODEL exists"].detail


async def test_the_model_list_is_read_across_pages():
    pages = iter([page(CHAT, token="next"), page(PRO, EMBED)])
    urls = []

    async def fetch(url, headers):
        urls.append(url)
        return next(pages)

    checks = await P.check_models(settings(), fetch)
    assert [c.status for c in checks] == ["ok", "ok", "ok"]
    assert "pageToken=next" in urls[1]


async def test_a_network_error_or_no_key_is_reported_not_raised():
    async def broken(url, headers):
        raise ConnectionError("no route")

    (down,) = await P.check_models(settings(), broken)
    assert down.status == "fail" and "no route" in down.detail
    (nokey,) = await P.check_models(settings(gemini_api_key=""), broken)
    assert nokey.status == "fail" and "GEMINI_API_KEY" in nokey.detail

    async def nothing(url, headers):
        return {}

    (empty,) = await P.check_models(settings(), nothing)
    assert empty.status == "warn"


# ── a running service ─────────────────────────────────────────────────────────────────


async def test_health_checks_the_service_and_that_it_has_the_key():
    async def good(url, headers):
        assert url == "http://localhost:8000/health"
        return {"status": "ok", "database": True, "gemini_configured": True}

    assert [c.status for c in await P.check_health("http://localhost:8000/", good)] == ["ok"]

    async def no_key(url, headers):
        return {"status": "ok", "database": True, "gemini_configured": False}

    assert [c.status for c in await P.check_health("http://localhost:8000", no_key)] == ["ok", "fail"]

    async def degraded(url, headers):
        return {"status": "degraded", "database": False}

    assert [c.status for c in await P.check_health("http://localhost:8000", degraded)] == ["fail"]

    async def refused(url, headers):
        raise ConnectionRefusedError("refused")

    (down,) = await P.check_health("http://localhost:8000", refused)
    assert down.status == "fail" and "refused" in down.detail


# ── the report ────────────────────────────────────────────────────────────────────────


def test_the_report_lists_every_check_and_the_verdict():
    checks = [P.Check("a", "ok", "fine"), P.Check("longer name", "warn", "hm"), P.Check("c", "fail", "broken")]
    text = P.render(checks)
    assert "ok    a            fine" in text
    assert "warn  longer name  hm" in text
    assert "FAIL  c            broken" in text
    assert "3 checks: 1 failed, 1 warnings" in text and "Ready" not in text
    assert "Ready for the live evals." in P.render([P.Check("a", "ok")])


@pytest.mark.parametrize("status,code", [("ok", 0), ("warn", 0), ("fail", 1)])
def test_warnings_do_not_fail_the_run(status, code):
    assert P.exit_code([P.Check("x", status)]) == code
