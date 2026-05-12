from __future__ import annotations
from fastapi import BackgroundTasks

from app.repositories.base import Repository
from app.repositories.utils import merge_update, model_to_dict, new_id, slugify
from app.schemas.models import (
    FaqCreate,
    FaqRecord,
    FaqUpdate,
    FaqVectorRecord,
    SiteCreate,
    SiteRecord,
    SiteUpdate,
    SiteGroupCreate,
    SiteGroupRecord,
    SiteGroupUpdate,
    utc_now,
)
from app.services.embedding_service import EmbeddingService
from app.services.text import normalize_text


class FaqService:
    """Simplified service for managing sites, groups, and FAQs."""
    
    def __init__(self, repository: Repository, embedder: EmbeddingService) -> None:
        self.repository = repository
        self.embedder = embedder

    def create_site(self, payload: SiteCreate) -> SiteRecord:
        site_id = payload.id or slugify(payload.domain or payload.name, "site")
        data = model_to_dict(payload)
        data.pop("id", None)
        site = SiteRecord(id=site_id, **data)
        return self.repository.upsert_site(site)

    def update_site(self, site_id: str, payload: SiteUpdate) -> SiteRecord | None:
        site = self.repository.get_site(site_id)
        if not site:
            return None
        updated = SiteRecord(**merge_update(site, payload))
        return self.repository.upsert_site(updated)

    def create_group(self, payload: SiteGroupCreate, background_tasks: BackgroundTasks | None = None) -> SiteGroupRecord:
        group_id = payload.id or slugify(payload.name, "group")
        data = model_to_dict(payload)
        data.pop("id", None)
        group = SiteGroupRecord(id=group_id, **data)
        saved = self.repository.upsert_group(group)
        if background_tasks:
            background_tasks.add_task(self.reindex_group, saved.id)
        else:
            self.reindex_group(saved.id)
        return saved

    def update_group(self, group_id: str, payload: SiteGroupUpdate, background_tasks: BackgroundTasks | None = None) -> SiteGroupRecord | None:
        group = self.repository.get_group(group_id)
        if not group:
            return None
        updated = SiteGroupRecord(**merge_update(group, payload))
        saved = self.repository.upsert_group(updated)
        if background_tasks:
            background_tasks.add_task(self.reindex_group, saved.id)
        else:
            self.reindex_group(saved.id)
        return saved

    def create_faq(self, payload: FaqCreate, background_tasks: BackgroundTasks | None = None) -> FaqRecord:
        faq_id = payload.id or new_id("faq")
        data = model_to_dict(payload)
        data.pop("id", None)
        faq = FaqRecord(id=faq_id, **data)
        saved = self.repository.upsert_faq(faq)
        
        if background_tasks:
            background_tasks.add_task(self.reindex_faq, saved.id)
        else:
            self.reindex_faq(saved.id)
        return saved

    def update_faq(self, faq_id: str, payload: FaqUpdate, background_tasks: BackgroundTasks | None = None) -> FaqRecord | None:
        faq = self.repository.get_faq(faq_id)
        if not faq:
            return None
        updated = FaqRecord(**merge_update(faq, payload))
        saved = self.repository.upsert_faq(updated)
        
        if background_tasks:
            background_tasks.add_task(self.reindex_faq, saved.id)
        else:
            self.reindex_faq(saved.id)
        return saved

    def delete_faq(self, faq_id: str) -> None:
        self.repository.delete_faq(faq_id)

    def resolve_target_site_ids(self, faq: FaqRecord) -> list[str]:
        site_ids = set(faq.site_ids)
        for group_id in faq.group_ids:
            group = self.repository.get_group(group_id)
            if group and group.active:
                site_ids.update(group.site_ids)
        return sorted(site_ids)

    def reindex_group(self, group_id: str) -> None:
        for faq in self.repository.list_faqs(group_id=group_id, include_inactive=True):
            self.reindex_faq(faq.id)

    def reindex_faq(self, faq_id: str) -> None:
        faq = self.repository.get_faq(faq_id)
        if not faq or not faq.active:
            self.repository.replace_vectors_for_faq(faq_id, [])
            return

        texts = [("main_question", faq.question)]
        texts.extend(("alias", alias) for alias in faq.aliases if alias.strip())

        vectors: list[FaqVectorRecord] = []
        for site_id in self.resolve_target_site_ids(faq):
            if not self.repository.get_site(site_id):
                continue
            for source_type, source_text in texts:
                vectors.append(
                    FaqVectorRecord(
                        id=new_id("vec"),
                        faq_id=faq.id,
                        site_id=site_id,
                        source_text=source_text,
                        source_type=source_type,
                        normalized_text=normalize_text(source_text),
                        embedding=self.embedder.embed(source_text),
                        answer_snapshot=faq.answer,
                        question_snapshot=faq.question,
                        active=faq.active,
                        updated_at=utc_now(),
                    )
                )
        self.repository.replace_vectors_for_faq(faq.id, vectors)

    def reindex_site(self, site_id: str) -> int:
        faqs = self.repository.list_faqs(site_id=site_id)
        for faq in faqs:
            self.reindex_faq(faq.id)
        return len(faqs)
