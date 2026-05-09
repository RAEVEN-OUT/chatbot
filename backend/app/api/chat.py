from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_repo, get_retrieval_service
from app.repositories.base import Repository
from app.schemas.models import (
    ChatMessageRequest,
    ChatMessageResponse,
    ChatSessionCreate,
    ChatSessionRecord,
)
from app.services.retrieval_service import RetrievalService

router = APIRouter(prefix="/api/chat")


@router.get("/sites/{site_id}/config")
def get_widget_config(site_id: str, repository: Repository = Depends(get_repo)):
    site = repository.get_site(site_id)
    if not site or not site.active:
        raise HTTPException(status_code=404, detail="Site not found.")
    return {
        "siteId": site.id,
        "name": site.name,
        "welcomeMessage": site.welcome_message,
        "collectLead": True,
    }


@router.post("/sessions", response_model=ChatSessionRecord)
def create_session(
    payload: ChatSessionCreate,
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
):
    return retrieval_service.create_session(payload)


@router.post("/message", response_model=ChatMessageResponse)
def send_message(
    payload: ChatMessageRequest,
    retrieval_service: RetrievalService = Depends(get_retrieval_service),
):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question is required.")
    return retrieval_service.answer(payload)
