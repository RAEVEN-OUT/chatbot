from __future__ import annotations

import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


COLLECTIONS_TO_CLEAR = [
    "sites",
    "site_groups",
    "faq_sources",
    "faq_vectors",
    "chat_sessions",
    "chat_logs",
    "background_tasks",
]


def init_firebase() -> None:
    if firebase_admin._apps:
        return
    backend_dir = Path(__file__).resolve().parent
    key_path = backend_dir / "firebase-key.json"
    if not key_path.exists():
        key_path = backend_dir.parent / "firebase-key.json"
    if key_path.exists():
        firebase_admin.initialize_app(credentials.Certificate(str(key_path)))
    else:
        firebase_admin.initialize_app()


def delete_collection(db, collection_name: str, batch_size: int = 250) -> int:
    total = 0
    collection = db.collection(collection_name)
    while True:
        docs = list(collection.limit(batch_size).stream())
        if not docs:
            return total
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        total += len(docs)


def main() -> None:
    init_firebase()
    db = firestore.client()
    print("Clearing application data. Firebase Authentication users are untouched.")
    for collection in COLLECTIONS_TO_CLEAR:
        deleted = delete_collection(db, collection)
        print(f"{collection}: deleted {deleted}")


if __name__ == "__main__":
    main()
