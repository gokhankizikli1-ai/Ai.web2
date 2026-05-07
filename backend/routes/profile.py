# coding: utf-8
from fastapi import APIRouter, Depends
from backend.models.schemas import ProfileResponse
from backend.core.security import verify_api_key
from backend.services.user_service import get_profile

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("/{user_id}", response_model=ProfileResponse)
async def profile(user_id: str, platform: str = "web", _auth=Depends(verify_api_key)):
    uid  = int(user_id) if user_id.isdigit() else hash(user_id) % 2**31
    data = get_profile(uid)
    data["platform"] = platform
    return ProfileResponse(**data)
