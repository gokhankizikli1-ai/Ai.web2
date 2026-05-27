# coding: utf-8
"""/v2/scratchpad — Phase 9 shared per-project journal.

Read + append surface for the shared scratchpad. Behind
ENABLE_SCRATCHPAD; route returns a 503 envelope when the flag is off so
the FE can detect and hide the panel rather than rendering empty.

Ownership: all reads are scoped to the caller's user_id via the store's
(user_id, project_id) index — a stranger can't request someone else's
project_id and have it return their notes.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.scratchpad import client as sp_client
from backend.services.scratchpad.types import SCRATCHPAD_KINDS, normalize_kind


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["scratchpad-v2"])


def _ensure_enabled() -> None:
    if not sp_client.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "SCRATCHPAD_DISABLED",
                "message":  "Scratchpad is disabled. Set ENABLE_SCRATCHPAD=true.",
                "rollback": "Unset ENABLE_SCRATCHPAD to disable.",
            },
        )


# ── Bodies ────────────────────────────────────────────────────────────────

class AppendBody(BaseModel):
    """Append-one request. Empty content + empty metadata + kind=note
    is refused by the client layer to keep the journal clean."""
    project_id:     str = Field(..., min_length=1, max_length=64)
    agent_id:       str = Field(..., min_length=1, max_length=128)
    kind:           str = Field(default="note", max_length=32)
    content:        str = Field(default="", max_length=8000)
    workflow_id:    Optional[str] = Field(None, max_length=128)
    job_id:         Optional[str] = Field(None, max_length=128)
    parent_id:      Optional[str] = Field(None, max_length=128)
    correlation_id: Optional[str] = Field(None, max_length=128)
    metadata:       Optional[Dict[str, Any]] = None


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("/scratchpad")
def append_entry(
    body: AppendBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Append a new entry. Returns the persisted record (id +
    created_at populated) or 422 when the payload is rejected by the
    client-layer signal-to-noise filter."""
    _ensure_enabled()
    entry = sp_client.append(
        user_id=        user.id,
        project_id=     body.project_id,
        agent_id=       body.agent_id,
        kind=           body.kind,
        content=        body.content,
        workflow_id=    body.workflow_id,
        job_id=         body.job_id,
        parent_id=      body.parent_id,
        correlation_id= body.correlation_id,
        metadata=       body.metadata,
    )
    if entry is None:
        # The client refused — empty content + no metadata + default
        # kind. Surface a precise 422 so callers can fix the payload.
        raise HTTPException(
            status_code=422,
            detail={
                "code":     "SCRATCHPAD_EMPTY_ENTRY",
                "message":  "Scratchpad entry must include content, metadata, or a non-default kind.",
            },
        )
    return envelope_ok(
        data={"entry": entry.to_dict()},
        endpoint="/v2/scratchpad",
        user_id=user.id,
    )


@router.get("/projects/{project_id}/scratchpad")
def list_project_scratchpad(
    project_id:     str = Path(..., max_length=64),
    limit:          int = Query(50, ge=1, le=200),
    offset:         int = Query(0, ge=0),
    kind:           Optional[str] = Query(None, max_length=32),
    workflow_id:    Optional[str] = Query(None, max_length=128),
    correlation_id: Optional[str] = Query(None, max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List recent entries for a project. Newest first. Returns
    empty list (not 404) when the project has no scratchpad activity
    yet — same convention as agent-activity / orchestration/activity."""
    _ensure_enabled()
    entries = sp_client.list_project(
        user_id=        user.id,
        project_id=     project_id,
        limit=          limit,
        offset=         offset,
        kind=           kind,
        workflow_id=    workflow_id,
        correlation_id= correlation_id,
        newest_first=   True,
    )
    total = sp_client.count_project(
        user_id=user.id, project_id=project_id,
    )
    return envelope_ok(
        data={
            "entries":  [e.to_dict() for e in entries],
            "kinds":    list(SCRATCHPAD_KINDS),
        },
        endpoint=f"/v2/projects/{project_id}/scratchpad",
        user_id=user.id,
        count=len(entries), total=total,
        limit=limit, offset=offset,
    )


@router.get("/scratchpad/{entry_id}")
def get_entry(
    entry_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    entry = sp_client.get(entry_id, user_id=user.id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "SCRATCHPAD_NOT_FOUND", "id": entry_id},
        )
    return envelope_ok(
        data={"entry": entry.to_dict()},
        endpoint=f"/v2/scratchpad/{entry_id}",
        user_id=user.id,
    )


__all__ = ["router"]
