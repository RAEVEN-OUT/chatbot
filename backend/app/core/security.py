from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import firebase_admin
from firebase_admin import auth, credentials
from fastapi import Depends, Header, HTTPException, status

from app.core.config import firebase_credentials_info, firebase_credentials_path


if not firebase_admin._apps:
    credential_info = firebase_credentials_info()
    if credential_info:
        firebase_admin.initialize_app(credentials.Certificate(credential_info))
    else:
        key_path = firebase_credentials_path()
        if key_path.exists():
            firebase_admin.initialize_app(credentials.Certificate(str(key_path)))
        else:
            firebase_admin.initialize_app()


@dataclass(frozen=True)
class AdminPrincipal:
    uid: str
    site_ids: tuple[str, ...] = ()
    email: str = ""

    @property
    def can_access_all_sites(self) -> bool:
        return "*" in self.site_ids

    def can_access_site(self, site_id: str) -> bool:
        return self.can_access_all_sites or site_id in self.site_ids


def _as_list(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.split(",") if item.strip())
    if isinstance(value, (list, tuple, set)):
        return tuple(str(item).strip() for item in value if str(item).strip())
    return ()


def _principal_from_claims(claims: dict[str, Any]) -> AdminPrincipal:
    rbac = claims.get("rbac") if isinstance(claims.get("rbac"), dict) else {}
    return AdminPrincipal(
        uid=str(claims.get("uid") or claims.get("sub") or ""),
        site_ids=_as_list(claims.get("site_ids") or rbac.get("site_ids")),
        email=str(claims.get("email") or ""),
    )


def require_site_access(principal: AdminPrincipal, site_id: str) -> None:
    if not principal.can_access_site(site_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied for site {site_id}.",
        )


async def require_admin(
    authorization: str | None = Header(default=None),
) -> AdminPrincipal:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
        )

    if not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed authentication token.",
        )

    token = authorization.split(" ", 1)[1].strip()

    try:
        decoded_token = auth.verify_id_token(token, clock_skew_seconds=10)
        principal = _principal_from_claims(decoded_token)
        if not principal.uid:
            raise ValueError("Token does not include a uid.")
        return principal
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {exc}",
        ) from exc


async def require_super_admin(
    principal: AdminPrincipal = Depends(require_admin),
) -> AdminPrincipal:
    if not principal.can_access_all_sites:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin privileges required.",
        )
    return principal
