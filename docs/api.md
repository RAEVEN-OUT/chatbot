# API Overview

## Admin

Set `ADMIN_API_KEY` in production and pass:

```txt
x-admin-api-key: your-key
```

Routes:

```txt
GET    /api/sites
POST   /api/sites
PATCH  /api/sites/{site_id}
DELETE /api/sites/{site_id}

GET    /api/groups
POST   /api/groups
PATCH  /api/groups/{group_id}
DELETE /api/groups/{group_id}

GET    /api/faqs?site_id=...
POST   /api/faqs
PATCH  /api/faqs/{faq_id}
DELETE /api/faqs/{faq_id}
POST   /api/faqs/{faq_id}/reindex

GET    /api/logs?site_id=...&fallback_only=true
POST   /api/logs/{log_id}/convert-to-faq
```

## Chat Widget

```txt
GET  /api/chat/sites/{site_id}/config
POST /api/chat/sessions
POST /api/chat/message
POST /api/chat/message/stream
```

Example:

```json
{
  "site_id": "demo-site",
  "session_id": "session_abc",
  "question": "tell me about demo site"
}
```

`POST /api/chat/message/stream` accepts the same body and returns newline-delimited
JSON events:

```json
{"type":"metadata","response_type":"faq_hit","session_id":"session_abc"}
{"type":"token","text":"Demo Site is a sample chatbot site used to test FAQ retrieval."}
{"type":"done"}
```

Response:

```json
{
  "answer": "Demo Site is a sample chatbot site used to test FAQ retrieval.",
  "response_type": "faq_hit",
  "matched_faq_id": "faq_abc",
  "vector_distance": 0.12,
  "session_id": "session_abc"
}
```
