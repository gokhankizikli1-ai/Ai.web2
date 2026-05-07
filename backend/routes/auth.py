# coding: utf-8
import os
from fastapi import APIRouter, Depends, HTTPException, status, Header
from pydantic import BaseModel
from backend.core.security import verify_api_key
from backend.services.user_service import make_premium

router  = APIRouter(prefix="/auth", tags=["admin"])
OWNER_ID = int(os.getenv("OWNER_ID", "0"))


class PremiumRequest(BaseModel):
    user_id: str
    value: bool = True


def _check_owner(x_user_id: str):
    uid = int(x_user_id) if x_user_id.isdigit() else 0
    if OWNER_ID and uid != OWNER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "forbidden", "message": "Unauthorized"},
        )
    return uid


@router.post("/premium")
async def set_premium_status(
    req: PremiumRequest,
    x_user_id: str = Header(default="0"),
    _auth=Depends(verify_api_key),
):
    _check_owner(x_user_id)
    target = int(req.user_id) if req.user_id.isdigit() else hash(req.user_id) % 2**31
    make_premium(target, req.value)
    action = "granted" if req.value else "revoked"
    return {"user_id": req.user_id, "premium": req.value, "action": action}
