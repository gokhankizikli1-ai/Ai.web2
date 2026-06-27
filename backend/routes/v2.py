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
import platform
import sys
from datetime import datetime, timezone

from fastapi import APIRouter

from backend.core.errors import NotFoundError
from backend.core.responses import err as envelope_err
from backend.core.responses import ok as envelope_ok
from backend.core.version import BACKEND_VERSION, uptime_seconds

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["v2"])


def _flag(name: str) -> bool:
    """Read a default-off boolean env flag once at call time."""
    return os.getenv(name, "false").strip().lower() == "true"


def _safe_provider_capabilities() -> list:
    """Best-effort provider snapshot — never fails the health probe."""
    try:
        from backend.services.providers import provider_capabilities
        return provider_capabilities()
    except Exception as exc:
        logger.warning("v2/health provider_capabilities failed: %s", exc)
        return []


def _safe_routing_snapshot() -> dict:
    """Best-effort routing-table snapshot — never fails the probe."""
    try:
        from backend.services.providers import describe_routing
        return describe_routing()
    except Exception as exc:
        logger.warning("v2/health routing snapshot failed: %s", exc)
        return {"modes": [], "default_provider": "openai", "error": str(exc)[:120]}


def _safe_task_stats() -> dict:
    """Best-effort background-task queue snapshot — never fails the
    health probe. Returns a flat dict so the JSON payload stays small."""
    try:
        from backend.services.tasks import queue_stats
        s = queue_stats()
        return {
            "enabled":          s.enabled,
            "worker_alive":     s.worker_alive,
            "queue_size":       s.queue_size,
            "max_queue_size":   s.max_queue_size,
            "submitted_total":  s.submitted_total,
            "processed_total":  s.processed_total,
            "failed_total":     s.failed_total,
            "overflow_dropped": s.overflow_dropped,
            "last_task_name":   s.last_task_name,
            "last_task_ms":     s.last_task_ms,
            "last_error":       s.last_error,
        }
    except Exception as exc:
        logger.warning("v2/health task stats failed: %s", exc)
        return {"enabled": False, "worker_alive": False, "error": str(exc)[:120]}


def _safe_redis_status() -> dict:
    """Best-effort Redis fanout snapshot — never fails the health probe.

    Reads ONLY in-memory state: the env-driven `is_enabled()` flag (no
    I/O), and the fanout singleton's stats dict (in-memory counters).
    Does NOT probe Redis itself — that would defeat the point of a
    bulletproof health endpoint. The fanout's stats already reflect
    real connectivity via its `errors` counter and `last_error` string.

    Returned `state`:
      "disabled" — ENABLE_REDIS=false or REDIS_URL unset (no fanout running)
      "ok"       — fanout running, no errors recorded
      "degraded" — fanout running but errors recorded (Redis unreachable
                   or pubsub failing). Surfaced as degraded; HTTP status
                   stays 200 because the API itself is alive.
    """
    try:
        from backend.services.redis_client import is_enabled
        if not is_enabled():
            return {"state": "disabled", "enabled": False}
    except Exception as exc:
        logger.warning("v2/health redis is_enabled() failed: %s", exc)
        return {"state": "unknown", "enabled": False, "error": str(exc)[:120]}

    try:
        from backend.services.jobs.events_redis import get_fanout
        stats = get_fanout().stats()
    except Exception as exc:
        logger.warning("v2/health fanout stats failed: %s", exc)
        return {"state": "unknown", "enabled": True, "error": str(exc)[:120]}

    state = "degraded" if (stats.get("errors", 0) > 0 or stats.get("last_error")) else "ok"
    return {
        "state":            state,
        "enabled":          True,
        "fanout_started":   bool(stats.get("started", False)),
        "messages_total":   int(stats.get("messages", 0)),
        "republishes_total": int(stats.get("republishes", 0)),
        "errors_total":     int(stats.get("errors", 0)),
        "last_error":       (stats.get("last_error") or "")[:240],
    }


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
            "status":         "ok",
            "service":        "korvixai-backend",
            "version":        BACKEND_VERSION,
            "environment":    os.getenv("ENVIRONMENT", "production"),
            "python_version": platform.python_version(),
            "uptime_seconds": uptime_seconds(),
        },
        commit_sha  = os.getenv("RAILWAY_GIT_COMMIT_SHA", "unknown"),
        deployed_at = os.getenv("RAILWAY_DEPLOYMENT_CREATED_AT", "unknown"),
        boot_at     = datetime.now(timezone.utc).isoformat(),
        # Capability discovery — one field per feature-flagged subsystem.
        # Default off until the env var is explicitly set on Railway.
        sessions_enabled         = _flag("ENABLE_SESSIONS"),
        trading_signals_enabled  = _flag("ENABLE_TRADING_SIGNALS"),
        tools_enabled            = _flag("ENABLE_TOOLS"),
        market_data_enabled      = _flag("ENABLE_MARKET_DATA"),
        new_memory_enabled       = _flag("ENABLE_NEW_MEMORY"),
        agent_enabled            = _flag("ENABLE_AGENT"),
        web_research_enabled     = _flag("ENABLE_WEB_RESEARCH"),
        # Phase B / Phase 3a — wired middleware (matches env flags in api.py).
        request_id_middleware    = _flag("ENABLE_REQUEST_ID_MIDDLEWARE"),
        timing_middleware        = _flag("ENABLE_TIMING_MIDDLEWARE"),
        auth_placeholder         = _flag("ENABLE_AUTH_MIDDLEWARE"),
        auth_v2                  = _flag("ENABLE_AUTH_V2"),
        v2_error_handlers        = _flag("ENABLE_V2_ERROR_HANDLERS"),
        # Phase 5 — auth-bound /v2/sessions/* is available when both
        # ENABLE_SESSIONS and ENABLE_AUTH_V2 are on. The frontend can
        # branch on this single field instead of probing two.
        auth_bound_sessions      = _flag("ENABLE_SESSIONS") and _flag("ENABLE_AUTH_V2"),
        log_format               = (os.getenv("LOG_FORMAT", "") or "text").lower(),
        # Phase B — AI provider registry snapshot.
        providers                = _safe_provider_capabilities(),
        python_implementation    = sys.implementation.name,
        # Phase 4b — background task queue snapshot.
        background_tasks         = _safe_task_stats(),
        # Phase 6b — provider routing snapshot. Shows the current
        # mode → provider mapping with each flag's current state, so
        # operators can confirm a flag flip took effect without
        # waiting for a real chat call.
        routing                  = _safe_routing_snapshot(),
        # Phase 7 slice 2 — Redis fanout status. Reads ONLY in-memory
        # state — never probes Redis. Surfaced here so operators can
        # see "degraded" without affecting HTTP status (the API itself
        # is alive even when Redis is unreachable; /health stays 200).
        services                 = {"redis": _safe_redis_status()},
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
