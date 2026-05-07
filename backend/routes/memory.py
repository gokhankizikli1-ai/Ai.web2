# coding: utf-8
from fastapi import APIRouter, Depends, HTTPException, status
from backend.models.schemas import MemorySaveRequest, MemoryListResponse, MemoryDeleteRequest
from backend.core.security import verify_api_key
from backend.services.memory_service import get_user_memory, save_memory, delete_memory

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("/{user_id}", response_model=MemoryListResponse)
async def list_memory(user_id: str, _auth=Depends(verify_api_key)):
    uid = int(user_id) if user_id.isdigit() else hash(user_id) % 2**31
    return get_user_memory(uid)


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_memory(req: MemorySaveRequest, _auth=Depends(verify_api_key)):
    uid  = int(req.user_id) if req.user_id.isdigit() else hash(req.user_id) % 2**31
    saved = save_memory(uid, req.content, req.category or "general")
    if not saved:
        return {"saved": False, "reason": "duplicate_or_noise"}
    return {"saved": True}


@router.delete("")
async def remove_memory(req: MemoryDeleteRequest, _auth=Depends(verify_api_key)):
    uid     = int(req.user_id) if req.user_id.isdigit() else hash(req.user_id) % 2**31
    deleted = delete_memory(uid, req.keyword)
    return {"deleted": deleted}
