"""FastAPI application: private AI service behind the Express web server."""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import FastAPI

from app.config import get_settings
from app.db import pool
from app.routers import internal, v1

log = logging.getLogger("taskquest.ai")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level, format='{"t":"%(asctime)s","lvl":"%(levelname)s","msg":"%(message)s"}'
    )
    tasks: list[asyncio.Task] = []
    if settings.gemini_api_key and not settings.db_url.startswith("sqlite"):
        from app.rag.indexer import reconcile_loop

        tasks.append(asyncio.create_task(reconcile_loop()))
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        engine = pool.get_engine()
        await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="TaskQuest AI", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.get("/health")
    async def health():
        settings = get_settings()
        try:
            await pool.ping()
            db_ok = True
        except Exception:  # noqa: BLE001 - health must never raise
            db_ok = False
        return {
            "status": "ok" if db_ok else "degraded",
            "database": db_ok,
            "gemini_configured": bool(settings.gemini_api_key),
        }

    app.include_router(v1.router)
    app.include_router(internal.router)
    return app


app = create_app()
