# coding: utf-8
import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Header
from backend.models.schemas import StatsResponse
from backend.core.security import verify_api_key
from stats import get_stats

router = APIRouter(prefix="/stats", tags=["admin"])

OWNER_ID = int(os.getenv("OWNER_ID", "0"))


@router.get("", response_model=StatsResponse)
async def admin_stats(
    x_user_id: str = Header(default="0"),
    _auth=Depends(verify_api_key),
):
    uid = int(x_user_id) if x_user_id.isdigit() else 0
    if OWNER_ID and uid != OWNER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "forbidden", "message": "Unauthorized"},
        )
    data = get_stats()
    return StatsResponse(
        **data,
        generated_at=datetime.now().isoformat(),
    )
