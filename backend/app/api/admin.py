from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status, Query

from app.api.deps import get_faq_service, get_repo
from app.core.security import (
    AdminPrincipal,
    AdminRole,
    require_admin,
    require_role,
    require_site_access,
)
from app.repositories.base import Repository
from app.schemas.models import (
    AdminUserCreate,
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
from firebase_admin import auth

router = APIRouter(prefix="/api")


def _visible_sites(
    principal: AdminPrincipal,
    sites: list[SiteRecord],
) -> list[SiteRecord]:
    if principal.can_access_all_sites:
        return sites
    return [site for site in sites if principal.can_access_site(site.id)]


def _require_faq_access(
    repository: Repository,
    principal: AdminPrincipal,
    faq: FaqRecord,
    minimum_role: AdminRole = AdminRole.editor,
) -> None:
    target_site_ids = set(faq.site_ids)
    for group_id in faq.group_ids:
        group = repository.get_group(group_id)
        if group:
            target_site_ids.update(group.site_ids)

    if not target_site_ids:
        require_role(principal, AdminRole.super_admin)
        return

    for site_id in target_site_ids:
        require_site_access(principal, site_id, minimum_role)


@router.get("/me")
def current_admin(principal: AdminPrincipal = Depends(require_admin)):
    return {
        "uid": principal.uid,
        "email": principal.email,
        "role": principal.role.value,
        "tenant_id": principal.tenant_id,
        "site_ids": list(principal.site_ids),
        "all_sites": principal.can_access_all_sites,
    }




@router.get("/sites", response_model=list[SiteRecord])
def list_sites(
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    return _visible_sites(principal, repository.list_sites())


@router.post("/sites", response_model=SiteRecord)
def create_site(
    payload: SiteCreate,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
    return faq_service.create_site(payload)


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
    require_site_access(principal, site_id, AdminRole.admin)
    site = faq_service.update_site(site_id, payload)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    return site
@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
    repository.delete_site(site_id)

@router.post("/users")
def create_admin_user(
    payload: AdminUserCreate,
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
    try:
        user = auth.create_user(
            email=payload.email,
            password=payload.password,
        )
        auth.set_custom_user_claims(
            user.uid,
            {
                "role": payload.role,
                "site_ids": payload.site_ids,
            }
        )
        return {"uid": user.uid, "message": f"Successfully created user {payload.email}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sites/{site_id}/reindex")
def reindex_site(
    site_id: str,
    background_tasks: BackgroundTasks,
    repository: Repository = Depends(get_repo),
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id, AdminRole.editor)
    from app.schemas.models import BackgroundTaskRecord, BackgroundTaskStatus
    from app.repositories.utils import new_id

    faqs = repository.list_faqs(site_id=site_id)
    task = BackgroundTaskRecord(
        id=new_id("task"),
        site_id=site_id,
        total_items=len(faqs),
        status=BackgroundTaskStatus.processing,
    )
    repository.upsert_background_task(task)

    def process_reindex(task_id: str, site_id: str, repository: Repository, faq_service: FaqService):
        task = repository.get_background_task(task_id)
        if not task: return
        try:
            faqs = repository.list_faqs(site_id=site_id)
            for i, faq in enumerate(faqs):
                faq_service.reindex_faq(faq.id)
                if (i + 1) % 5 == 0 or i + 1 == len(faqs):
                    task.processed_items = i + 1
                    repository.upsert_background_task(task)
            task.status = BackgroundTaskStatus.completed
            repository.upsert_background_task(task)
        except Exception as e:
            task.status = BackgroundTaskStatus.failed
            task.error_message = str(e)
            repository.upsert_background_task(task)

    background_tasks.add_task(process_reindex, task.id, site_id, repository, faq_service)
    return {"task_id": task.id, "message": f"Started reindexing {len(faqs)} FAQs in the background."}


@router.get("/groups", response_model=list[SiteGroupRecord])
def list_groups(
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    groups = repository.list_groups()
    if principal.can_access_all_sites:
        return groups
    return [
        group for group in groups
        if any(principal.can_access_site(site_id) for site_id in group.site_ids)
    ]


@router.post("/groups", response_model=SiteGroupRecord)
def create_group(
    payload: SiteGroupCreate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
    return faq_service.create_group(payload, background_tasks)


@router.patch("/groups/{group_id}", response_model=SiteGroupRecord)
def update_group(
    group_id: str,
    payload: SiteGroupUpdate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
    group = faq_service.update_group(group_id, payload, background_tasks)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    return group


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
    repository.delete_group(group_id)


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
    if group_id:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")
        if not principal.can_access_all_sites:
            for target_site_id in group.site_ids:
                require_site_access(principal, target_site_id)

    faqs = repository.list_faqs(
        site_id=site_id,
        group_id=group_id,
        include_inactive=include_inactive,
    )
    if principal.can_access_all_sites or site_id:
        return faqs
    return [
        faq for faq in faqs
        if any(principal.can_access_site(target_site_id) for target_site_id in faq.site_ids)
    ]


@router.post("/faqs", response_model=FaqRecord)
def create_faq(
    payload: FaqCreate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    if not payload.site_ids and not payload.group_ids:
        raise HTTPException(
            status_code=400,
            detail="Select at least one site or group for this FAQ.",
        )
    for site_id in payload.site_ids:
        require_site_access(principal, site_id, AdminRole.editor)
    for group_id in payload.group_ids:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail=f"Group {group_id} not found.")
        for site_id in group.site_ids:
            require_site_access(principal, site_id, AdminRole.editor)
    return faq_service.create_faq(payload, background_tasks)


@router.patch("/faqs/{faq_id}", response_model=FaqRecord)
def update_faq(
    faq_id: str,
    payload: FaqUpdate,
    background_tasks: BackgroundTasks,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    existing = repository.get_faq(faq_id)
    if not existing:
        raise HTTPException(status_code=404, detail="FAQ not found.")
    _require_faq_access(repository, principal, existing)
    for site_id in payload.site_ids or []:
        require_site_access(principal, site_id, AdminRole.editor)
    for group_id in payload.group_ids or []:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail=f"Group {group_id} not found.")
        for site_id in group.site_ids:
            require_site_access(principal, site_id, AdminRole.editor)
    faq = faq_service.update_faq(faq_id, payload, background_tasks)
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found.")
    _require_faq_access(repository, principal, faq)
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
    _require_faq_access(repository, principal, faq)
    faq_service.delete_faq(faq_id)


@router.get("/sites/{site_id}/analytics")
def get_site_analytics(
    site_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id)
    logs = repository.list_logs(site_id=site_id, limit=1000)
    total = len(logs)
    
    faq_hits = sum(1 for log in logs if log.response_type == ResponseType.faq_hit)
    llm_fallbacks = sum(1 for log in logs if log.response_type == ResponseType.llm_fallback)
    helpline_fallbacks = sum(1 for log in logs if log.response_type == ResponseType.helpline)
    
    hit_rate = round((faq_hits / total * 100), 1) if total > 0 else 0
    llm_rate = round((llm_fallbacks / total * 100), 1) if total > 0 else 0
    helpline_rate = round((helpline_fallbacks / total * 100), 1) if total > 0 else 0
    
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
        "llm_rate": llm_rate,
        "helpline_rate": helpline_rate,
        "top_faqs": top_faqs
    }


@router.post("/sites/{site_id}/faqs/upload")
async def upload_faqs_csv(
    site_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_site_access(principal, site_id, AdminRole.editor)
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")

    content = await file.read()
    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = content.decode("latin-1")
        
    import csv
    from app.schemas.models import BackgroundTaskRecord, BackgroundTaskStatus
    from app.repositories.utils import new_id

    lines = [line.strip() for line in decoded.splitlines() if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="The file is empty.")

    delimiter = ","
    if "\t" in lines[0]: delimiter = "\t"
    elif ";" in lines[0]: delimiter = ";"

    reader = csv.reader(lines, delimiter=delimiter)
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="No data found in file.")

    first_row = [c.lower().strip() for c in rows[0]]
    has_header = any("question" in c or "answer" in c for c in first_row)
    
    q_idx, a_idx, alias_idx = 0, 1, 2
    data_rows = rows
    if has_header:
        data_rows = rows[1:]
        for i, col in enumerate(first_row):
            if "question" in col or col == "q": q_idx = i
            elif "answer" in col or col == "a": a_idx = i
            elif "alias" in col or "keyword" in col: alias_idx = i

    # Filter out empty rows early
    valid_rows = []
    for row in data_rows:
        if len(row) > max(q_idx, a_idx) and row[q_idx].strip() and row[a_idx].strip():
            valid_rows.append(row)

    if not valid_rows:
        raise HTTPException(status_code=400, detail="No valid FAQs found.")

    task = BackgroundTaskRecord(
        id=new_id("task"),
        site_id=site_id,
        total_items=len(valid_rows),
        status=BackgroundTaskStatus.processing
    )
    repository.upsert_background_task(task)

    def process_csv_rows(task_id: str, site_id: str, rows_to_process: list, repository: Repository, faq_service: FaqService):
        task = repository.get_background_task(task_id)
        if not task:
            return
        
        try:
            for i, row in enumerate(rows_to_process):
                question = row[q_idx].strip()
                answer = row[a_idx].strip()
                aliases_raw = row[alias_idx] if len(row) > alias_idx else ""
                aliases = [a.strip() for a in str(aliases_raw).split(";") if a.strip()]
                
                # This blocks, but it's okay because we are in a background thread
                faq_service.create_faq(
                    FaqCreate(
                        question=question,
                        answer=answer,
                        aliases=aliases,
                        site_ids=[site_id],
                    )
                )
                
                # Update progress every 10 rows or at the end
                if (i + 1) % 10 == 0 or i + 1 == len(rows_to_process):
                    task.processed_items = i + 1
                    repository.upsert_background_task(task)
                    
            task.status = BackgroundTaskStatus.completed
            repository.upsert_background_task(task)
        except Exception as e:
            task.status = BackgroundTaskStatus.failed
            task.error_message = str(e)
            repository.upsert_background_task(task)

    background_tasks.add_task(
        process_csv_rows, 
        task.id, 
        site_id, 
        valid_rows, 
        repository, 
        faq_service
    )

    return {"task_id": task.id, "message": f"Started indexing {len(valid_rows)} FAQs in the background."}


@router.get("/tasks/{task_id}")
def get_task_status(
    task_id: str,
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    from app.schemas.models import BackgroundTaskRecord
    task = repository.get_background_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    require_site_access(principal, task.site_id)
    return task


@router.post("/faqs/{faq_id}/reindex", response_model=FaqRecord)
def reindex_faq(
    faq_id: str,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    faq = repository.get_faq(faq_id)
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found.")
    _require_faq_access(repository, principal, faq)
    faq_service.reindex_faq(faq_id)
    return faq


@router.get("/logs")
def list_logs(
    site_id: str | None = None,
    response_type: ResponseType | None = None,
    fallback_only: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=1000),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    if site_id:
        require_site_access(principal, site_id)
    logs = repository.list_logs(site_id=site_id, response_type=response_type, limit=limit)
    if not site_id and not principal.can_access_all_sites:
        logs = [log for log in logs if principal.can_access_site(log.site_id)]
    if fallback_only:
        logs = [log for log in logs if log.response_type != ResponseType.faq_hit]
    return logs


@router.post("/logs/{log_id}/convert-to-faq", response_model=FaqRecord)
def convert_log_to_faq(
    log_id: str,
    payload: ConvertLogRequest,
    faq_service: FaqService = Depends(get_faq_service),
    repository: Repository = Depends(get_repo),
    principal: AdminPrincipal = Depends(require_admin),
):
    log = repository.get_log(log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log not found.")
    require_site_access(principal, log.site_id, AdminRole.editor)
    for site_id in payload.site_ids:
        require_site_access(principal, site_id, AdminRole.editor)
    for group_id in payload.group_ids:
        group = repository.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail=f"Group {group_id} not found.")
        for site_id in group.site_ids:
            require_site_access(principal, site_id, AdminRole.editor)
    faq = faq_service.convert_log_to_faq(log_id, payload)
    if not faq:
        raise HTTPException(status_code=404, detail="Log not found.")
    return faq


@router.post("/demo/seed", response_model=SeedDemoResponse)
def seed_demo(
    faq_service: FaqService = Depends(get_faq_service),
    principal: AdminPrincipal = Depends(require_admin),
):
    require_role(principal, AdminRole.super_admin)
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
