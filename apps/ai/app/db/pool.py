"""Async SQLAlchemy engine. The service never runs DDL: the Node migrations own the schema."""

from __future__ import annotations

import ssl
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None


def make_engine(settings: Settings) -> AsyncEngine:
    url = settings.sqlalchemy_url
    if url.startswith("sqlite"):
        return create_async_engine(url)
    connect_args: dict = {}
    if settings.db_ssl:
        ctx = ssl.create_default_context()
        if not settings.db_ssl_reject_unauthorized:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
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
