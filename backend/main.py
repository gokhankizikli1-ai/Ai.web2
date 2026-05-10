# coding: utf-8
"""
KorvixAI v3 — Backend Entry Point
===================================
Railway Procfile: web: uvicorn backend.main:app --host 0.0.0.0 --port $PORT

This replaces backend/api.py as the canonical FastAPI application.
backend/api.py is kept as a legacy shim so any old direct imports still work.
"""
import sys
import os

# Ensure project root is always on sys.path — required for Railway
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_DIR    = os.path.dirname(_BACKEND_DIR)
for _d in [_ROOT_DIR, _BACKEND_DIR]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

# ── Logging must be set up before any other import ────────────────────────────
from backend.core.logging import setup_logging
from backend.core.config import settings

_log_level = "DEBUG" if settings.DEBUG else "INFO"
setup_logging(_log_level)

import logging
logger = logging.getLogger("korvix")

# ── FastAPI app ───────────────────────────────────────────────────────────────
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.core.middleware import add_middleware
from backend.core.errors import global_exception_handler

app = FastAPI(
    title="KorvixAI API",
    description="KorvixAI v3 Backend",
    version="3.0.0",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

add_middleware(app)
app.add_exception_handler(Exception, global_exception_handler)

# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup() -> None:
    logger.info(
        "KorvixAI v3 started | env=%s | model_fast=%s | model_strong=%s",
        settings.ENVIRONMENT, settings.MODEL_FAST, settings.MODEL_STRONG,
    )
    # Importing the service modules triggers their init_*_db() calls at module load time.
    # We do it again explicitly here to make startup logs visible and to catch any errors early.
    try:
        from memory import init_memory_db
        from usage_limits import init_usage_db
        from db import init_db
        init_memory_db()
        init_usage_db()
        init_db()
        logger.info("Database tables initialized")
    except Exception as e:
        logger.warning("DB init warning (non-fatal): %s", e)


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health() -> dict:
    """Railway health probe — must return 200 quickly."""
    return {
        "status": "ok",
        "version": "3.0.0",
        "environment": settings.ENVIRONMENT,
    }


# ── Route registration ────────────────────────────────────────────────────────
# Existing routes are preserved as-is so the frontend API contract stays intact.
# Phase 2 will migrate these to backend/api/routes/.

from backend.routes.chat   import router as chat_router
from backend.routes.memory import router as memory_router
from backend.routes.health import router as health_router_legacy

app.include_router(chat_router)
app.include_router(memory_router)
# Note: /health from legacy health router is shadowed by the one above — that is intentional.

logger.info("Routes registered: /chat, /memory")
