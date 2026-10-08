"""FastAPI application: private AI service behind the Express web server."""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import pool
from app.llm import AIUnavailable
from app.observability import add_request_logging, configure_logging, configure_tracing
from app.routers import chat, internal, v1
from app.usage import QuotaExceeded

log = logging.getLogger("taskquest.ai")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings)
    configure_tracing(settings)
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

    add_request_logging(app)

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

    @app.exception_handler(QuotaExceeded)
    async def _quota(request: Request, exc: QuotaExceeded):
        return JSONResponse(
            status_code=429,
            content={"error": "Daily AI energy used up. It resets at midnight UTC.", "code": "AI_QUOTA"},
        )

    @app.exception_handler(AIUnavailable)
    async def _unavailable(request: Request, exc: AIUnavailable):
        return JSONResponse(status_code=503, content={"error": "AI is not available.", "code": "AI_UNAVAILABLE"})

    app.include_router(v1.router)
    app.include_router(chat.router)
    app.include_router(internal.router)
    return app


app = create_app()
