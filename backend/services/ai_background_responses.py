# coding: utf-8
# Phase 13F.1 — opaque, short-lived, authenticated ownership records for OpenAI Background
# Responses used by the dedicated frontend_builder full-source tasks.
#
# What this stores (Redis, bounded TTL — see JOB_TTL_S): ONLY a minimal ownership mapping — the opaque Korvix
# job id, the authenticated user id, the RAW OpenAI response id (kept SERVER-SIDE, never sent
# to the browser), the task kind, the model, and created/expires timestamps.
#
# What this NEVER stores: frontend source, the prompt, the specification, public copy,
# research, the raw OpenAI response payload, the API key, any auth token, or full provider
# errors.
#
# The browser only ever sees the opaque `job_<token>` id (never `resp_...`). Every
# retrieve/cancel MUST verify ownership against the authoritative authenticated request user
# (the caller resolves it exactly like /chat). A mismatch is reported as "not found" so the
# existence of another user's job is never revealed.
#
# Cross-process safe: backed by the shared Redis connection. When Redis is disabled/
# unavailable there is NO in-memory fallback — the caller falls back to the SYNCHRONOUS
# frontend transport instead of starting an unusable background job.
import os
import json
import time
import asyncio
import secrets
import logging
from dataclasses import dataclass
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# ── Opaque-job retention lifetime — ONE authoritative definition ──────────────
#
# The Redis ownership record MUST outlive the browser's polling window by a
# deliberate, bounded safety margin, otherwise the record can expire at the same
# instant the client still considers the workflow valid — a final poll delayed by
# normal network / event-loop / Redis timing then gets a 404 before the client
# deadline elapses (the observed background-job-missing → generic failure).
#
# INVARIANT: JOB_TTL_S  >  browser polling window  +  final-poll / network margin.
#
# BROWSER_WORKFLOW_BUDGET_S is the MAXIMUM overall client polling budget across all
# full-source background task kinds (src/lib/webBuildApi.ts). The default budget is
# 540_000 ms, but `quality-repair` — which regenerates the entire multi-file project
# from the existing files + spec + review findings — is granted an extended
# 720_000 ms budget there; this value must mirror that MAXIMUM so the retention
# invariant holds for the longest permitted poll window. The margin comfortably
# covers the client's final ~25s poll HTTP timeout plus network / Redis / event-loop
# scheduling slack. This single derived value drives the Redis expiry, the record's
# expires_at, AND the advertised expires_in_ms, so the contract can never drift
# through duplicated magic numbers. The TTL is still fixed and bounded — jobs expire
# automatically; there is NO sliding TTL.
BROWSER_WORKFLOW_BUDGET_S = 720
JOB_RETENTION_SAFETY_MARGIN_S = 120
JOB_TTL_S = BROWSER_WORKFLOW_BUDGET_S + JOB_RETENTION_SAFETY_MARGIN_S  # 840s (14 min)
_KEY_PREFIX = "aibg:"
_JOB_ID_PREFIX = "job_"
_MAX_FIELD = 200


def job_expires_in_ms() -> int:
    """Advertised opaque-job lifetime (ms) for the initial queued response — the
    SAME authoritative retention used for the Redis TTL and the record's
    expires_at. Callers must use this instead of a hardcoded literal so the
    lifetime invariant stays single-sourced."""
    return JOB_TTL_S * 1000


# Phase 13F.2 — a TRUTHFUL asynchronous probe of the shared background store. It replaces the
# old opaque boolean that (a) hid WHY the store was unavailable and (b) ran a BLOCKING sync
# ping inside the async request path — the defect that silently forced synchronous fallback in
# production. The probe uses the SAME async Redis client factory that create/load/delete_job
# use (`get_async_client`, which pings on connect), so all four operations share one client
# model and URL resolution. It never surfaces a URL/host/password or an exception repr.
_PROBE_TIMEOUT_S = 3.0


@dataclass(frozen=True)
class BackgroundStoreProbe:
    available: bool
    status: str                       # available | disabled | missing-configuration |
    #                                   import-failed | connection-failed | ping-failed | unexpected-error
    error_kind: Optional[str] = None  # bounded; never a secret / exception repr


async def probe_background_store() -> BackgroundStoreProbe:
    """Async, bounded probe of the shared Redis background store. No blocking sync ping, no
    secret in the result. `available` is True only when the store is enabled, reachable and
    responds to a ping within the bounded timeout."""
    # Config gate first (pure env read; mirrors redis_client.is_enabled without importing privates).
    enabled = os.getenv("ENABLE_REDIS", "false").strip().lower() == "true"
    has_url = bool((os.getenv("REDIS_URL") or "").strip())
    if not enabled:
        return BackgroundStoreProbe(False, "disabled", "background-store-disabled")
    if not has_url:
        return BackgroundStoreProbe(False, "missing-configuration", "background-store-missing-config")

    # Import the shared async client factory (a missing/wrong module → import-failed, not sync fallback).
    try:
        from backend.services.redis_client import get_async_client
    except Exception:
        return BackgroundStoreProbe(False, "import-failed", "background-store-import-failed")

    try:
        async def _connect_and_ping() -> None:
            client = await get_async_client()   # connects + pings on first call; raises on failure
            await client.ping()                 # explicit re-ping for a live-degradation check
        await asyncio.wait_for(_connect_and_ping(), timeout=_PROBE_TIMEOUT_S)
        return BackgroundStoreProbe(True, "available")
    except asyncio.TimeoutError:
        return BackgroundStoreProbe(False, "connection-failed", "background-store-timeout")
    except Exception as e:
        # Distinguish a config/import raise from a connect/ping raise WITHOUT leaking details.
        name = type(e).__name__
        if name in ("RedisConfigError",):
            return BackgroundStoreProbe(False, "import-failed", "background-store-config")
        if "ping" in str(e).lower():
            return BackgroundStoreProbe(False, "ping-failed", "background-store-ping-failed")
        if name in ("RedisUnavailable", "ConnectionError", "TimeoutError", "OSError"):
            return BackgroundStoreProbe(False, "connection-failed", "background-store-connection-failed")
        logger.warning("ai_background_responses | probe unexpected error | %s", name)
        return BackgroundStoreProbe(False, "unexpected-error", "background-store-error")


def _key(job_id: str) -> str:
    return _KEY_PREFIX + job_id


def _new_job_id() -> str:
    return _JOB_ID_PREFIX + secrets.token_urlsafe(32)


async def create_job(
    authenticated_user_id: str,
    openai_response_id: str,
    task_kind: str,
    model: str,
    configured_max_output_tokens: int = 0,
) -> Optional[str]:
    """Create an opaque, TTL-bounded ownership record. Returns the opaque job id, or None
    when the record could not be stored (the caller then best-effort cancels the started
    OpenAI response and returns a truthful failure — never asks the client to poll)."""
    if not openai_response_id or not authenticated_user_id:
        return None
    job_id = _new_job_id()
    now = int(time.time())
    record = {
        "job_id": job_id,
        "authenticated_user_id": str(authenticated_user_id)[:_MAX_FIELD],
        "openai_response_id": str(openai_response_id)[:_MAX_FIELD],
        "task_kind": str(task_kind or "unknown")[:_MAX_FIELD],
        "model": str(model or "")[:_MAX_FIELD],
        # Phase 13F.2 — bounded number so the poll endpoint can report the configured budget
        # on the terminal result (owner diagnostics). Never source / prompt / provider output.
        "configured_max_output_tokens": int(configured_max_output_tokens or 0),
        "created_at": now,
        "expires_at": now + JOB_TTL_S,
    }
    try:
        from backend.services.redis_client import get_async_client
        client = await get_async_client()
        await client.set(_key(job_id), json.dumps(record), ex=JOB_TTL_S)
        return job_id
    except Exception as e:
        logger.warning("ai_background_responses | create_job store failed | kind=%s | err=%s", task_kind, type(e).__name__)
        return None


async def load_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Load a job record by opaque id, or None when missing/expired/unreadable."""
    if not job_id or not isinstance(job_id, str) or not job_id.startswith(_JOB_ID_PREFIX):
        return None
    try:
        from backend.services.redis_client import get_async_client
        client = await get_async_client()
        raw = await client.get(_key(job_id))
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", "ignore")
        rec = json.loads(raw)
        return rec if isinstance(rec, dict) else None
    except Exception as e:
        logger.warning("ai_background_responses | load_job failed | err=%s", type(e).__name__)
        return None


def owns_job(record: Optional[Dict[str, Any]], authenticated_user_id: str) -> bool:
    """True only when the record belongs to the authoritative authenticated request user."""
    if not record:
        return False
    return str(record.get("authenticated_user_id")) == str(authenticated_user_id)


async def delete_job(job_id: str) -> None:
    """Best-effort delete after a terminal delivery/cancel. Never raises."""
    if not job_id or not isinstance(job_id, str):
        return
    try:
        from backend.services.redis_client import get_async_client
        client = await get_async_client()
        await client.delete(_key(job_id))
    except Exception:
        pass
