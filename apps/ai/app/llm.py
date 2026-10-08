"""Factories for Gemini chat and embedding models (imports are lazy so tests need no network)."""

from __future__ import annotations

from typing import Any

from app.config import get_settings


class AIUnavailable(RuntimeError):
    """Gemini is not configured or failed; callers degrade gracefully."""


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
    )


def embeddings_model() -> Any:
    s = get_settings()
    if not s.gemini_api_key:
        raise AIUnavailable("GEMINI_API_KEY is not configured")
    from langchain_google_genai import GoogleGenerativeAIEmbeddings

    return GoogleGenerativeAIEmbeddings(
        model=s.gemini_embed_model, google_api_key=s.gemini_api_key, output_dimensionality=s.embed_dim
    )
