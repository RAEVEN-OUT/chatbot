import asyncio

from app.repositories.memory import MemoryRepository
from app.schemas.models import ChatMessageRequest, FaqCreate, FaqVectorRecord, SiteCreate
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


def test_single_semantic_question_does_not_combine_unrelated_faqs():
    repository = MemoryRepository()
    embedder = HashEmbeddingService()
    faq_service = FaqService(repository, embedder)
    site = faq_service.create_site(
        SiteCreate(
            id="demo",
            name="Demo",
            helpline_number="12345",
            faq_accept_distance=0.0,
            faq_review_distance=1.0,
        )
    )
    faq_service.create_faq(
        FaqCreate(question="hello", answer="hi this is chat bot!", site_id=site.id)
    )
    faq_service.create_faq(
        FaqCreate(question="what is today", answer="sunday", site_id=site.id)
    )
    faq_service.create_faq(
        FaqCreate(question="b and d", answer="its D", site_id=site.id)
    )

    retrieval = RetrievalService(repository, embedder, DisabledLlmService())
    response = asyncio.run(
        retrieval.answer(ChatMessageRequest(site_id=site.id, question="whts today"))
    )

    assert response.response_type == "faq_hit"
    assert response.answer == "sunday"


def test_composite_split_reuses_shared_question_prefix():
    retrieval = RetrievalService(MemoryRepository(), HashEmbeddingService(), DisabledLlmService())

    assert retrieval._decompose_question("whts the color of apple and banana") == [
        "whts the color of apple",
        "whts the color of banana",
    ]


def test_broad_composite_filters_unrelated_vector_neighbors():
    retrieval = RetrievalService(MemoryRepository(), HashEmbeddingService(), DisabledLlmService())
    site = SiteCreate(
        id="demo",
        name="Demo",
        helpline_number="12345",
        faq_review_distance=0.45,
        llm_candidate_distance=0.55,
    )
    results = [
        (
            FaqVectorRecord(
                id="apple-vector",
                faq_id="apple",
                site_id="demo",
                source_text="wht is the color of apple",
                source_type="question",
                normalized_text="wht is the color of apple",
                embedding=[],
                question_snapshot="wht is the color of apple",
                answer_snapshot="red",
            ),
            0.2,
        ),
        (
            FaqVectorRecord(
                id="banana-vector",
                faq_id="banana",
                site_id="demo",
                source_text="wht is the color of banana",
                source_type="question",
                normalized_text="wht is the color of banana",
                embedding=[],
                question_snapshot="wht is the color of banana",
                answer_snapshot="yellow",
            ),
            0.22,
        ),
        (
            FaqVectorRecord(
                id="random-vector",
                faq_id="random",
                site_id="demo",
                source_text="b and d",
                source_type="question",
                normalized_text="b and d",
                embedding=[],
                question_snapshot="b and d",
                answer_snapshot="its D",
            ),
            0.23,
        ),
    ]

    response = retrieval._composite_from_ranked_results(site, "whts the colors of fruits", results)

    assert response is not None
    assert response.answer == "1. red\n\n2. yellow"
