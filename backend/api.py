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
        # "*" should cover everything, but we list the custom headers
        # explicitly as belt-and-suspenders for browsers / CDNs that
        # treat allow_headers=* + allow_credentials=true conservatively.
        # X-Korvix-Owner-Token MUST be on this list or the OwnerUnlock
        # modal's preflight is rejected and the chip can never flip.
        allow_headers=[
            "*",
            "Content-Type",
            "Authorization",
            "X-Korvix-Owner-Token",
            "X-Korvix-Owner-Email",
            "X-Korvix-Guest-Id",
            "X-Request-Id",
        ],
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

        # ── Persistence + configuration self-check (fail-safe) ──────────
        # Surfaces data-volatility and insecure-config issues LOUDLY at
        # boot without ever crashing the process (Railway's /health probe
        # must still pass even with a misconfigured env). See
        # backend/core/config.py::validate_runtime + backend/core/paths.py.
        try:
            from backend.core.paths import persistence_summary
            from backend.core.config import settings as _settings
            _persist = persistence_summary()
            if _persist["durable"]:
                logger.info(
                    "Persistence | DURABLE | data_dir=%s (source=%s)",
                    _persist["data_dir"], _persist["source"],
                )
            else:
                logger.warning(
                    "Persistence | EPHEMERAL | DBs under CWD — wiped on "
                    "redeploy. Set KORVIX_DATA_DIR or mount a Railway volume.",
                )
            for _level, _msg in _settings.validate_runtime():
                if _level == "critical":
                    logger.critical("CONFIG CHECK [critical] %s", _msg)
                elif _level == "warning":
                    logger.warning("CONFIG CHECK [warning] %s", _msg)
                else:
                    logger.info("CONFIG CHECK [info] %s", _msg)
        except Exception as _cfg_err:  # never block boot on the self-check
            logger.warning("startup config self-check skipped: %s", _cfg_err)

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
        # Phase 4B — start background task worker (no-op if ENABLE_BACKGROUND_TASKS
        # is not "true"). The hook itself is safe to call always; the queue's
        # own gates keep production behaviour byte-identical when off.
        try:
            from backend.services.tasks.lifecycle import on_app_startup as _bg_start
            await _bg_start()
        except Exception as _bg_err:
            logger.warning("background-task startup (non-fatal): %s", _bg_err)

        # Phase 7 slice 2 — Redis fanout subscriber. No-op when
        # ENABLE_REDIS=false, so production behaviour is unchanged on
        # the default path. When Redis is on, this starts ONE
        # PSUBSCRIBE task per API replica that bridges worker-published
        # events to in-process SSE consumers.
        try:
            from backend.services.jobs.events_redis import get_fanout
            await get_fanout().start()
        except Exception as _fanout_err:
            logger.warning("jobs.events_redis startup (non-fatal): %s", _fanout_err)

        # Phase A.1 — Workflow DAG runner orphan sweep. No-op when
        # ENABLE_WORKFLOW_RUNNER=false (which is the default), so this
        # has zero blast radius on production until the flag is
        # flipped. When the runner IS enabled, this re-attaches a
        # driver to every workflow whose status is `running` but has
        # no live driver in this process (the typical case after an
        # API restart). See backend/services/workflows/runner.py
        # `sweep_orphans` for the resume semantics.
        try:
            from backend.services.workflows import runner as _wf_runner
            await _wf_runner.sweep_orphans()
        except Exception as _wf_err:
            logger.warning(
                "workflows.runner startup sweep (non-fatal): %s", _wf_err,
            )

    @_app.on_event("shutdown")
    async def _shutdown():
        # Drain the background queue (within a 5s budget) before the
        # process exits so usage / save_message writes don't get lost
        # on a normal redeploy. Force-kills (SIGKILL) still drop the
        # pending work; that's acceptable.
        try:
            from backend.services.tasks.lifecycle import on_app_shutdown as _bg_stop
            await _bg_stop()
        except Exception as _bg_err:
            logger.warning("background-task shutdown (non-fatal): %s", _bg_err)
        # Phase 7 — drain the Job Queue inline runner (up to 5s) so
        # in-flight jobs land in a clean terminal state before the
        # process dies. No-op when the queue was never enabled.
        try:
            from backend.services.jobs import client as _jobs_client
            if _jobs_client.is_enabled():
                await _jobs_client.shutdown(drain_timeout_s=5.0)
        except Exception as _jobs_err:
            logger.warning("jobs shutdown (non-fatal): %s", _jobs_err)
        # Phase 7 slice 2 — stop the Redis fanout subscriber cleanly.
        try:
            from backend.services.jobs.events_redis import get_fanout
            await get_fanout().stop()
        except Exception as _fanout_err:
            logger.warning("jobs.events_redis shutdown (non-fatal): %s", _fanout_err)

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
        "backend.routes.sessions",     # Phase M2 — /sessions/* (gated by ENABLE_SESSIONS)
        "backend.routes.projects",     # Phase 2  — /projects/* (gated by ENABLE_PROJECTS)
        "backend.routes.trading",      # Phase T1 — /trading/signals (gated by ENABLE_TRADING_SIGNALS)
        "backend.routes.v2",           # Phase 1 — /v2/* envelope reference impl
        "backend.routes.v2_auth",      # Phase 3a — /v2/auth/* (guest, refresh, me, logout)
        "backend.routes.v2_chat_stream",  # Phase 4a — /v2/chat/stream (SSE)
        "backend.routes.v2_sessions",  # Phase 5 — /v2/sessions/* (auth-bound, parallel to legacy)
        "backend.routes.v2_agent",     # Phase 6d — /v2/agent/execute (gated by ENABLE_AGENT)
        "backend.routes.v2_orchestrate",  # Phase 3.4 — /v2/orchestrate (gated by ENABLE_ORCHESTRATOR)
        "backend.routes.v2_orchestrator",  # Phase A.2 — /v2/orchestrator/* project runs (gated by ENABLE_PROJECT_ORCHESTRATOR)
        "backend.routes.v2_events",    # Phase 3.5 — /v2/events/stream (gated by ENABLE_REALTIME_EVENTS)
        "backend.routes.market",       # Phase 8e — /market/quote/{symbol} (gated by ENABLE_MARKET_QUOTE)
        "backend.routes.v2_memory",    # Phase 6 — /v2/memory/* Memory Plane (gated by ENABLE_MEMORY_PLANE)
        "backend.routes.v2_jobs",      # Phase 7 — /v2/jobs/* Job Queue (gated by ENABLE_JOB_QUEUE)
        "backend.routes.v2_assets",    # Phase 8 — /v2/assets/* Asset System (gated by ENABLE_ASSET_SYSTEM)
        "backend.routes.v2_vision",    # Phase 8 — /v2/assets/{id}/analyze + /analysis (gated by ENABLE_VISION_PIPELINE)
        "backend.routes.v2_brain",     # Phase 8 — /v2/projects/{id}/brain/* (gated by ENABLE_PROJECT_BRAIN)
        "backend.routes.v2_workflows", # Phase 8 — /v2/workflows/* (gated by ENABLE_WORKFLOWS)
        "backend.routes.v2_agent_tasks", # Phase 8 — /v2/agents/{id}/tasks/* (gated by ENABLE_AGENT_ORCHESTRATION)
        "backend.routes.v2_recreate",  # Phase 8 — /v2/recreate/* (gated by ENABLE_WEBSITE_RECREATION)
        "backend.routes.v2_orchestration",  # Phase 9 — /v2/orchestration/activity (always 200)
        "backend.routes.v2_scratchpad",     # Phase 9 — /v2/scratchpad/* (gated by ENABLE_SCRATCHPAD)
        "backend.routes.v2_coordinator",    # Phase 9 — /v2/coordinator/plan + /classify (gated by ENABLE_COORDINATOR)
        "backend.routes.v2_panels",         # Phase 9 — /v2/panels/* (gated by ENABLE_REAL_COORDINATION)
        "backend.routes.v2_agent_presence", # Phase 9 — /v2/agents/presence (gated by ENABLE_AGENT_PRESENCE)
        "backend.routes.v2_tools",          # Phase 10 — /v2/tools/* unified tools API
        "backend.routes.v2_db_health",      # Phase 6 — /v2/db/health (owner-only)
    ]:
        try:
            _app.include_router(importlib.import_module(_mod).router)
            logger.info("Route OK: %s", _mod)
        except Exception as _e:
            logger.error("Route SKIP %s: %s", _mod, _e)

    # Phase-1 / Phase-B optional middleware — each gated by env var,
    # default off so the existing production behaviour is byte-for-byte
    # unchanged until a flag is flipped on Railway.
    #
    #   ENABLE_REQUEST_ID_MIDDLEWARE=true → X-Request-Id correlation
    #   ENABLE_TIMING_MIDDLEWARE=true     → X-Response-Time-ms + per-req log
    #   ENABLE_AUTH_MIDDLEWARE=true       → reads Bearer / guest header (no verify)
    #   ENABLE_V2_ERROR_HANDLERS=true     → ApiError → envelope handler
    #
    # Middleware order matters in Starlette: the FIRST added is the
    # OUTERMOST wrapper (runs first on the way in, last on the way out).
    # We want:
    #   request_id   → outermost so every log line + response has the id
    #   timing       → wraps the inner handler to measure full duration
    #   auth         → innermost so request_id + timing already populated
    if os.getenv("ENABLE_REQUEST_ID_MIDDLEWARE", "false").strip().lower() == "true":
        try:
            from backend.middleware.request_id import RequestIdMiddleware
            _app.add_middleware(RequestIdMiddleware)
            logger.info("Phase-1 middleware: RequestIdMiddleware installed")
        except Exception as _e:
            logger.warning("RequestIdMiddleware install failed (non-fatal): %s", _e)

    if os.getenv("ENABLE_TIMING_MIDDLEWARE", "false").strip().lower() == "true":
        try:
            from backend.middleware.timing import TimingMiddleware
            _app.add_middleware(TimingMiddleware)
            logger.info("Phase-B middleware: TimingMiddleware installed")
        except Exception as _e:
            logger.warning("TimingMiddleware install failed (non-fatal): %s", _e)

    if os.getenv("ENABLE_AUTH_MIDDLEWARE", "false").strip().lower() == "true":
        try:
            from backend.middleware.auth_placeholder import AuthPlaceholderMiddleware
            _app.add_middleware(AuthPlaceholderMiddleware)
            logger.info("Phase-B middleware: AuthPlaceholderMiddleware installed (no verify)")
        except Exception as _e:
            logger.warning("AuthPlaceholderMiddleware install failed (non-fatal): %s", _e)

    # Phase 3a — real JWT-verifying AuthMiddleware. Supersedes the
    # placeholder above. Opt-in via ENABLE_AUTH_V2=true. Do NOT enable
    # both flags simultaneously — the inner placeholder would overwrite
    # request.state fields the real one just set.
    if os.getenv("ENABLE_AUTH_V2", "false").strip().lower() == "true":
        try:
            from backend.middleware.auth import AuthMiddleware
            _app.add_middleware(AuthMiddleware)
            logger.info("Phase-3a middleware: AuthMiddleware installed (real JWT verify)")
        except Exception as _e:
            logger.warning("AuthMiddleware install failed (non-fatal): %s", _e)

    if os.getenv("ENABLE_V2_ERROR_HANDLERS", "false").strip().lower() == "true":
        try:
            from backend.core.errors import install_api_error_handlers
            install_api_error_handlers(_app)
            logger.info("Phase-1 handlers: ApiError → envelope handler installed")
        except Exception as _e:
            logger.warning("install_api_error_handlers failed (non-fatal): %s", _e)

    # Owner / Admin Mode — /v2/admin/* routes. Hidden from the route
    # table entirely when ENABLE_ADMIN_MODE is off so a scanner gets
    # 404 instead of 401 (admin mode shouldn't be discoverable).
    if os.getenv("ENABLE_ADMIN_MODE", "false").strip().lower() == "true":
        try:
            from backend.routes.v2_admin import router as _admin_router
            _app.include_router(_admin_router)
            logger.info("Admin mode: /v2/admin/* routes installed")
        except Exception as _e:
            logger.warning("v2_admin route install failed (non-fatal): %s", _e)

    # Phase-B: import the providers package so KNOWN_PROVIDERS is
    # populated and bootstrap_default_providers() runs once. Safe even
    # when OPENAI_API_KEY isn't set — the registry stays empty and
    # /v2/health.metadata.providers reflects that.
    try:
        import backend.services.providers  # noqa: F401
        logger.info("Phase-B providers package imported")
    except Exception as _e:
        logger.warning("providers package import failed (non-fatal): %s", _e)

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
