# Developer Handover Guide: Multi-Site FAQ Chatbot

Welcome to the Multi-Site FAQ Chatbot project! This document is designed to give you a complete understanding of the system, how it works, and where to find everything. 

---

## 1. Core Technologies
- **Backend:** Python 3, **FastAPI** (High-performance async API framework).
- **Database:** **Google Cloud Firestore** (NoSQL document database).
- **Vector Search:** Firestore's native **Vector KNN Search** for semantic matching.
- **LLM & Embeddings:** Configurable (currently using **OpenAI** `gpt-4o-mini` and `text-embedding-3-small`, but supports Gemini as well via `.env`).
- **Authentication:** **Firebase Auth** (Custom Claims are used for RBAC/Site access).
- **Frontend / Portals:** Vanilla HTML, CSS, and JavaScript (No React/Vue). It relies on heavy DOM manipulation and a custom global `state` object.
- **Chatbot Widget:** A lightweight, vanilla JS embeddable script (`chatbot-widget.js`) designed to be dropped into any client website.

---

## 2. System Architecture & Data Flow

### The Multi-Tenant Model
The system is built for **Multi-Tenancy**. A single backend serves multiple different companies (Sites).
1. **Sites:** Represents a single website or client. It has its own settings, colors, allowed origins, and bot configurations.
2. **Groups:** A collection of Sites (must contain at least 2). Groups are used to share a common Knowledge Base across multiple related sites (e.g., sharing "Shipping Policies" across 5 localized e-commerce domains).
3. **FAQs (Knowledge Base):** An FAQ belongs strictly to **EITHER** a Site **OR** a Group (Exclusive OR). 

### The Retrieval Flow (How the Bot Answers)
When a user asks a question via the widget on `example.com`:
1. **Request:** Widget sends the `site_id` and the user's `question` to the backend.
2. **Embedding:** The backend generates a Vector Embedding (768 or 1536 dimensions) for the user's question using OpenAI/Gemini.
3. **Vector Search:** The backend queries the `faq_vectors` Firestore collection using `find_nearest` (KNN). It filters by `site_id` (which includes vectors belonging to the site AND vectors belonging to the site's groups).
4. **Distance Check:** The system checks the "cosine distance" of the nearest match:
   - **Direct Hit:** If distance is below `faq_accept_distance` (e.g., very similar), the exact FAQ answer is returned immediately.
   - **Borderline (LLM Fallback):** If distance is below `llm_candidate_distance`, the FAQ context is sent to the LLM to verify if it answers the question, or to rephrase it.
   - **No Match:** The bot returns the site's default `fallback_message` (e.g., "Please call our helpline").
5. **Logging:** The interaction is asynchronously logged to the `chat_logs` collection and the O(1) `site_stats` counters are incremented.

---

## 3. Key Frontend Logic

### State Management & Caching
Both the Admin and User portals (`app.js`) use a global `state` object. 
Data is aggressively cached in `localStorage` using a custom `Cache` object to prevent unnecessary API calls and reduce Firestore reads.

### Optimistic UI & Promise Queues
To make the dashboard feel blazing fast, forms (like adding an FAQ or creating a Group) update the UI **instantly** before the server responds.
- A temporary ID (e.g., `temp_171...`) is assigned.
- The UI renders the new item immediately.
- The API call is pushed to a Promise queue (`faqQueue` or `groupQueue`).
- **If it succeeds:** The temp ID is swapped with the real database ID silently.
- **If it fails:** The UI rolls back the change and shows an error toast.
*(Note: Never remove the Queues, or rapid clicking will cause race conditions!)*

---

## 4. Database & Performance Optimization

### High-Efficiency Analytics (O(1) Reads)
Instead of reading 1,000 logs to calculate "Hit Rates," the system uses **Atomic Counters**. Every time a chat happens, `FirestoreRepository.create_log` increments counters in a `site_stats` document. The analytics dashboard costs only **1 Read** to load.

### Pagination
Log viewing uses native Firestore `offset()` and `limit(20)`. The frontend manages a `state.logPage` variable.

### Critical Indexes & TTL
If search or analytics break with a "Failed Precondition" error, you are missing an index. The following must exist in the Firebase Console:
1. `chat_logs`: `site_id` (Asc), `response_type` (Asc), `timestamp` (Desc)
2. `chat_logs`: `site_id` (Asc), `review_status` (Asc), `timestamp` (Desc)
3. `chat_logs`: `site_id` (Asc), `timestamp` (Desc)
4. `faq_vectors`: `site_id` (Asc), `active` (Asc), `embedding` (Vector)

**Note on TTL:** The code automatically adds an `expire_at` field to logs, but the automatic deletion in Firestore **requires a Firebase Blaze (Pay-as-you-go) plan**. On the Spark (Free) plan, logs will persist until manually deleted.

---

## 5. File Directory Map

Here is where to find everything when you need to make changes:

### Backend (`/backend/app/`)
| Path | Purpose |
| :--- | :--- |
| `main.py` | FastAPI application entry point, CORS setup, and route inclusion. |
| `core/config.py` | Environment variables parsing (`.env`) and configuration setup. |
| `api/admin.py` | REST API routes for the Admin Portal (Site/Group/User CRUD). |
| `api/portal.py` | REST API routes specifically for the User/Site-Owner portal. |
| `api/chat.py` | The main inference endpoint. Where the bot actually processes user messages. |
| `models/` | Pydantic data models. Defines the schema for FAQs, Sites, Logs, etc. |
| `repositories/firestore.py` | **The Database Layer.** ALL database interactions, queries, and atomic counter logic live here. |
| `services/` | Business logic (e.g., `llm.py` for LLM routing, `embeddings.py` for generating vectors). |
| `workers/` | Background task logic (e.g., `reindex.py` for bulk FAQ embedding generation). |

### Frontend Portals (`/backend/app/static/`)
| Path | Purpose |
| :--- | :--- |
| `admin/index.html` & `app.js` | The **Super Admin** portal. Used to manage all sites, users, and groups globally. |
| `portal/index.html` & `app.js` | The **Site Owner** portal. Multi-tenant dashboard where clients log in to manage their specific assigned sites. |

### Widget (`/widget/`)
| Path | Purpose |
| :--- | :--- |
| `chatbot-widget.js` | The vanilla JS file embedded on client websites. Handles the chat UI, WebSockets/HTTP calls to the backend, and maintains a 24-hour `localStorage` chat session. |
| `demo.html` | A simple HTML file to locally test the widget. |

---

## 6. How to Run Locally

1. **Backend:**
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
2. **Environment Variables:** Ensure your `.env` is populated with `OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS` (path to your Firebase service account key), and `GOOGLE_CLOUD_PROJECT`.
3. **Accessing Portals Locally:** 
   - Admin: `http://localhost:8000/admin/`
   - User Portal: `http://localhost:8000/portal/`
