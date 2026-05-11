from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_repo, get_retrieval_service
from app.core.config import settings
from app.repositories.base import Repository
from app.schemas.models import (
    ChatMessageRequest,
    ChatMessageResponse,
    ChatSessionCreate,
    ChatSessionRecord,
)
from app.services.retrieval_service import RetrievalService

router = APIRouter(prefix="/api/chat")
logger = logging.getLogger(__name__)


# In-memory rate limiting dictionary: { ip: [timestamps] }
_rate_limits = {}

def check_rate_limit(request: Request, limit: int = 20, window: int = 60):
    """Limits requests to `limit` per `window` seconds per IP address."""
    if not request.client:
        return
        
    ip = request.client.host
    now = time.time()
    
    timestamps = _rate_limits.get(ip, [])
    # Keep only timestamps within the current window
    timestamps = [ts for ts in timestamps if now - ts < window]
    
    if len(timestamps) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a minute.")
        
    timestamps.append(now)
    _rate_limits[ip] = timestamps


def verify_site_origin(request: Request, site_id: str, repo: Repository):
    site = repo.get_site(site_id)
    if not site or not site.active:
        raise HTTPException(status_code=404, detail="Site not found.")

    if settings.env == "development":
        return site

    # Extract origin or referer
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    
    # Allow localhost by default in dev
    if "localhost" in origin or "127.0.0.1" in origin:
        return site

    # Clean the origin (remove protocol and trailing slashes for easier comparison)
    clean_origin = origin.lower().replace("https://", "").replace("http://", "").strip("/")
    clean_site_domain = site.domain.lower().replace("https://", "").replace("http://", "").strip("/")

    # Check against primary domain
    if clean_site_domain and clean_origin == clean_site_domain:
        return site

    # Check against allowed origins list
    for allowed in site.allowed_origins:
        clean_allowed = allowed.lower().replace("https://", "").replace("http://", "").strip("/")
        if clean_origin == clean_allowed:
            return site

    raise HTTPException(
        status_code=403, 
        detail=f"Origin {origin} is not allowed for this site."
    )


@router.get("/sites/{site_id}/config")
def get_widget_config(site_id: str, request: Request, repository: Repository = Depends(get_repo)):
    site = verify_site_origin(request, site_id, repository)
    return {
        "siteId": site.id,
        "name": site.name,
        "welcomeMessage": site.welcome_message,
        "primaryColor": site.primary_color,
        "botName": site.bot_name,
        "botAvatar": site.bot_avatar_url,
        "launcherIcon": site.launcher_icon,
        "collectLead": True,
    }


@router.post("/sessions", response_model=ChatSessionRecord)
def create_session(
    payload: ChatSessionCreate,
    request: Request,
    repository: Repository = Depends(get_repo),
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
):
    verify_site_origin(request, payload.site_id, repository)
    return retrieval_service.create_session(payload)


@router.post("/message", response_model=ChatMessageResponse)
async def send_message(
    payload: ChatMessageRequest,
    request: Request,
    repository: Repository = Depends(get_repo),
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
):
    check_rate_limit(request, limit=15) # Stricter limit for actual messages
    verify_site_origin(request, payload.site_id, repository)
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question is required.")
    return await retrieval_service.answer(payload)


@router.post("/message/stream")
async def stream_message(
    payload: ChatMessageRequest,
    request: Request,
    repository: Repository = Depends(get_repo),
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
):
    check_rate_limit(request, limit=15) # Stricter limit for actual messages
    verify_site_origin(request, payload.site_id, repository)
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question is required.")

    async def events():
        try:
            async for chunk in retrieval_service.stream_answer(payload):
                yield f"{json.dumps(chunk)}\n"
        except Exception:
            logger.exception("Chat stream failed for site %s", payload.site_id)
            fallback = "Sorry, something went wrong. Please try again."
            yield f"{json.dumps({'type': 'metadata', 'response_type': 'error'})}\n"
            yield f"{json.dumps({'type': 'token', 'text': fallback})}\n"
            yield f"{json.dumps({'type': 'done'})}\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")
