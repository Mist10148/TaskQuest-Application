"""Checks to run before the first live Gemini run (docs/OPERATIONS.md "First live Gemini run").

    python -m app.preflight                          # configuration and database, no network to Google
    python -m app.preflight --check-models           # also asks Google which model ids exist (needs GEMINI_API_KEY)
    python -m app.preflight --url http://localhost:8000   # also calls a running service's /health

It prints one line per check (ok / warn / FAIL) and exits 1 when anything failed, so a deploy script can stop on it. It
costs no model quota: ``--check-models`` only lists models. Nothing here writes to the database.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from sqlalchemy import text

from app.config import Settings, get_settings
from app.db import pool

Status = Literal["ok", "warn", "fail"]

# What the service reads and writes. A table missing here means a migration has not run (003 added ai_prioritize_cache).
REQUIRED_TABLES = (
    "users",
    "lists",
    "items",
    "ai_embeddings",
    "ai_usage",
    "ai_summary_cache",
    "ai_prioritize_cache",
    "ai_chat_threads",
    "ai_checkpoints",
    "ai_checkpoint_writes",
)

MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"


@dataclass(frozen=True)
class Check:
    name: str
    status: Status
    detail: str = ""


def _ok(name: str, detail: str = "") -> Check:
    return Check(name, "ok", detail)


def _warn(name: str, detail: str) -> Check:
    return Check(name, "warn", detail)


def _fail(name: str, detail: str) -> Check:
    return Check(name, "fail", detail)


# ── pure checks on the configuration ──────────────────────────────────────────────


def check_config(settings: Settings) -> list[Check]:
    """Everything that can be decided from the environment alone."""
    checks: list[Check] = []

    if settings.gemini_api_key.strip():
        checks.append(_ok("GEMINI_API_KEY", "set"))
    else:
        checks.append(_fail("GEMINI_API_KEY", "empty: the service answers 'AI unavailable' to every model call"))

    for label, value in (
        ("GEMINI_CHAT_MODEL", settings.gemini_chat_model),
        ("GEMINI_REASONING_MODEL", settings.gemini_reasoning_model),
        ("GEMINI_EMBED_MODEL", settings.gemini_embed_model),
    ):
        if value.strip():
            checks.append(_ok(label, value))
        else:
            checks.append(_fail(label, "empty"))

    if settings.embed_dim > 0:
        checks.append(_ok("EMBED_DIM", str(settings.embed_dim)))
    else:
        checks.append(_fail("EMBED_DIM", "must be a positive number"))

    token = settings.ai_internal_token
    if len(token) >= 32:
        checks.append(_ok("AI_INTERNAL_TOKEN", f"{len(token)} characters"))
    elif token:
        checks.append(_fail("AI_INTERNAL_TOKEN", f"only {len(token)} characters: the service refuses to start under 32"))
    else:
        checks.append(_fail("AI_INTERNAL_TOKEN", "empty: the web server and the bot cannot call the service"))

    if settings.sqlalchemy_url.startswith("sqlite"):
        checks.append(_warn("database", "SQLite is for tests only; point DB_URL (or DB_HOST ...) at the staging PostgreSQL"))
    if settings.ai_daily_request_limit <= 0:
        checks.append(_fail("AI_DAILY_REQUEST_LIMIT", "zero or negative: every request would be refused"))
    else:
        checks.append(_ok("AI_DAILY_REQUEST_LIMIT", f"{settings.ai_daily_request_limit} per user per day"))
    return checks


# ── database ───────────────────────────────────────────────────────────────────────


async def check_database(settings: Settings) -> list[Check]:
    """Connect, check the tables the service needs and that the vector column matches EMBED_DIM."""
    if settings.sqlalchemy_url.startswith("sqlite"):
        return []
    checks: list[Check] = []
    try:
        engine = pool.get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            checks.append(_ok("database connection"))
            found = {
                r[0]
                for r in (
                    await conn.execute(
                        text("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
                    )
                ).all()
            }
            missing = [t for t in REQUIRED_TABLES if t not in found]
            if missing:
                checks.append(_fail("tables", f"missing {', '.join(missing)}: run npm run db:migrate"))
            else:
                checks.append(_ok("tables", f"{len(REQUIRED_TABLES)} present"))
            if "ai_embeddings" in found:
                dim = (
                    await conn.execute(
                        text(
                            "SELECT atttypmod FROM pg_attribute "
                            "WHERE attrelid = to_regclass('ai_embeddings') AND attname = 'embedding'"
                        )
                    )
                ).scalar()
                if dim is None:
                    checks.append(_fail("vector column", "ai_embeddings.embedding not found"))
                elif int(dim) != settings.embed_dim:
                    checks.append(
                        _fail(
                            "vector column",
                            f"vector({dim}) in the database but EMBED_DIM={settings.embed_dim}: embeddings would be rejected",
                        )
                    )
                else:
                    checks.append(_ok("vector column", f"vector({dim}) matches EMBED_DIM"))
    except Exception as err:
        checks.append(_fail("database connection", f"{type(err).__name__}: {err}"))
    return checks


# ── Google's model list and a running service ───────────────────────────────────────────

Fetch = Callable[[str, dict[str, str]], Awaitable[dict[str, Any]]]


async def http_get_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else {}


def model_ids(payload_pages: Iterable[dict[str, Any]]) -> dict[str, set[str]]:
    """``{model id: supported generation methods}`` from the pages of a models.list answer."""
    out: dict[str, set[str]] = {}
    for page in payload_pages:
        for m in page.get("models", []):
            name = str(m.get("name", "")).removeprefix("models/")
            if name:
                out[name] = set(m.get("supportedGenerationMethods", []))
    return out


async def check_models(settings: Settings, fetch: Fetch = http_get_json) -> list[Check]:
    """Ask Google which model ids exist for this key, and whether the configured ones can do what the service needs."""
    if not settings.gemini_api_key.strip():
        return [_fail("model list", "needs GEMINI_API_KEY")]
    headers = {"x-goog-api-key": settings.gemini_api_key}  # a header, so the key never lands in a URL or a proxy log
    try:
        pages: list[dict[str, Any]] = []
        url = f"{MODELS_URL}?pageSize=200"
        for _ in range(10):
            page = await fetch(url, headers)
            pages.append(page)
            token = page.get("nextPageToken")
            if not token:
                break
            url = f"{MODELS_URL}?pageSize=200&pageToken={token}"
    except Exception as err:
        return [_fail("model list", f"could not ask Google: {type(err).__name__}: {err}")]
    available = model_ids(pages)
    if not available:
        return [_warn("model list", "Google returned no models for this key")]

    wanted = (
        ("GEMINI_CHAT_MODEL", settings.gemini_chat_model, "generateContent"),
        ("GEMINI_REASONING_MODEL", settings.gemini_reasoning_model, "generateContent"),
        ("GEMINI_EMBED_MODEL", settings.gemini_embed_model, "embedContent"),
    )
    checks: list[Check] = []
    for label, value, method in wanted:
        methods = available.get(value)
        if methods is None:
            hint = ", ".join(sorted(n for n in available if n.startswith("gemini"))[:8])
            checks.append(_fail(f"{label} exists", f"'{value}' is not in Google's list (retired or misspelled). Some that are: {hint}"))
        elif methods and method not in methods:
            checks.append(_fail(f"{label} exists", f"'{value}' does not support {method}"))
        else:
            checks.append(_ok(f"{label} exists", value))
    return checks


async def check_health(url: str, fetch: Fetch = http_get_json) -> list[Check]:
    target = url.rstrip("/") + "/health"
    try:
        body = await fetch(target, {})
    except Exception as err:
        return [_fail("service /health", f"{target}: {type(err).__name__}: {err}")]
    if body.get("status") != "ok":
        return [_fail("service /health", f"{target} says {body}")]
    checks = [_ok("service /health", target)]
    if not body.get("gemini_configured"):
        checks.append(_fail("service has the key", "/health says gemini_configured is false: the running service has no GEMINI_API_KEY"))
    return checks


# ── report ─────────────────────────────────────────────────────────────────────────────

ICONS = {"ok": "ok  ", "warn": "warn", "fail": "FAIL"}


def render(checks: list[Check]) -> str:
    width = max((len(c.name) for c in checks), default=0)
    lines = [f"  {ICONS[c.status]}  {c.name:<{width}}  {c.detail}".rstrip() for c in checks]
    failed = sum(c.status == "fail" for c in checks)
    warned = sum(c.status == "warn" for c in checks)
    lines.append("")
    lines.append(f"{len(checks)} checks: {failed} failed, {warned} warnings" + ("" if failed else ". Ready for the live evals."))
    return "\n".join(lines)


def exit_code(checks: list[Check]) -> int:
    return 1 if any(c.status == "fail" for c in checks) else 0


async def run(settings: Settings, *, models: bool = False, url: str | None = None) -> list[Check]:
    checks = check_config(settings)
    checks += await check_database(settings)
    if models:
        checks += await check_models(settings)
    if url:
        checks += await check_health(url)
    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check-models", action="store_true", help="ask Google which model ids exist (needs the key)")
    parser.add_argument("--url", help="base URL of a running service, e.g. http://localhost:8000")
    args = parser.parse_args(argv)

    async def go() -> list[Check]:
        try:
            return await run(get_settings(), models=args.check_models, url=args.url)
        finally:
            await pool.dispose_engine()  # close what check_database opened

    checks = asyncio.run(go())
    print(render(checks))
    return exit_code(checks)


if __name__ == "__main__":
    sys.exit(main())
