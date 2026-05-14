import asyncio

from app.repositories.memory import MemoryRepository
from app.schemas.models import ChatMessageRequest, FaqCreate, SiteCreate
from app.services.embedding_service import HashEmbeddingService
from app.services.faq_service import FaqService
from app.services.llm_service import DisabledLlmService
from app.services.retrieval_service import RetrievalService


def test_exact_alias_returns_faq_answer():
    repository = MemoryRepository()
    embedder = HashEmbeddingService()
    faq_service = FaqService(repository, embedder)
    site = faq_service.create_site(
        SiteCreate(
            id="demo",
            name="Demo",
            helpline_number="12345",
        )
    )
    faq = faq_service.create_faq(
        FaqCreate(
            question="What is XYZ?",
            answer="XYZ is the exact saved answer.",
            aliases=["tell me about xyz", "wht is xyz"],
            site_id=site.id,
        )
    )

    retrieval = RetrievalService(repository, embedder, DisabledLlmService())
    response = asyncio.run(
        retrieval.answer(ChatMessageRequest(site_id=site.id, question="wht is xyz"))
    )

    assert response.response_type == "faq_hit"
    assert response.answer == faq.answer


def test_exact_match_is_scoped_to_site():
    repository = MemoryRepository()
    embedder = HashEmbeddingService()
    faq_service = FaqService(repository, embedder)
    first_site = faq_service.create_site(
        SiteCreate(id="first", name="First", helpline_number="111")
    )
    second_site = faq_service.create_site(
        SiteCreate(id="second", name="Second", helpline_number="222")
    )
    faq_service.create_faq(
        FaqCreate(question="support", answer="First answer.", site_id=first_site.id)
    )
    faq_service.create_faq(
        FaqCreate(question="support", answer="Second answer.", site_id=second_site.id)
    )

    retrieval = RetrievalService(repository, embedder, DisabledLlmService())
    first_response = asyncio.run(
        retrieval.answer(ChatMessageRequest(site_id=first_site.id, question="support"))
    )
    second_response = asyncio.run(
        retrieval.answer(ChatMessageRequest(site_id=second_site.id, question="support"))
    )

    assert first_response.answer == "First answer."
    assert second_response.answer == "Second answer."
