from __future__ import annotations

from enum import Enum
from typing import Any

from app.core.config import firebase_credentials_path, settings
from app.repositories.base import Repository
from app.repositories.cache import TTLCache
from app.repositories.memory import cosine_distance
from app.repositories.utils import model_to_dict
from app.schemas.models import (
    BackgroundTaskRecord,
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
    def __init__(self, project: str = "", database: str = "(default)") -> None:
        try:
            from google.cloud import firestore
        except ImportError as exc:
            raise RuntimeError("Install google-cloud-firestore to use Firestore.") from exc

        key_path = firebase_credentials_path()
        client_kwargs: dict[str, Any] = {"database": database}
        if project:
            client_kwargs["project"] = project
        if key_path.exists():
            from google.oauth2 import service_account

            client_kwargs["credentials"] = service_account.Credentials.from_service_account_file(
                str(key_path)
            )
        self.db = firestore.Client(**client_kwargs)

        self._site_cache: TTLCache[str, SiteRecord] = TTLCache(
            ttl_seconds=settings.repository_cache_ttl_seconds,
            max_items=settings.repository_cache_max_items,
        )
        self._site_vectors_cache: TTLCache[str, list[FaqVectorRecord]] = TTLCache(
            ttl_seconds=settings.repository_cache_ttl_seconds,
            max_items=settings.repository_cache_max_items,
        )
        self._exact_vector_cache: TTLCache[tuple[str, str], FaqVectorRecord | bool] = TTLCache(
            ttl_seconds=settings.repository_cache_ttl_seconds,
            max_items=settings.repository_cache_max_items,
        )

    def _collection(self, name: str):
        return self.db.collection(name)

    def _load(self, collection: str, doc_id: str, model):
        snapshot = self._collection(collection).document(doc_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict()
        data["id"] = snapshot.id
        return model(**self._from_firestore(data))

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

    def _faq_from_snapshot(self, doc) -> FaqRecord:
        data = doc.to_dict()
        data["id"] = data.get("id", doc.id)
        return FaqRecord(**self._from_firestore(data))

    def _invalidate_vector_caches(self, site_ids: set[str]) -> None:
        for site_id in site_ids:
            self._site_vectors_cache.pop(site_id)
        self._exact_vector_cache.delete_where(
            lambda key: isinstance(key, tuple) and key[0] in site_ids
        )

    def list_sites(self, include_deleted: bool = False) -> list[SiteRecord]:
        sites = [
            SiteRecord(**self._from_firestore({**doc.to_dict(), "id": doc.id}))
            for doc in self._collection("sites").stream()
        ]
        if not include_deleted:
            sites = [site for site in sites if site.deleted_at is None]
        return sorted(sites, key=lambda site: site.updated_at, reverse=True)

    def get_site(self, site_id: str) -> SiteRecord | None:
        cached = self._site_cache.get(site_id)
        if cached:
            return cached
        site = self._load("sites", site_id, SiteRecord)
        if site:
            self._site_cache.set(site_id, site)
        return site

    def upsert_site(self, site: SiteRecord) -> SiteRecord:
        self._save("sites", site.id, site)
        self._site_cache.set(site.id, site)
        return site

    def delete_site(self, site_id: str) -> None:
        self._collection("sites").document(site_id).delete()
        self._site_cache.pop(site_id)
        self._invalidate_vector_caches({site_id})

    def list_groups(self) -> list[SiteGroupRecord]:
        return sorted(
            [
                SiteGroupRecord(**self._from_firestore({**doc.to_dict(), "id": doc.id}))
                for doc in self._collection("site_groups").stream()
            ],
            key=lambda group: group.updated_at,
            reverse=True,
        )

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
        if site_id:
            faq_by_id: dict[str, FaqRecord] = {}
            site_query = self._collection("faq_sources").where("site_id", "==", site_id)
            if not include_inactive:
                site_query = site_query.where("active", "==", True)
            for doc in site_query.stream():
                faq = self._faq_from_snapshot(doc)
                faq_by_id[faq.id] = faq

            target_group_ids = [group.id for group in self.list_groups() if site_id in group.site_ids]
            for target_group_id in target_group_ids:
                query = self._collection("faq_sources").where("group_id", "==", target_group_id)
                if not include_inactive:
                    query = query.where("active", "==", True)
                for doc in query.stream():
                    faq = self._faq_from_snapshot(doc)
                    faq_by_id[faq.id] = faq

            docs = list(faq_by_id.values())
            if group_id:
                docs = [faq for faq in docs if faq.group_id == group_id]
            return sorted(docs, key=lambda faq: faq.updated_at, reverse=True)

        query = self._collection("faq_sources")
        if group_id:
            query = query.where("group_id", "==", group_id)
        if not include_inactive:
            query = query.where("active", "==", True)
        docs = [self._faq_from_snapshot(doc) for doc in query.stream()]
        return sorted(docs, key=lambda faq: faq.updated_at, reverse=True)

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
        op_count = 0
        old_docs = self._collection("faq_vectors").where("faq_id", "==", faq_id).stream()
        old_site_ids: set[str] = set()

        def commit_if_full(force: bool = False) -> None:
            nonlocal batch, op_count
            if op_count and (force or op_count >= 450):
                batch.commit()
                batch = self.db.batch()
                op_count = 0

        for doc in old_docs:
            old_site_ids.add(doc.to_dict().get("site_id", ""))
            batch.delete(doc.reference)
            op_count += 1
            commit_if_full()

        for vector in vectors:
            batch.set(
                self._collection("faq_vectors").document(vector.id),
                self._to_firestore("faq_vectors", model_to_dict(vector)),
            )
            op_count += 1
            commit_if_full()
        commit_if_full(force=True)

        site_ids = old_site_ids | {vector.site_id for vector in vectors}
        site_ids.discard("")
        self._invalidate_vector_caches(site_ids)

    def list_vectors_for_site(self, site_id: str) -> list[FaqVectorRecord]:
        cached = self._site_vectors_cache.get(site_id)
        if cached is not None:
            return cached
        docs = (
            self._collection("faq_vectors")
            .where("site_id", "==", site_id)
            .where("active", "==", True)
            .stream()
        )
        vectors = [FaqVectorRecord(**self._from_firestore(doc.to_dict())) for doc in docs]
        self._site_vectors_cache.set(site_id, vectors)
        return vectors

    def get_vector_by_normalized_text(
        self,
        site_id: str,
        normalized_text: str,
    ) -> FaqVectorRecord | None:
        cache_key = (site_id, normalized_text)
        cached = self._exact_vector_cache.get(cache_key)
        if cached is not None:
            return cached if isinstance(cached, FaqVectorRecord) else None
        docs = (
            self._collection("faq_vectors")
            .where("site_id", "==", site_id)
            .where("active", "==", True)
            .where("normalized_text", "==", normalized_text)
            .limit(1)
            .stream()
        )
        for doc in docs:
            vector = FaqVectorRecord(**self._from_firestore(doc.to_dict()))
            self._exact_vector_cache.set(cache_key, vector)
            return vector
        self._exact_vector_cache.set(cache_key, False)
        return None

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

    def get_log(self, log_id: str) -> ChatLogRecord | None:
        return self._load("chat_logs", log_id, ChatLogRecord)

    def list_logs(
        self,
        site_id: str | None = None,
        response_type: ResponseType | None = None,
        review_status: ReviewStatus | None = None,
        fallback_only: bool = False,
        limit: int = 200,
    ) -> list[ChatLogRecord]:
        query = self._collection("chat_logs")
        if site_id:
            query = query.where("site_id", "==", site_id)
        if response_type:
            query = query.where("response_type", "==", response_type.value)
        if review_status:
            query = query.where("review_status", "==", review_status.value)
        fetch_limit = limit * 2 if fallback_only else limit
        query = query.limit(max(1, min(fetch_limit, 1000)))
        logs = []
        for doc in query.stream():
            data = doc.to_dict()
            data["id"] = doc.id
            log = ChatLogRecord(**self._from_firestore(data))
            if fallback_only and log.response_type == ResponseType.faq_hit:
                continue
            logs.append(log)
        return sorted(logs, key=lambda item: item.timestamp, reverse=True)[:limit]

    def update_log(self, log: ChatLogRecord) -> ChatLogRecord:
        self._save("chat_logs", log.id, log)
        return log

    def get_background_task(self, task_id: str) -> BackgroundTaskRecord | None:
        return self._load("background_tasks", task_id, BackgroundTaskRecord)

    def upsert_background_task(self, task: BackgroundTaskRecord) -> BackgroundTaskRecord:
        self._save("background_tasks", task.id, task)
        return task
