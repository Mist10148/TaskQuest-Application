from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel

from app.llm import is_blocked, safety_settings
from app.llm_call import ContentBlocked, StructuredOutputError, structured_call


def test_is_blocked_reads_finish_reason_and_prompt_feedback():
    assert is_blocked(AIMessage("", response_metadata={"finish_reason": "SAFETY"}))
    assert is_blocked(AIMessage("", response_metadata={"finish_reason": "prohibited_content"}))
    assert is_blocked(AIMessage("", response_metadata={"prompt_feedback": {"block_reason": "OTHER"}}))
    assert not is_blocked(AIMessage("hi", response_metadata={"finish_reason": "STOP"}))
    assert not is_blocked(AIMessage("hi"))


def test_safety_settings_cover_every_category():
    assert len(safety_settings()) == 4


class Out(BaseModel):
    x: int


class _RawLLM:
    def __init__(self, raw):
        self.raw = raw

    def with_structured_output(self, schema, include_raw=False):
        raw = self.raw

        class _R:
            async def ainvoke(self, messages):
                return {"parsed": None, "raw": raw, "parsing_error": None}

        return _R()


async def test_structured_call_reports_blocked_output():
    with pytest.raises(ContentBlocked):
        await structured_call(_RawLLM(AIMessage("", response_metadata={"finish_reason": "SAFETY"})), Out, [])
    with pytest.raises(StructuredOutputError) as err:
        await structured_call(_RawLLM(AIMessage("")), Out, [])
    assert not isinstance(err.value, ContentBlocked)
