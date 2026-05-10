# coding: utf-8
"""
KorvixAI v3 — ASGI Entry Point (backend/api.py)
=================================================
Railway Procfile: web: uvicorn backend.api:app --host 0.0.0.0 --port $PORT

Three-layer defence so `app` is ALWAYS defined:
  Layer 1 — full production app with all routes and middleware
  Layer 2 — minimal FastAPI app with /health only  (if routes fail)
  Layer 3 — bare ASGI callable                     (if FastAPI itself fails)

backend/main.py re-exports `app` from here so `uvicorn backend.main:app`
also works as an alias.
"""
import sys
import os
import logging

# ── sys.path bootstrap (must run before any project import) ────────────────
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT_DIR    = os.path.dirname(_BACKEND_DIR)
for _p in [_ROOT_DIR, _BACKEND_DIR]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Basic logging — never fails ─────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("korvix")

# ── Optional enhanced logging + config from core/ ────────────────────
try:
    from backend.core.logging import setup_logging
    from backend.core.config import settings as _settings
    setup_logging("DEBUG" if _settings.DEBUG else "INFO")
    _ENV           = _settings.ENVIRONMENT
    _MODEL_FAST    = _settings.MODEL_FAST
    _MODEL_STRONG  = _settings.MODEL_STRONG
    _ALLOWED_ORIGINS  = _settings.ALLOWED_ORIGINS
    _CORS_REGEX       = _settings.CORS_ORIGIN_REGEX
except Exception as _core_err:
    logger.warning("core/ config unavailable (%s) — using env defaults", _core_err)
    _ENV          = os.getenv("ENVIRONMENT", "production")
    _MODEL_FAST   = os.getenv("MODEL_FAST",   "gpt-4o-mini")
    _MODEL_STRONG = os.getenv("MODEL_STRONG", "gpt-4o")
    _ALLOWED_ORIGINS = [
        "https://korvixai.com",
        "https://www.korvixai.com",
        "https://ai-web2-roan.vercel.app",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
    ]
    _CORS_REGEX = r"https://.*\.(vercel\.app|railway\.app)$"


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 1 — Full production app
# ═══════════════════════════════════════════════════════════════════════════════
def _build_full_app():
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    import importlib

    _app = FastAPI(
        title="KorvixAI API",
        description="KorvixAI v3 Backend",
        version="3.0.0",
        docs_url="/docs",
        redoc_url=None,
    )

    _app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_origin_regex=_CORS_REGEX,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=600,
    )

    @_app.exception_handler(Exception)
    async def _global_exc(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled | %s %s | %s: %s",
            request.method, request.url.path, type(exc).__name__, exc,
            exc_info=True,
        )
        return JSONResponse(status_code=500, content={
            "reply":             "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
            "intent":            "error", "model": "none", "provider": "none",
            "mode":              "error", "memory_used": False,
            "remaining_messages": -1, "premium": False,
            "response_time_ms":  0, "request_id": "err",
            "suggested_followups": None,
            "success": False,
            "error":   "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
            "code":    "INTERNAL_ERROR",
        })

    @_app.on_event("startup")
    async def _startup():
        logger.info("KorvixAI v3 | env=%s | fast=%s | strong=%s",
                    _ENV, _MODEL_FAST, _MODEL_STRONG)
        try:
            from memory import init_memory_db
            from usage_limits import init_usage_db
            from db import init_db
            init_memory_db(); init_usage_db(); init_db()
            logger.info("DB tables OK")
        except Exception as e:
            logger.warning("DB init (non-fatal): %s", e)
        # Phase 4A — register tools (non-fatal if tools package unavailable)
        try:
            import backend.services.tools  # noqa: F401 — triggers __init__ registration
            from backend.services.tools.tool_registry import health_status
            hs = health_status()
            logger.info("Tools | enabled=%s | registered=%s", hs["tools_enabled"], hs["registered_tools"])
        except Exception as _tool_err:
            logger.warning("Tools init (non-fatal): %s", _tool_err)

    @_app.get("/health", tags=["system"])
    async def health():
        return {"status": "ok", "version": "3.0.0", "environment": _ENV}

    # Register routes individually — one failure never kills the others
    for _mod in [
        "backend.routes.chat",
        "backend.routes.memory",
        "backend.routes.health",
        "backend.routes.auth",
        "backend.routes.profile",
        "backend.routes.stats",
        "backend.routes.tools",        # Phase 4A — /tools/health
    ]:
        try:
            _app.include_router(importlib.import_module(_mod).router)
            logger.info("Route OK: %s", _mod)
        except Exception as _e:
            logger.error("Route SKIP %s: %s", _mod, _e)

    return _app


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 2 — Minimal app (FastAPI available but routes broken)
# ═══════════════════════════════════════════════════════════════════════════════
def _build_minimal_app(reason: str):
    from fastapi import FastAPI
    _app = FastAPI(title="KorvixAI API (minimal)", version="3.0.0")

    @_app.get("/health")
    async def health():
        return {"status": "ok", "note": "minimal mode", "reason": reason}

    logger.warning("Running in MINIMAL mode: %s", reason)
    return _app


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 3 — Bare ASGI callable (FastAPI itself broken)
# ═══════════════════════════════════════════════════════════════════════════════
async def _bare_asgi(scope, receive, send):
    if scope["type"] == "http":
        body = b'{"status":"ok","note":"bare-asgi fallback"}'
        await send({"type": "http.response.start", "status": 200,
                    "headers": [[b"content-type", b"application/json"]]})
        await send({"type": "http.response.body", "body": body})


# ═══════════════════════════════════════════════════════════════════════════════
# Build `app` — try each layer in order
# ═══════════════════════════════════════════════════════════════════════════════
try:
    app = _build_full_app()
    logger.info("ASGI app ready (full)")
except Exception as _layer1_err:
    logger.error("Layer 1 failed: %s", _layer1_err, exc_info=True)
    try:
        app = _build_minimal_app(str(_layer1_err))
        logger.warning("ASGI app ready (minimal)")
    except Exception as _layer2_err:
        logger.critical("Layer 2 failed: %s", _layer2_err, exc_info=True)
        app = _bare_asgi  # type: ignore[assignment]
        logger.critical("ASGI app ready (bare fallback)")
