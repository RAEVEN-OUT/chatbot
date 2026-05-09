from __future__ import annotations

from enum import Enum
from typing import Any

from app.repositories.base import Repository
from app.repositories.memory import cosine_distance
from app.repositories.utils import model_to_dict
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


class FirestoreRepository(Repository):
    """Firestore-backed repository.

    Firestore is the source of truth. Vector search can be enabled with native
    Firestore vector indexes. If the local SDK does not support vector querying
    in your installed version, the adapter falls back to scoring the active
    vectors returned for the site. That fallback is only for small datasets.
    """

    def __init__(self, project: str = "", database: str = "(default)") -> None:
        try:
            from google.cloud import firestore
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("Install google-cloud-firestore to use Firestore.") from exc

        if project:
            self.db = firestore.Client(project=project, database=database)
        else:
            self.db = firestore.Client(database=database)

    def _collection(self, name: str):
        return self.db.collection(name)

    def _load(self, collection: str, doc_id: str, model):
        snapshot = self._collection(collection).document(doc_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict()
        data["id"] = snapshot.id
        data = self._from_firestore(data)
        return model(**data)

    def _save(self, collection: str, doc_id: str, record) -> None:
        self._collection(collection).document(doc_id).set(
            self._to_firestore(collection, model_to_dict(record))
        )

    def _to_firestore(self, collection: str, data: dict[str, Any]) -> dict[str, Any]:
        cleaned = self._clean_value(data)
        if collection == "faq_vectors" and isinstance(cleaned.get("embedding"), list):
            try:
                from google.cloud.firestore_v1.vector import Vector

                cleaned["embedding"] = Vector(cleaned["embedding"])
            except Exception:
                pass
        return cleaned

    def _from_firestore(self, data: dict[str, Any]) -> dict[str, Any]:
        embedding = data.get("embedding")
        if embedding is not None and not isinstance(embedding, list):
            if hasattr(embedding, "to_list"):
                data["embedding"] = embedding.to_list()
            else:
                try:
                    data["embedding"] = list(embedding)
                except TypeError:
                    pass
        return data

    def _clean_value(self, value):
        if isinstance(value, Enum):
            return value.value
        if isinstance(value, dict):
            return {key: self._clean_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._clean_value(item) for item in value]
        return value

    def list_sites(self) -> list[SiteRecord]:
        return [
            SiteRecord(**self._from_firestore(doc.to_dict()))
            for doc in self._collection("sites").stream()
        ]

    def get_site(self, site_id: str) -> SiteRecord | None:
        return self._load("sites", site_id, SiteRecord)

    def upsert_site(self, site: SiteRecord) -> SiteRecord:
        self._save("sites", site.id, site)
        return site

    def delete_site(self, site_id: str) -> None:
        self._collection("sites").document(site_id).delete()

    def list_groups(self) -> list[SiteGroupRecord]:
        return [
            SiteGroupRecord(**self._from_firestore(doc.to_dict()))
            for doc in self._collection("site_groups").stream()
        ]

    def get_group(self, group_id: str) -> SiteGroupRecord | None:
        return self._load("site_groups", group_id, SiteGroupRecord)

    def upsert_group(self, group: SiteGroupRecord) -> SiteGroupRecord:
        self._save("site_groups", group.id, group)
        return group

    def delete_group(self, group_id: str) -> None:
        self._collection("site_groups").document(group_id).delete()

    def list_faqs(
        self,
        site_id: str | None = None,
        group_id: str | None = None,
        include_inactive: bool = False,
    ) -> list[FaqRecord]:
        query = self._collection("faq_sources")
        if not include_inactive:
            query = query.where("active", "==", True)
        if group_id:
            query = query.where("group_ids", "array_contains", group_id)
        docs = [FaqRecord(**self._from_firestore(doc.to_dict())) for doc in query.stream()]
        if site_id:
            vector_faq_ids = {
                doc.to_dict()["faq_id"]
                for doc in self._collection("faq_vectors")
                .where("site_id", "==", site_id)
                .where("active", "==", True)
                .stream()
            }
            docs = [faq for faq in docs if faq.id in vector_faq_ids or site_id in faq.site_ids]
        return sorted(docs, key=lambda item: item.updated_at, reverse=True)

    def get_faq(self, faq_id: str) -> FaqRecord | None:
        return self._load("faq_sources", faq_id, FaqRecord)

    def upsert_faq(self, faq: FaqRecord) -> FaqRecord:
        self._save("faq_sources", faq.id, faq)
        return faq

    def delete_faq(self, faq_id: str) -> None:
        faq = self.get_faq(faq_id)
        if faq:
            self.upsert_faq(faq.model_copy(update={"active": False}))
        self.replace_vectors_for_faq(faq_id, [])

    def replace_vectors_for_faq(self, faq_id: str, vectors: list[FaqVectorRecord]) -> None:
        batch = self.db.batch()
        old_docs = self._collection("faq_vectors").where("faq_id", "==", faq_id).stream()
        for doc in old_docs:
            batch.delete(doc.reference)
        for vector in vectors:
            batch.set(
                self._collection("faq_vectors").document(vector.id),
                self._to_firestore("faq_vectors", model_to_dict(vector)),
            )
        batch.commit()

    def list_vectors_for_site(self, site_id: str) -> list[FaqVectorRecord]:
        docs = (
            self._collection("faq_vectors")
            .where("site_id", "==", site_id)
            .where("active", "==", True)
            .stream()
        )
        return [FaqVectorRecord(**self._from_firestore(doc.to_dict())) for doc in docs]

    def search_vectors(
        self,
        site_id: str,
        embedding: list[float],
        limit: int = 5,
    ) -> list[tuple[FaqVectorRecord, float]]:
        try:
            from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
            from google.cloud.firestore_v1.vector import Vector

            query = (
                self._collection("faq_vectors")
                .where("site_id", "==", site_id)
                .where("active", "==", True)
                .find_nearest(
                    vector_field="embedding",
                    query_vector=Vector(embedding),
                    distance_measure=DistanceMeasure.COSINE,
                    limit=limit,
                    distance_result_field="vector_distance",
                )
            )
            results = []
            for doc in query.stream():
                data = doc.to_dict()
                distance = float(data.pop("vector_distance", 1.0))
                results.append((FaqVectorRecord(**self._from_firestore(data)), distance))
            return results
        except Exception:
            scored = [
                (vector, cosine_distance(embedding, vector.embedding))
                for vector in self.list_vectors_for_site(site_id)
            ]
            return sorted(scored, key=lambda item: item[1])[:limit]

    def create_session(self, session: ChatSessionRecord) -> ChatSessionRecord:
        self._save("chat_sessions", session.id, session)
        return session

    def get_session(self, session_id: str) -> ChatSessionRecord | None:
        return self._load("chat_sessions", session_id, ChatSessionRecord)

    def add_log(self, log: ChatLogRecord) -> ChatLogRecord:
        self._save("chat_logs", log.id, log)
        return log

    def list_logs(
        self,
        site_id: str | None = None,
        response_type: ResponseType | None = None,
        review_status: ReviewStatus | None = None,
    ) -> list[ChatLogRecord]:
        query = self._collection("chat_logs")
        if site_id:
            query = query.where("site_id", "==", site_id)
        if response_type:
            query = query.where("response_type", "==", response_type.value)
        if review_status:
            query = query.where("review_status", "==", review_status.value)
        return [ChatLogRecord(**self._from_firestore(doc.to_dict())) for doc in query.stream()]

    def update_log(self, log: ChatLogRecord) -> ChatLogRecord:
        self._save("chat_logs", log.id, log)
        return log
