# Multi-Site FAQ-First RAG Chatbot

This project is a starter implementation for a multi-site chatbot where FAQs are the first source of truth, LLM calls are only used as a controlled fallback, and admins can manage sites, groups, FAQs, and fallback logs from one panel.

## What This Scaffold Includes

- FastAPI backend
- Site, group, FAQ, chat session, and fallback log APIs
- FAQ-first retrieval pipeline
- Per-site vector records generated from FAQ questions and aliases
- Async Gemini calls in the chat path
- Site-scoped exact-match lookup before embedding/vector search
- Process-local Firestore cache for site config and hot FAQ vector lookups
- Process-local Gemini embedding cache for repeated queries
- Site-scoped admin RBAC via Firebase custom claims
- Optional Gemini embedding and LLM fallback adapters
- Firestore repository adapter skeleton
- In-memory repository for local development
- Static admin panel served by the backend
- Embeddable JavaScript widget

## Local Run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example ..\.env
uvicorn app.main:app --reload --port 8000
```

Open:

```txt
http://localhost:8000/admin/
```

Widget embed example:

```html
<script
  src="http://localhost:8000/widget/chatbot-widget.js"
  data-site-id="demo-site"
  data-api-base="http://localhost:8000"
  data-collect-lead="true"
></script>
```

## Keys Needed Later

You do not need keys to run the scaffold locally. For production you will need:

- `ADMIN_API_KEY`
- Firebase service account / Google credentials for Firestore
- `GOOGLE_CLOUD_PROJECT`
- `GEMINI_API_KEY`

## Admin RBAC

Firebase custom claims can scope panel users to one site, many sites, or the whole platform:

```json
{
  "role": "editor",
  "site_ids": ["demo-site"],
  "tenant_id": "default"
}
```

Roles are `viewer`, `editor`, `admin`, and `super_admin`. Use `site_ids: ["*"]` for all sites. The fallback `ADMIN_API_KEY` and local development mode act as `super_admin`.

## Retrieval Priority

```txt
1. Exact normalized question or alias match
2. Site-scoped vector FAQ match
3. LLM fallback using only that site's candidate FAQs
4. Site helpline fallback
```

The answer returned for FAQ hits is the exact stored FAQ answer.
