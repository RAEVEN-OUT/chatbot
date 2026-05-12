from __future__ import annotations

import asyncio
import logging
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
    ReviewStatus,
    SiteRecord,
)
from app.services.embedding_service import EmbeddingService
from app.services.llm_service import LlmService
from app.services.text import normalize_text

logger = logging.getLogger(__name__)
_background_tasks: set[asyncio.Task] = set()


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
    def __init__(
        self,
        repository: Repository,
        embedder: EmbeddingService,
        llm: LlmService,
    ) -> None:
        self.repository = repository
        self.embedder = embedder
        self.llm = llm

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

        if not site or not site.active:
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

        review_status = (
            ReviewStatus.reviewed
            if candidate.response_type == ResponseType.faq_hit
            else ReviewStatus.pending
        )
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
                    review_status=review_status,
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

        query_embedding = await self.embedder.embed_async(question)
        results = await asyncio.to_thread(
            self.repository.search_vectors,
            site.id,
            query_embedding,
            settings.vector_search_limit,
        )
        if not results:
            return self._helpline(site, None, None)

        best_vector, best_distance = results[0]
        if best_distance <= site.faq_accept_distance:
            return self._faq_hit(best_vector, best_distance)

        llm_candidates = [
            vector
            for vector, distance in results
            if distance <= site.llm_candidate_distance
        ][:3]

        if self.llm.model_name and llm_candidates:
            reranked_faq = await self.llm.select_best_faq_async(question, llm_candidates)
            if reranked_faq:
                reranked_distance = next(
                    distance for vector, distance in results if vector.id == reranked_faq.id
                )
                return self._faq_hit(reranked_faq, reranked_distance)

            llm_answer = await self.llm.answer_from_faqs_async(question, llm_candidates)
            if llm_answer:
                return RetrievalCandidate(
                    answer=llm_answer,
                    response_type=ResponseType.llm_fallback,
                    matched_faq_id=best_vector.faq_id,
                    vector_distance=best_distance,
                    llm_model=self.llm.model_name,
                )

        if not self.llm.model_name and best_distance <= site.faq_review_distance:
            return self._faq_hit(best_vector, best_distance)

        return self._helpline(site, best_vector.faq_id, best_distance)

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

        if not site or not site.active:
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
            query_embedding = await self.embedder.embed_async(payload.question)
            results = await asyncio.to_thread(
                self.repository.search_vectors,
                site.id,
                query_embedding,
                settings.vector_search_limit,
            )
            if results:
                best_vector, best_distance = results[0]
                if best_distance <= site.faq_accept_distance:
                    candidate = self._faq_hit(best_vector, best_distance)
                else:
                    llm_candidates = [
                        vector
                        for vector, distance in results
                        if distance <= site.llm_candidate_distance
                    ][:3]

                    if self.llm.model_name and llm_candidates:
                        reranked_faq = await self.llm.select_best_faq_async(
                            payload.question,
                            llm_candidates,
                        )
                        if reranked_faq:
                            reranked_distance = next(
                                distance
                                for vector, distance in results
                                if vector.id == reranked_faq.id
                            )
                            candidate = self._faq_hit(reranked_faq, reranked_distance)
                        else:
                            async for event in self._stream_llm_fallback(
                                site,
                                session,
                                payload,
                                best_vector,
                                best_distance,
                                llm_candidates,
                            ):
                                yield event
                            return
                    elif not self.llm.model_name and best_distance <= site.faq_review_distance:
                        candidate = self._faq_hit(best_vector, best_distance)
                    elif self.llm.model_name:
                        async for event in self._stream_llm_fallback(
                            site,
                            session,
                            payload,
                            best_vector,
                            best_distance,
                            [vector for vector, _ in results[:3]],
                        ):
                            yield event
                        return
                    else:
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

    async def _stream_llm_fallback(
        self,
        site: SiteRecord,
        session: ChatSessionRecord,
        payload: ChatMessageRequest,
        best_vector: FaqVectorRecord,
        best_distance: float,
        candidates: list[FaqVectorRecord],
    ) -> AsyncIterable[dict]:
        yield {
            "type": "metadata",
            "response_type": ResponseType.llm_fallback.value,
            "matched_faq_id": best_vector.faq_id,
            "vector_distance": best_distance,
            "session_id": session.id,
        }

        full_answer = ""
        try:
            async for token in self.llm.stream_answer_from_faqs_async(payload.question, candidates):
                full_answer += token
                yield {"type": "token", "text": token}
        except Exception:
            logger.exception("LLM stream fallback failed for site %s", site.id)

        if not full_answer:
            helpline = self._helpline(site, best_vector.faq_id, best_distance)
            yield {"type": "token", "text": helpline.answer}
            self._log_candidate_background(site, session, payload, helpline)
            yield {"type": "done"}
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
                    answer=full_answer,
                    response_type=ResponseType.llm_fallback,
                    matched_faq_id=best_vector.faq_id,
                    vector_distance=best_distance,
                    llm_model=self.llm.model_name,
                    review_status=ReviewStatus.pending,
                )
            )
        )
        yield {"type": "done"}
