from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional, Union, List, Dict

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ResponseType(str, Enum):
    faq_hit = "faq_hit"
    llm_fallback = "llm_fallback"
    helpline = "helpline"
    error = "error"


class ReviewStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class BackgroundTaskStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class BackgroundTaskRecord(BaseModel):
    id: str
    site_id: str
    type: str
    status: BackgroundTaskStatus = BackgroundTaskStatus.pending
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SiteBase(BaseModel):
    name: Optional[str] = None
    domain: str = ""
    helpline_number: Optional[str] = None
    welcome_message: str = "Hi, how can I help?"
    fallback_message: str = "I could not find the exact answer. Please contact our helpline."
    faq_accept_distance: float = 0.28
    faq_review_distance: float = 0.45
    llm_candidate_distance: float = 0.55
    active: bool = True
    allowed_origins: List[str] = Field(default_factory=list)
    primary_color: str = "#126c57"
    bot_name: str = "Support Bot"
    bot_avatar_url: str = ""
    launcher_icon: str = "?"
    deleted_at: Optional[datetime] = None
    purge_after: Optional[datetime] = None


class SiteCreate(SiteBase):
    id: Optional[str] = None


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    helpline_number: Optional[str] = None
    welcome_message: Optional[str] = None
    fallback_message: Optional[str] = None
    faq_accept_distance: Optional[float] = None
    faq_review_distance: Optional[float] = None
    llm_candidate_distance: Optional[float] = None
    active: Optional[bool] = None
    allowed_origins: Optional[List[str]] = None
    primary_color: Optional[str] = None
    bot_name: Optional[str] = None
    bot_avatar_url: Optional[str] = None
    launcher_icon: Optional[str] = None
    deleted_at: Optional[datetime] = None
    purge_after: Optional[datetime] = None


class SiteRecord(SiteBase):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SiteGroupBase(BaseModel):
    name: str
    description: str = ""
    site_ids: List[str] = Field(default_factory=list)


class SiteGroupCreate(SiteGroupBase):
    id: Optional[str] = None


class SiteGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    site_ids: Optional[List[str]] = None


class SiteGroupRecord(SiteGroupBase):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class FaqBase(BaseModel):
    question: str
    answer: str
    aliases: List[str] = Field(default_factory=list)
    site_id: str = ""
    group_id: str = ""
    active: bool = True


class FaqCreate(FaqBase):
    id: Optional[str] = None


class FaqUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    aliases: Optional[List[str]] = None
    site_id: Optional[str] = None
    group_id: Optional[str] = None
    active: Optional[bool] = None


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
    embedding: List[float]
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
    session_id: Optional[str] = None
    name: str = ""
    email: str = ""
    phone: str = ""


class ChatMessageResponse(BaseModel):
    answer: str
    response_type: ResponseType
    matched_faq_id: Optional[str] = None
    vector_distance: Optional[float] = None
    session_id: Optional[str] = None


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
    matched_faq_id: Optional[str] = None
    vector_distance: Optional[float] = None
    llm_model: str = ""
    timestamp: datetime = Field(default_factory=utc_now)
    review_status: ReviewStatus = ReviewStatus.pending
    converted_to_faq_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AdminUserCreate(BaseModel):
    email: str
    password: str
    site_ids: List[str] = Field(default_factory=list)


class SiteOwnerRegistration(BaseModel):
    email: str
    password: str
    site: SiteCreate
