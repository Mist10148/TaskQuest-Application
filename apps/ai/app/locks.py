"""Per-key asyncio locks, used to serialise turns on one chat thread.

Two quick clicks on Approve (or two Discord messages in one channel) must not run the same
LangGraph thread concurrently: a confirmed write could otherwise run twice. Entries are
reference-counted and removed when nobody holds or waits for them, so the dict stays small.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager


class KeyedLocks:
    def __init__(self) -> None:
        self._locks: dict[str, tuple[asyncio.Lock, int]] = {}

    def __len__(self) -> int:
        return len(self._locks)

    @asynccontextmanager
    async def hold(self, key: str) -> AsyncIterator[None]:
        lock, users = self._locks.get(key, (asyncio.Lock(), 0))
        self._locks[key] = (lock, users + 1)
        try:
            async with lock:
                yield
        finally:
            lock, users = self._locks[key]
            if users <= 1:
                del self._locks[key]
            else:
                self._locks[key] = (lock, users - 1)


thread_locks = KeyedLocks()
