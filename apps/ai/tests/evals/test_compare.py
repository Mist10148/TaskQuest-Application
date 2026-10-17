"""The report comparer, on canned reports (no model, no database)."""

from __future__ import annotations

import json

import pytest

from tests.evals import compare as C


def report(mode="live", retrieval=None, summary=None, prioritize=None):
    def suite(name, metrics):
        return {"suite": name, "passed": True, "metrics": metrics, "thresholds": {}, "failures": []}

    return {
        "mode": mode,
        "results": [
            suite("retrieval", retrieval or {"recall_at_k": 0.9, "mrr": 0.7, "leaks": 0, "queries": 50}),
            suite("summary", summary or {"faithful_rate": 1.0, "coverage": 0.9, "violations": 0}),
            suite("prioritize", prioritize or {"top3_agreement": 0.85, "top1_accuracy": 0.7, "valid_id_rate": 1.0, "cases": 6}),
        ],
    }


def levels(findings):
    return {f.text.split(" = ")[0].split(":")[0]: f.level for f in findings}


def test_a_report_that_meets_every_live_target_passes():
    findings = C.check_report(report())
    assert [f for f in findings if f.level == "fail"] == []
    assert "retrieval.recall_at_k = 0.9 (target >= 0.85)" in [f.text for f in findings]


def test_each_missed_target_fails_with_the_number_and_the_bound():
    findings = C.check_report(
        report(
            retrieval={"recall_at_k": 0.8, "leaks": 1},
            summary={"faithful_rate": 0.95, "coverage": 0.9, "violations": 0},
            prioritize={"top3_agreement": 0.5, "valid_id_rate": 0.9},
        )
    )
    failed = {f.text.split(" = ")[0] for f in findings if f.level == "fail"}
    assert failed == {
        "retrieval.recall_at_k",
        "retrieval.leaks",
        "summary.faithful_rate",
        "prioritize.top3_agreement",
        "prioritize.valid_id_rate",
    }
    leak = next(f for f in findings if f.text.startswith("retrieval.leaks"))
    assert "target <= 0" in leak.text


def test_an_offline_report_is_flagged_and_judged_by_the_live_targets_not_its_own():
    findings = C.check_report(report(mode="offline", retrieval={"recall_at_k": 0.75, "leaks": 0}))
    assert any(f.level == "warn" and "offline report" in f.text for f in findings)
    assert any(f.level == "fail" and f.text.startswith("retrieval.recall_at_k") for f in findings), "0.75 passes offline, not live"


def test_latency_and_the_judge_are_only_checked_when_they_were_measured():
    plain = C.check_report(report())
    assert not any("p95_latency_s" in f.text and f.level != "warn" for f in plain)
    assert any(f.level == "warn" and "p95_latency_s" in f.text for f in plain)

    judged = C.check_report(report(summary={"faithful_rate": 1.0, "coverage": 0.9, "violations": 0, "p95_latency_s": 6.5, "judge_faithful_rate": 0.8}))
    assert {f.text.split(" = ")[0] for f in judged if f.level == "fail"} == {"summary.p95_latency_s", "summary.judge_faithful_rate"}


def test_a_missing_suite_is_a_warning():
    partial = report()
    partial["results"] = [r for r in partial["results"] if r["suite"] != "summary"]
    findings = C.check_report(partial)
    assert any(f.level == "warn" and f.text.startswith("summary: not in the report") for f in findings)


def test_regressions_against_a_baseline_beyond_the_tolerance():
    before = report()
    after = report(
        retrieval={"recall_at_k": 0.87, "mrr": 0.6, "leaks": 0},  # recall -0.03 (over 0.02), mrr -0.1
        summary={"faithful_rate": 1.0, "coverage": 0.89, "violations": 1},  # coverage -0.01 (fine), a new violation
        prioritize={"top3_agreement": 0.9, "top1_accuracy": 0.7, "valid_id_rate": 1.0, "cases": 6},  # better
    )
    findings = C.compare(after, before)
    regressions = {f.text.split(":")[0] for f in findings if f.level == "fail"}
    assert regressions == {"retrieval.recall_at_k", "retrieval.mrr", "summary.violations"}
    assert any(f.level == "ok" and f.text.startswith("prioritize.top3_agreement") for f in findings)


def test_latency_has_its_own_relative_tolerance():
    base = report(summary={"faithful_rate": 1.0, "coverage": 0.9, "violations": 0, "p95_latency_s": 2.0})
    slower = report(summary={"faithful_rate": 1.0, "coverage": 0.9, "violations": 0, "p95_latency_s": 2.4})
    much = report(summary={"faithful_rate": 1.0, "coverage": 0.9, "violations": 0, "p95_latency_s": 3.0})
    assert [f for f in C.compare(slower, base) if f.level == "fail"] == [], "+20% is inside the 25% allowance"
    assert [f.text.split(":")[0] for f in C.compare(much, base) if f.level == "fail"] == ["summary.p95_latency_s"]


def test_case_counts_and_unmatched_metrics_are_not_compared():
    before = report(prioritize={"top3_agreement": 0.85, "valid_id_rate": 1.0, "cases": 6})
    after = report(prioritize={"top3_agreement": 0.85, "valid_id_rate": 1.0, "cases": 12})
    assert C.compare(after, before) == [] or all(f.level == "ok" for f in C.compare(after, before))
    assert not any("cases" in f.text for f in C.compare(after, before))


def test_the_command_reads_files_and_sets_the_exit_code(tmp_path, capsys):
    good, bad, base = tmp_path / "good.json", tmp_path / "bad.json", tmp_path / "base.json"
    good.write_text(json.dumps(report()), encoding="utf-8")
    bad.write_text(json.dumps(report(retrieval={"recall_at_k": 0.5, "leaks": 0})), encoding="utf-8")
    base.write_text(json.dumps(report()), encoding="utf-8")

    assert C.main([str(good)]) == 0
    assert "All live targets met." in capsys.readouterr().out
    assert C.main([str(bad)]) == 1
    assert "FAIL  retrieval.recall_at_k" in capsys.readouterr().out
    assert C.main([str(bad), "--baseline", str(base)]) == 1
    assert C.main([str(good), "--baseline", str(base)]) == 0


def test_a_file_that_is_not_a_report_is_refused(tmp_path):
    junk = tmp_path / "junk.json"
    junk.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(ValueError, match="not an eval report"):
        C.load_report(junk)
