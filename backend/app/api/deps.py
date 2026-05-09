from __future__ import annotations

from app.repositories.base import Repository
from app.repositories.factory import get_repository
from app.services.embedding_service import get_embedding_service
from app.services.faq_service import FaqService
from app.services.llm_service import get_llm_service
from app.services.retrieval_service import RetrievalService


def get_repo() -> Repository:
    return get_repository()


def get_faq_service() -> FaqService:
    repository = get_repository()
    return FaqService(repository=repository, embedder=get_embedding_service())


def get_retrieval_service() -> RetrievalService:
    repository = get_repository()
    return RetrievalService(
        repository=repository,
        embedder=get_embedding_service(),
        llm=get_llm_service(),
    )
