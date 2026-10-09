"""Factories for Gemini chat and embedding models (imports are lazy so tests need no network)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import SecretStr

from app.config import get_settings


class AIUnavailable(RuntimeError):
    """Gemini is not configured or failed; callers degrade gracefully."""


# Finish reasons that mean Gemini withheld the answer rather than finishing it.
BLOCKED_FINISH_REASONS = frozenset({"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"})
BLOCKED_REPLY = "I can't help with that one. Try asking about your quests in a different way."


def is_blocked(message: Any) -> bool:
    """True when a Gemini reply was stopped by a safety filter (or the prompt itself was blocked)."""
    meta = getattr(message, "response_metadata", None) or {}
    if str(meta.get("finish_reason") or "").upper() in BLOCKED_FINISH_REASONS:
        return True
    feedback = meta.get("prompt_feedback") or {}
    return bool(isinstance(feedback, dict) and feedback.get("block_reason"))


def safety_settings() -> dict[Any, Any]:
    """Moderate filters. Harassment only blocks high-probability content so a snappy persona still works."""
    from langchain_google_genai import HarmBlockThreshold, HarmCategory

    return {
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    }


def chat_model(*, reasoning: bool = False, temperature: float = 0.2, max_output_tokens: int = 800) -> Any:
    s = get_settings()
    if not s.gemini_api_key:
        raise AIUnavailable("GEMINI_API_KEY is not configured")
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=s.gemini_reasoning_model if reasoning else s.gemini_chat_model,
        google_api_key=s.gemini_api_key,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        safety_settings=safety_settings(),
    )


def embeddings_model() -> Any:
    s = get_settings()
    if not s.gemini_api_key:
        raise AIUnavailable("GEMINI_API_KEY is not configured")
    from langchain_google_genai import GoogleGenerativeAIEmbeddings

    return GoogleGenerativeAIEmbeddings(
        model=s.gemini_embed_model, api_key=SecretStr(s.gemini_api_key), output_dimensionality=s.embed_dim
    )


def get_llm_factory() -> Callable[[], Any]:
    """FastAPI dependency returning a lazy model factory (overridden in tests with a scripted fake).

    Lazy so cached answers and deterministic fallbacks work without a Gemini key.
    """
    return chat_model
