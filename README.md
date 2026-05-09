# Multi-Site FAQ-First RAG Chatbot

This project is a starter implementation for a multi-site chatbot where FAQs are the first source of truth, LLM calls are only used as a controlled fallback, and admins can manage sites, groups, FAQs, and fallback logs from one panel.

## What This Scaffold Includes

- FastAPI backend
- Site, group, FAQ, chat session, and fallback log APIs
- FAQ-first retrieval pipeline
- Per-site vector records generated from FAQ questions and aliases
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

## Retrieval Priority

```txt
1. Exact normalized question or alias match
2. Site-scoped vector FAQ match
3. LLM fallback using only that site's candidate FAQs
4. Site helpline fallback
```

The answer returned for FAQ hits is the exact stored FAQ answer.
