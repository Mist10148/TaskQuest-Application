"""Structured JSON logs with a request id, and optional LangSmith tracing.

Task text is never logged: log lines carry ids, counts, token usage and timings only.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import time
import uuid

from fastapi import FastAPI, Request

from app.config import Settings

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "t": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": request_id_var.get(),
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info).splitlines()[-1]  # type only, no data dump
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(settings: Settings) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(settings.log_level)


def configure_tracing(settings: Settings) -> bool:
    """Enable LangSmith only when a key is configured (graph-level traces for development and evals)."""
    if not settings.langsmith_api_key:
        return False
    os.environ.setdefault("LANGSMITH_TRACING", "true")
    os.environ.setdefault("LANGSMITH_API_KEY", settings.langsmith_api_key)
    os.environ.setdefault("LANGSMITH_PROJECT", "taskquest-ai")
    return True


def add_request_logging(app: FastAPI) -> None:
    log = logging.getLogger("taskquest.ai.http")

    @app.middleware("http")
    async def _log_requests(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        token = request_id_var.set(rid)
        started = time.monotonic()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        log.info(
            "%s %s -> %d in %dms",
            request.method,
            request.url.path,
            response.status_code,
            (time.monotonic() - started) * 1000,
        )
        response.headers["X-Request-Id"] = rid
        return response
