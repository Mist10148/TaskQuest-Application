"""Structured-output call helper that also surfaces token usage."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.llm import is_blocked
from app.usage import tokens_from


class StructuredOutputError(RuntimeError):
    """The model returned nothing parseable for the requested schema."""


class ContentBlocked(StructuredOutputError):
    """Gemini's safety filters withheld the answer."""


async def structured_call[T: BaseModel](llm: Any, schema: type[T], messages: list) -> tuple[T, tuple[int, int]]:
    """Run ``llm.with_structured_output(schema, include_raw=True)``; return (parsed, (in_tokens, out_tokens))."""
    runnable = llm.with_structured_output(schema, include_raw=True)
    result = await runnable.ainvoke(messages)
    if isinstance(result, dict) and "parsed" in result:
        parsed, raw = result["parsed"], result.get("raw")
    else:
        parsed, raw = result, None
    if parsed is None and raw is not None and is_blocked(raw):
        raise ContentBlocked("model output was blocked by safety filters")
    if parsed is None:
        raise StructuredOutputError("model returned no structured output")
    if isinstance(parsed, dict):
        parsed = schema.model_validate(parsed)
    return parsed, tokens_from(raw)
