"""CLI: embed everything that is missing or changed.

python -m app.rag.backfill [--user DISCORD_ID]
"""

from __future__ import annotations

import argparse
import asyncio

from app.db import pool
from app.rag import indexer, runtime


async def run(user: str | None) -> int:
    store, embedder = runtime.get_store(), runtime.get_embedder()
    total = 0
    async with pool.connection() as conn:
        if user:
            users = [user]
        else:
            from sqlalchemy import text

            users = [
                r[0] for r in (await conn.execute(text("SELECT discord_id FROM users WHERE ai_enabled = 1"))).all()
            ]
        for uid in users:
            total += await indexer.index_user(conn, store, embedder, uid)
    await pool.get_engine().dispose()
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", help="only this Discord ID")
    args = parser.parse_args()
    print(f"embedded {asyncio.run(run(args.user))} chunks")


if __name__ == "__main__":
    main()
