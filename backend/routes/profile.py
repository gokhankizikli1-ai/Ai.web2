"""Legacy per-user profile route.

DEPRECATED — same hardening as routes/memory.py. `GET /profile/{user_id}`
previously returned any user's profile with no auth (IDOR). It is now
ownership-enforced; an unauthenticated caller (resolving to "anonymous")
cannot read another user's profile. `POST /profile` was (and remains) a
no-op stub. Retire the surface with ENABLE_LEGACY_USER_ROUTES=false.
"""
import logging
from fastapi import APIRouter, Request, HTTPException

from backend.core.config import settings
from backend.core.deps import authorize_user_scope

router = APIRouter(prefix="/profile", tags=["profile"])
logger = logging.getLogger(__name__)


def _uid(raw: str) -> int:
    return int(raw) if str(raw).isdigit() else hash(str(raw)) % 2**31


@router.get("/{user_id}", deprecated=True)
async def get_profile(user_id: str, request: Request):
    if not settings.ENABLE_LEGACY_USER_ROUTES:
        raise HTTPException(
            status_code=410,
            detail={"error": "gone", "use": "/v2/sessions",
                    "message": "Legacy /profile is retired."},
        )
    if not authorize_user_scope(request, user_id, normalize=_uid):
        logger.warning("legacy /profile denied cross-user access to uid=%s", user_id)
        raise HTTPException(
            status_code=403,
            detail={"error": "forbidden",
                    "message": "You may only access your own profile."},
        )
    try:
        from backend.services.user_service import get_profile as _get_profile
        return _get_profile(_uid(user_id))
    except Exception as e:
        logger.warning("profile fallback: " + str(e))
        return {"profile": {}, "user_id": user_id}

@router.post("", deprecated=True)
async def post_profile():
    # Historically a no-op stub that ignores its body. Kept for
    # backward compatibility; returns success without persisting.
    return {"ok": True}
