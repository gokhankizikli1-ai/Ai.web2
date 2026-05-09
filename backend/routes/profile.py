import logging
from fastapi import APIRouter

router = APIRouter(prefix="/profile", tags=["profile"])
logger = logging.getLogger(__name__)

@router.get("/{user_id}")
async def get_profile(user_id: str):
    try:
        from backend.services.user_service import get_profile as _get_profile
        uid = int(user_id) if user_id.isdigit() else hash(user_id) % 2**31
        return _get_profile(uid)
    except Exception as e:
        logger.warning("profile fallback: " + str(e))
        return {"profile": {}, "user_id": user_id}

@router.post("")
async def post_profile():
    return {"ok": True}
