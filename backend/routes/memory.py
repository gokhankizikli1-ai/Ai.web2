import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/memory", tags=["memory"])
logger = logging.getLogger(__name__)

class MemorySaveBody(BaseModel):
    user_id: str
    content: str
    category: Optional[str] = "general"

class MemoryDeleteBody(BaseModel):
    user_id: str
    keyword: str

@router.get("/{user_id}")
async def get_memory(user_id: str):
    try:
        from backend.services.memory_service import get_user_memory
        uid = int(user_id) if user_id.isdigit() else hash(user_id) % 2**31
        return get_user_memory(uid)
    except Exception as e:
        logger.warning("memory get fallback: " + str(e))
        return {"memory": [], "user_id": user_id}

@router.post("")
async def save_memory(req: MemorySaveBody):
    try:
        from backend.services.memory_service import save_memory as _save
        uid = int(req.user_id) if req.user_id.isdigit() else hash(req.user_id) % 2**31
        saved = _save(uid, req.content, req.category or "general")
        return {"ok": True, "saved": saved}
    except Exception as e:
        logger.warning("memory save fallback: " + str(e))
        return {"ok": False, "error": str(e)}

@router.delete("")
async def delete_memory(req: MemoryDeleteBody):
    try:
        from backend.services.memory_service import delete_memory as _del
        uid = int(req.user_id) if req.user_id.isdigit() else hash(req.user_id) % 2**31
        deleted = _del(uid, req.keyword)
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.warning("memory delete fallback: " + str(e))
        return {"ok": False, "error": str(e)}
