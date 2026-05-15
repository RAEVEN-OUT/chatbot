from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from app.core.config import settings
from app.repositories.cache import TTLCache
from app.services.text import normalize_text


class EmbeddingService(Protocol):
    def embed(self, text: str) -> list[float]:
        ...

    async def embed_async(self, text: str) -> list[float]:
        ...


def _normalize_vector(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return values
    return [value / norm for value in values]


def _load_httpx():
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Install httpx to use hosted embeddings.") from exc
    return httpx


@dataclass
class HashEmbeddingService(EmbeddingService):
    """Deterministic local embedder for development.

    It is not a replacement for Gemini/Vertex embeddings, but it lets the app
    run locally without keys and still exercises the retrieval flow.
    """

    dimensions: int = 384

    def embed(self, text: str) -> list[float]:
        normalized = normalize_text(text)
        vector = [0.0] * self.dimensions
        tokens = normalized.split()

        features: list[str] = []
        features.extend(tokens)
        features.extend(f"word:{token}" for token in tokens)

        compact = normalized.replace(" ", "_")
        for size in (3, 4):
            features.extend(
                f"char:{compact[index:index + size]}"
                for index in range(max(len(compact) - size + 1, 0))
            )

        for feature in features:
            digest = hashlib.sha256(feature.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign

        return _normalize_vector(vector)

    async def embed_async(self, text: str) -> list[float]:
        return self.embed(text)


@dataclass
class GeminiEmbeddingService(EmbeddingService):
    api_key: str
    model: str
    cache: TTLCache[tuple[str, str, str], list[float]]

    @property
    def model_id(self) -> str:
        model = (self.model or "gemini-embedding-001").strip()
        if model.startswith("models/"):
            model = model.removeprefix("models/")
        return model

    @property
    def endpoint(self) -> str:
        return (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_id}:embedContent?key={self.api_key}"
        )

    def _payload(self, text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> dict:
        return {
            "model": f"models/{self.model_id}",
            "content": {
                "parts": [{"text": text}],
            },
            "taskType": task_type,
            "outputDimensionality": 768,
        }

    def _values_from_response(self, data: dict) -> list[float]:
        values = data.get("embedding", {}).get("values", [])
        if not values:
            raise RuntimeError("Gemini embedding response did not include values.")
        return [float(value) for value in values]

    def _cache_key(self, text: str, task_type: str) -> tuple[str, str, str]:
        return (self.model_id, task_type, normalize_text(text))

    def _runtime_error(self, exc) -> RuntimeError:
        httpx = _load_httpx()
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            body = exc.response.text[:300].replace(self.api_key, "[redacted]")
            hint = ""
            if status == 404 and self.model_id == "text-embedding-004":
                hint = " Set GEMINI_EMBEDDING_MODEL=gemini-embedding-001 and reindex vectors."
            return RuntimeError(
                f"Gemini embedding request failed with HTTP {status} for model "
                f"{self.model_id}.{hint} Response: {body}"
            )
        return RuntimeError(f"Gemini embedding request failed for model {self.model_id}: {exc}")

    def embed(self, text: str) -> list[float]:
        """Embed a document (FAQ question/answer) for indexing."""
        cache_key = self._cache_key(text, "RETRIEVAL_DOCUMENT")
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached
        httpx = _load_httpx()
        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    self.endpoint,
                    json=self._payload(text, "RETRIEVAL_DOCUMENT"),
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc) from exc
        values = self._values_from_response(data)
        self.cache.set(cache_key, values)
        return values

    async def embed_async(self, text: str) -> list[float]:
        """Embed a user query for semantic search."""
        cache_key = self._cache_key(text, "RETRIEVAL_QUERY")
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached
        httpx = _load_httpx()
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    self.endpoint,
                    json=self._payload(text, "RETRIEVAL_QUERY"),
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc) from exc
        values = self._values_from_response(data)
        self.cache.set(cache_key, values)
        return values


@dataclass
class OpenAIEmbeddingService(EmbeddingService):
    api_key: str
    model: str
    dimensions: int
    cache: TTLCache[tuple[str, str, str, int], list[float]]

    @property
    def endpoint(self) -> str:
        return "https://api.openai.com/v1/embeddings"

    def _payload(self, text: str) -> dict:
        payload: dict[str, object] = {
            "model": self.model or "text-embedding-3-small",
            "input": text,
            "encoding_format": "float",
        }
        if self.dimensions:
            payload["dimensions"] = self.dimensions
        return payload

    def _values_from_response(self, data: dict) -> list[float]:
        values = (data.get("data") or [{}])[0].get("embedding", [])
        if not values:
            raise RuntimeError("OpenAI embedding response did not include values.")
        return [float(value) for value in values]

    def _cache_key(self, text: str, task_type: str) -> tuple[str, str, str, int]:
        return (self.model, task_type, normalize_text(text), self.dimensions)

    def _runtime_error(self, exc) -> RuntimeError:
        httpx = _load_httpx()
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            body = exc.response.text[:300].replace(self.api_key, "[redacted]")
            return RuntimeError(
                f"OpenAI embedding request failed with HTTP {status} for model "
                f"{self.model}. Response: {body}"
            )
        return RuntimeError(f"OpenAI embedding request failed for model {self.model}: {exc}")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def embed(self, text: str) -> list[float]:
        cache_key = self._cache_key(text, "RETRIEVAL_DOCUMENT")
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached
        httpx = _load_httpx()
        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    self.endpoint,
                    json=self._payload(text),
                    headers=self._headers(),
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc) from exc
        values = self._values_from_response(data)
        self.cache.set(cache_key, values)
        return values

    async def embed_async(self, text: str) -> list[float]:
        cache_key = self._cache_key(text, "RETRIEVAL_QUERY")
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached
        httpx = _load_httpx()
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    self.endpoint,
                    json=self._payload(text),
                    headers=self._headers(),
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc) from exc
        values = self._values_from_response(data)
        self.cache.set(cache_key, values)
        return values


@lru_cache
def get_embedding_service() -> EmbeddingService:
    if settings.openai_api_key:
        return OpenAIEmbeddingService(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
            dimensions=settings.openai_embedding_dimensions,
            cache=TTLCache(
                ttl_seconds=settings.embedding_cache_ttl_seconds,
                max_items=settings.embedding_cache_max_items,
            ),
        )
    if settings.gemini_api_key:
        return GeminiEmbeddingService(
            api_key=settings.gemini_api_key,
            model=settings.gemini_embedding_model,
            cache=TTLCache(
                ttl_seconds=settings.embedding_cache_ttl_seconds,
                max_items=settings.embedding_cache_max_items,
            ),
        )
    return HashEmbeddingService()
