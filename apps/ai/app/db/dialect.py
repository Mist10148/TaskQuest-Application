"""The few SQL spellings that differ between MySQL/MariaDB (production) and SQLite (offline tests)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection


def is_mysql(conn: AsyncConnection) -> bool:
    return conn.dialect.name in ("mysql", "mariadb")


def insert_ignore(conn: AsyncConnection) -> str:
    """``INSERT`` that silently skips a row that violates a unique key (race-safe create-if-missing)."""
    return "INSERT IGNORE" if is_mysql(conn) else "INSERT OR IGNORE"
