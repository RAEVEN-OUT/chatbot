from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import AsyncIterable, Protocol

from app.core.config import settings
from app.schemas.models import FaqVectorRecord


def _load_httpx():
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Install httpx to use Gemini LLM fallback.") from exc
    return httpx


class LlmService(Protocol):
    model_name: str

    def answer_from_faqs(self, question: str, candidates: list[FaqVectorRecord]) -> str | None:
        ...

    async def answer_from_faqs_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> str | None:
        ...

    async def stream_answer_from_faqs_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> AsyncIterable[str]:
        ...

    async def select_best_faq_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> FaqVectorRecord | None:
        ...


@dataclass
class DisabledLlmService(LlmService):
    model_name: str = ""

    def answer_from_faqs(self, question: str, candidates: list[FaqVectorRecord]) -> str | None:
        return None

    async def answer_from_faqs_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> str | None:
        return None

    async def stream_answer_from_faqs_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> AsyncIterable[str]:
        if False:
            yield ""
        return

    async def select_best_faq_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> FaqVectorRecord | None:
        if candidates:
            return candidates[0]
        return None


@dataclass
class GeminiLlmService(LlmService):
    api_key: str
    model_name: str

    @property
    def model_id(self) -> str:
        model = (self.model_name or "gemini-2.5-flash").strip()
        if model.startswith("models/"):
            model = model.removeprefix("models/")
        return model

    @property
    def endpoint(self) -> str:
        return (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_id}:generateContent?key={self.api_key}"
        )

    @property
    def stream_endpoint(self) -> str:
        return (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model_id}:streamGenerateContent?key={self.api_key}"
        )

    def _runtime_error(self, exc, operation: str) -> RuntimeError:
        httpx = _load_httpx()
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            try:
                body = exc.response.text[:300].replace(self.api_key, "[redacted]")
            except Exception:
                body = ""
            return RuntimeError(
                f"Gemini {operation} request failed with HTTP {status} for model "
                f"{self.model_id}. Response: {body}"
            )
        return RuntimeError(f"Gemini {operation} request failed for model {self.model_id}: {exc}")

    def _prompt(self, question: str, candidates: list[FaqVectorRecord]) -> str:
        faq_context = "\n\n".join(
            (
                f"FAQ {index + 1}\n"
                f"Question: {candidate.question_snapshot}\n"
                f"Allowed answer: {candidate.answer_snapshot}"
            )
            for index, candidate in enumerate(candidates[:5])
        )
        prompt = (
            "You are a helpful and conversational customer support agent.\n"
            "Your job is to answer the user's question using ONLY the provided FAQ information.\n"
            "If the question cannot be answered using the FAQs, respond with exactly: NO_ANSWER\n"
            "You may combine information from multiple FAQs to give a complete answer.\n"
            "Write your response in a friendly, natural tone. Do not just blindly copy-paste.\n\n"
            f"User question: {question}\n\n"
            f"Available FAQs to use as context:\n{faq_context}"
        )
        return prompt

    def _extract_answer(self, data: dict) -> str | None:
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

    def answer_from_faqs(self, question: str, candidates: list[FaqVectorRecord]) -> str | None:
        if not candidates:
            return None

        httpx = _load_httpx()
        payload = {"contents": [{"parts": [{"text": self._prompt(question, candidates)}]}]}
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    self.endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc, "LLM") from exc

        return self._extract_answer(data)

    async def answer_from_faqs_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> str | None:
        if not candidates:
            return None

        httpx = _load_httpx()
        payload = {"contents": [{"parts": [{"text": self._prompt(question, candidates)}]}]}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc, "LLM") from exc

        return self._extract_answer(data)

    async def stream_answer_from_faqs_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> AsyncIterable[str]:
        if not candidates:
            return

        httpx = _load_httpx()
        payload = {"contents": [{"parts": [{"text": self._prompt(question, candidates)}]}]}
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream(
                    "POST",
                    self.stream_endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    response.raise_for_status()
                    
                    import json
                    buffer = ""
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        
                        # Gemini stream response is a list of JSON objects
                        # Each line starts with "," if it's not the first one
                        line = line.strip()
                        if line.startswith("[") or line.startswith(","):
                            line = line[1:].strip()
                        if line.endswith("]"):
                            line = line[:-1].strip()
                        
                        if not line:
                            continue
                            
                        try:
                            data = json.loads(line)
                            token = (
                                data.get("candidates", [{}])[0]
                                .get("content", {})
                                .get("parts", [{}])[0]
                                .get("text", "")
                            )
                            if token:
                                if token == "NO_ANSWER":
                                    return
                                yield token
                        except json.JSONDecodeError:
                            continue
        except (httpx.HTTPError, ValueError) as exc:
            raise self._runtime_error(exc, "LLM stream") from exc


    async def select_best_faq_async(
        self,
        question: str,
        candidates: list[FaqVectorRecord],
    ) -> FaqVectorRecord | None:
        if not candidates:
            return None

        faq_context = "\n\n".join(
            (
                f"ID: {candidate.id}\n"
                f"Question: {candidate.question_snapshot}\n"
                f"Answer: {candidate.answer_snapshot}"
            )
            for candidate in candidates
        )

        prompt = (
            "You are an expert intent matching AI for a chatbot.\n"
            "Your job is to analyze the logic, entities, and geographical constraints in the user's question, "
            "and determine which of the provided candidate FAQs truly and precisely answers it.\n"
            "If the user asks about a specific location (e.g. Madurai), do NOT select a FAQ about a different location (e.g. Marudhamalai), even if they sound similar.\n"
            "Respond ONLY with the exact ID of the correct FAQ.\n"
            "If none of the candidates perfectly answer the question based on logic, respond with exactly: NONE\n\n"
            f"User question: {question}\n\n"
            f"Candidate FAQs:\n{faq_context}"
        )

        httpx = _load_httpx()
        # Use low temperature for deterministic picking
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.0}
        }
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    self.endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                response.raise_for_status()
                data = response.json()
                
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                )
                
                if text and text != "NONE":
                    for candidate in candidates:
                        if candidate.id == text:
                            return candidate
                            
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("LLM reranking failed: %s", exc)
            
        return None

@lru_cache
def get_llm_service() -> LlmService:
    if settings.gemini_api_key:
        return GeminiLlmService(
            api_key=settings.gemini_api_key,
            model_name=settings.gemini_chat_model,
        )
    return DisabledLlmService()
