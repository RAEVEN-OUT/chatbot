# Implementation Plan

## Phase 1: MVP

- FastAPI backend
- Firestore storage
- Firestore vector search
- Gemini embedding generation
- FAQ CRUD
- Site CRUD
- Group CRUD
- Widget script
- Admin fallback log review

## Phase 2: Production Hardening

- Firebase Auth or admin SSO
- Per-tenant role permissions
- Domain allow-list enforcement for widget calls
- Rate limiting by site and IP
- Batch FAQ import from CSV/XLSX
- Background reindex job for large FAQ imports
- Better analytics: FAQ hit rate, LLM fallback rate, helpline rate, estimated API spend

## Phase 3: Scale

- Move from process reindexing to queue-based indexing
- Add external vector DB if Firestore vector search becomes too limiting
- Add hybrid retrieval with keyword + vector reranking
- Add per-site branding config for widget
- Add billing and tenant isolation

## Admin Workflow

1. Create a site once.
2. Select the current site from the admin sidebar.
3. Add local FAQs using "Current site".
4. Create a group for shared products or brands.
5. Add common FAQs using "Group".
6. Review fallback logs.
7. Convert repeated fallback questions into FAQs.

## Retrieval Rules

- Exact normalized question or alias returns the stored answer.
- Semantic FAQ hit returns the stored answer.
- LLM fallback is only called for borderline candidates.
- LLM is instructed to copy the FAQ answer exactly or return `NO_ANSWER`.
- If no answer is found from that site's FAQs, return the site's helpline.
