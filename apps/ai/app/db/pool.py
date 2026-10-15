"""Async SQLAlchemy engine. The service never runs DDL: the Node migrations own the schema."""

from __future__ import annotations

import ssl
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None

_PG_EPOCH = datetime(2000, 1, 1)


def ssl_context(settings: Settings) -> ssl.SSLContext | None:
    """TLS settings matching packages/shared/src/db/pool.js (DB_SSL, DB_SSL_CA, DB_SSL_REJECT_UNAUTHORIZED)."""
    if not settings.db_ssl:
        return None
    # DB_SSL_CA holds PEM contents, not a path; hosts often store newlines escaped.
    cadata = settings.db_ssl_ca.replace("\\n", "\n") if settings.db_ssl_ca else None
    ctx = ssl.create_default_context(cadata=cadata)
    if not settings.db_ssl_reject_unauthorized:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


# ── asyncpg codecs ───────────────────────────────────────────────────────────
# The code works in naive UTC datetimes (what Express stores and what SQLite returns in tests). asyncpg would read
# a naive datetime as LOCAL time and return aware ones, so timestamptz is (de)coded here as naive UTC, and DATE
# accepts the ISO strings the code passes as well as date objects.


def encode_timestamptz(value: datetime | str) -> tuple[int]:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    delta = value - _PG_EPOCH
    return ((delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds,)


def decode_timestamptz(value: tuple[int]) -> datetime:
    return _PG_EPOCH + timedelta(microseconds=value[0])


def encode_date(value: date | str) -> str:
    return value.isoformat() if isinstance(value, date) else str(value)[:10]


def decode_date(value: str) -> date:
    return date.fromisoformat(value)


async def _setup_connection(conn: Any) -> None:
    await conn.execute("SET TIME ZONE 'UTC'")
    await conn.set_type_codec(
        "timestamptz", schema="pg_catalog", encoder=encode_timestamptz, decoder=decode_timestamptz, format="tuple"
    )
    await conn.set_type_codec("date", schema="pg_catalog", encoder=encode_date, decoder=decode_date, format="text")


def _on_connect(dbapi_connection: Any, _record: Any) -> None:
    dbapi_connection.run_async(_setup_connection)


def make_engine(settings: Settings) -> AsyncEngine:
    url = settings.sqlalchemy_url
    if url.startswith("sqlite"):
        return create_async_engine(url)
    connect_args: dict = {}
    ctx = ssl_context(settings)
    if ctx is not None:
        connect_args["ssl"] = ctx
    engine = create_async_engine(url, connect_args=connect_args, pool_size=settings.db_pool_size, pool_pre_ping=True)
    event.listen(engine.sync_engine, "connect", _on_connect)
    return engine


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = make_engine(get_settings())
    return _engine


def set_engine(engine: AsyncEngine | None) -> None:
    """Swap the engine (tests use in-memory SQLite)."""
    global _engine
    _engine = engine


@asynccontextmanager
async def connection():
    """A connection whose transaction commits on success and rolls back on error."""
    async with get_engine().begin() as conn:
        yield conn


async def ping() -> bool:
    async with get_engine().connect() as conn:
        await conn.execute(text("SELECT 1"))
    return True
