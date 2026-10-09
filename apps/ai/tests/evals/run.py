"""Eval runner for the retrieval, summarizer and prioritizer golden sets (docs/AI_INTEGRATION.md §15).

    python -m tests.evals.run                      # offline: fake embeddings/models, checks the pipeline
    python -m tests.evals.run --live               # real Gemini (needs GEMINI_API_KEY), §1 thresholds
    python -m tests.evals.run --suite retrieval --report evals.json

Offline mode uses a bag-of-words fake embedder, a heuristic fake summarizer (which also invents an id on its
first answer, to exercise the validation retry) and the deterministic prioritizer fallback. Its numbers say the
plumbing works, not that the model is good. Run ``--live`` before changing prompts or models.

Everything runs on an in-memory SQLite copy of the schema seeded from ``seed.json``; no MySQL is needed.
"""

from __future__ import annotations

import os

os.environ.setdefault("AI_INTERNAL_TOKEN", "e" * 40)
os.environ.setdefault("DB_URL", "sqlite+aiosqlite://")

import argparse  # noqa: E402
import asyncio  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import sys  # noqa: E402
from collections.abc import Callable  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402
from typing import Any  # noqa: E402

from langchain_core.messages import AIMessage  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncEngine  # noqa: E402

from app.chains.summarize import Summarizer, Summary, render_input  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import pool  # noqa: E402
from app.graphs import prioritize as prio  # noqa: E402
from app.llm import AIUnavailable  # noqa: E402
from app.rag import indexer  # noqa: E402
from app.rag.embed import Embedder  # noqa: E402
from app.rag.retriever import Retrieved, TaskRetriever  # noqa: E402
from app.rag.store import MySQLNumpyStore  # noqa: E402
from tests.evals.seed import Seeded, load_json, seed  # noqa: E402
from tests.fakes import FakeEmbedder  # noqa: E402
from tests.schema import create_engine, drop_engine  # noqa: E402

SUITES = ("retrieval", "summary", "prioritize")

# Success criteria from docs/AI_INTEGRATION.md §1, applied in --live mode.
LIVE_THRESHOLDS: dict[str, dict[str, float]] = {
    "retrieval": {"recall_at_k": 0.85, "leaks": 0},
    "summary": {"faithful_rate": 1.0, "coverage": 0.8, "violations": 0},
    "prioritize": {"top3_agreement": 0.8, "valid_id_rate": 1.0},
}
# Offline the fakes are crude, so retrieval recall is held to a lower bar; the rest must still hold.
OFFLINE_THRESHOLDS: dict[str, dict[str, float]] = {
    **LIVE_THRESHOLDS,
    "retrieval": {"recall_at_k": 0.7, "leaks": 0},
}
MAX_IS_BETTER = {"leaks", "violations"}  # these must stay at or below the threshold


@dataclass
class SuiteResult:
    name: str
    metrics: dict[str, float]
    thresholds: dict[str, float]
    failures: list[str] = field(default_factory=list)  # per-case notes for misses

    @property
    def passed(self) -> bool:
        return all(self.meets(k) for k in self.thresholds)

    def meets(self, metric: str) -> bool:
        value, bound = self.metrics[metric], self.thresholds[metric]
        return value <= bound if metric in MAX_IS_BETTER else value >= bound

    def to_dict(self) -> dict[str, Any]:
        return {
            "suite": self.name,
            "passed": self.passed,
            "metrics": self.metrics,
            "thresholds": self.thresholds,
            "failures": self.failures,
        }


# ── offline stand-ins ────────────────────────────────────────────────────────

_HEAD = re.compile(r'^\[(L\d+)\] ".*?" priority=')
_WHEN = re.compile(r"\((OVERDUE by \d+ days|due today|in (\d+) days)\)")
_RECAP = re.compile(r'^\[(I\d+)\] ".*?" in \[(L\d+)\]')
_ITEM = re.compile(r"^\s+\[(I\d+)\] \[ \]")


class HeuristicSummaryLLM:
    """Reads the rendered input like a careful reader would; invents one id on its first answer."""

    def __init__(self) -> None:
        self.calls = 0

    def with_structured_output(self, schema: Any, include_raw: bool = False, **_: Any) -> Any:
        outer = self

        class _Runnable:
            async def ainvoke(self, messages: list[Any], *a: Any, **kw: Any) -> Any:
                outer.calls += 1
                parsed = outer._summarize(str(messages[-1].content))
                if outer.calls == 1:
                    parsed.referenced_ids.append("L999999")  # must be caught by validation
                raw = AIMessage(content="", usage_metadata={"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})
                return {"parsed": parsed, "raw": raw, "parsing_error": None} if include_raw else parsed

        return _Runnable()

    @staticmethod
    def _summarize(prompt: str) -> Summary:
        mode = prompt.split("\n", 1)[0].removeprefix("Mode: ").strip()
        lines = prompt.splitlines()
        ids: list[str] = []
        if mode == "recap":
            ids = [m.group(2) for line in lines if (m := _RECAP.match(line))]
        else:
            for line in lines:
                m = _HEAD.match(line)
                if not m:
                    continue
                when = _WHEN.search(line)
                urgent = when is not None and (when.group(2) is None or int(when.group(2)) <= 3)
                if mode == "list" or urgent:
                    ids.append(m.group(1))
            if mode == "list":
                ids += [m.group(1) for line in lines if (m := _ITEM.match(line))]
        ids = list(dict.fromkeys(ids))
        return Summary(
            headline=f"{len(ids)} things need attention",
            highlights=[f"Focus on {i}" for i in ids[:5]],
            next_steps=[f"Work on {i}" for i in ids[:3]],
            referenced_ids=ids,
        )


def _offline_prioritize_factory(**_: Any) -> Any:
    raise AIUnavailable("offline eval: use the deterministic ranking")


# ── harness ──────────────────────────────────────────────────────────────────


@dataclass
class Env:
    engine: AsyncEngine
    seeded: Seeded
    live: bool
    embedder: Embedder
    store: MySQLNumpyStore
    llm_factory: Callable[..., Any]


async def make_env(live: bool) -> Env:
    engine = await create_engine()
    pool.set_engine(engine)
    async with engine.begin() as conn:
        seeded = await seed(conn)
    if live:
        from app import llm

        settings = get_settings()
        if not settings.gemini_api_key:
            raise SystemExit("--live needs GEMINI_API_KEY")
        return Env(
            engine, seeded, True, llm.embeddings_model(), MySQLNumpyStore(settings.gemini_embed_model), llm.chat_model
        )
    return Env(engine, seeded, False, FakeEmbedder(), MySQLNumpyStore("fake-embed"), _offline_prioritize_factory)


def _matches(ref: str, hit: Retrieved, seeded: Seeded) -> bool:
    if ref.startswith("doc:"):
        _, slug, phrase = ref.split(":", 2)
        return hit.kind == "doc" and hit.id.startswith(f"{slug}#") and phrase.lower() in hit.text.lower()
    return hit.id == seeded.label(ref)


async def run_retrieval(env: Env) -> SuiteResult:
    spec = load_json("retrieval.json")
    uid, k = spec["user"], spec["k"]
    async with env.engine.begin() as conn:
        for owner in {env.seeded.owner[label] for label in env.seeded.owner}:
            await indexer.index_user(conn, env.store, env.embedder, owner)
        await indexer.index_docs(conn, env.store, env.embedder, env.seeded.docs)

    retriever = TaskRetriever(env.store, env.embedder)
    recalls, rrs, leaks, failures = [], [], 0, []
    async with env.engine.connect() as conn:
        for case in spec["queries"]:
            types = frozenset({"doc"}) if case["scope"] == "docs" else frozenset({"list", "item", "history"})
            hits = await retriever.retrieve(conn, uid, case["q"], k=k, source_types=types, today=env.seeded.today)
            leaks += sum(1 for h in hits if env.seeded.owner.get(h.id, uid) != uid)
            found = [ref for ref in case["relevant"] if any(_matches(ref, h, env.seeded) for h in hits)]
            recalls.append(len(found) / len(case["relevant"]))
            first = next(
                (i for i, h in enumerate(hits, 1) if any(_matches(r, h, env.seeded) for r in case["relevant"])), None
            )
            rrs.append(1 / first if first else 0.0)
            if len(found) < len(case["relevant"]):
                missing = sorted(set(case["relevant"]) - set(found))
                failures.append(f"{case['q']!r}: missing {missing}; got {[h.id for h in hits]}")
    thresholds = (LIVE_THRESHOLDS if env.live else OFFLINE_THRESHOLDS)["retrieval"]
    metrics = {"recall_at_k": _mean(recalls), "mrr": _mean(rrs), "leaks": leaks, "queries": len(recalls)}
    return SuiteResult("retrieval", metrics, thresholds, failures)


async def run_summary(env: Env) -> SuiteResult:
    spec = load_json("summary.json")
    uid = spec["user"]
    faithful, coverage, violations, failures = 0, [], 0, []
    async with env.engine.connect() as conn:
        for case in spec["cases"]:
            list_id = int(env.seeded.label(f"list:{case['list']}")[1:]) if case.get("list") else None
            rendered = await render_input(
                conn, uid, case["mode"], list_id=list_id, range_=case.get("range", "week"), today=env.seeded.today
            )
            llm = env.llm_factory() if env.live else HeuristicSummaryLLM()
            summary, dropped = await Summarizer(llm).summarize_text(case["mode"], env.seeded.today, rendered)
            refs = set(summary.referenced_ids)
            if dropped == 0 and refs <= rendered.valid_ids:
                faithful += 1
            else:
                failures.append(f"{case['name']}: {dropped} unknown id(s) survived validation")
            must = [env.seeded.label(r) for r in case["must_mention"]]
            hit = [m for m in must if m in refs]
            coverage.append(len(hit) / len(must) if must else 1.0)
            if len(hit) < len(must):
                failures.append(
                    f"{case['name']}: did not mention {[env.seeded.key_of(m) for m in must if m not in refs]}"
                )
            bad = [env.seeded.label(r) for r in case["must_not_mention"] if env.seeded.label(r) in refs]
            violations += len(bad)
            if bad:
                failures.append(f"{case['name']}: mentioned {[env.seeded.key_of(b) for b in bad]}")
    thresholds = (LIVE_THRESHOLDS if env.live else OFFLINE_THRESHOLDS)["summary"]
    n = len(spec["cases"])
    metrics = {"faithful_rate": faithful / n, "coverage": _mean(coverage), "violations": violations, "cases": n}
    return SuiteResult("summary", metrics, thresholds, failures)


async def run_prioritize(env: Env) -> SuiteResult:
    spec = load_json("prioritize.json")
    agreements, top1, valid, failures = [], 0, 0, []
    async with env.engine.connect() as conn:
        for case in spec["cases"]:
            prio.clear_cache()
            out = await prio.prioritize(conn, case["user"], env.llm_factory, today=env.seeded.today)
            ranked = [r["id"] for r in out["ranked"]]
            own = {
                label for label, owner in env.seeded.owner.items() if owner == case["user"] and label.startswith("L")
            }
            if len(ranked) == len(set(ranked)) and set(ranked) <= own:
                valid += 1
            else:
                failures.append(f"{case['name']}: invalid ids {ranked}")
            gold = [env.seeded.label(r) for r in case["gold_top3"]]
            agreements.append(len(set(ranked[:3]) & set(gold)) / 3)
            top1 += bool(ranked) and ranked[0] == gold[0]
            if set(ranked[:3]) != set(gold):
                got = [env.seeded.key_of(r) for r in ranked[:3]]
                failures.append(f"{case['name']}: top 3 {got} vs gold {case['gold_top3']}")
    thresholds = (LIVE_THRESHOLDS if env.live else OFFLINE_THRESHOLDS)["prioritize"]
    n = len(spec["cases"])
    metrics = {"top3_agreement": _mean(agreements), "top1_accuracy": top1 / n, "valid_id_rate": valid / n, "cases": n}
    return SuiteResult("prioritize", metrics, thresholds, failures)


RUNNERS = {"retrieval": run_retrieval, "summary": run_summary, "prioritize": run_prioritize}


async def run_suites(suites: list[str], *, live: bool = False) -> list[SuiteResult]:
    results = []
    for name in suites:
        env = await make_env(live)  # fresh database per suite, so usage and caches never interact
        try:
            results.append(await RUNNERS[name](env))
        finally:
            pool.set_engine(None)
            await drop_engine(env.engine)
    return results


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def print_report(results: list[SuiteResult], live: bool) -> None:
    print(f"TaskQuest AI evals ({'live' if live else 'offline'})\n")
    for r in results:
        print(f"{r.name:<11} {'PASS' if r.passed else 'FAIL'}")
        for metric, value in r.metrics.items():
            bound = r.thresholds.get(metric)
            target = "" if bound is None else f"  (target {'<=' if metric in MAX_IS_BETTER else '>='} {bound})"
            print(f"  {metric:<16} {value}{target}")
        for note in r.failures:
            print(f"  - {note}")
        print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--suite", choices=[*SUITES, "all"], default="all")
    parser.add_argument("--live", action="store_true", help="use real Gemini models (costs quota)")
    parser.add_argument("--report", help="also write the results as JSON to this path")
    args = parser.parse_args(argv)

    suites = list(SUITES) if args.suite == "all" else [args.suite]
    results = asyncio.run(run_suites(suites, live=args.live))
    print_report(results, args.live)
    if args.report:
        payload = {"mode": "live" if args.live else "offline", "results": [r.to_dict() for r in results]}
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
