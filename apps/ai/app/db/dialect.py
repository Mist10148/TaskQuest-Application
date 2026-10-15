"""The few SQL spellings that differ between PostgreSQL (production) and SQLite (offline tests)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection


def is_postgres(conn: AsyncConnection) -> bool:
    return conn.dialect.name == "postgresql"
