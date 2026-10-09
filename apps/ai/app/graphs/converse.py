"""Discord conversation: the chat agent in read-only mode with the persona and Zephyr-style memory.

One LangGraph thread per user per channel (never shared between users, because retrieval and tools
read that user's private quests). Memory folds older turns into a rolling summary once a thread
passes 20 messages, keeping the newest 10 verbatim.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.graphs.chat import ChatDeps, build_chat_graph

FOLD_AT = 20
KEEP = 10
_NAMESPACE = uuid.UUID("6f1c2b52-7f5e-4f39-9d6b-2f0b7f4c9a11")


def thread_id_for(discord_id: str, channel_id: str) -> str:
    """Stable thread UUID for (user, channel). DMs pass the DM channel id."""
    return str(uuid.uuid5(_NAMESPACE, f"discord:{channel_id}:{discord_id}"))


def build_converse_graph(deps: ChatDeps, checkpointer: Any):
    return build_chat_graph(
        deps, checkpointer, prompt_name="converse_system", read_only=True, fold_at=FOLD_AT, keep=KEEP
    )
