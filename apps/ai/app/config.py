"""Settings, read from the environment (and the shared repo-root .env in development)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(str(ROOT / ".env"), str(ROOT / "apps" / "ai" / ".env")), extra="ignore")

    # Service-to-service auth (same value on web and ai)
    ai_internal_token: str = ""
    web_internal_url: str = "http://localhost:3001"

    # Gemini. Model ids are configuration, not code: confirm against Google's current list.
    gemini_api_key: str = ""
    gemini_chat_model: str = "gemini-2.5-flash"
    gemini_reasoning_model: str = "gemini-2.5-pro"
    gemini_embed_model: str = "gemini-embedding-001"
    embed_dim: int = 768

    # Database (shares the web service's variables; AI_DB_* overrides the credentials)
    db_url: str = ""
    db_host: str = "localhost"
    db_port: int = 3306
    db_user: str = "root"
    db_password: str = ""
    db_name: str = "taskquest"
    db_ssl: bool = False
    db_ssl_reject_unauthorized: bool = True
    ai_db_user: str = ""
    ai_db_password: str = ""
    db_pool_size: int = 5

    # Limits
    ai_daily_request_limit: int = 100
    ai_reconcile_minutes: int = 15
    summary_map_reduce_chars: int = 40_000
    max_tool_iterations: int = 6

    # Optional tracing
    langsmith_api_key: str = ""

    log_level: str = Field(default="INFO")

    @property
    def sqlalchemy_url(self) -> str:
        """mysql+aiomysql URL, preferring AI_DB_USER over the app's credentials."""
        if self.db_url.startswith("sqlite"):
            return self.db_url
        user, password = self.db_user, self.db_password
        host, port, name = self.db_host, self.db_port, self.db_name
        if self.db_url:
            parsed = urlparse(self.db_url)
            user = unquote(parsed.username or user)
            password = unquote(parsed.password or "")
            host, port = parsed.hostname or host, parsed.port or port
            name = (parsed.path or "/").lstrip("/") or name
        if self.ai_db_user:
            user, password = self.ai_db_user, self.ai_db_password
        return f"mysql+aiomysql://{quote(user)}:{quote(password)}@{host}:{port}/{name}?charset=utf8mb4"


@lru_cache
def get_settings() -> Settings:
    return Settings()
