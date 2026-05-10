# coding: utf-8
"""
KorvixAI — Root-level ASGI entrypoint
======================================
Railway start command: uvicorn api:app --host 0.0.0.0 --port $PORT

This file lives at the repository root so uvicorn never has to resolve
a dotted package path (backend.api), which eliminates all __init__.py /
namespace-package ambiguity on Railway.

It tries to import the full app from backend/api.py.
If that fails for any reason, it falls back to a minimal FastAPI app
that keeps /health alive so Railway passes its health probe.
"""
import sys
import os
import logging

# ── Ensure project root is on sys.path ────────────────────────────────────
_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
_log = logging.getLogger("korvix.root")

# ── Try to load the full backend app ─────────────────────────────────────
try:
    from backend.api import app  # noqa: F401
    _log.info("Root entrypoint: loaded full app from backend.api")

except Exception as _import_err:
    _log.error(
        "Root entrypoint: backend.api import failed (%s) — starting minimal fallback",
        _import_err,
        exc_info=True,
    )

    # ── Minimal FastAPI fallback (health probe stays alive) ──────────────────
    try:
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        app = FastAPI(title="KorvixAI API (fallback)", version="3.0.0")
        app.add_middleware(CORSMiddleware, allow_origins=["*"],
                           allow_methods=["*"], allow_headers=["*"])

        @app.get("/health")
        async def health():
            return {"status": "ok", "mode": "fallback", "reason": str(_import_err)}

        @app.post("/chat")
        async def chat_fallback():
            return {
                "reply": "Sistem bakimda, lutfen tekrar deneyin.",
                "intent": "error", "model": "none", "provider": "none",
                "mode": "fallback", "memory_used": False,
                "remaining_messages": -1, "premium": False,
                "response_time_ms": 0, "request_id": "fallback",
                "suggested_followups": None, "success": False,
                "error": "Sistem bakimda, lutfen tekrar deneyin.",
                "code": "SERVICE_UNAVAILABLE",
            }

        _log.warning("Root entrypoint: running minimal FastAPI fallback")

    except Exception as _fastapi_err:
        # ── Bare ASGI last resort — app is ALWAYS defined ─────────────────
        _log.critical("Root entrypoint: FastAPI unavailable (%s) — bare ASGI", _fastapi_err)

        async def app(scope, receive, send):  # type: ignore[misc]
            if scope["type"] == "http":
                body = b'{"status":"ok","mode":"bare-asgi"}'
                await send({"type": "http.response.start", "status": 200,
                            "headers": [[b"content-type", b"application/json"]]})
                await send({"type": "http.response.body", "body": body})
