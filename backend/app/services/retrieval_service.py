from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings
from app.repositories.base import Repository
from app.repositories.utils import new_id
from app.schemas.models import (
    ChatLogRecord,
    ChatMessageRequest,
    ChatMessageResponse,
    ChatSessionRecord,
    ResponseType,
    ReviewStatus,
    utc_now,
)
from app.services.embedding_service import EmbeddingService
from app.services.llm_service import LlmService
from app.services.text import normalize_text


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

    def answer(self, payload: ChatMessageRequest) -> ChatMessageResponse:
        site = self.repository.get_site(payload.site_id)
        if not site or not site.active:
            return ChatMessageResponse(
                answer="This chatbot is not active.",
                response_type=ResponseType.error,
                session_id=payload.session_id,
            )

        session = None
        if payload.session_id:
            session = self.repository.get_session(payload.session_id)
        if not session:
            session = self.repository.create_session(
                ChatSessionRecord(
                    id=new_id("session"),
                    site_id=payload.site_id,
                    name=payload.name,
                    email=payload.email,
                    phone=payload.phone,
                )
            )

        candidate = self._retrieve(site_id=site.id, question=payload.question)

        should_log = (
            settings.collect_all_chat_logs
            or candidate.response_type != ResponseType.faq_hit
        )
        if should_log:
            review_status = (
                ReviewStatus.reviewed
                if candidate.response_type == ResponseType.faq_hit
                else ReviewStatus.pending
            )
            self.repository.add_log(
                ChatLogRecord(
                    id=new_id("log"),
                    site_id=site.id,
                    session_id=session.id,
                    user_name=session.name or payload.name,
                    email=session.email or payload.email,
                    phone=session.phone or payload.phone,
                    question=payload.question,
                    answer=candidate.answer,
                    response_type=candidate.response_type,
                    matched_faq_id=candidate.matched_faq_id,
                    vector_distance=candidate.vector_distance,
                    llm_model=candidate.llm_model,
                    review_status=review_status,
                )
            )

        return ChatMessageResponse(
            answer=candidate.answer,
            response_type=candidate.response_type,
            matched_faq_id=candidate.matched_faq_id,
            vector_distance=candidate.vector_distance,
            session_id=session.id,
        )

    def _retrieve(self, site_id: str, question: str) -> RetrievalCandidate:
        site = self.repository.get_site(site_id)
        if not site:
            return RetrievalCandidate(
                answer="This chatbot is not active.",
                response_type=ResponseType.error,
            )

        normalized = normalize_text(question)
        for vector in self.repository.list_vectors_for_site(site_id):
            if vector.normalized_text == normalized:
                return RetrievalCandidate(
                    answer=vector.answer_snapshot,
                    response_type=ResponseType.faq_hit,
                    matched_faq_id=vector.faq_id,
                    vector_distance=0.0,
                )

        query_embedding = self.embedder.embed(question)
        results = self.repository.search_vectors(site_id, query_embedding, limit=5)
        if results:
            best_vector, best_distance = results[0]
            if best_distance <= site.faq_accept_distance:
                return RetrievalCandidate(
                    answer=best_vector.answer_snapshot,
                    response_type=ResponseType.faq_hit,
                    matched_faq_id=best_vector.faq_id,
                    vector_distance=best_distance,
                )

            llm_candidates = [
                vector
                for vector, distance in results
                if distance <= site.llm_candidate_distance
            ]
            if llm_candidates:
                llm_answer = self.llm.answer_from_faqs(question, llm_candidates)
                if llm_answer:
                    return RetrievalCandidate(
                        answer=llm_answer,
                        response_type=ResponseType.llm_fallback,
                        matched_faq_id=best_vector.faq_id,
                        vector_distance=best_distance,
                        llm_model=self.llm.model_name,
                    )

            return self._helpline(site_id, best_vector.faq_id, best_distance)

        return self._helpline(site_id, None, None)

    def _helpline(
        self,
        site_id: str,
        matched_faq_id: str | None,
        distance: float | None,
    ) -> RetrievalCandidate:
        site = self.repository.get_site(site_id)
        if not site:
            return RetrievalCandidate("This chatbot is not active.", ResponseType.error)
        answer = f"{site.fallback_message} Helpline: {site.helpline_number}"
        return RetrievalCandidate(
            answer=answer,
            response_type=ResponseType.helpline,
            matched_faq_id=matched_faq_id,
            vector_distance=distance,
        )
