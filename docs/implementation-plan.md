# Implementation Plan
[Technical Architecture & Indexing Details](./developer-handover.md)

## Phase 1: MVP (Completed)

- [x] FastAPI backend
- [x] Firestore storage & vector search
- [x] Embedding generation (OpenAI / Gemini)
- [x] FAQ, Site, Group CRUD
- [x] Embeddable Chatbot Widget script

## Phase 2: Production Hardening (Completed)

- [x] Firebase Auth & User SSO
- [x] Domain allow-list enforcement for widget calls
- [x] Batch FAQ import from CSV via User & Admin Portals
- [x] High-Efficiency O(1) Analytics via Atomic Counters (Total queries, hit rate, fallback rate, etc.)
- [x] Admin fallback log review & FAQ conversion
- [x] Log Pagination (offset/limit) & Database-Level Filtering

## Phase 3: Scale & Appearance (Completed)

- [x] **Per-Site Branding** (Dynamic Widget Styles, Custom Icons)
- [x] **Optimistic UI Updates** (Instant frontend updates with rollback queues for Groups, FAQs, Sites)
- [x] **Multi-Tenant Navigation** (Single-site users bypass context selection, multi-site users get a full management portal)

## Phase 4: Enterprise & Accuracy (Next Steps)

- **Hybrid Retrieval:** Implement keyword-based filtering alongside vector search to prevent name confusion (e.g., Madurai vs. Marudhamalai).
- **Multi-Tenant RBAC:** Expand the current claim-based security to granular roles (e.g., "Viewer", "Editor", "Admin").
- **Distributed Background Workers:** Move reindexing and embedding generation to dedicated worker nodes (e.g., using Celery or Cloud Tasks) for massive 100,000+ row imports.
- **External Vector Database:** Integrate with specialized vector DBs like Pinecone/Qdrant if Firestore KNN latency grows.
- **Billing & Usage Metering:** Track API and embedding costs per tenant for automated billing.

## Phase 5: Production Readiness (Completed)

- [x] **Firestore Vector Indexing** (Created composite indexes for `chat_logs`, `faq_sources`, and `faq_vectors`).

---

## Phase 6: Cost Optimization (Optional / Paid)

- **TTL Policies:** Enable the `expire_at` field in Firestore to auto-purge old chat logs (Requires Firebase Blaze Plan).

---

## Admin Workflow

1. Create a site once.
2. Select the current site from the admin sidebar.
3. Add local FAQs using "Current site", or Bulk Import CSV.
4. Create a group for shared products or brands (must contain at least 2 sites).
5. Add common FAQs using "Group".
6. Review fallback logs using pagination and type filters.
7. Convert repeated fallback questions into FAQs directly from the Logs tab.

## Retrieval Rules

- Exact normalized question or alias returns the stored answer.
- Semantic FAQ hit returns the stored answer.
- LLM fallback is only called for borderline candidates based on distance threshold.
- LLM is instructed to copy the FAQ answer exactly or return `NO_ANSWER`.
- If no answer is found from that site's FAQs, return the site's fallback message.
