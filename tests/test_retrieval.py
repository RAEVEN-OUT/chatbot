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
            site_ids=[site.id],
        )
    )

    retrieval = RetrievalService(repository, embedder, DisabledLlmService())
    response = retrieval.answer(
        ChatMessageRequest(site_id=site.id, question="wht is xyz")
    )

    assert response.response_type == "faq_hit"
    assert response.answer == faq.answer
