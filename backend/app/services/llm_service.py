from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from app.core.config import settings
from app.schemas.models import FaqVectorRecord


class LlmService(Protocol):
    model_name: str

    def answer_from_faqs(self, question: str, candidates: list[FaqVectorRecord]) -> str | None:
        ...


@dataclass
class DisabledLlmService(LlmService):
    model_name: str = ""

    def answer_from_faqs(self, question: str, candidates: list[FaqVectorRecord]) -> str | None:
        return None


@dataclass
class GeminiLlmService(LlmService):
    api_key: str
    model_name: str

    def answer_from_faqs(self, question: str, candidates: list[FaqVectorRecord]) -> str | None:
        if not candidates:
            return None

        faq_context = "\n\n".join(
            (
                f"FAQ {index + 1}\n"
                f"Question: {candidate.question_snapshot}\n"
                f"Allowed answer: {candidate.answer_snapshot}"
            )
            for index, candidate in enumerate(candidates[:5])
        )
        prompt = (
            "You are a strict FAQ routing assistant.\n"
            "Answer only if one of the provided FAQs clearly answers the user's question.\n"
            "If none of the FAQs answer it, respond with exactly: NO_ANSWER\n"
            "When answering, copy the matching FAQ answer exactly. Do not rewrite it.\n\n"
            f"User question: {question}\n\n"
            f"FAQs:\n{faq_context}"
        )
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_name}:generateContent?key={self.api_key}"
        )
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Gemini LLM request failed: {exc}") from exc

        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )
        if not text or text == "NO_ANSWER":
            return None
        return text


def get_llm_service() -> LlmService:
    if settings.gemini_api_key:
        return GeminiLlmService(
            api_key=settings.gemini_api_key,
            model_name=settings.gemini_chat_model,
        )
    return DisabledLlmService()
