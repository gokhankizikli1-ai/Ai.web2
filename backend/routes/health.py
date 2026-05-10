# coding: utf-8
from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/health")
async def health_check() -> dict:
    """Railway health probe — must respond quickly."""
    return {"status": "ok", "version": "3.0.0"}
