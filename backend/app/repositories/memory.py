from __future__ import annotations

import math

from app.repositories.base import Repository
from app.schemas.models import (
    ChatLogRecord,
    ChatSessionRecord,
    FaqRecord,
    FaqVectorRecord,
    ResponseType,
    ReviewStatus,
    SiteGroupRecord,
    SiteRecord,
    BackgroundTaskRecord,
)


def cosine_distance(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 1.0
    cosine_similarity = dot / (left_norm * right_norm)
    return 1.0 - cosine_similarity


class MemoryRepository(Repository):
    """Process-local repository used for development and tests."""

    def __init__(self) -> None:
        self.sites: dict[str, SiteRecord] = {}
        self.groups: dict[str, SiteGroupRecord] = {}
        self.faqs: dict[str, FaqRecord] = {}
        self.vectors: dict[str, FaqVectorRecord] = {}
        self.vector_exact_index: dict[tuple[str, str], str] = {}
        self.sessions: dict[str, ChatSessionRecord] = {}
        self.logs: dict[str, ChatLogRecord] = {}
        self.tasks: dict[str, BackgroundTaskRecord] = {}

    def _rebuild_vector_indexes(self) -> None:
        self.vector_exact_index = {
            (vector.site_id, vector.normalized_text): vector.id
            for vector in self.vectors.values()
            if vector.active
        }

    def list_sites(self, include_deleted: bool = False) -> list[SiteRecord]:
        sites = list(self.sites.values())
        if not include_deleted:
            sites = [site for site in sites if site.deleted_at is None]
        return sorted(sites, key=lambda item: item.updated_at, reverse=True)

    def get_site(self, site_id: str) -> SiteRecord | None:
        return self.sites.get(site_id)

    def upsert_site(self, site: SiteRecord) -> SiteRecord:
        self.sites[site.id] = site
        return site

    def delete_site(self, site_id: str) -> None:
        self.sites.pop(site_id, None)
        self.vectors = {
            key: value for key, value in self.vectors.items() if value.site_id != site_id
        }
        self._rebuild_vector_indexes()

    def list_groups(self) -> list[SiteGroupRecord]:
        return sorted(self.groups.values(), key=lambda item: item.updated_at, reverse=True)

    def get_group(self, group_id: str) -> SiteGroupRecord | None:
        return self.groups.get(group_id)

    def upsert_group(self, group: SiteGroupRecord) -> SiteGroupRecord:
        self.groups[group.id] = group
        return group

    def delete_group(self, group_id: str) -> None:
        self.groups.pop(group_id, None)

    def list_faqs(
        self,
        site_id: str | None = None,
        group_id: str | None = None,
        include_inactive: bool = False,
    ) -> list[FaqRecord]:
        faqs = list(self.faqs.values())
        if not include_inactive:
            faqs = [faq for faq in faqs if faq.active]
        if site_id:
            faq_ids = {
                vector.faq_id
                for vector in self.vectors.values()
                if vector.site_id == site_id and vector.active
            }
            faqs = [faq for faq in faqs if faq.id in faq_ids or faq.site_id == site_id]
        if group_id:
            faqs = [faq for faq in faqs if faq.group_id == group_id]
        return sorted(faqs, key=lambda item: item.updated_at, reverse=True)

    def get_faq(self, faq_id: str) -> FaqRecord | None:
        return self.faqs.get(faq_id)

    def upsert_faq(self, faq: FaqRecord) -> FaqRecord:
        self.faqs[faq.id] = faq
        return faq

    def delete_faq(self, faq_id: str) -> None:
        faq = self.faqs.get(faq_id)
        if faq:
            self.faqs[faq_id] = faq.model_copy(update={"active": False})
        self.replace_vectors_for_faq(faq_id, [])

    def replace_vectors_for_faq(self, faq_id: str, vectors: list[FaqVectorRecord]) -> None:
        self.vectors = {
            key: value for key, value in self.vectors.items() if value.faq_id != faq_id
        }
        for vector in vectors:
            self.vectors[vector.id] = vector
        self._rebuild_vector_indexes()

    def list_vectors_for_site(self, site_id: str) -> list[FaqVectorRecord]:
        return [
            vector
            for vector in self.vectors.values()
            if vector.site_id == site_id and vector.active
        ]

    def get_vector_by_normalized_text(
        self,
        site_id: str,
        normalized_text: str,
    ) -> FaqVectorRecord | None:
        vector_id = self.vector_exact_index.get((site_id, normalized_text))
        if not vector_id:
            return None
        return self.vectors.get(vector_id)

    def search_vectors(
        self,
        site_id: str,
        embedding: list[float],
        limit: int = 5,
    ) -> list[tuple[FaqVectorRecord, float]]:
        scored = [
            (vector, cosine_distance(embedding, vector.embedding))
            for vector in self.list_vectors_for_site(site_id)
        ]
        return sorted(scored, key=lambda item: item[1])[:limit]

    def create_session(self, session: ChatSessionRecord) -> ChatSessionRecord:
        self.sessions[session.id] = session
        return session

    def get_session(self, session_id: str) -> ChatSessionRecord | None:
        return self.sessions.get(session_id)

    def add_log(self, log: ChatLogRecord) -> ChatLogRecord:
        self.logs[log.id] = log
        return log

    def get_log(self, log_id: str) -> ChatLogRecord | None:
        return self.logs.get(log_id)

    def list_logs(
        self,
        site_id: str | None = None,
        response_type: ResponseType | None = None,
        review_status: ReviewStatus | None = None,
        fallback_only: bool = False,
        limit: int = 200,
    ) -> list[ChatLogRecord]:
        logs = list(self.logs.values())
        if site_id:
            logs = [log for log in logs if log.site_id == site_id]
        if response_type:
            logs = [log for log in logs if log.response_type == response_type]
        if review_status:
            logs = [log for log in logs if log.review_status == review_status]
        if fallback_only:
            logs = [log for log in logs if log.response_type != ResponseType.faq_hit]
        return sorted(logs, key=lambda item: item.timestamp, reverse=True)[:limit]

    def update_log(self, log: ChatLogRecord) -> ChatLogRecord:
        self.logs[log.id] = log
        return log

    def get_background_task(self, task_id: str) -> BackgroundTaskRecord | None:
        return self.tasks.get(task_id)

    def upsert_background_task(self, task: BackgroundTaskRecord) -> BackgroundTaskRecord:
        self.tasks[task.id] = task
        return task
