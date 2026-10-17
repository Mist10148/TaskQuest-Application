"""Judge a saved eval report against the live targets, and against an earlier report.

    python -m tests.evals.compare evals-live.json
    python -m tests.evals.compare evals-live.json --baseline evals-live-before.json

``evals-live.json`` comes from ``python -m tests.evals.run --live --report evals-live.json`` (add ``--judge`` for latency and
the LLM-judged faithfulness). The targets are the ones in apps/ai/README.md and docs/AI_INTEGRATION.md §1, applied here even
to a report whose own thresholds were looser, so an offline report can never pass as a live one. With ``--baseline`` a metric
that got worse by more than the tolerance is reported as a regression. Exit code 1 when anything failed.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from tests.evals.run import JUDGE_THRESHOLD, LIVE_THRESHOLDS, MAX_IS_BETTER, SUITES

Level = Literal["ok", "warn", "fail"]

# A rate may drop this much before it counts as a regression; latency may rise by this share.
RATE_TOLERANCE = 0.02
LATENCY_TOLERANCE = 0.25
NOT_A_QUALITY_METRIC = {"cases", "queries"}


@dataclass(frozen=True)
class Finding:
    level: Level
    text: str


def load_report(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise ValueError(f"{path} is not an eval report (no 'results' list)")
    return data


def _metrics(report: dict[str, Any]) -> dict[str, dict[str, float]]:
    return {r["suite"]: dict(r.get("metrics", {})) for r in report["results"]}


def _bound(suite: str, metric: str) -> float | None:
    if metric == "judge_faithful_rate":
        return JUDGE_THRESHOLD
    return LIVE_THRESHOLDS.get(suite, {}).get(metric)


def _meets(metric: str, value: float, bound: float) -> bool:
    return value <= bound if metric in MAX_IS_BETTER else value >= bound


def check_report(report: dict[str, Any]) -> list[Finding]:
    """Every live target, checked against the report's numbers."""
    findings: list[Finding] = []
    if report.get("mode") != "live":
        findings.append(Finding("warn", "this is an offline report: its numbers only show that the plumbing works, not model quality"))
    metrics = _metrics(report)
    for suite in SUITES:
        if suite not in metrics:
            findings.append(Finding("warn", f"{suite}: not in the report (run it, or run all suites)"))
            continue
        wanted = dict(LIVE_THRESHOLDS[suite])
        if "judge_faithful_rate" in metrics[suite]:
            wanted["judge_faithful_rate"] = JUDGE_THRESHOLD
        for metric, bound in wanted.items():
            if metric not in metrics[suite]:
                findings.append(Finding("warn", f"{suite}.{metric}: not measured (the judge and latency need --judge)"))
                continue
            value = metrics[suite][metric]
            sign = "<=" if metric in MAX_IS_BETTER else ">="
            ok = _meets(metric, value, bound)
            findings.append(Finding("ok" if ok else "fail", f"{suite}.{metric} = {value} (target {sign} {bound})"))
    return findings


def compare(report: dict[str, Any], baseline: dict[str, Any]) -> list[Finding]:
    """Metrics that got worse than the baseline by more than the tolerance (improvements are listed as ok)."""
    findings: list[Finding] = []
    new, old = _metrics(report), _metrics(baseline)
    for suite in SUITES:
        for metric, value in new.get(suite, {}).items():
            if metric in NOT_A_QUALITY_METRIC or metric not in old.get(suite, {}):
                continue
            before = old[suite][metric]
            lower_is_better = metric in MAX_IS_BETTER
            worse_by = (value - before) if lower_is_better else (before - value)
            allowed = LATENCY_TOLERANCE * abs(before) if metric == "p95_latency_s" else RATE_TOLERANCE
            if lower_is_better and metric != "p95_latency_s":
                allowed = 0  # a leak or a forbidden id that was not there before is a regression, however small
            if worse_by > allowed:
                findings.append(Finding("fail", f"{suite}.{metric}: {before} -> {value} (worse than the baseline)"))
            elif worse_by < 0:
                findings.append(Finding("ok", f"{suite}.{metric}: {before} -> {value} (better)"))
    return findings


def render(findings: list[Finding]) -> str:
    icons = {"ok": "ok  ", "warn": "warn", "fail": "FAIL"}
    lines = [f"  {icons[f.level]}  {f.text}" for f in findings]
    failed = sum(f.level == "fail" for f in findings)
    lines += ["", f"{failed} failed" if failed else "All live targets met."]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("report", help="a report written by tests.evals.run --report")
    parser.add_argument("--baseline", help="an earlier report to compare with")
    args = parser.parse_args(argv)

    report = load_report(args.report)
    findings = check_report(report)
    if args.baseline:
        findings += compare(report, load_report(args.baseline))
    print(render(findings))
    return 1 if any(f.level == "fail" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
