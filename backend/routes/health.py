# coding: utf-8
from fastapi import APIRouter
from backend.models.schemas import HealthResponse
from backend.core.config import ENVIRONMENT

router = APIRouter(tags=["health"])

VERSION = "1.0.0"


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        version=VERSION,
        environment=ENVIRONMENT,
    )
