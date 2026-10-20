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
