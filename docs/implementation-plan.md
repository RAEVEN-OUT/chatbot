# Implementation Plan
[Technical Architecture & Indexing Details](./technical-architecture.md)

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

## Phase 2: Production Hardening (Completed)

- [x] Firebase Auth or admin SSO
- [x] Domain allow-list enforcement for widget calls
- [x] Rate limiting by site and IP
- [x] Batch FAQ import from CSV/XLSX
- [x] Better analytics: FAQ hit rate, LLM fallback rate, helpline rate, estimated API spend

## Phase 3: Scale & Appearance

- [x] **Per-Site Branding** (Dynamic Widget Styles, Custom Icons)
- [x] **Queue-based Reindexing** (Background Tasks for Large CSVs)
- [x] **Enhanced LLM Reranking** (Using Gemini for final answer validation)

## Phase 4: Enterprise & Accuracy

- **Hybrid Retrieval:** Implement keyword-based filtering alongside vector search to prevent name confusion (e.g., Madurai vs. Marudhamalai).
- **Multi-Tenant RBAC:** Implement full role-based access control where different company admins can only manage their specific sites and see their own analytics.
- **Distributed Background Workers:** Move reindexing and embedding generation to dedicated worker nodes (e.g., using Celery or Cloud Tasks) for massive 100,000+ row imports.
- **External Vector Database:** Integrate with specialized vector DBs like Pinecone/Qdrant if Firestore KNN latency grows.
- **Billing & Usage Metering:** Track API and embedding costs per tenant for automated billing.

### Firestore Vector Indexing
To ensure sub-second search performance once the database grows beyond ~1,000 total vectors, a composite vector index must be created. This enables native KNN search and prevents slow "Full Collection Scans."

**Run this command to create the index:**
```bash
gcloud firestore indexes composite create \
--collection-group=faq_vectors \
--query-scope=COLLECTION \
--field-config=field-path=site_id,order=ASCENDING \
--field-config=field-path=active,order=ASCENDING \
--field-config=vector-config='{"dimension":"768","flat": "{}"}',field-path=embedding
```

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

## Phase 4: Production Readiness

### Firestore Vector Indexing
To ensure sub-second search performance once the database grows beyond ~1,000 total vectors, a composite vector index must be created. This enables native KNN search and prevents slow "Full Collection Scans."

**Run this command to create the index:**
```bash
gcloud firestore indexes composite create \
--collection-group=faq_vectors \
--query-scope=COLLECTION \
--field-config=field-path=site_id,order=ASCENDING \
--field-config=field-path=active,order=ASCENDING \
--field-config=vector-config='{"dimension":"768","flat": "{}"}',field-path=embedding
```
