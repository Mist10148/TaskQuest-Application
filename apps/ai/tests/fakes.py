"""Scripted stand-ins for Gemini so every test runs offline."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage


class ScriptedLLM:
    """Pops one scripted response per structured call. Exceptions in the script are raised."""

    def __init__(self, responses: list[Any]):
        self.responses = list(responses)
        self.calls: list[list] = []  # messages of each call

    def with_structured_output(self, schema, include_raw: bool = False, **kwargs):
        outer = self

        class _Runnable:
            async def ainvoke(self, messages, *a, **kw):
                outer.calls.append(messages)
                if not outer.responses:
                    raise AssertionError("ScriptedLLM ran out of responses")
                item = outer.responses.pop(0)
                if isinstance(item, Exception):
                    raise item
                raw = AIMessage(content="", usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15})
                return {"parsed": item, "raw": raw, "parsing_error": None} if include_raw else item

        return _Runnable()

    def last_text(self) -> str:
        return "\n".join(str(m.content) for m in self.calls[-1])
