from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.core.config import settings


async def require_admin(
    authorization: str | None = Header(default=None),
    x_admin_api_key: str | None = Header(default=None),
) -> None:
    """Protect admin routes when ADMIN_API_KEY is configured."""
    if not settings.admin_api_key:
        return

    token = x_admin_api_key
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if token != settings.admin_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin API key.",
        )
