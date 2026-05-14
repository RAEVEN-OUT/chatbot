from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dotenv is optional at import time.
    load_dotenv = None


ROOT_DIR = Path(__file__).resolve().parents[3]

if load_dotenv:
    load_dotenv(ROOT_DIR / ".env")


def _get_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _get_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Multi Site FAQ Chatbot")
    env: str = os.getenv("ENV", "development")
    storage_backend: str = os.getenv("STORAGE_BACKEND", "memory").lower()
    admin_api_key: str = os.getenv("ADMIN_API_KEY", "")
    google_cloud_project: str = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    firestore_database: str = os.getenv("FIRESTORE_DATABASE", "(default)")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_embedding_model: str = os.getenv("GEMINI_EMBEDDING_MODEL", "text-embedding-004")
    gemini_chat_model: str = os.getenv("GEMINI_CHAT_MODEL", "gemini-1.5-flash")
    allowed_origins: list[str] = None  # type: ignore[assignment]
    collect_all_chat_logs: bool = _get_bool("COLLECT_ALL_CHAT_LOGS", True)
    repository_cache_ttl_seconds: int = _get_int("REPOSITORY_CACHE_TTL_SECONDS", 60)
    repository_cache_max_items: int = _get_int("REPOSITORY_CACHE_MAX_ITEMS", 1000)
    embedding_cache_ttl_seconds: int = _get_int("EMBEDDING_CACHE_TTL_SECONDS", 86400)
    embedding_cache_max_items: int = _get_int("EMBEDDING_CACHE_MAX_ITEMS", 5000)
    vector_search_limit: int = _get_int("VECTOR_SEARCH_LIMIT", 5)

    def __post_init__(self) -> None:
        object.__setattr__(self, "allowed_origins", _get_origins())


settings = Settings()
