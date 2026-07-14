# coding: utf-8
# Phase 13F.1 — opaque, short-lived, authenticated ownership records for OpenAI Background
# Responses used by the dedicated frontend_builder full-source tasks.
#
# What this stores (Redis, TTL 540s): ONLY a minimal ownership mapping — the opaque Korvix
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
import json
import time
import secrets
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# Background Responses are only retrievable for a limited period; keep the ownership record
# for a matching short, fixed TTL so stale user jobs disappear automatically.
JOB_TTL_S = 540  # 9 minutes
_KEY_PREFIX = "aibg:"
_JOB_ID_PREFIX = "job_"
_MAX_FIELD = 200


def is_background_store_available() -> bool:
    """True only when the shared Redis KV store is enabled AND reachable. When False the
    caller must NOT start a background job (no cross-process in-memory fallback exists)."""
    try:
        from backend.services.redis_client import is_enabled
        if not is_enabled():
            return False
        from backend.services.redis_client import get_client
        get_client()  # eager PING; raises when unreachable/misconfigured
        return True
    except Exception:
        return False


def _key(job_id: str) -> str:
    return _KEY_PREFIX + job_id


def _new_job_id() -> str:
    return _JOB_ID_PREFIX + secrets.token_urlsafe(32)


async def create_job(
    authenticated_user_id: str,
    openai_response_id: str,
    task_kind: str,
    model: str,
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
