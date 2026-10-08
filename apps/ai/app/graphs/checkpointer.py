"""LangGraph checkpointer persisted in MySQL (``ai_checkpoints`` / ``ai_checkpoint_writes``).

Only the async API is implemented: the service runs the graphs with ``astream``/``ainvoke``.
Checkpoint ids are time-ordered, so "latest checkpoint" is the greatest id in a thread.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    WRITES_IDX_MAP,
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    get_checkpoint_id,
    get_checkpoint_metadata,
)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


def _pack(serde, obj: Any) -> tuple[str, bytes]:
    return serde.dumps_typed(obj)


class MySQLCheckpointSaver(BaseCheckpointSaver[str]):
    def __init__(self, engine: AsyncEngine) -> None:
        super().__init__()
        self.engine = engine

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _ids(config: RunnableConfig) -> tuple[str, str]:
        cfg = config["configurable"]
        return str(cfg["thread_id"]), cfg.get("checkpoint_ns", "")

    def _meta_dumps(self, metadata: CheckpointMetadata) -> bytes:
        type_, blob = _pack(self.serde, metadata)
        return type_.encode() + b"\x00" + blob

    def _meta_loads(self, raw: bytes) -> CheckpointMetadata:
        type_, _, blob = bytes(raw).partition(b"\x00")
        return self.serde.loads_typed((type_.decode(), blob))

    async def _tuple_from_row(self, conn, row) -> CheckpointTuple:
        thread_id, ns, checkpoint_id, parent_id, type_, blob, meta = row
        writes = (
            await conn.execute(
                text(
                    "SELECT task_id, channel, type, value, idx FROM ai_checkpoint_writes "
                    "WHERE thread_id = :t AND checkpoint_ns = :ns AND checkpoint_id = :c ORDER BY task_id, idx"
                ),
                {"t": thread_id, "ns": ns, "c": checkpoint_id},
            )
        ).all()
        config: RunnableConfig = {
            "configurable": {"thread_id": thread_id, "checkpoint_ns": ns, "checkpoint_id": checkpoint_id}
        }
        parent: RunnableConfig | None = (
            {"configurable": {"thread_id": thread_id, "checkpoint_ns": ns, "checkpoint_id": parent_id}}
            if parent_id
            else None
        )
        return CheckpointTuple(
            config=config,
            checkpoint=self.serde.loads_typed((type_, bytes(blob))),
            metadata=self._meta_loads(meta) if meta else {},
            parent_config=parent,
            pending_writes=[(w[0], w[1], self.serde.loads_typed((w[2], bytes(w[3])))) for w in writes],
        )

    _COLUMNS = "thread_id, checkpoint_ns, checkpoint_id, parent_id, type, checkpoint, metadata"

    # ── reads ────────────────────────────────────────────────────────────────

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id, ns = self._ids(config)
        checkpoint_id = get_checkpoint_id(config)
        sql = f"SELECT {self._COLUMNS} FROM ai_checkpoints WHERE thread_id = :t AND checkpoint_ns = :ns"
        params: dict[str, Any] = {"t": thread_id, "ns": ns}
        if checkpoint_id:
            sql += " AND checkpoint_id = :c"
            params["c"] = checkpoint_id
        else:
            sql += " ORDER BY checkpoint_id DESC LIMIT 1"
        async with self.engine.connect() as conn:
            row = (await conn.execute(text(sql), params)).first()
            return await self._tuple_from_row(conn, row) if row else None

    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        sql = f"SELECT {self._COLUMNS} FROM ai_checkpoints WHERE 1 = 1"
        params: dict[str, Any] = {}
        if config:
            thread_id, ns = self._ids(config)
            sql += " AND thread_id = :t AND checkpoint_ns = :ns"
            params.update(t=thread_id, ns=ns)
            if get_checkpoint_id(config):
                sql += " AND checkpoint_id = :c"
                params["c"] = get_checkpoint_id(config)
        if before and get_checkpoint_id(before):
            sql += " AND checkpoint_id < :before"
            params["before"] = get_checkpoint_id(before)
        sql += " ORDER BY checkpoint_id DESC"
        async with self.engine.connect() as conn:
            rows = (await conn.execute(text(sql), params)).all()
            count = 0
            for row in rows:
                tup = await self._tuple_from_row(conn, row)
                if filter and not all(tup.metadata.get(k) == v for k, v in filter.items()):
                    continue
                yield tup
                count += 1
                if limit is not None and count >= limit:
                    break

    # ── writes ───────────────────────────────────────────────────────────────

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id, ns = self._ids(config)
        type_, blob = _pack(self.serde, checkpoint)
        params = {
            "t": thread_id,
            "ns": ns,
            "c": checkpoint["id"],
            "p": config["configurable"].get("checkpoint_id"),
            "type": type_,
            "cp": blob,
            "meta": self._meta_dumps(get_checkpoint_metadata(config, metadata)),
        }
        async with self.engine.begin() as conn:
            updated = await conn.execute(
                text(
                    "UPDATE ai_checkpoints SET parent_id = :p, type = :type, checkpoint = :cp, metadata = :meta "
                    "WHERE thread_id = :t AND checkpoint_ns = :ns AND checkpoint_id = :c"
                ),
                params,
            )
            if updated.rowcount == 0:
                await conn.execute(
                    text(
                        "INSERT INTO ai_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_id, type, "
                        "checkpoint, metadata) VALUES (:t, :ns, :c, :p, :type, :cp, :meta)"
                    ),
                    params,
                )
        return {"configurable": {"thread_id": thread_id, "checkpoint_ns": ns, "checkpoint_id": checkpoint["id"]}}

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        thread_id, ns = self._ids(config)
        checkpoint_id = config["configurable"]["checkpoint_id"]
        async with self.engine.begin() as conn:
            for idx, (channel, value) in enumerate(writes):
                special = channel in WRITES_IDX_MAP
                slot = WRITES_IDX_MAP.get(channel, idx)
                type_, blob = _pack(self.serde, value)
                params = {
                    "t": thread_id,
                    "ns": ns,
                    "c": checkpoint_id,
                    "task": task_id,
                    "idx": slot,
                    "ch": channel,
                    "type": type_,
                    "v": blob,
                }
                exists = (
                    await conn.execute(
                        text(
                            "SELECT 1 FROM ai_checkpoint_writes WHERE thread_id = :t AND checkpoint_ns = :ns "
                            "AND checkpoint_id = :c AND task_id = :task AND idx = :idx"
                        ),
                        params,
                    )
                ).first()
                if exists and special:  # special channels (errors, interrupts, resume) overwrite
                    await conn.execute(
                        text(
                            "UPDATE ai_checkpoint_writes SET channel = :ch, type = :type, value = :v "
                            "WHERE thread_id = :t AND checkpoint_ns = :ns AND checkpoint_id = :c "
                            "AND task_id = :task AND idx = :idx"
                        ),
                        params,
                    )
                elif not exists:
                    await conn.execute(
                        text(
                            "INSERT INTO ai_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, "
                            "channel, type, value) VALUES (:t, :ns, :c, :task, :idx, :ch, :type, :v)"
                        ),
                        params,
                    )

    async def adelete_thread(self, thread_id: str) -> None:
        async with self.engine.begin() as conn:
            for table in ("ai_checkpoint_writes", "ai_checkpoints"):
                await conn.execute(text(f"DELETE FROM {table} WHERE thread_id = :t"), {"t": str(thread_id)})  # noqa: S608

    # The sync API is intentionally unsupported (the service is fully async).
    def get_tuple(self, config):  # pragma: no cover
        raise NotImplementedError("MySQLCheckpointSaver is async-only")

    def put(self, *a, **kw):  # pragma: no cover
        raise NotImplementedError("MySQLCheckpointSaver is async-only")

    def put_writes(self, *a, **kw):  # pragma: no cover
        raise NotImplementedError("MySQLCheckpointSaver is async-only")

    def list(self, *a, **kw):  # pragma: no cover
        raise NotImplementedError("MySQLCheckpointSaver is async-only")
