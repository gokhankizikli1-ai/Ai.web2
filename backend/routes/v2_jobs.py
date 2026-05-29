# coding: utf-8
"""
/v2/jobs — Phase 7 Job Queue REST API.

Auth-bound; user_id is derived from the JWT (via `current_user`),
never from the request body. Owner-only routes use `require_owner`.

Endpoints:
    POST   /v2/jobs                 create + enqueue a job
    GET    /v2/jobs                 list the caller's jobs
    GET    /v2/jobs/all             OWNER-only — list every job
    GET    /v2/jobs/{id}            read one
    POST   /v2/jobs/{id}/cancel     cancel a queued/running job
    POST   /v2/jobs/{id}/retry      re-enqueue a failed/cancelled job
    GET    /v2/jobs/{id}/stream     SSE stream of live status / progress

When `ENABLE_JOB_QUEUE=false` (default), every endpoint returns a
structured 503 envelope. Cross-user access returns 404 — same
convention as /v2/memory and /v2/sessions.

The SSE stream emits a `snapshot` frame on connect (so even a late
subscriber sees the current state), then `status` / `progress` /
`log` / `heartbeat` / `done` / `error` frames as they occur. The
stream closes cleanly when the job reaches a terminal status.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.jobs import client as jobs_client
from backend.services.jobs.errors import (
    JobError, JobInvalidTransition, JobKindUnknown,
    JobNotFound, JobValidationError,
)
from backend.services.jobs.events import get_bus
from backend.services.jobs.kinds import public_kinds, is_public_kind
from backend.services.jobs.types import (
    DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_S, MAX_PAYLOAD_BYTES,
    TERMINAL_STATUSES,
)
from backend.utils.sse import sse_event, sse_response


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/v2/jobs", tags=["jobs-v2"])


# ── Feature gate ─────────────────────────────────────────────────────────────

def _is_enabled() -> bool:
    return os.getenv("ENABLE_JOB_QUEUE", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "JOB_QUEUE_DISABLED",
                "message":  "Job queue is disabled. Set ENABLE_JOB_QUEUE=true to activate.",
                "rollback": "Unset ENABLE_JOB_QUEUE (or set to 'false') to disable again.",
            },
        )


def _job_not_found(job_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "JOB_NOT_FOUND",
                "message": f"job {job_id!r} not found"},
    )


# ── Owner check (returns bool — does not raise) ──────────────────────────────

def _is_owner(user: User) -> bool:
    """Best-effort owner check. Falls back to False if the admin
    package isn't available — non-owners are silently treated as
    regular users."""
    try:
        from backend.services.admin.owner import is_owner
        return is_owner(user)
    except Exception:
        return False


# ── Request bodies ───────────────────────────────────────────────────────────

class CreateJobBody(BaseModel):
    kind:            str = Field(..., min_length=1, max_length=64)
    payload:         Optional[Dict[str, Any]] = Field(default=None)
    project_id:      Optional[str] = Field(default=None, max_length=64)
    agent_id:        Optional[str] = Field(default=None, max_length=64)
    idempotency_key: Optional[str] = Field(default=None, max_length=128)
    max_attempts:    int = Field(default=DEFAULT_MAX_ATTEMPTS, ge=1, le=10)
    timeout_s:       Optional[int] = Field(default=DEFAULT_TIMEOUT_S, ge=1, le=3600)
    metadata:        Optional[Dict[str, Any]] = Field(default=None)


class RetryBody(BaseModel):
    extra_max_attempts: int = Field(default=1, ge=1, le=5)


# ── Error translation ────────────────────────────────────────────────────────

def _translate_job_error(e: JobError) -> HTTPException:
    """Convert a typed JobError into a structured HTTPException. We
    use HTTPException directly (rather than NotFoundError /
    ValidationError from core/errors.py) so behaviour is independent
    of ENABLE_V2_ERROR_HANDLERS."""
    return HTTPException(
        status_code=e.http_status,
        detail={"code": e.code, "message": e.message, **e.details},
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("")
async def create_job(
    body: CreateJobBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Create + enqueue a job. Idempotent when `idempotency_key` is
    provided — a duplicate (user, kind, key) tuple returns the
    existing row WITHOUT creating a new one."""
    _ensure_enabled()
    kind = body.kind.strip().lower()
    if not is_public_kind(kind):
        raise HTTPException(
            status_code=400,
            detail={
                "code":      "JOB_KIND_UNKNOWN",
                "message":   f"kind {kind!r} is not allowed via this API.",
                "available": list(public_kinds()),
            },
        )
    try:
        rec = await jobs_client.create(
            user_id=         user.id,
            kind=            kind,
            payload=         body.payload or {},
            project_id=      body.project_id,
            agent_id=        body.agent_id,
            idempotency_key= body.idempotency_key,
            max_attempts=    body.max_attempts,
            timeout_s=       body.timeout_s,
            metadata=        body.metadata,
        )
    except JobError as e:
        raise _translate_job_error(e)
    return envelope_ok(
        data={"job": rec.to_dict()},
        endpoint="/v2/jobs",
        user_id=user.id,
    )


@router.get("")
def list_jobs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    kind: Optional[str] = Query(None, max_length=64),
    status: Optional[str] = Query(None, max_length=32),
    project_id: Optional[str] = Query(None, max_length=64),
    agent_id: Optional[str] = Query(None, max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List the caller's jobs, newest first."""
    _ensure_enabled()
    items = jobs_client.list_user(
        user.id,
        kind=kind, status=status,
        project_id=project_id, agent_id=agent_id,
        limit=limit, offset=offset,
    )
    logger.info(
        "[JOB][JOBS_API] endpoint=/v2/jobs user_id=%s count=%d filters: kind=%s status=%s",
        user.id, len(items), kind or "*", status or "*",
    )
    return envelope_ok(
        data={"jobs": [j.to_dict() for j in items]},
        endpoint="/v2/jobs",
        user_id=user.id,
        count=len(items),
        limit=limit,
        offset=offset,
    )


@router.get("/all")
def list_all_jobs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    kind: Optional[str] = Query(None, max_length=64),
    status: Optional[str] = Query(None, max_length=32),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """OWNER-only — list every job across users. Non-owners get 404
    (route hidden) rather than 403 so non-owners can't discover
    its existence."""
    _ensure_enabled()
    if not _is_owner(user):
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND",
                                                     "message": "Not found"})
    items = jobs_client.list_all(kind=kind, status=status,
                                 limit=limit, offset=offset)
    # Phase 7 closure — surface the DB path so the operator can
    # compare against [JOB][SHADOW_VERIFY]. If the paths differ, the
    # writer and reader are not seeing the same SQLite file (multi-
    # container / ephemeral disk).
    import os as _os
    _db_path = _os.getenv("JOBS_DB_PATH") or "(unset → ./jobs.db)"
    logger.info(
        "[JOB][JOBS_API] endpoint=/v2/jobs/all caller=%s count=%d "
        "db_path=%s filters: kind=%s status=%s",
        user.id, len(items), _db_path,
        kind or "*", status or "*",
    )
    return envelope_ok(
        data={"jobs": [j.to_dict() for j in items]},
        endpoint="/v2/jobs/all",
        count=len(items),
        limit=limit,
        offset=offset,
        owner=True,
    )


@router.get("/{job_id}")
def get_job(
    job_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Read one. Cross-user access returns 404 (existence hidden).
    Owners can read any job."""
    _ensure_enabled()
    by_owner = _is_owner(user)
    rec = jobs_client.get(job_id, user_id=None if by_owner else user.id)
    if rec is None:
        raise _job_not_found(job_id)
    return envelope_ok(
        data={"job": rec.to_dict()},
        endpoint=f"/v2/jobs/{job_id}",
        user_id=user.id,
        by_owner=by_owner,
    )


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Cancel a queued/running job. Terminal jobs return 409."""
    _ensure_enabled()
    by_owner = _is_owner(user)
    try:
        rec = await jobs_client.cancel(job_id, user_id=user.id, by_owner=by_owner)
    except JobNotFound:
        raise _job_not_found(job_id)
    except JobInvalidTransition as e:
        raise _translate_job_error(e)
    return envelope_ok(
        data={"job": rec.to_dict()},
        endpoint=f"/v2/jobs/{job_id}/cancel",
        user_id=user.id,
        by_owner=by_owner,
    )


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str,
    body: Optional[RetryBody] = None,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Re-enqueue a failed/cancelled job. Bumps max_attempts so the
    runner is allowed at least one more pass."""
    _ensure_enabled()
    by_owner = _is_owner(user)
    extra = (body or RetryBody()).extra_max_attempts
    try:
        rec = await jobs_client.retry(job_id, user_id=user.id, by_owner=by_owner,
                                       extra_max_attempts=extra)
    except JobNotFound:
        raise _job_not_found(job_id)
    except JobInvalidTransition as e:
        raise _translate_job_error(e)
    return envelope_ok(
        data={"job": rec.to_dict()},
        endpoint=f"/v2/jobs/{job_id}/retry",
        user_id=user.id,
        by_owner=by_owner,
    )


# ── SSE stream ───────────────────────────────────────────────────────────────

@router.get("/{job_id}/stream")
async def stream_job(
    job_id: str,
    request: Request,
    user: User = Depends(current_user),
):
    """Live status/progress stream for one job.

    Frame protocol:
      event: snapshot   — full current JobRecord on connect
      event: status     — status transition (queued → running → ...)
      event: progress   — progress update {progress, label}
      event: heartbeat  — keep-alive every ~15s on idle
      event: done       — terminal success {status, result}
      event: error      — terminal failure {status, error}
    """
    _ensure_enabled()
    by_owner = _is_owner(user)
    rec = jobs_client.get(job_id, user_id=None if by_owner else user.id)
    if rec is None:
        raise _job_not_found(job_id)

    async def event_stream() -> AsyncIterator[str]:
        # 1) Initial snapshot.
        yield sse_event("snapshot", {"job": rec.to_dict()})
        # If the job is already terminal, close immediately with the
        # appropriate done/error frame.
        if rec.is_terminal:
            kind = "done" if rec.status == "succeeded" else "error"
            yield sse_event(kind, {
                "status": rec.status,
                "result": rec.result,
                "error":  rec.error,
            })
            return

        # 2) Subscribe to live events.
        bus = get_bus()
        async for event in bus.consume(job_id, heartbeat_s=15.0):
            # Client disconnected → stop pushing.
            if await request.is_disconnected():
                return
            yield sse_event(event.kind, {
                **event.payload,
                "ts": event.timestamp,
            })
            # Close on terminal events.
            if event.kind in {"done", "error"}:
                return

    return sse_response(event_stream())


# ── Health/diagnostic (no auth — counts only, no PII) ────────────────────────

@router.get("/health/diagnostic", include_in_schema=False)
def jobs_health() -> Dict[str, Any]:
    """Internal — flag state, counters, registered kinds."""
    return envelope_ok(
        data=jobs_client.stats(),
        endpoint="/v2/jobs/health/diagnostic",
        public_kinds=list(public_kinds()),
    )


__all__ = ["router"]
