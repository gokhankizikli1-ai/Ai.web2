# coding: utf-8
"""
v3 health route — thin, fast, Railway-safe.
Phase 2: mount this instead of backend/routes/health.py
"""
from fastapi import APIRouter
from backend.core.config import settings

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": "3.0.0",
        "environment": settings.ENVIRONMENT,
    }
