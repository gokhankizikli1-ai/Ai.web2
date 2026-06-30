"""Legacy per-user memory routes.

DEPRECATED — superseded by the auth-bound Memory Plane at /v2/memory/*.
These pre-auth endpoints originally trusted `user_id` from the path/body
with NO authentication, so anyone could read/write/delete ANY user's
memory (the audit's worst IDOR finding).

They are now OWNERSHIP-ENFORCED: a caller may only touch the user_id that
matches their authenticated identity (verified JWT, or a guest's
X-Korvix-Guest-Id nonce); owners may touch any. Identity is derived from
the request context — never from the supplied user_id — so an
unauthenticated caller resolves to "anonymous" and is denied.

The whole surface can be retired via ENABLE_LEGACY_USER_ROUTES=false
(routes then return 410 Gone, pointing at /v2/memory). Kept mounted by
default so nothing breaks. The LIVE chat memory path does NOT use these
routes — it writes via memory_service from routes/chat.py — so this
hardening has no effect on production chat behaviour.
"""
import logging
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.core.config import settings
from backend.core.deps import authorize_user_scope

router = APIRouter(prefix="/memory", tags=["memory"])
logger = logging.getLogger(__name__)


def _uid(raw: str) -> int:
    """Same stable int-normalisation the live chat path uses."""
    return int(raw) if str(raw).isdigit() else hash(str(raw)) % 2**31


def _ensure_enabled() -> None:
    if not settings.ENABLE_LEGACY_USER_ROUTES:
        raise HTTPException(
            status_code=410,
            detail={"error": "gone", "use": "/v2/memory",
                    "message": "Legacy /memory is retired; use /v2/memory."},
        )


def _ensure_owner_of(request: Request, user_id: str) -> None:
    """403 unless the caller's authenticated identity owns `user_id`."""
    if not authorize_user_scope(request, user_id, normalize=_uid):
        logger.warning("legacy /memory denied cross-user access to uid=%s", user_id)
        raise HTTPException(
            status_code=403,
            detail={"error": "forbidden",
                    "message": "You may only access your own memory."},
        )


class MemorySaveBody(BaseModel):
    user_id: str
    content: str
    category: Optional[str] = "general"

class MemoryDeleteBody(BaseModel):
    user_id: str
    keyword: str

@router.get("/{user_id}", deprecated=True)
async def get_memory(user_id: str, request: Request):
    _ensure_enabled()
    _ensure_owner_of(request, user_id)
    try:
        from backend.services.memory_service import get_user_memory
        return get_user_memory(_uid(user_id))
    except Exception as e:
        logger.warning("memory get fallback: " + str(e))
        return {"memory": [], "user_id": user_id}

@router.post("", deprecated=True)
async def save_memory(req: MemorySaveBody, request: Request):
    _ensure_enabled()
    _ensure_owner_of(request, req.user_id)
    try:
        from backend.services.memory_service import save_memory as _save
        saved = _save(_uid(req.user_id), req.content, req.category or "general")
        return {"ok": True, "saved": saved}
    except Exception as e:
        logger.warning("memory save fallback: " + str(e))
        return {"ok": False, "error": str(e)}

@router.delete("", deprecated=True)
async def delete_memory(req: MemoryDeleteBody, request: Request):
    _ensure_enabled()
    _ensure_owner_of(request, req.user_id)
    try:
        from backend.services.memory_service import delete_memory as _del
        deleted = _del(_uid(req.user_id), req.keyword)
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.warning("memory delete fallback: " + str(e))
        return {"ok": False, "error": str(e)}
