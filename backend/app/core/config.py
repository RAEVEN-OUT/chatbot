from __future__ import annotations

import os
import json
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dotenv is optional at import time.
    load_dotenv = None


ROOT_DIR = Path(__file__).resolve().parents[3]

if load_dotenv:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(Path.cwd() / ".env", override=False)


def resolve_project_path(path_value: str | os.PathLike[str]) -> Path:
    path = Path(str(path_value).strip().strip('"').strip("'"))
    if path.is_absolute():
        return path

    candidates = [ROOT_DIR / path, Path.cwd() / path]
    candidates.extend(parent / path for parent in Path.cwd().parents)
    candidates.extend(parent / path for parent in ROOT_DIR.parents)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return ROOT_DIR / path


credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if credentials_path:
    credentials_path = credentials_path.strip().strip('"').strip("'")
    if credentials_path:
        resolved_credentials_path = resolve_project_path(credentials_path)
        if resolved_credentials_path.exists():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(resolved_credentials_path)
        else:
            os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)


def firebase_credentials_path() -> Path:
    configured = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if configured:
        return resolve_project_path(configured)
    return resolve_project_path("firebase-key.json")


def firebase_credentials_info() -> dict[str, Any] | None:
    raw_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw_json:
        return json.loads(raw_json)

    raw_b64 = os.getenv("FIREBASE_SERVICE_ACCOUNT_B64", "").strip()
    if raw_b64:
        return json.loads(base64.b64decode(raw_b64).decode("utf-8"))

    return None


def firebase_credentials_status() -> dict[str, Any]:
    if os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip():
        return {"source": "FIREBASE_SERVICE_ACCOUNT_JSON", "exists": True}
    if os.getenv("FIREBASE_SERVICE_ACCOUNT_B64", "").strip():
        return {"source": "FIREBASE_SERVICE_ACCOUNT_B64", "exists": True}

    path = firebase_credentials_path()
    return {
        "source": "GOOGLE_APPLICATION_CREDENTIALS" if os.getenv("GOOGLE_APPLICATION_CREDENTIALS") else "firebase-key.json",
        "exists": path.exists(),
        "filename": path.name,
    }


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
