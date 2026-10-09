"""Async SQLAlchemy engine. The service never runs DDL: the Node migrations own the schema."""

from __future__ import annotations

import ssl
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None


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


def make_engine(settings: Settings) -> AsyncEngine:
    url = settings.sqlalchemy_url
    if url.startswith("sqlite"):
        return create_async_engine(url)
    connect_args: dict = {}
    ctx = ssl_context(settings)
    if ctx is not None:
        connect_args["ssl"] = ctx
    return create_async_engine(url, connect_args=connect_args, pool_size=settings.db_pool_size, pool_pre_ping=True)


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
