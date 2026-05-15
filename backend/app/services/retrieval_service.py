from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import AsyncIterable

from app.core.config import settings
from app.repositories.base import Repository
from app.repositories.utils import new_id
from app.schemas.models import (
    ChatLogRecord,
    ChatMessageRequest,
    ChatMessageResponse,
    ChatSessionRecord,
    FaqVectorRecord,
    ResponseType,
    SiteRecord,
)
from app.services.embedding_service import EmbeddingService
from app.services.llm_service import DisabledLlmService, LlmService
from app.services.text import normalize_text

logger = logging.getLogger(__name__)
_background_tasks: set[asyncio.Task] = set()
_LEXICAL_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "can",
    "do",
    "does",
    "for",
    "give",
    "i",
    "is",
    "me",
    "of",
    "please",
    "tell",
    "the",
    "to",
    "what",
    "whats",
    "wht",
    "whts",
}
_TOKEN_ALIASES = {
    "colours": "color",
    "colour": "color",
    "colors": "color",
    "fruits": "fruit",
}


def _schedule_background(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@dataclass
class RetrievalCandidate:
    answer: str
    response_type: ResponseType
    matched_faq_id: str | None = None
    vector_distance: float | None = None
    llm_model: str = ""


class RetrievalService:
    """Simplified retrieval logic."""
    
    def __init__(
        self,
        repository: Repository,
        embedder: EmbeddingService,
        llm: LlmService | None = None,
    ) -> None:
        self.repository = repository
        self.embedder = embedder
        self.llm = llm or DisabledLlmService()

    def create_session(self, payload) -> ChatSessionRecord:
        session = ChatSessionRecord(
            id=new_id("session"),
            site_id=payload.site_id,
            name=payload.name,
            email=payload.email,
            phone=payload.phone,
        )
        return self.repository.create_session(session)

    async def answer(self, payload: ChatMessageRequest) -> ChatMessageResponse:
        site_task = asyncio.to_thread(self.repository.get_site, payload.site_id)
        session_task = (
            asyncio.to_thread(self.repository.get_session, payload.session_id)
            if payload.session_id
            else self._none()
        )
        site, session = await asyncio.gather(site_task, session_task)

        if not site or not site.active or site.deleted_at is not None:
            return ChatMessageResponse(
                answer="This chatbot is not active.",
                response_type=ResponseType.error,
                session_id=payload.session_id,
            )

        if session and session.site_id != payload.site_id:
            session = None

        session_write_task = None
        if not session:
            session = ChatSessionRecord(
                id=new_id("session"),
                site_id=payload.site_id,
                name=payload.name,
                email=payload.email,
                phone=payload.phone,
            )
            session_write_task = asyncio.create_task(
                asyncio.to_thread(self.repository.create_session, session)
            )

        candidate = await self._retrieve(site=site, question=payload.question)
        if session_write_task:
            await session_write_task

        self._log_candidate_background(site, session, payload, candidate)

        return ChatMessageResponse(
            answer=candidate.answer,
            response_type=candidate.response_type,
            matched_faq_id=candidate.matched_faq_id,
            vector_distance=candidate.vector_distance,
            session_id=session.id,
        )

    async def _none(self) -> None:
        return None

    async def _add_log(self, log: ChatLogRecord) -> None:
        try:
            await asyncio.to_thread(self.repository.add_log, log)
        except Exception:
            logger.exception("Failed to save chat log %s", log.id)

    def _contact_fields(
        self,
        session: ChatSessionRecord,
        payload: ChatMessageRequest,
    ) -> tuple[str, str, str]:
        user_name = (session.name or payload.name) or "anonymous"
        email = (session.email or payload.email) or ""
        phone = (session.phone or payload.phone) or ""
        return user_name, email, phone

    def _log_candidate_background(
        self,
        site: SiteRecord,
        session: ChatSessionRecord,
        payload: ChatMessageRequest,
        candidate: RetrievalCandidate,
    ) -> None:
        if not settings.collect_all_chat_logs and candidate.response_type == ResponseType.faq_hit:
            return

        user_name, email, phone = self._contact_fields(session, payload)
        _schedule_background(
            self._add_log(
                ChatLogRecord(
                    id=new_id("log"),
                    site_id=site.id,
                    session_id=session.id,
                    user_name=user_name,
                    email=email,
                    phone=phone,
                    question=payload.question,
                    answer=candidate.answer,
                    response_type=candidate.response_type,
                    matched_faq_id=candidate.matched_faq_id,
                    vector_distance=candidate.vector_distance,
                    llm_model=candidate.llm_model,
                )
            )
        )

    async def _retrieve(self, site: SiteRecord, question: str) -> RetrievalCandidate:
        normalized = normalize_text(question)
        exact_vector = await asyncio.to_thread(
            self.repository.get_vector_by_normalized_text,
            site.id,
            normalized,
        )
        if exact_vector:
            return self._faq_hit(exact_vector, 0.0)

        try:
            query_embedding = await self.embedder.embed_async(question)
            results = await asyncio.to_thread(
                self.repository.search_vectors,
                site.id,
                query_embedding,
                settings.vector_search_limit,
            )
        except Exception:
            logger.exception("Embedding failed for site %s, falling back", site.id)
            results = []
        if not results:
            return self._helpline(site, None, None)

        best_vector, best_distance = results[0]
        should_try_composite = bool(self._decompose_question(question)) or self._is_aggregation_question(question)
        if should_try_composite:
            composite = await self._composite_faq_answer(site, question, results)
            if composite:
                return composite
            llm_candidate = await self._llm_fallback_answer(site, question, results)
            if llm_candidate:
                return llm_candidate
            return self._helpline(site, best_vector.faq_id, best_distance)

        if best_distance <= site.faq_accept_distance:
            return self._faq_hit(best_vector, best_distance)

        if best_distance <= site.faq_review_distance:
            return self._faq_hit(best_vector, best_distance)

        llm_candidate = await self._llm_fallback_answer(site, question, results)
        if llm_candidate:
            return llm_candidate

        return self._helpline(site, best_vector.faq_id, best_distance)

    def _decompose_question(self, question: str) -> list[str]:
        parts = [
            part.strip(" .?!,;:")
            for part in re.split(r"\s+(?:and|also|plus|with|along with)\s+|[?;]\s*", question, flags=re.I)
        ]
        useful: list[str] = []
        shared_prefix = ""
        for index, part in enumerate(parts):
            tokens = part.split()
            if len(tokens) >= 3:
                useful.append(part)
                if index == 0 and len(tokens) > 3:
                    shared_prefix = " ".join(tokens[:-1])
                continue
            if shared_prefix and tokens:
                useful.append(f"{shared_prefix} {' '.join(tokens)}")
        if len(useful) <= 1:
            return []
        unique: list[str] = []
        seen: set[str] = set()
        for part in useful[:4]:
            normalized = normalize_text(part)
            if normalized and normalized not in seen:
                seen.add(normalized)
                unique.append(part)
        return unique

    def _is_aggregation_question(self, question: str) -> bool:
        normalized = normalize_text(question)
        tokens = set(normalized.split())
        if not tokens:
            return False
        if tokens & {"hello", "hi", "hey", "today", "now"}:
            return False
        if re.search(r"\b(?:all|list|multiple|both|each|various|different|fruits|colors|colours)\b", normalized):
            return True
        return bool(re.search(r"\bwhat(?:s| is| are)?\b.*\b(?:types|kinds|options|answers|colors|colours)\b", normalized))

    def _important_tokens(self, text: str) -> set[str]:
        tokens: set[str] = set()
        for token in normalize_text(text).split():
            if len(token) <= 1 or token in _LEXICAL_STOP_WORDS:
                continue
            token = _TOKEN_ALIASES.get(token, token)
            if len(token) > 3 and token.endswith("s"):
                token = token[:-1]
            tokens.add(token)
        return tokens

    def _lexical_score(self, question: str, vector: FaqVectorRecord) -> int:
        query_tokens = self._important_tokens(question)
        if not query_tokens:
            return 0
        faq_tokens = self._important_tokens(
            f"{vector.question_snapshot} {vector.source_text}"
        )
        return len(query_tokens & faq_tokens)

    def _best_chunk_match(
        self,
        question: str,
        results: list[tuple[FaqVectorRecord, float]],
        max_distance: float,
    ) -> tuple[FaqVectorRecord, float] | None:
        eligible = [
            (vector, distance)
            for vector, distance in results
            if distance <= max_distance
        ]
        if not eligible:
            return None
        best = max(
            eligible,
            key=lambda item: (self._lexical_score(question, item[0]), -item[1]),
        )
        if self._important_tokens(question) and self._lexical_score(question, best[0]) == 0:
            return None
        return best

    async def _composite_faq_answer(
        self,
        site: SiteRecord,
        question: str,
        initial_results: list[tuple[FaqVectorRecord, float]],
    ) -> RetrievalCandidate | None:
        sub_questions = self._decompose_question(question)
        if len(sub_questions) < 2:
            if self._is_aggregation_question(question):
                return self._composite_from_ranked_results(site, question, initial_results)
            return None

        async def match_sub_question(sub_question: str) -> tuple[str, FaqVectorRecord, float] | None:
            normalized = normalize_text(sub_question)
            exact = await asyncio.to_thread(
                self.repository.get_vector_by_normalized_text,
                site.id,
                normalized,
            )
            if exact:
                return sub_question, exact, 0.0
            try:
                embedding = await self.embedder.embed_async(sub_question)
                results = await asyncio.to_thread(
                    self.repository.search_vectors,
                    site.id,
                    embedding,
                    settings.vector_search_limit,
                )
            except Exception:
                logger.exception("Composite retrieval failed for site %s", site.id)
                return None
            if not results:
                return None
            match = self._best_chunk_match(
                sub_question,
                results,
                max(site.faq_review_distance, site.llm_candidate_distance),
            )
            if match:
                vector, distance = match
                return sub_question, vector, distance
            return None

        matches = await asyncio.gather(*(match_sub_question(part) for part in sub_questions))
        valid_matches = [match for match in matches if match]
        if len(valid_matches) < 2 or len(valid_matches) != len(sub_questions):
            return None

        by_faq: dict[str, tuple[str, FaqVectorRecord, float]] = {}
        for match in valid_matches:
            _, vector, distance = match
            current = by_faq.get(vector.faq_id)
            if not current or distance < current[2]:
                by_faq[vector.faq_id] = match

        if len(by_faq) < 2:
            return None

        ordered = list(by_faq.values())
        answer = "\n\n".join(
            f"{index + 1}. {vector.answer_snapshot}"
            for index, (_, vector, _) in enumerate(ordered)
        )
        best_vector, best_distance = initial_results[0]
        return RetrievalCandidate(
            answer=answer,
            response_type=ResponseType.faq_hit,
            matched_faq_id=best_vector.faq_id,
            vector_distance=min(distance for _, _, distance in ordered),
        )

    def _composite_from_ranked_results(
        self,
        site: SiteRecord,
        question: str,
        results: list[tuple[FaqVectorRecord, float]],
    ) -> RetrievalCandidate | None:
        if not results:
            return None
        _, best_distance = results[0]
        if best_distance > site.faq_review_distance:
            return None

        max_distance = min(site.llm_candidate_distance, max(best_distance + 0.08, site.faq_review_distance))
        by_faq: dict[str, tuple[FaqVectorRecord, float]] = {}
        for vector, distance in results:
            if distance > max_distance:
                continue
            if self._lexical_score(question, vector) == 0:
                continue
            current = by_faq.get(vector.faq_id)
            if not current or distance < current[1]:
                by_faq[vector.faq_id] = (vector, distance)

        if len(by_faq) < 2:
            return None

        ordered = sorted(by_faq.values(), key=lambda item: item[1])[:4]
        answer = "\n\n".join(
            f"{index + 1}. {vector.answer_snapshot}"
            for index, (vector, _) in enumerate(ordered)
        )
        best_vector, best_distance = ordered[0]
        return RetrievalCandidate(
            answer=answer,
            response_type=ResponseType.faq_hit,
            matched_faq_id=best_vector.faq_id,
            vector_distance=best_distance,
        )

    def _llm_candidates(
        self,
        site: SiteRecord,
        question: str,
        results: list[tuple[FaqVectorRecord, float]],
    ) -> list[FaqVectorRecord]:
        max_distance = min(site.llm_candidate_distance, site.faq_review_distance + 0.15)
        aggregation = self._is_aggregation_question(question) or bool(self._decompose_question(question))
        candidates: list[FaqVectorRecord] = []
        seen: set[str] = set()
        for vector, distance in results:
            if distance > max_distance or vector.faq_id in seen:
                continue
            if aggregation and self._lexical_score(question, vector) == 0:
                continue
            seen.add(vector.faq_id)
            candidates.append(vector)
        return candidates[:5]

    async def _llm_fallback_answer(
        self,
        site: SiteRecord,
        question: str,
        results: list[tuple[FaqVectorRecord, float]],
    ) -> RetrievalCandidate | None:
        if not self.llm.model_name:
            return None
        candidates = self._llm_candidates(site, question, results)
        if not candidates:
            return None
        try:
            answer = await self.llm.answer_from_faqs_async(question, candidates, site=site)
        except Exception:
            logger.exception("LLM fallback failed for site %s", site.id)
            return None
        if not answer:
            return None
        best_vector, best_distance = results[0]
        return RetrievalCandidate(
            answer=answer,
            response_type=ResponseType.llm_fallback,
            matched_faq_id=best_vector.faq_id,
            vector_distance=best_distance,
            llm_model=self.llm.model_name,
        )

    def _faq_hit(
        self,
        vector: FaqVectorRecord,
        distance: float,
    ) -> RetrievalCandidate:
        return RetrievalCandidate(
            answer=vector.answer_snapshot,
            response_type=ResponseType.faq_hit,
            matched_faq_id=vector.faq_id,
            vector_distance=distance,
        )

    def _helpline(
        self,
        site: SiteRecord,
        matched_faq_id: str | None,
        distance: float | None,
    ) -> RetrievalCandidate:
        answer = f"{site.fallback_message} Helpline: {site.helpline_number}"
        return RetrievalCandidate(
            answer=answer,
            response_type=ResponseType.helpline,
            matched_faq_id=matched_faq_id,
            vector_distance=distance,
        )

    async def stream_answer(self, payload: ChatMessageRequest) -> AsyncIterable[dict]:
        site_task = asyncio.to_thread(self.repository.get_site, payload.site_id)
        session_task = (
            asyncio.to_thread(self.repository.get_session, payload.session_id)
            if payload.session_id
            else self._none()
        )
        site, session = await asyncio.gather(site_task, session_task)

        if not site or not site.active or site.deleted_at is not None:
            yield {
                "type": "metadata",
                "answer": "This chatbot is not active.",
                "response_type": ResponseType.error.value,
            }
            return

        if session and session.site_id != payload.site_id:
            session = None

        if not session:
            session = ChatSessionRecord(
                id=new_id("session"),
                site_id=payload.site_id,
                name=payload.name,
                email=payload.email,
                phone=payload.phone,
            )
            await asyncio.to_thread(self.repository.create_session, session)

        normalized = normalize_text(payload.question)
        exact_vector = await asyncio.to_thread(
            self.repository.get_vector_by_normalized_text,
            site.id,
            normalized,
        )

        candidate: RetrievalCandidate | None = None
        if exact_vector:
            candidate = self._faq_hit(exact_vector, 0.0)
        else:
            try:
                query_embedding = await self.embedder.embed_async(payload.question)
                results = await asyncio.to_thread(
                    self.repository.search_vectors,
                    site.id,
                    query_embedding,
                    settings.vector_search_limit,
                )
            except Exception:
                logger.exception("Embedding failed for site %s, falling back", site.id)
                results = []
            if results:
                best_vector, best_distance = results[0]
                should_try_composite = bool(self._decompose_question(payload.question)) or self._is_aggregation_question(payload.question)
                if should_try_composite:
                    candidate = await self._composite_faq_answer(site, payload.question, results)
                    if not candidate:
                        candidate = await self._llm_fallback_answer(site, payload.question, results)
                    if not candidate:
                        candidate = self._helpline(site, best_vector.faq_id, best_distance)
                elif best_distance <= site.faq_accept_distance:
                    candidate = self._faq_hit(best_vector, best_distance)
                else:
                    if best_distance <= site.faq_review_distance:
                        candidate = self._faq_hit(best_vector, best_distance)
                    else:
                        candidate = await self._llm_fallback_answer(site, payload.question, results)
                        if not candidate:
                            candidate = self._helpline(site, best_vector.faq_id, best_distance)
            else:
                candidate = self._helpline(site, None, None)

        if not candidate:
            candidate = self._helpline(site, None, None)

        yield {
            "type": "metadata",
            "response_type": candidate.response_type.value,
            "matched_faq_id": candidate.matched_faq_id,
            "vector_distance": candidate.vector_distance,
            "session_id": session.id,
        }
        yield {"type": "token", "text": candidate.answer}
        self._log_candidate_background(site, session, payload, candidate)
        yield {"type": "done"}
        return

