from __future__ import annotations

import hashlib
import json
import math
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from app.core.config import settings
from app.services.text import normalize_text


class EmbeddingService(Protocol):
    def embed(self, text: str) -> list[float]:
        ...


def _normalize_vector(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return values
    return [value / norm for value in values]


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


@dataclass
class GeminiEmbeddingService(EmbeddingService):
    api_key: str
    model: str

    def embed(self, text: str) -> list[float]:
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:embedContent?key={self.api_key}"
        )
        payload = {
            "content": {
                "parts": [{"text": text}],
            },
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Gemini embedding request failed: {exc}") from exc

        values = data.get("embedding", {}).get("values", [])
        if not values:
            raise RuntimeError("Gemini embedding response did not include values.")
        return [float(value) for value in values]


def get_embedding_service() -> EmbeddingService:
    if settings.gemini_api_key:
        return GeminiEmbeddingService(
            api_key=settings.gemini_api_key,
            model=settings.gemini_embedding_model,
        )
    return HashEmbeddingService()
