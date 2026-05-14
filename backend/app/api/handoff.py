from fastapi import APIRouter, HTTPException, Depends, Query
from firebase_admin import auth
from app.core.security import AdminPrincipal, require_admin

router = APIRouter(prefix="/api/handoff", tags=["handoff"])

@router.get("")
async def generate_handoff_token(
    principal: AdminPrincipal = Depends(require_admin)
):
    """Generate a Firebase Custom Token for handoff with claims."""
    try:
        # We fetch the user to get the latest custom claims (like site_ids)
        # and embed them in the custom token. This ensures they are immediately
        # available in the portal after handoff without waiting for a refresh.
        user = auth.get_user(principal.uid)
        token = auth.create_custom_token(principal.uid, user.custom_claims or {})
        return {"firebase_token": token.decode("utf-8") if isinstance(token, bytes) else token}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
