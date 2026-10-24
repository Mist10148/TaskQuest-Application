"""List ids are 32-bit INTEGER columns: a larger id must be a 422, never a database error."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.routers.internal import IndexBody
from app.routers.v1 import SummaryBody

BIG = 2_147_483_648


def test_summary_list_id_has_an_upper_bound():
    assert SummaryBody(mode="list", listId=2_147_483_647).listId == 2_147_483_647
    with pytest.raises(ValidationError):
        SummaryBody(mode="list", listId=BIG)


def test_index_list_id_has_bounds():
    assert IndexBody(discordId="123", listId=None).listId is None
    assert IndexBody(discordId="123", listId=7).listId == 7
    for bad in (0, -1, BIG):
        with pytest.raises(ValidationError):
            IndexBody(discordId="123", listId=bad)


def test_tool_ids_past_32_bits_are_a_refusal_not_a_driver_error():
    from app.tools.specs import _parse_id
    from app.tools.web_client import ToolError

    assert _parse_id("L2147483647", "L") == 2_147_483_647
    assert _parse_id("42", "L") == 42
    with pytest.raises(ToolError):
        _parse_id("L99999999999", "L")


def test_repair_tool_calls_answers_dangling_calls_only():
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    from app.graphs.chat import repair_tool_calls

    dangling = AIMessage(content="", tool_calls=[{"name": "add_item", "args": {}, "id": "c1"}])
    answered = AIMessage(content="", tool_calls=[{"name": "get_list", "args": {}, "id": "c2"}])
    history = [
        HumanMessage("add milk"),
        dangling,
        HumanMessage("hello?"),
        answered,
        ToolMessage(content="ok", tool_call_id="c2"),
        AIMessage("done"),
    ]
    fixed = repair_tool_calls(history)
    assert [type(m).__name__ for m in fixed] == [
        "HumanMessage", "AIMessage", "ToolMessage", "HumanMessage", "AIMessage", "ToolMessage", "AIMessage",
    ]
    assert fixed[2].tool_call_id == "c1"
    assert repair_tool_calls(fixed) == fixed  # nothing left to repair
    assert repair_tool_calls([]) == []
