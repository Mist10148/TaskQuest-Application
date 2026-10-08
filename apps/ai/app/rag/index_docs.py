"""CLI: index the global help docs (idempotent; unchanged sections are skipped).

    python -m app.rag.index_docs [--docs-dir PATH]

Runs at deploy time. Needs GEMINI_API_KEY and database access; if either is missing
it exits 0 without failing the build (docs can then be indexed later).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from app.config import ROOT, get_settings
from app.db import pool
from app.rag import indexer, runtime

DOC_FILES = {"gameplay": "GAMEPLAY.md", "commands": "COMMANDS.md"}


def load_docs(docs_dir: Path) -> dict[str, str]:
    return {
        slug: (docs_dir / name).read_text(encoding="utf-8")
        for slug, name in DOC_FILES.items()
        if (docs_dir / name).exists()
    }


async def run(docs_dir: Path) -> int:
    docs = load_docs(docs_dir)
    if not docs:
        print(f"no docs found in {docs_dir}; skipping")
        return 0
    async with pool.connection() as conn:
        n = await indexer.index_docs(conn, runtime.get_store(), runtime.get_embedder(), docs)
    await pool.get_engine().dispose()
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs-dir", type=Path, default=ROOT / "docs")
    args = parser.parse_args()
    if not get_settings().gemini_api_key:
        print("GEMINI_API_KEY not set; skipping docs indexing")
        sys.exit(0)
    try:
        print(f"embedded {asyncio.run(run(args.docs_dir))} doc chunks")
    except Exception as err:  # noqa: BLE001 - never fail a deploy over optional indexing
        print(f"docs indexing skipped: {type(err).__name__}: {err}")


if __name__ == "__main__":
    main()
