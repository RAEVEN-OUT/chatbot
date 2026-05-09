from __future__ import annotations

from typing import Protocol

from app.schemas.models import (
    ChatLogRecord,
    ChatSessionRecord,
    FaqRecord,
    FaqVectorRecord,
    ResponseType,
    ReviewStatus,
    SiteGroupRecord,
    SiteRecord,
)


class Repository(Protocol):
    def list_sites(self) -> list[SiteRecord]:
        ...

    def get_site(self, site_id: str) -> SiteRecord | None:
        ...

    def upsert_site(self, site: SiteRecord) -> SiteRecord:
        ...

    def delete_site(self, site_id: str) -> None:
        ...

    def list_groups(self) -> list[SiteGroupRecord]:
        ...

    def get_group(self, group_id: str) -> SiteGroupRecord | None:
        ...

    def upsert_group(self, group: SiteGroupRecord) -> SiteGroupRecord:
        ...

    def delete_group(self, group_id: str) -> None:
        ...

    def list_faqs(
        self,
        site_id: str | None = None,
        group_id: str | None = None,
        include_inactive: bool = False,
    ) -> list[FaqRecord]:
        ...

    def get_faq(self, faq_id: str) -> FaqRecord | None:
        ...

    def upsert_faq(self, faq: FaqRecord) -> FaqRecord:
        ...

    def delete_faq(self, faq_id: str) -> None:
        ...

    def replace_vectors_for_faq(self, faq_id: str, vectors: list[FaqVectorRecord]) -> None:
        ...

    def list_vectors_for_site(self, site_id: str) -> list[FaqVectorRecord]:
        ...

    def search_vectors(
        self,
        site_id: str,
        embedding: list[float],
        limit: int = 5,
    ) -> list[tuple[FaqVectorRecord, float]]:
        ...

    def create_session(self, session: ChatSessionRecord) -> ChatSessionRecord:
        ...

    def get_session(self, session_id: str) -> ChatSessionRecord | None:
        ...

    def add_log(self, log: ChatLogRecord) -> ChatLogRecord:
        ...

    def list_logs(
        self,
        site_id: str | None = None,
        response_type: ResponseType | None = None,
        review_status: ReviewStatus | None = None,
    ) -> list[ChatLogRecord]:
        ...

    def update_log(self, log: ChatLogRecord) -> ChatLogRecord:
        ...
