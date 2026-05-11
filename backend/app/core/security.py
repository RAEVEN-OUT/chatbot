from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import firebase_admin
from firebase_admin import auth
from fastapi import Header, HTTPException, status

from app.core.config import settings

if not firebase_admin._apps:
    firebase_admin.initialize_app()


class AdminRole(str, Enum):
    viewer = "viewer"
    editor = "editor"
    admin = "admin"
    super_admin = "super_admin"


ROLE_RANK = {
    AdminRole.viewer: 10,
    AdminRole.editor: 20,
    AdminRole.admin: 30,
    AdminRole.super_admin: 40,
}


@dataclass(frozen=True)
class AdminPrincipal:
    uid: str
    role: AdminRole
    tenant_id: str = "default"
    site_ids: tuple[str, ...] = ()
    email: str = ""

    @property
    def is_super_admin(self) -> bool:
        return self.role == AdminRole.super_admin

    @property
    def can_access_all_sites(self) -> bool:
        return self.is_super_admin or "*" in self.site_ids

    def has_role(self, minimum_role: AdminRole) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[minimum_role]

    def can_access_site(self, site_id: str, minimum_role: AdminRole = AdminRole.viewer) -> bool:
        if not self.has_role(minimum_role):
            return False
        return self.can_access_all_sites or site_id in self.site_ids


def _as_list(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.split(",") if item.strip())
    if isinstance(value, (list, tuple, set)):
        return tuple(str(item).strip() for item in value if str(item).strip())
    return ()


def _role_from_claims(claims: dict[str, Any]) -> AdminRole:
    raw_role = (
        claims.get("role")
        or claims.get("admin_role")
        or claims.get("rbac", {}).get("role")
        or "viewer"
    )
    try:
        return AdminRole(str(raw_role))
    except ValueError:
        return AdminRole.viewer


def _principal_from_claims(claims: dict[str, Any]) -> AdminPrincipal:
    rbac = claims.get("rbac") if isinstance(claims.get("rbac"), dict) else {}
    return AdminPrincipal(
        uid=str(claims.get("uid") or claims.get("sub") or ""),
        role=_role_from_claims(claims),
        tenant_id=str(claims.get("tenant_id") or rbac.get("tenant_id") or "default"),
        site_ids=_as_list(claims.get("site_ids") or rbac.get("site_ids")),
        email=str(claims.get("email") or ""),
    )


def require_role(principal: AdminPrincipal, minimum_role: AdminRole) -> None:
    if not principal.has_role(minimum_role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{minimum_role.value} role required.",
        )


def require_site_access(
    principal: AdminPrincipal,
    site_id: str,
    minimum_role: AdminRole = AdminRole.viewer,
) -> None:
    if not principal.can_access_site(site_id, minimum_role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{minimum_role.value} access is required for site {site_id}.",
        )


async def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_api_key: str | None = Header(default=None),
) -> AdminPrincipal:
    """Protect admin routes with Firebase Auth claims or fallback ADMIN_API_KEY.

    Firebase custom claims supported:
    - role/admin_role/rbac.role: viewer, editor, admin, super_admin
    - site_ids/rbac.site_ids: list of site IDs, comma string, or "*" for all sites
    - tenant_id/rbac.tenant_id: optional tenant scope for future expansion
    """
    token = x_admin_api_key
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if not token:
        if settings.env == "development" and not settings.admin_api_key:
            return AdminPrincipal(uid="dev_user", role=AdminRole.super_admin, site_ids=("*",))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
        )

    if settings.admin_api_key and token == settings.admin_api_key:
        return AdminPrincipal(uid="api_key_user", role=AdminRole.super_admin, site_ids=("*",))

    try:
        decoded_token = auth.verify_id_token(token)
        principal = _principal_from_claims(decoded_token)
        if not principal.uid:
            raise ValueError("Token does not include a uid.")
        return principal
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(exc)}",
        ) from exc
