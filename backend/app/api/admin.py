from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks

from app.api.deps import get_faq_service, get_repo
from app.core.security import (
    AdminPrincipal,
    require_admin,
    require_site_access,
)
from app.repositories.base import Repository
from app.schemas.models import (
    AdminUserCreate,
    FaqCreate,
    FaqRecord,
    FaqUpdate,
    ResponseType,
    SiteCreate,
    SiteRecord,
    SiteUpdate,
    SiteGroupCreate,
    SiteGroupRecord,
    SiteGroupUpdate,
)
from app.services.faq_service import FaqService
from firebase_admin import auth

router = APIRouter(prefix="/api")


def _visible_sites(
    principal: AdminPrincipal,
    sites: list[SiteRecord],
) -> list[SiteRecord]:
    if principal.can_access_all_sites:
        return sites
    return [site for site in sites if principal.can_access_site(site.id)]


@router.get("/me")
def current_admin(principal: AdminPrincipal = Depends(require_admin)):
    return {
        "uid": principal.uid,
        "email": principal.email,
        "site_ids": list(principal.site_ids),
        "all_sites": principal.can_access_all_sites,
    }


@router.get("/sites", response_model=list[SiteRecord])
def list_sites(
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    return _visible_sites(principal, repository.list_sites())


@router.get("/sites/{site_id}", response_model=SiteRecord)
def get_site(
    site_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id)
    site = repository.get_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    return site


@router.patch("/sites/{site_id}", response_model=SiteRecord)
def update_site(
    site_id: str,
    payload: SiteUpdate,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id)
    site = faq_service.update_site(site_id, payload)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    return site


@router.get("/groups", response_model=list[SiteGroupRecord])
def list_groups(
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    groups = repository.list_groups()
    if principal.can_access_all_sites:
        return groups
    
    # Filter groups: user can see a group if it contains ANY site they own
    return [
        g for g in groups
        if any(principal.can_access_site(s_id) for s_id in g.site_ids)
    ]


@router.post("/groups", response_model=SiteGroupRecord)
def create_group(
    payload: SiteGroupCreate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    # Ensure user has access to all sites they are putting in this group
    if not payload.site_ids:
        raise HTTPException(status_code=400, detail="A group must contain at least one site.")
        
    for s_id in payload.site_ids:
        require_site_access(principal, s_id)
        
    return faq_service.create_group(payload, background_tasks)


@router.patch("/groups/{group_id}", response_model=SiteGroupRecord)
def update_group(
    group_id: str,
    payload: SiteGroupUpdate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    group = repository.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
        
    # Check access to existing sites in group
    for s_id in group.site_ids:
        require_site_access(principal, s_id)
        
    # Check access to new sites being added
    if payload.site_ids:
        for s_id in payload.site_ids:
            require_site_access(principal, s_id)
            
    return faq_service.update_group(group_id, payload, background_tasks)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    group = repository.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
        
    for s_id in group.site_ids:
        require_site_access(principal, s_id)
        
    repository.delete_group(group_id)


@router.post("/users")
def create_admin_user(
    payload: AdminUserCreate,
    principal: AdminPrincipal = Depends(require_admin),
):
    if not principal.can_access_all_sites:
        raise HTTPException(status_code=403, detail="Only platform admins can create users.")
        
    try:
        user = auth.create_user(
            email=payload.email,
            password=payload.password,
        )
        auth.set_custom_user_claims(
            user.uid,
            {
                "site_ids": payload.site_ids,
            }
        )
        return {"uid": user.uid, "message": f"Successfully created user {payload.email}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/faqs", response_model=list[FaqRecord])
def list_faqs(
    site_id: str | None = None,
    group_id: str | None = None,
    include_inactive: bool = False,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    if site_id:
        require_site_access(principal, site_id)
        return repository.list_faqs(site_id=site_id, include_inactive=include_inactive)

    if group_id:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")
        for s_id in group.site_ids:
            require_site_access(principal, s_id)
        return repository.list_faqs(group_id=group_id, include_inactive=include_inactive)

    # If no scope, list all FAQs the user has access to
    faqs = repository.list_faqs(include_inactive=include_inactive)
    if principal.can_access_all_sites:
        return faqs
        
    return [
        faq for faq in faqs
        if any(principal.can_access_site(s_id) for s_id in faq.site_ids) or
           any(any(principal.can_access_site(s_id) for s_id in repository.get_group(g_id).site_ids) 
               for g_id in faq.group_ids if repository.get_group(g_id))
    ]


@router.post("/faqs", response_model=FaqRecord)
def create_faq(
    payload: FaqCreate,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    if not payload.site_ids and not payload.group_ids:
        raise HTTPException(status_code=400, detail="Select at least one site or group for this FAQ.")
        
    for site_id in payload.site_ids:
        require_site_access(principal, site_id)
    
    for group_id in payload.group_ids:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail=f"Group {group_id} not found.")
        for s_id in group.site_ids:
            require_site_access(principal, s_id)
        
    return faq_service.create_faq(payload)


@router.patch("/faqs/{faq_id}", response_model=FaqRecord)
def update_faq(
    faq_id: str,
    payload: FaqUpdate,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    existing = repository.get_faq(faq_id)
    if not existing:
        raise HTTPException(status_code=404, detail="FAQ not found.")
        
    # Check access to current sites/groups
    for s_id in existing.site_ids:
        require_site_access(principal, s_id)
    for g_id in existing.group_ids:
        group = repository.get_group(g_id)
        if group:
            for s_id in group.site_ids:
                require_site_access(principal, s_id)
        
    # Check access to new sites/groups
    if payload.site_ids:
        for site_id in payload.site_ids:
            require_site_access(principal, site_id)
    if payload.group_ids:
        for g_id in payload.group_ids:
            group = repository.get_group(g_id)
            if group:
                for s_id in group.site_ids:
                    require_site_access(principal, s_id)
            
    faq = faq_service.update_faq(faq_id, payload)
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found.")
    return faq


@router.delete("/faqs/{faq_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_faq(
    faq_id: str,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    faq = repository.get_faq(faq_id)
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found.")
        
    for s_id in faq.site_ids:
        require_site_access(principal, s_id)
        
    faq_service.delete_faq(faq_id)


@router.get("/sites/{site_id}/analytics")
def get_site_analytics(
    site_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id)
    logs = repository.list_logs(site_id=site_id, limit=500)
    total = len(logs)
    
    faq_hits = sum(1 for log in logs if log.response_type == ResponseType.faq_hit)
    llm_fallbacks = sum(1 for log in logs if log.response_type == ResponseType.llm_fallback)
    helpline_fallbacks = sum(1 for log in logs if log.response_type == ResponseType.helpline)
    
    hit_rate = round((faq_hits / total * 100), 1) if total > 0 else 0
    
    from collections import Counter
    faq_counter = Counter(log.matched_faq_id for log in logs if log.matched_faq_id)
    top_faqs = []
    for faq_id, count in faq_counter.most_common(5):
        faq = repository.get_faq(faq_id)
        question_text = faq.question if faq else faq_id
        top_faqs.append({"question": question_text, "count": count})
        
    return {
        "total_queries": total,
        "faq_hits": faq_hits,
        "llm_fallbacks": llm_fallbacks,
        "helpline_fallbacks": helpline_fallbacks,
        "hit_rate": hit_rate,
        "top_faqs": top_faqs
    }


@router.get("/logs")
def list_logs(
    site_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    if site_id:
        require_site_access(principal, site_id)
    
    logs = repository.list_logs(site_id=site_id, limit=limit)
    
    if not site_id and not principal.can_access_all_sites:
        logs = [log for log in logs if principal.can_access_site(log.site_id)]
        
    return logs
