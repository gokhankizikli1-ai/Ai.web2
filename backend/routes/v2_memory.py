# coding: utf-8
"""
/v2/memory — Phase 6 Memory Plane REST API.

Auth-bound; user_id is derived from the JWT (via `current_user`),
NEVER from the request body, so no caller can spoof another user.
When the service is disabled (`ENABLE_MEMORY_PLANE != "true"`) every
endpoint returns a 503 envelope.

Endpoints:
    POST   /v2/memory                  create one memory
    GET    /v2/memory                  list the caller's recent memories
    GET    /v2/memory/search           full-text + filter search
    GET    /v2/memory/project/{id}     list memories scoped to one project
    GET    /v2/memory/{id}             read one
    DELETE /v2/memory/{id}             soft-delete one

Ownership model:
    * Every read/write enforces row.user_id == caller.id.
    * Cross-user access returns 404 (NotFoundError) — NEVER 403 —
      so a probe can't distinguish "doesn't exist" from
      "exists but belongs to someone else".
    * When `project_id` is provided, we additionally check the
      project (= sessions workspace) belongs to the caller; mismatch
      ⇒ 404. The check piggybacks on the existing
      `sessions.auth.workspace_or_404` helper so behaviour matches
      /v2/sessions exactly.

Pagination: every list/search response carries `count`, `limit`,
`offset` in the envelope metadata. Cursor-pagination is reserved
for a future revision (the API stays back-compat — adding a cursor
field will not break offset-based callers).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.errors import NotFoundError   # raised by sessions.auth.workspace_or_404
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.memory_plane import client as memory_client
from backend.services.memory_plane.types import (
    MEMORY_KINDS, DEFAULT_KIND, MemoryRecord,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/memory", tags=["memory-v2"])


# ── Feature gate ─────────────────────────────────────────────────────────────

def _is_enabled() -> bool:
    return os.getenv("ENABLE_MEMORY_PLANE", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    """Return a structured 503 when the flag is off. Matches the
    envelope shape /v2/sessions uses so the frontend can render one
    "service disabled" UX for every Phase 6+ subsystem."""
    if not _is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "MEMORY_PLANE_DISABLED",
                "message":  "Memory Plane is disabled. Set ENABLE_MEMORY_PLANE=true to activate.",
                "rollback": "Unset ENABLE_MEMORY_PLANE (or set to 'false') to disable again.",
            },
        )


# ── Project ownership helper ─────────────────────────────────────────────────
#
# When a route receives a `project_id` we verify it via the sessions
# service. This couples Memory Plane to the existing workspace model
# without re-implementing ownership in two places. We keep the import
# inside the helper so a deployment without ENABLE_SESSIONS still gets
# a clean 404 instead of an ImportError.

def _project_not_found(project_id: str) -> HTTPException:
    """Build the canonical 'project not found' 404. Never reveals
    whether the project exists for another user."""
    return HTTPException(
        status_code=404,
        detail={
            "code":    "PROJECT_NOT_FOUND",
            "message": f"project '{project_id}' not found",
        },
    )


def _memory_not_found(record_id: str) -> HTTPException:
    """Build the canonical 'memory not found' 404. Same content
    whether the row truly doesn't exist or belongs to another user."""
    return HTTPException(
        status_code=404,
        detail={
            "code":    "MEMORY_NOT_FOUND",
            "message": f"memory '{record_id}' not found",
        },
    )


def _enforce_project_ownership(project_id: str, user: User) -> None:
    """Raise HTTPException(404) when `project_id` doesn't exist OR
    belongs to a different user. Never raises 403 — the absence of a
    distinguishable error keeps cross-user probing impossible.

    Uses HTTPException directly rather than NotFoundError so the
    behaviour does NOT depend on `install_api_error_handlers` having
    been wired into the app (which is gated by ENABLE_V2_ERROR_HANDLERS
    at app-build time).
    """
    try:
        from backend.services.sessions.auth import workspace_or_404
        from backend.services.sessions import client as sessions_client
    except Exception as e:
        logger.warning("memory_plane.routes: sessions package missing (%s)", e)
        raise _project_not_found(project_id)
    if not sessions_client:
        # Sessions storage unavailable — trust the JWT-derived user
        # rather than blocking Memory Plane entirely.
        return
    try:
        workspace_or_404(project_id, user)
    except NotFoundError:
        raise _project_not_found(project_id)


# ── Request bodies ───────────────────────────────────────────────────────────

class CreateMemoryBody(BaseModel):
    content:     str = Field(..., min_length=1, max_length=8_000)
    kind:        str = Field(DEFAULT_KIND, max_length=32)
    project_id:  Optional[str] = Field(None, max_length=64)
    agent_id:    Optional[str] = Field(None, max_length=64)
    importance:  Optional[float] = Field(None, ge=0.0, le=1.0)
    ttl_seconds: Optional[int] = Field(None, ge=0, le=60 * 60 * 24 * 365)  # max 1 yr
    metadata:    Optional[Dict[str, Any]] = None


# ── Response shaping helpers ─────────────────────────────────────────────────

def _records_to_payload(records: List[MemoryRecord]) -> List[Dict[str, Any]]:
    return [r.to_dict() for r in records]


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("")
def create_memory(
    body: CreateMemoryBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Create one memory for the authenticated user. Idempotent within
    the dedup window: identical content for the same (project, agent,
    kind) is folded into the existing row and its importance is
    bumped."""
    _ensure_enabled()
    if body.project_id:
        _enforce_project_ownership(body.project_id, user)

    rec = memory_client.create(
        user_id=    user.id,
        content=    body.content,
        kind=       body.kind,
        project_id= body.project_id,
        agent_id=   body.agent_id,
        importance= body.importance,
        ttl_seconds=body.ttl_seconds,
        metadata=   body.metadata or {},
    )
    if rec is None:
        # The manager rejected the input — most likely because the
        # safety filter caught a secret. Surface a clean 400 rather
        # than leaking the reason.
        raise HTTPException(
            status_code=400,
            detail={
                "code":    "MEMORY_REJECTED",
                "message": "Memory content was rejected (empty or contains sensitive data).",
            },
        )
    return envelope_ok(
        data={"memory": rec.to_dict()},
        endpoint="/v2/memory",
        user_id=user.id,
    )


@router.get("")
def list_memories(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    kind: Optional[str] = Query(None, max_length=32),
    project_id: Optional[str] = Query(None, max_length=64),
    agent_id: Optional[str] = Query(None, max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List the caller's memories. Filters: kind / project_id /
    agent_id. Ordered by importance DESC, created_at DESC."""
    _ensure_enabled()
    if project_id:
        _enforce_project_ownership(project_id, user)
    items = memory_client.list_user(
        user.id,
        project_id=project_id,
        agent_id=  agent_id,
        kind=      kind,
        limit=     limit,
        offset=    offset,
    )
    return envelope_ok(
        data={"memories": _records_to_payload(items)},
        endpoint="/v2/memory",
        user_id=user.id,
        count=len(items),
        limit=limit,
        offset=offset,
    )


@router.get("/search")
def search_memories(
    q: Optional[str] = Query(None, max_length=400, description="Free-text query"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    kind: Optional[str] = Query(None, max_length=32),
    project_id: Optional[str] = Query(None, max_length=64),
    agent_id: Optional[str] = Query(None, max_length=64),
    importance_floor: Optional[float] = Query(None, ge=0.0, le=1.0),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Search the caller's memories. Today: text-LIKE + importance +
    recency ranking. Tomorrow: cosine similarity over embeddings —
    same response shape, transparent upgrade."""
    _ensure_enabled()
    if project_id:
        _enforce_project_ownership(project_id, user)
    items = memory_client.search(
        user.id,
        query=           q,
        project_id=      project_id,
        agent_id=        agent_id,
        kind=            kind,
        importance_floor=importance_floor,
        limit=           limit,
        offset=          offset,
    )
    return envelope_ok(
        data={"memories": _records_to_payload(items)},
        endpoint="/v2/memory/search",
        user_id=user.id,
        query=q,
        count=len(items),
        limit=limit,
        offset=offset,
    )


@router.get("/project/{project_id}")
def list_project_memories(
    project_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    kind: Optional[str] = Query(None, max_length=32),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List every memory scoped to one project. Enforces ownership via
    the sessions/workspaces service — cross-user access ⇒ 404."""
    _ensure_enabled()
    _enforce_project_ownership(project_id, user)
    items = memory_client.list_user(
        user.id,
        project_id=project_id,
        kind=      kind,
        limit=     limit,
        offset=    offset,
    )
    return envelope_ok(
        data={"memories": _records_to_payload(items)},
        endpoint=f"/v2/memory/project/{project_id}",
        user_id=user.id,
        project_id=project_id,
        count=len(items),
        limit=limit,
        offset=offset,
    )


@router.get("/whoami", include_in_schema=False)
def memory_whoami_first(user: User = Depends(current_user)) -> Dict[str, Any]:
    """Diagnostic — reveals exactly which user_id the current JWT
    resolves to + how many memories exist for it. Declared BEFORE
    the parameterized `/{record_id}` route so FastAPI doesn't match
    "whoami" as a memory id."""
    _ensure_enabled()
    items = memory_client.list_user(user.id, limit=200)
    by_kind: Dict[str, int] = {}
    for it in items:
        by_kind[it.kind] = by_kind.get(it.kind, 0) + 1
    return envelope_ok(
        data={
            "user_id":              user.id,
            "kind":                 user.kind,
            "external_id":          user.external_id,
            "memory_count_total":   len(items),
            "memory_count_by_kind": by_kind,
        },
        endpoint="/v2/memory/whoami",
    )


@router.get("/health/diagnostic", include_in_schema=False)
def memory_health_diagnostic_first() -> Dict[str, Any]:
    """Health snapshot. Declared BEFORE `/{record_id}` so FastAPI
    doesn't match the literal path as a memory id."""
    snap = memory_client.stats()
    return envelope_ok(
        data=snap,
        endpoint="/v2/memory/health/diagnostic",
        kinds_supported=list(MEMORY_KINDS),
    )


@router.get("/{record_id}")
def get_memory(
    record_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Read one memory by id. Cross-user access ⇒ 404."""
    _ensure_enabled()
    rec = memory_client.get(record_id, user_id=user.id)
    if rec is None:
        raise _memory_not_found(record_id)
    return envelope_ok(
        data={"memory": rec.to_dict()},
        endpoint=f"/v2/memory/{record_id}",
        user_id=user.id,
    )


@router.delete("/{record_id}")
def delete_memory(
    record_id: str,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Soft-delete one memory. Cross-user access ⇒ 404 (so a probe
    can't enumerate other users' memory ids)."""
    _ensure_enabled()
    ok = memory_client.delete(record_id, user_id=user.id)
    if not ok:
        raise _memory_not_found(record_id)
    return envelope_ok(
        data={"deleted_id": record_id},
        endpoint=f"/v2/memory/{record_id}",
        user_id=user.id,
    )


# NOTE: /whoami and /health/diagnostic are declared ABOVE the
# parameterized `/{record_id}` route so FastAPI doesn't match
# their path literals as memory ids. Don't redeclare them here.


__all__ = ["router"]
