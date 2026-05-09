from __future__ import annotations

from app.repositories.base import Repository
from app.repositories.utils import merge_update, model_to_dict, new_id, slugify
from app.schemas.models import (
    ConvertLogRequest,
    FaqCreate,
    FaqRecord,
    FaqUpdate,
    FaqVectorRecord,
    OwnerType,
    SiteCreate,
    SiteGroupCreate,
    SiteGroupRecord,
    SiteGroupUpdate,
    SiteRecord,
    SiteUpdate,
    utc_now,
)
from app.services.embedding_service import EmbeddingService
from app.services.text import normalize_text


class FaqService:
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

    def create_group(self, payload: SiteGroupCreate) -> SiteGroupRecord:
        group_id = payload.id or slugify(payload.name, "group")
        data = model_to_dict(payload)
        data.pop("id", None)
        group = SiteGroupRecord(id=group_id, **data)
        saved = self.repository.upsert_group(group)
        self.reindex_group(saved.id)
        return saved

    def update_group(
        self,
        group_id: str,
        payload: SiteGroupUpdate,
    ) -> SiteGroupRecord | None:
        group = self.repository.get_group(group_id)
        if not group:
            return None
        updated = SiteGroupRecord(**merge_update(group, payload))
        saved = self.repository.upsert_group(updated)
        self.reindex_group(saved.id)
        return saved

    def create_faq(self, payload: FaqCreate) -> FaqRecord:
        faq_id = payload.id or new_id("faq")
        owner_type = payload.owner_type
        if payload.group_ids or len(payload.site_ids) > 1:
            owner_type = OwnerType.common
        data = model_to_dict(payload)
        data.pop("id", None)
        data["owner_type"] = owner_type
        faq = FaqRecord(id=faq_id, **data)
        saved = self.repository.upsert_faq(faq)
        self.reindex_faq(saved.id)
        return saved

    def update_faq(self, faq_id: str, payload: FaqUpdate) -> FaqRecord | None:
        faq = self.repository.get_faq(faq_id)
        if not faq:
            return None
        updated = FaqRecord(**merge_update(faq, payload))
        if updated.group_ids or len(updated.site_ids) > 1:
            data = model_to_dict(updated)
            data["owner_type"] = OwnerType.common
            updated = FaqRecord(**data)
        saved = self.repository.upsert_faq(updated)
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
                vector_id = new_id("vec")
                vectors.append(
                    FaqVectorRecord(
                        id=vector_id,
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

    def convert_log_to_faq(
        self,
        log_id: str,
        payload: ConvertLogRequest,
    ) -> FaqRecord | None:
        logs = self.repository.list_logs()
        log = next((item for item in logs if item.id == log_id), None)
        if not log:
            return None

        site_ids = (
            payload.site_ids
            if payload.site_ids
            else ([] if payload.group_ids else [log.site_id])
        )
        faq = self.create_faq(
            FaqCreate(
                question=log.question,
                answer=payload.answer or log.answer,
                aliases=payload.aliases,
                site_ids=site_ids,
                group_ids=payload.group_ids,
            )
        )
        updated_log = log.model_copy(
            update={"review_status": "converted", "converted_to_faq_id": faq.id}
        )
        self.repository.update_log(updated_log)
        return faq
