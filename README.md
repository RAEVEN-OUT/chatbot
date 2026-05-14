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
- Site-scoped owner access via Firebase custom claims
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

Widget embed example (Production):

```html
<script
  src="https://chatbot.goride.net.in/widget/chatbot-widget.js"
  data-site-id="demo-site"
  data-api-base="https://chatbot.goride.net.in"
  data-collect-lead="true"
></script>
```

## Keys Needed Later

You do not need keys to run the scaffold locally. For production you will need:

- `ADMIN_API_KEY`
- Firebase service account / Google credentials for Firestore
- `GOOGLE_CLOUD_PROJECT`
- `GEMINI_API_KEY`

## Portal Access

Firebase custom claims can scope panel users to one site, many sites, or the whole platform:

```json
{
  "site_ids": ["demo-site"]
}
```

There are no viewer/editor roles in the active API. A normal owner has full access to every site listed in `site_ids`. A platform admin uses `site_ids: ["*"]`.

FAQ targeting is separate from account access. Each FAQ belongs to exactly one site or one group:

```json
{ "site_id": "demo-site", "group_id": "" }
```

or:

```json
{ "site_id": "", "group_id": "common-group" }
```

## Retrieval Priority

```txt
1. Exact normalized question or alias match
2. Site-scoped vector FAQ match
3. LLM fallback using only that site's candidate FAQs
4. Site helpline fallback
```

The answer returned for FAQ hits is the exact stored FAQ answer.


Go to your Firebase Console.
Click the Settings gear (Project Settings) -> Service Accounts tab.
Click Generate New Private Key.
This will download a .json file. Rename it to `firebase-key.json` and place it in the project root.
In your `.env` file, add this line:
```bash
GOOGLE_APPLICATION_CREDENTIALS="firebase-key.json"
```

The app resolves that relative path from the project root, so it works even when
the server process starts inside `backend/`.
