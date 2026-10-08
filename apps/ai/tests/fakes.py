"""Scripted stand-ins for Gemini so every test runs offline."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

import numpy as np
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk


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


DIM = 64


class FakeEmbedder:
    """Deterministic bag-of-words embedder: shared words => higher cosine. Counts calls."""

    def __init__(self):
        self.doc_calls = 0
        self.texts: list[str] = []

    @staticmethod
    def _vec(t: str) -> list[float]:
        v = np.zeros(DIM)
        for w in t.lower().split():
            w = w.strip(":-[]()\"'.,;")
            if len(w) > 2:
                v[int(hashlib.md5(w.encode()).hexdigest(), 16) % DIM] += 1
        return v.tolist()

    async def aembed_documents(self, texts, **kwargs):
        self.doc_calls += 1
        self.texts += texts
        return [self._vec(t) for t in texts]

    async def aembed_query(self, t, **kwargs):
        return self._vec(t)


class FakeChatLLM(GenericFakeChatModel):
    """Chat model with scripted replies (``messages``) and scripted structured outputs (``structured``)."""

    structured: list[Any] = []

    def bind_tools(self, tools, **kwargs):
        return self

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        """Stream text word by word; tool calls (and empty text) arrive as a single chunk."""
        msg = self._generate(messages, stop=stop, run_manager=run_manager, **kwargs).generations[0].message
        text = msg.content if isinstance(msg.content, str) else ""
        if msg.tool_calls or not text:
            chunks = [
                {"name": c["name"], "args": json.dumps(c["args"]), "id": c["id"], "index": i}
                for i, c in enumerate(msg.tool_calls)
            ]
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content=text, id=msg.id, tool_call_chunks=chunks, usage_metadata=msg.usage_metadata
                )
            )
            return
        parts = [p for p in re.split(r"(\s+)", text) if p]
        for i, part in enumerate(parts):
            last = i == len(parts) - 1
            yield ChatGenerationChunk(
                message=AIMessageChunk(content=part, id=msg.id, usage_metadata=msg.usage_metadata if last else None)
            )

    def with_structured_output(self, schema, include_raw: bool = False, **kwargs):
        script = ScriptedLLM([])
        script.responses = self.structured  # share the list so pops persist across calls
        return script.with_structured_output(schema, include_raw=include_raw)
