# coding: utf-8
"""
v2 routes — Phase-1 reference implementation of the unified envelope.

This module exists for one reason: prove the new contract works in
production before any legacy route (which the frontend depends on) is
migrated. The /v2/health endpoint returns the exact shape future v2
routes will use:

    {
      "success":   true,
      "data":      { ... },
      "error":     null,
      "metadata":  { ... },
      "timestamp": "<ISO8601>"
    }

The legacy /health endpoint (defined inline in `api.py`) and every
existing /chat, /trading, /sessions, /memory route are NOT changed by
this PR — they keep returning their current shapes. Frontend keeps
working without modification.

When the frontend is ready to read the envelope, callers migrate by
calling `dual_emit(legacy_payload, ...)` in the route they own — old
readers (`response.reply`) and new readers (`response.data.reply`) both
work against the same body, so migration is per-route and rollback-safe.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter

from backend.core.errors import NotFoundError
from backend.core.responses import err as envelope_err
from backend.core.responses import ok as envelope_ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["v2"])


# Read once at import — see also: STABLE_CHECKPOINT.md and Phase 5.3 workflow.
_VERSION = "phase1-foundation"


def _flag(name: str) -> bool:
    """Read a default-off boolean env flag once at call time."""
    return os.getenv(name, "false").strip().lower() == "true"


@router.get("/health")
async def v2_health() -> dict:
    """Reference implementation of the v2 envelope.

    Mirrors the existing /health route's data, wrapped in the new
    {success, data, error, metadata, timestamp} envelope. Useful for:
      - Smoke-testing the envelope shape from the frontend or curl
      - Confirming on a fresh deploy that the v2 wiring is alive
      - Capability discovery for the frontend (which feature-flagged
        backend services are currently turned on)

    Always returns 200 OK; the inner `data.status` is the real probe
    signal. `metadata.commit_sha` ties the response to the build, so a
    stale CDN or browser cache shows up as "I got an old timestamp".

    Phase-2 addition: `metadata.sessions_enabled` mirrors the
    ENABLE_SESSIONS env flag so the frontend can decide whether to
    write-through chat turns to /sessions/* (skip when disabled).
    """
    return envelope_ok(
        data={
            "status":      "ok",
            "service":     "korvixai-backend",
            "version":     _VERSION,
            "environment": os.getenv("ENVIRONMENT", "production"),
        },
        commit_sha=os.getenv("RAILWAY_GIT_COMMIT_SHA", "unknown"),
        deployed_at=os.getenv("RAILWAY_DEPLOYMENT_CREATED_AT", "unknown"),
        boot_at=datetime.now(timezone.utc).isoformat(),
        # Capability discovery — one field per feature-flagged subsystem.
        # Default off until the env var is explicitly set on Railway.
        sessions_enabled        = _flag("ENABLE_SESSIONS"),
        trading_signals_enabled = _flag("ENABLE_TRADING_SIGNALS"),
        tools_enabled           = _flag("ENABLE_TOOLS"),
        market_data_enabled     = _flag("ENABLE_MARKET_DATA"),
        new_memory_enabled      = _flag("ENABLE_NEW_MEMORY"),
        agent_enabled           = _flag("ENABLE_AGENT"),
        web_research_enabled    = _flag("ENABLE_WEB_RESEARCH"),
    )


@router.get("/echo/{token}")
async def v2_echo(token: str) -> dict:
    """Diagnostic echo: surfaces the path parameter back inside the
    envelope. Lets clients verify they got an envelope-shaped response
    (and not e.g. a CDN error page) without parsing anything else.

    Raises a NotFoundError if the token is the literal string "missing"
    so we can exercise the install_api_error_handlers path from a
    browser without writing a destructive request.
    """
    if token.lower() == "missing":
        raise NotFoundError(f"token '{token}' is reserved for handler tests")
    return envelope_ok({"token": token}, length=len(token))


# Explicit demo of the failure envelope shape so frontend devs can copy
# the JSON without having to trigger a real error.
@router.get("/_demo/error")
async def v2_demo_error() -> dict:
    return envelope_err(
        "This endpoint always returns the failure envelope.",
        code="DEMO_ERROR",
    )
