# Technology Stack

This document summarizes the core technologies used in the Chatbot platform.

## 1. Backend Core
- **FastAPI:** High-performance Python web framework for the API.
- **Uvicorn:** ASGI server for production-grade performance.
- **Pydantic:** Data validation and settings management using Python type annotations.
- **Firebase Admin SDK:** Server-side interaction with Firebase Auth and Firestore.

## 2. Database & Search
- **Google Firestore:** Scalable NoSQL document database.
- **Firestore Native Vector Search:** Uses `VectorValue` and `find_nearest` for high-speed semantic retrieval.
- **Distance Metric:** Cosine Similarity.

## 3. Artificial Intelligence (Gemini)
- **Gemini 3 Flash:** Used for synthesizing natural language answers from FAQ context and reranking candidates.
- **Gemini Embedding 2:** Generates 768-dimension vectors for semantic search.
- **Streaming:** Tokens are streamed from Gemini to the UI in real-time for a "typing" effect.

## 4. Security & RBAC
- **Firebase Authentication:** Handles user identity (Email/Password).
- **Custom Claims:** RBAC (Roles and Site IDs) are "stamped" onto the Firebase ID Token.
- **Backend Middleware:** Strict dependency-injection based security checks in FastAPI.

## 5. Frontend
- **Vanilla JavaScript:** Zero-dependency frontend logic for maximum speed and compatibility.
- **CSS3 Variables:** Modern, themeable design system with dark mode and glassmorphism.
- **Embeddable Widget:** A single `<script>` tag solution that works on any website.

## 6. Deployment Target
- **Docker:** Containerized environment for consistent deployment.
- **Google Cloud Run:** Fully managed serverless platform for hosting the FastAPI app.
- **Google Artifact Registry:** Stores the production container images.
