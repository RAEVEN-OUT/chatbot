from __future__ import annotations

from functools import lru_cache

from app.core.config import settings
from app.repositories.base import Repository
from app.repositories.firestore import FirestoreRepository
from app.repositories.memory import MemoryRepository


@lru_cache
def get_repository() -> Repository:
    if settings.storage_backend == "firestore":
        return FirestoreRepository(
            project=settings.google_cloud_project,
            database=settings.firestore_database,
        )
    return MemoryRepository()
