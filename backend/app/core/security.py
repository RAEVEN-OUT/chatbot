from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import firebase_admin
from firebase_admin import auth
from fastapi import Depends, Header, HTTPException, status

from app.core.config import ROOT_DIR, settings

if not firebase_admin._apps:
<<<<<<< HEAD
    firebase_admin.initialize_app()
=======
    from firebase_admin import credentials
    
    key_path = ROOT_DIR / "firebase-key.json"
    
    if key_path.exists():
        cred = credentials.Certificate(str(key_path))
        firebase_admin.initialize_app(cred)
    else:
        # Fallback: rely on GOOGLE_APPLICATION_CREDENTIALS env var
        # or default service account if running in GCP
        firebase_admin.initialize_app()
>>>>>>> dev


@dataclass(frozen=True)
class AdminPrincipal:
    uid: str
    site_ids: tuple[str, ...] = ()
    email: str = ""

    @property
    def can_access_all_sites(self) -> bool:
<<<<<<< HEAD
        """If user has '*', they are a Platform Admin."""
        return "*" in self.site_ids

    def can_access_site(self, site_id: str) -> bool:
        """Check if user is allowed to manage this specific site."""
=======
        return "*" in self.site_ids

    def can_access_site(self, site_id: str) -> bool:
>>>>>>> dev
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
    # Custom claims are stored directly or in an 'rbac' object for compatibility
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
<<<<<<< HEAD
    """Simplified protection for admin routes."""
    token = x_admin_api_key
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if not token:
        # Auto-login for local dev if no key is set
        if settings.env == "development" and not settings.admin_api_key:
            return AdminPrincipal(uid="dev_user", site_ids=("*",))
=======
    """Authentication: Verify token exists and is valid."""
    if not authorization:
        print("DEBUG AUTH: Missing Authorization header")
>>>>>>> dev
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
        )
<<<<<<< HEAD

    # Master API Key access
    if settings.admin_api_key and token == settings.admin_api_key:
        return AdminPrincipal(uid="api_key_user", site_ids=("*",))

    try:
        decoded_token = auth.verify_id_token(token)
        principal = _principal_from_claims(decoded_token)
        if not principal.uid:
            raise ValueError("Token does not include a uid.")
        return principal
    except Exception as exc:
=======
    
    if not authorization.lower().startswith("bearer "):
        print(f"DEBUG AUTH: Malformed header: {authorization[:20]}...")
>>>>>>> dev
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed authentication token.",
        )

    token = authorization.split(" ", 1)[1].strip()

    try:
        # Verify the token
        decoded_token = auth.verify_id_token(token, clock_skew_seconds=10)
        principal = _principal_from_claims(decoded_token)
        
        if not principal.uid:
            print("DEBUG AUTH: Token verified but no UID found")
            raise ValueError("Token does not include a uid.")
            
        return principal
    except Exception as exc:
        import traceback
        detail = str(exc)
        print(f"DEBUG AUTH: Verification failed for token {token[:10]}...: {detail}")
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid session: {detail}",
        ) from exc


async def require_super_admin(
    principal: AdminPrincipal = Depends(require_admin),
) -> AdminPrincipal:
    """Authorization: Ensure the user is a platform-wide Super Admin."""
    if not principal.can_access_all_sites:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Super Admin privileges required.",
        )
    return principal
