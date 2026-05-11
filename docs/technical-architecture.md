# Technical Architecture & Indexing

This document outlines the core retrieval architecture and indexing strategy used for the Chatbot platform.

## 1. Vector Retrieval System

The system uses a multi-layered approach to finding the best answer:
1.  **Exact Match:** Checks for a normalized string match against stored questions and aliases.
2.  **Semantic Search (Vector):** Uses Firestore's native vector engine to find semantically similar FAQs.
3.  **LLM Reranking:** A reasoning layer (Gemini) that validates the Top 3 vector results to prevent "entity confusion."

## 2. Firestore Indexing Details

We use a **Composite Vector Index** on the `faq_vectors` collection. This allows us to perform high-speed searches that are strictly scoped to a specific site.

### Indexed Columns:
| Field | Type | Purpose |
| :--- | :--- | :--- |
| `site_id` | `ASCENDING` | **Multi-Tenancy:** Ensures a site only sees its own data. |
| `active` | `ASCENDING` | **Filter:** Excludes deleted or hidden FAQs from search. |
| `embedding` | `VECTOR` | **KNN Search:** The 768-dimension vector representation of the question. |

### Search Configuration:
*   **Collection Group:** `faq_vectors`
*   **Vector Dimension:** use the dimension returned by the configured embedding model. The current default is `gemini-embedding-001`.
*   **Distance Measure:** `COSINE` (Measures semantic angle rather than absolute distance)
*   **Algorithm:** `FLAT` (Provides 100% accuracy for datasets up to ~10,000 FAQs)

## 3. Embedding Generation

*   **Model:** `gemini-embedding-001`
*   **Normalization:** Input text is lowercase-normalized and stripped of extra whitespace before embedding.
*   **Snapshots:** We store snapshots of the question and answer *inside* the vector document to avoid unnecessary database lookups during retrieval.

## 4. Background Task Queue

Large CSV imports are processed via a persistent Task system:
*   **State Tracking:** Jobs are stored in the `background_tasks` collection.
*   **Polling:** The Admin UI polls `GET /api/tasks/{task_id}` for real-time progress updates.
*   **Robustness:** Allows users to close the browser tab without stopping the indexing process.
