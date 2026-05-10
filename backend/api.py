# coding: utf-8
"""
KorvixAI v3 — Canonical ASGI Entry Point
==========================================
Railway Procfile: web: uvicorn backend.api:app --host 0.0.0.0 --port $PORT

This file owns the FastAPI `app` object.
backend/main.py re-exports `app` from here for backward compatibility.
"""
import sys
import os
import logging

# ── sys.path bootstrap — must happen before any project import ────────────────
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_DIR    = os.path.dirname(_BACKEND_DIR)
for _p in [_ROOT_DIR, _BACKEND_DIR]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Logging ───────────────────────────────────────────────────────────────────
try:
    from backend.core.logging import setup_logging
    from backend.core.config import settings
    setup_logging("DEBUG" if settings.DEBUG else "INFO")
except Exception:
    # Bare fallback so Railway can still boot if core/ has a problem
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    class _FallbackSettings:
        ENVIRONMENT = os.getenv("ENVIRONMENT", "production")
        DEBUG       = False
        MODEL_FAST  = os.getenv("MODEL_FAST", "gpt-4o-mini")
        MODEL_STRONG = os.getenv("MODEL_STRONG", "gpt-4o")
        ALLOWED_ORIGINS = [
            "https://korvixai.com",
            "https://www.korvixai.com",
            "https://ai-web2-roan.vercel.app",
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:8000",
        ]
        CORS_ORIGIN_REGEX = r"https://.*\.(vercel\.app|railway\.app)$"
    settings = _FallbackSettings()

logger = logging.getLogger("korvix")

# ── FastAPI app ───────────────────────────────────────────────────────────────
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(
    title="KorvixAI API",
    description="KorvixAI v3 Backend",
    version="3.0.0",
    docs_url="/docs",
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# ── Global exception handler — never expose raw tracebacks ────────────────────
@app.exception_handler(Exception)
async def _global_exc(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled exception | %s %s | %s: %s",
        request.method, request.url.path, type(exc).__name__, exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "reply":             "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
            "intent":            "error",
            "model":             "none",
            "provider":          "none",
            "mode":              "error",
            "memory_used":       False,
            "remaining_messages": -1,
            "premium":           False,
            "response_time_ms":  0,
            "request_id":        "err",
            "suggested_followups": None,
            "success":           False,
            "error":             "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
            "code":              "INTERNAL_ERROR",
        },
    )

# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    logger.info(
        "KorvixAI v3 started | env=%s | fast=%s | strong=%s",
        settings.ENVIRONMENT, settings.MODEL_FAST, settings.MODEL_STRONG,
    )
    try:
        from memory import init_memory_db
        from usage_limits import init_usage_db
        from db import init_db
        init_memory_db()
        init_usage_db()
        init_db()
        logger.info("DB tables initialized")
    except Exception as e:
        logger.warning("DB init warning (non-fatal): %s", e)

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health() -> dict:
    """Railway health probe — must return 200 quickly."""
    return {"status": "ok", "version": "3.0.0", "environment": settings.ENVIRONMENT}

# ── Route registration ────────────────────────────────────────────────────────
# Each import is wrapped individually so one broken route never kills the app.

def _include(module_path: str, attr: str = "router") -> None:
    try:
        import importlib
        mod = importlib.import_module(module_path)
        app.include_router(getattr(mod, attr))
        logger.info("Route registered: %s", module_path)
    except Exception as e:
        logger.error("Failed to register route %s: %s", module_path, e, exc_info=True)

_include("backend.routes.chat")
_include("backend.routes.memory")
_include("backend.routes.health")
_include("backend.routes.auth")
_include("backend.routes.profile")
_include("backend.routes.stats")
