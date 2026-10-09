"""Runs the eval suites offline (fake models) so CI catches a broken pipeline or golden set.

These do not measure model quality; run ``python -m tests.evals.run --live`` for that.
"""

from __future__ import annotations

import pytest

from tests.evals.run import SUITES, run_suites
from tests.evals.seed import load_json


@pytest.mark.parametrize("suite", SUITES)
async def test_offline_suite_passes(suite):
    (result,) = await run_suites([suite])
    assert result.passed, result.to_dict()


def test_golden_sets_only_reference_seeded_keys():
    seed = load_json("seed.json")
    keys = set()
    for user in seed["users"].values():
        for lst in user["lists"]:
            keys.add(f"list:{lst['key']}")
            keys |= {f"item:{i['key']}" for i in lst.get("items", []) if i.get("key")}
    refs = [r for q in load_json("retrieval.json")["queries"] for r in q["relevant"] if not r.startswith("doc:")]
    for case in load_json("summary.json")["cases"]:
        refs += case["must_mention"] + case["must_not_mention"]
        if case.get("list"):
            refs.append(f"list:{case['list']}")
    refs += [r for case in load_json("prioritize.json")["cases"] for r in case["gold_top3"]]
    assert set(refs) <= keys, sorted(set(refs) - keys)
