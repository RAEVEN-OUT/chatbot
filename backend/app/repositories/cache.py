from __future__ import annotations

import time
from collections.abc import Hashable
from threading import Lock
from typing import Generic, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    def __init__(self, ttl_seconds: int, max_items: int) -> None:
        self.ttl_seconds = max(ttl_seconds, 0)
        self.max_items = max(max_items, 1)
        self._items: dict[K, tuple[float, V]] = {}
        self._lock = Lock()

    def get(self, key: K) -> V | None:
        with self._lock:
            item = self._items.get(key)
            if not item:
                return None
            expires_at, value = item
            if expires_at < time.monotonic():
                self._items.pop(key, None)
                return None
            return value

    def set(self, key: K, value: V) -> None:
        if self.ttl_seconds <= 0:
            return
        with self._lock:
            if len(self._items) >= self.max_items:
                self._items.pop(next(iter(self._items)), None)
            self._items[key] = (time.monotonic() + self.ttl_seconds, value)

    def pop(self, key: K) -> None:
        with self._lock:
            self._items.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def delete_where(self, predicate) -> None:
        with self._lock:
            for key in list(self._items):
                if predicate(key):
                    self._items.pop(key, None)
