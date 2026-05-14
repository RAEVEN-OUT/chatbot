from __future__ import annotations

<<<<<<< HEAD
=======
from datetime import datetime, timedelta, timezone

>>>>>>> dev
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
<<<<<<< HEAD
=======
    SiteOwnerRegistration,
>>>>>>> dev
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


<<<<<<< HEAD
=======
def _claim_site_ids(uid: str) -> list[str]:
    user = auth.get_user(uid)
    claims = user.custom_claims or {}
    raw = claims.get("site_ids") or []
    if isinstance(raw, str):
        return [item.strip() for item in raw.split(",") if item.strip()]
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return []


def _append_site_claim(uid: str, site_id: str) -> None:
    site_ids = _claim_site_ids(uid)
    if "*" in site_ids or site_id in site_ids:
        return
    user = auth.get_user(uid)
    claims = dict(user.custom_claims or {})
    claims["site_ids"] = [*site_ids, site_id]
    auth.set_custom_user_claims(uid, claims)


>>>>>>> dev
@router.get("/me")
def current_admin(principal: AdminPrincipal = Depends(require_admin)):
    return {
        "uid": principal.uid,
        "email": principal.email,
        "site_ids": list(principal.site_ids),
        "all_sites": principal.can_access_all_sites,
        "role": "super_admin" if principal.can_access_all_sites else "owner",
    }


@router.get("/sites", response_model=list[SiteRecord])
def list_sites(
    include_deleted: bool = False,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    return _visible_sites(
        principal,
        repository.list_sites(include_deleted=include_deleted and principal.can_access_all_sites),
    )


<<<<<<< HEAD
=======
@router.post("/sites", response_model=SiteRecord)
def create_site(
    payload: SiteCreate,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    site = faq_service.create_site(payload)
    if not principal.can_access_all_sites:
        _append_site_claim(principal.uid, site.id)
    return site


>>>>>>> dev
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
<<<<<<< HEAD
=======


@router.delete("/sites/{site_id}", response_model=SiteRecord)
def delete_site(
    site_id: str,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id)
    site = faq_service.soft_delete_site(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    return site
>>>>>>> dev


@router.get("/groups", response_model=list[SiteGroupRecord])
def list_groups(
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    groups = repository.list_groups()
    if principal.can_access_all_sites:
        return groups
<<<<<<< HEAD
    
    # Filter groups: user can see a group if it contains ANY site they own
    return [
        g for g in groups
        if any(principal.can_access_site(s_id) for s_id in g.site_ids)
    ]
=======
    return [g for g in groups if any(principal.can_access_site(s_id) for s_id in g.site_ids)]
>>>>>>> dev


@router.post("/groups", response_model=SiteGroupRecord)
def create_group(
    payload: SiteGroupCreate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
<<<<<<< HEAD
    # Ensure user has access to all sites they are putting in this group
    if not payload.site_ids:
        raise HTTPException(status_code=400, detail="A group must contain at least one site.")
        
    for s_id in payload.site_ids:
        require_site_access(principal, s_id)
        
=======
    if not payload.site_ids:
        raise HTTPException(status_code=400, detail="A group must contain at least one site.")
    for s_id in payload.site_ids:
        require_site_access(principal, s_id)
>>>>>>> dev
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
<<<<<<< HEAD
        
    # Check access to existing sites in group
    for s_id in group.site_ids:
        require_site_access(principal, s_id)
        
    # Check access to new sites being added
    if payload.site_ids:
        for s_id in payload.site_ids:
            require_site_access(principal, s_id)
            
=======
    for s_id in group.site_ids:
        require_site_access(principal, s_id)
    if payload.site_ids:
        for s_id in payload.site_ids:
            require_site_access(principal, s_id)
>>>>>>> dev
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
<<<<<<< HEAD
        
    for s_id in group.site_ids:
        require_site_access(principal, s_id)
        
=======
    for s_id in group.site_ids:
        require_site_access(principal, s_id)
>>>>>>> dev
    repository.delete_group(group_id)


@router.post("/users")
def create_admin_user(
    payload: AdminUserCreate,
    principal: AdminPrincipal = Depends(require_admin),
):
    if not principal.can_access_all_sites:
        raise HTTPException(status_code=403, detail="Only platform admins can create users.")
<<<<<<< HEAD
        
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
=======
    try:
        user = auth.create_user(email=payload.email, password=payload.password)
        auth.set_custom_user_claims(user.uid, {"site_ids": payload.site_ids})
>>>>>>> dev
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
<<<<<<< HEAD

=======
>>>>>>> dev
    if group_id:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")
        for s_id in group.site_ids:
            require_site_access(principal, s_id)
        return repository.list_faqs(group_id=group_id, include_inactive=include_inactive)
<<<<<<< HEAD

    # If no scope, list all FAQs the user has access to
=======
    
>>>>>>> dev
    faqs = repository.list_faqs(include_inactive=include_inactive)
    if principal.can_access_all_sites:
        return faqs
        
    return [
        faq for faq in faqs
<<<<<<< HEAD
        if any(principal.can_access_site(s_id) for s_id in faq.site_ids) or
           any(any(principal.can_access_site(s_id) for s_id in repository.get_group(g_id).site_ids) 
               for g_id in faq.group_ids if repository.get_group(g_id))
=======
        if (faq.site_id and principal.can_access_site(faq.site_id)) or
           (faq.group_id and (group := repository.get_group(faq.group_id)) and
            any(principal.can_access_site(s_id) for s_id in group.site_ids))
>>>>>>> dev
    ]


@router.post("/faqs", response_model=FaqRecord)
def create_faq(
    payload: FaqCreate,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
<<<<<<< HEAD
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
        
=======
    if bool(payload.site_id) == bool(payload.group_id):
        raise HTTPException(status_code=400, detail="Select exactly one site or one group.")
    if payload.site_id:
        require_site_access(principal, payload.site_id)
    if payload.group_id:
        group = repository.get_group(payload.group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")
        for s_id in group.site_ids:
            require_site_access(principal, s_id)
>>>>>>> dev
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
<<<<<<< HEAD
        
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
=======
    if existing.site_id:
        require_site_access(principal, existing.site_id)
    if existing.group_id:
        group = repository.get_group(existing.group_id)
        if group:
            for s_id in group.site_ids:
                require_site_access(principal, s_id)
    target_site_id = payload.site_id if payload.site_id is not None else existing.site_id
    target_group_id = payload.group_id if payload.group_id is not None else existing.group_id
    if bool(target_site_id) == bool(target_group_id):
        raise HTTPException(status_code=400, detail="Select exactly one site or one group.")
    if target_site_id:
        require_site_access(principal, target_site_id)
    if target_group_id:
        group = repository.get_group(target_group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")
        for s_id in group.site_ids:
            require_site_access(principal, s_id)
    return faq_service.update_faq(faq_id, payload)
>>>>>>> dev


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
<<<<<<< HEAD
        
    for s_id in faq.site_ids:
        require_site_access(principal, s_id)
        
=======
    if faq.site_id:
        require_site_access(principal, faq.site_id)
    if faq.group_id:
        group = repository.get_group(faq.group_id)
        if group:
            for s_id in group.site_ids:
                require_site_access(principal, s_id)
>>>>>>> dev
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
    helpline_escapes = sum(1 for log in logs if log.response_type == ResponseType.helpline)
    
    hit_rate = round((faq_hits / total * 100), 1) if total > 0 else 0
<<<<<<< HEAD
=======
    llm_rate = round((llm_fallbacks / total * 100), 1) if total > 0 else 0
    helpline_rate = round((helpline_escapes / total * 100), 1) if total > 0 else 0
>>>>>>> dev
    
    from collections import Counter
    faq_counter = Counter(log.matched_faq_id for log in logs if log.matched_faq_id)
    top_faqs = []
    for faq_id, count in faq_counter.most_common(5):
        faq = repository.get_faq(faq_id)
        top_faqs.append({"question": faq.question if faq else faq_id, "count": count})
        
    return {
        "total_queries": total,
        "faq_hits": faq_hits,
        "hit_rate": hit_rate,
<<<<<<< HEAD
=======
        "llm_fallbacks": llm_fallbacks,
        "llm_rate": llm_rate,
        "helpline_rate": helpline_rate,
>>>>>>> dev
        "top_faqs": top_faqs
    }


@router.get("/logs")
def list_logs(
    site_id: str | None = None,
<<<<<<< HEAD
=======
    response_type: ResponseType | None = None,
    since: str | None = None,
    fallback_only: bool = False,
>>>>>>> dev
    limit: int = Query(default=100, ge=1, le=500),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    if site_id:
        require_site_access(principal, site_id)
<<<<<<< HEAD
    
    logs = repository.list_logs(site_id=site_id, limit=limit)
    
    if not site_id and not principal.can_access_all_sites:
        logs = [log for log in logs if principal.can_access_site(log.site_id)]
        
    return logs
=======
    logs = repository.list_logs(
        site_id=site_id,
        response_type=response_type,
        fallback_only=fallback_only,
        limit=limit,
    )
    if not site_id and not principal.can_access_all_sites:
        logs = [log for log in logs if principal.can_access_site(log.site_id)]
    if since:
        now = datetime.now(timezone.utc)
        cutoffs = {
            "1d": now - timedelta(days=1),
            "7d": now - timedelta(days=7),
            "30d": now - timedelta(days=30),
        }
        cutoff = cutoffs.get(since)
        if cutoff:
            logs = [log for log in logs if log.timestamp >= cutoff]
    return logs


@router.post("/logs/{log_id}/convert-to-faq", response_model=FaqRecord)
def convert_log_to_faq(
    log_id: str,
    payload: FaqCreate,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    log = repository.get_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found.")
    require_site_access(principal, log.site_id)
    faq_payload = payload.model_copy(update={"site_id": log.site_id, "group_id": ""})
    faq = faq_service.create_faq(faq_payload)
    log.converted_to_faq_id = faq.id
    repository.update_log(log)
    return faq


@router.post("/sites/{site_id}/reindex")
def reindex_site(
    site_id: str,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id)
    count = faq_service.reindex_site(site_id)
    return {"status": "completed", "total_items": count}


@router.post("/register-site-owner")
def register_site_owner(
    payload: SiteOwnerRegistration,
    faq_service: FaqService = Depends(get_faq_service),
):
    try:
        user = auth.create_user(email=payload.email, password=payload.password)
        site = faq_service.create_site(payload.site)
        auth.set_custom_user_claims(user.uid, {"site_ids": [site.id]})
        token = auth.create_custom_token(user.uid, {"site_ids": [site.id]})
        return {
            "uid": user.uid,
            "site": site,
            "firebase_token": token.decode("utf-8") if isinstance(token, bytes) else token,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
>>>>>>> dev
