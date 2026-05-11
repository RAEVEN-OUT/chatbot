# Firestore Schema

Use one Firestore database for the platform. Scope records by `site_id`, `group_ids`, and later `tenant_id`.

## `sites/{siteId}`

```json
{
  "id": "goride-chennai",
  "tenant_id": "default",
  "name": "GoRide Chennai",
  "domain": "goride.chennai",
  "helpline_number": "+91 ...",
  "welcome_message": "Welcome to GoRide Chennai. How can I help?",
  "fallback_message": "I could not find that in our FAQs.",
  "faq_accept_distance": 0.28,
  "faq_review_distance": 0.45,
  "llm_candidate_distance": 0.55,
  "active": true,
  "allowed_origins": ["https://goride.chennai"],
  "created_at": "...",
  "updated_at": "..."
}
```

## `site_groups/{groupId}`

```json
{
  "id": "goride-common",
  "tenant_id": "default",
  "name": "GoRide Common",
  "description": "Shared FAQs for all GoRide city sites",
  "site_ids": ["goride-chennai", "goride-coimbatore"],
  "active": true
}
```

Admins can add or remove sites from a group. When membership changes, group FAQs are reindexed for those sites.

## `faq_sources/{faqId}`

This is the editable FAQ source of truth.

```json
{
  "id": "faq_abc123",
  "tenant_id": "default",
  "question": "What is GoRide?",
  "answer": "GoRide is ...",
  "aliases": ["Tell me about GoRide", "wht is goride"],
  "site_ids": [],
  "group_ids": ["goride-common"],
  "owner_type": "common",
  "tags": ["general"],
  "active": true
}
```

## `faq_vectors/{vectorId}`

This is the retrieval table. It is generated from `faq_sources`.

```json
{
  "id": "vec_abc123",
  "faq_id": "faq_abc123",
  "site_id": "goride-chennai",
  "source_text": "Tell me about GoRide",
  "source_type": "alias",
  "normalized_text": "tell me about goride",
  "embedding": [0.1, 0.2],
  "answer_snapshot": "GoRide is ...",
  "question_snapshot": "What is GoRide?",
  "active": true
}
```

Create Firestore vector indexes on `faq_vectors.embedding`, with filters for:

- `site_id == ...`
- `active == true`

Create a composite index for exact FAQ/alias matches:

- collection: `faq_vectors`
- fields: `site_id ASC`, `active ASC`, `normalized_text ASC`

The chat path queries this index before embedding, so exact user text and alias
matches do not download every FAQ vector for the site.

## `chat_sessions/{sessionId}`

```json
{
  "id": "session_abc123",
  "site_id": "goride-chennai",
  "name": "Ravi",
  "email": "ravi@example.com",
  "phone": "+91 ...",
  "created_at": "...",
  "last_seen_at": "..."
}
```

## `chat_logs/{logId}`

```json
{
  "id": "log_abc123",
  "site_id": "goride-chennai",
  "session_id": "session_abc123",
  "user_name": "Ravi",
  "email": "ravi@example.com",
  "phone": "+91 ...",
  "question": "Can I cancel a ride?",
  "answer": "I could not find that in our FAQs. Helpline: +91 ...",
  "response_type": "helpline",
  "matched_faq_id": null,
  "vector_distance": 0.72,
  "llm_model": "",
  "timestamp": "...",
  "review_status": "pending",
  "converted_to_faq_id": null
}
```

Admin uses this collection to find questions where FAQ answer was not used and convert them into new FAQs.

## RBAC Model

Panel access is enforced from Firebase Auth custom claims. Recommended claims:

```json
{
  "role": "editor",
  "tenant_id": "default",
  "site_ids": ["goride-chennai", "goride-coimbatore"]
}
```

Roles:

- `viewer`: read assigned sites, FAQs, logs, and analytics.
- `editor`: viewer permissions plus FAQ edits, log conversion, imports, and reindexing.
- `admin`: editor permissions plus site settings for assigned sites.
- `super_admin`: full platform access, including creating/deleting sites and groups.

Use `site_ids: ["*"]` only for platform admins. Keep role checks in the API; UI filtering is only a convenience.
