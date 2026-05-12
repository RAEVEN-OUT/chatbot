from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ResponseType(str, Enum):
    faq_hit = "faq_hit"
    llm_fallback = "llm_fallback"
    helpline = "helpline"
    error = "error"


class SiteBase(BaseModel):
    name: str
    domain: str = ""
    helpline_number: str
    welcome_message: str = "Hi, how can I help?"
    fallback_message: str = "I could not find the exact answer. Please contact our helpline."
    faq_accept_distance: float = 0.28
    faq_review_distance: float = 0.45
    llm_candidate_distance: float = 0.55
    active: bool = True
    allowed_origins: list[str] = Field(default_factory=list)
    primary_color: str = "#126c57"
    bot_name: str = "Support Bot"
    bot_avatar_url: str = ""
    launcher_icon: str = "?"


class SiteCreate(SiteBase):
    id: str | None = None


class SiteUpdate(BaseModel):
    name: str | None = None
    domain: str | None = None
    helpline_number: str | None = None
    welcome_message: str | None = None
    fallback_message: str | None = None
    faq_accept_distance: float | None = None
    faq_review_distance: float | None = None
    llm_candidate_distance: float | None = None
    active: bool | None = None
    allowed_origins: list[str] | None = None
    primary_color: str | None = None
    bot_name: str | None = None
    bot_avatar_url: str | None = None
    launcher_icon: str | None = None


class SiteRecord(SiteBase):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SiteGroupBase(BaseModel):
    name: str
    description: str = ""
    site_ids: list[str] = Field(default_factory=list)
    active: bool = True


class SiteGroupCreate(SiteGroupBase):
    id: str | None = None


class SiteGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    site_ids: list[str] | None = None
    active: bool | None = None


class SiteGroupRecord(SiteGroupBase):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class FaqBase(BaseModel):
    question: str
    answer: str
    aliases: list[str] = Field(default_factory=list)
    site_ids: list[str] = Field(default_factory=list)
    group_ids: list[str] = Field(default_factory=list)
    active: bool = True


class FaqCreate(FaqBase):
    id: str | None = None


class FaqUpdate(BaseModel):
    question: str | None = None
    answer: str | None = None
    aliases: list[str] | None = None
    site_ids: list[str] | None = None
    group_ids: list[str] | None = None
    active: bool | None = None


class FaqRecord(FaqBase):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class FaqVectorRecord(BaseModel):
    id: str
    faq_id: str
    site_id: str
    source_text: str
    source_type: str
    normalized_text: str
    embedding: list[float]
    answer_snapshot: str
    question_snapshot: str
    active: bool = True
    source_version: int = 1
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ChatSessionCreate(BaseModel):
    site_id: str
    name: str = ""
    email: str = ""
    phone: str = ""


class ChatSessionRecord(ChatSessionCreate):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    last_seen_at: datetime = Field(default_factory=utc_now)


class ChatMessageRequest(BaseModel):
    site_id: str
    question: str = Field(min_length=1, max_length=2000)
    session_id: str | None = None
    name: str = ""
    email: str = ""
    phone: str = ""


class ChatMessageResponse(BaseModel):
    answer: str
    response_type: ResponseType
    matched_faq_id: str | None = None
    vector_distance: float | None = None
    session_id: str | None = None


class ChatLogRecord(BaseModel):
    id: str
    site_id: str
    session_id: str = ""
    user_name: str = ""
    email: str = ""
    phone: str = ""
    question: str
    answer: str
    response_type: ResponseType
    matched_faq_id: str | None = None
    vector_distance: float | None = None
    llm_model: str = ""
    timestamp: datetime = Field(default_factory=utc_now)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AdminUserCreate(BaseModel):
    email: str
    password: str
    site_ids: list[str] = Field(default_factory=list)
