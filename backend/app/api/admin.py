from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_faq_service, get_repo
from app.core.security import require_admin
from app.repositories.base import Repository
from app.schemas.models import (
    ConvertLogRequest,
    FaqCreate,
    FaqRecord,
    FaqUpdate,
    ResponseType,
    SeedDemoResponse,
    SiteCreate,
    SiteGroupCreate,
    SiteGroupRecord,
    SiteGroupUpdate,
    SiteRecord,
    SiteUpdate,
)
from app.services.faq_service import FaqService

router = APIRouter(prefix="/api", dependencies=[Depends(require_admin)])


@router.get("/sites", response_model=list[SiteRecord])
def list_sites(repository: Repository = Depends(get_repo)):
    return repository.list_sites()


@router.post("/sites", response_model=SiteRecord)
def create_site(
    payload: SiteCreate,
    faq_service: FaqService = Depends(get_faq_service),
):
    return faq_service.create_site(payload)


@router.get("/sites/{site_id}", response_model=SiteRecord)
def get_site(site_id: str, repository: Repository = Depends(get_repo)):
    site = repository.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    return site


@router.patch("/sites/{site_id}", response_model=SiteRecord)
def update_site(
    site_id: str,
    payload: SiteUpdate,
    faq_service: FaqService = Depends(get_faq_service),
):
    site = faq_service.update_site(site_id, payload)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    return site


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(site_id: str, repository: Repository = Depends(get_repo)):
    repository.delete_site(site_id)


@router.get("/groups", response_model=list[SiteGroupRecord])
def list_groups(repository: Repository = Depends(get_repo)):
    return repository.list_groups()


@router.post("/groups", response_model=SiteGroupRecord)
def create_group(
    payload: SiteGroupCreate,
    faq_service: FaqService = Depends(get_faq_service),
):
    return faq_service.create_group(payload)


@router.patch("/groups/{group_id}", response_model=SiteGroupRecord)
def update_group(
    group_id: str,
    payload: SiteGroupUpdate,
    faq_service: FaqService = Depends(get_faq_service),
):
    group = faq_service.update_group(group_id, payload)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    return group


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: str, repository: Repository = Depends(get_repo)):
    repository.delete_group(group_id)


@router.get("/faqs", response_model=list[FaqRecord])
def list_faqs(
    site_id: str | None = None,
    group_id: str | None = None,
    include_inactive: bool = False,
    repository: Repository = Depends(get_repo),
):
    return repository.list_faqs(
        site_id=site_id,
        group_id=group_id,
        include_inactive=include_inactive,
    )


@router.post("/faqs", response_model=FaqRecord)
def create_faq(
    payload: FaqCreate,
    faq_service: FaqService = Depends(get_faq_service),
):
    if not payload.site_ids and not payload.group_ids:
        raise HTTPException(
            status_code=400,
            detail="Select at least one site or group for this FAQ.",
        )
    return faq_service.create_faq(payload)


@router.patch("/faqs/{faq_id}", response_model=FaqRecord)
def update_faq(
    faq_id: str,
    payload: FaqUpdate,
    faq_service: FaqService = Depends(get_faq_service),
):
    faq = faq_service.update_faq(faq_id, payload)
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found.")
    return faq


@router.delete("/faqs/{faq_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_faq(
    faq_id: str,
    faq_service: FaqService = Depends(get_faq_service),
):
    faq_service.delete_faq(faq_id)


@router.post("/faqs/{faq_id}/reindex", response_model=FaqRecord)
def reindex_faq(
    faq_id: str,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
):
    faq = repository.get_faq(faq_id)
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found.")
    faq_service.reindex_faq(faq_id)
    return faq


@router.get("/logs")
def list_logs(
    site_id: str | None = None,
    response_type: ResponseType | None = None,
    fallback_only: bool = Query(default=False),
    repository: Repository = Depends(get_repo),
):
    logs = repository.list_logs(site_id=site_id, response_type=response_type)
    if fallback_only:
        logs = [log for log in logs if log.response_type != ResponseType.faq_hit]
    return logs


@router.post("/logs/{log_id}/convert-to-faq", response_model=FaqRecord)
def convert_log_to_faq(
    log_id: str,
    payload: ConvertLogRequest,
    faq_service: FaqService = Depends(get_faq_service),
):
    faq = faq_service.convert_log_to_faq(log_id, payload)
    if not faq:
        raise HTTPException(status_code=404, detail="Log not found.")
    return faq


@router.post("/demo/seed", response_model=SeedDemoResponse)
def seed_demo(faq_service: FaqService = Depends(get_faq_service)):
    site = faq_service.create_site(
        SiteCreate(
            id="demo-site",
            name="Demo Site",
            domain="demo.local",
            helpline_number="+91 90000 00000",
            welcome_message="Welcome to Demo Site. How can I help?",
            fallback_message="I could not find that in our FAQs.",
        )
    )
    existing = faq_service.repository.list_faqs(site_id=site.id)
    if not existing:
        faq_service.create_faq(
            FaqCreate(
                question="What is Demo Site?",
                answer="Demo Site is a sample chatbot site used to test FAQ retrieval.",
                aliases=["Tell me about Demo Site", "wht is demo site"],
                site_ids=[site.id],
            )
        )
        faq_service.create_faq(
            FaqCreate(
                question="How do I contact support?",
                answer="You can contact Demo Site support at +91 90000 00000.",
                aliases=["support number", "helpline number"],
                site_ids=[site.id],
            )
        )
    return SeedDemoResponse(site=site, faq_count=len(faq_service.repository.list_faqs(site_id=site.id)))
