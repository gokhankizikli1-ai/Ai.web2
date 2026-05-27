# coding: utf-8
"""/v2/panels — Phase 9 part 2.

Panel CRUD-ish surface. Gated by ENABLE_REAL_COORDINATION; 503 when
off. Ownership enforced via the (user_id, panel_id) store WHERE.

Also exposes panel message history (the AgentMessenger's persistent
log). Posting messages is an in-process action by the coordinator /
agents themselves — no public route for that today; the route is
read-only to keep the attack surface narrow.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.agent_messenger import client as msg_client
from backend.services.auth.identity import User
from backend.services.panels import client as panel_client
from backend.services.panels.types import PANEL_STATUSES


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["panels-v2"])


def _ensure_enabled() -> None:
    if not panel_client.is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "REAL_COORDINATION_DISABLED",
                "message":  "Panel coordination is disabled. Set ENABLE_REAL_COORDINATION=true.",
                "rollback": "Unset ENABLE_REAL_COORDINATION to disable.",
            },
        )


# ── Bodies ────────────────────────────────────────────────────────────────

class CreatePanelBody(BaseModel):
    title:              str = Field(..., min_length=1, max_length=200)
    project_id:         Optional[str] = Field(None, max_length=64)
    parent_panel_id:    Optional[str] = Field(None, max_length=128)
    chat_id:            Optional[str] = Field(None, max_length=128)
    coordinator_intent: Optional[str] = Field(None, max_length=64)
    metadata:           Optional[Dict[str, Any]] = None


class UpdateStatusBody(BaseModel):
    status: str = Field(..., max_length=32)


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("/panels")
def create_panel(
    body: CreatePanelBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = panel_client.create(
        user_id=            user.id,
        title=              body.title,
        project_id=         body.project_id,
        parent_panel_id=    body.parent_panel_id,
        chat_id=            body.chat_id,
        coordinator_intent= body.coordinator_intent,
        metadata=           body.metadata,
    )
    if rec is None:
        raise HTTPException(
            status_code=503,
            detail={"code": "PANEL_CREATE_FAILED",
                    "message": "Could not create panel — check backend logs."},
        )
    # Bus publish so SSE subscribers learn about new panels.
    try:
        from backend.services.events import bus as _bus
        from backend.services.events.types import ActivityEvent
        _bus.publish(ActivityEvent(
            kind="panel.created",
            scope=f"user:{user.id}",
            payload={"panel_id": rec.id, "title": rec.title,
                     "project_id": rec.project_id,
                     "intent": rec.coordinator_intent},
        ))
    except Exception:
        pass
    return envelope_ok(
        data={"panel": rec.to_dict()},
        endpoint="/v2/panels",
        user_id=user.id,
    )


@router.get("/panels/{panel_id}")
def get_panel(
    panel_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = panel_client.get(panel_id, user_id=user.id)
    if rec is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "PANEL_NOT_FOUND", "id": panel_id},
        )
    return envelope_ok(
        data={"panel": rec.to_dict()},
        endpoint=f"/v2/panels/{panel_id}",
        user_id=user.id,
    )


@router.get("/panels")
def list_user_panels(
    project_id: Optional[str] = Query(None, max_length=64),
    status:     Optional[str] = Query(None, max_length=32),
    limit:      int = Query(50, ge=1, le=200),
    offset:     int = Query(0, ge=0),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    recs = panel_client.list_user(
        user_id=user.id, project_id=project_id, status=status,
        limit=limit, offset=offset,
    )
    return envelope_ok(
        data={"panels": [r.to_dict() for r in recs],
              "statuses": list(PANEL_STATUSES)},
        endpoint="/v2/panels",
        user_id=user.id,
        count=len(recs), limit=limit, offset=offset,
    )


@router.post("/panels/{panel_id}/status")
def update_panel_status(
    panel_id: str = Path(..., max_length=128),
    body: UpdateStatusBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Coordinator-driven status transition. The store enforces the
    terminal-lock rule (a completed panel cannot move back to active)."""
    _ensure_enabled()
    rec = panel_client.mark_status(
        panel_id, user_id=user.id, status=body.status,
    )
    if rec is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "PANEL_NOT_FOUND", "id": panel_id},
        )
    try:
        from backend.services.events import bus as _bus
        from backend.services.events.types import ActivityEvent
        _bus.publish(ActivityEvent(
            kind="panel.status_changed",
            scope=f"panel:{panel_id}",
            payload={"panel_id": panel_id, "status": rec.status},
        ))
    except Exception:
        pass
    return envelope_ok(
        data={"panel": rec.to_dict()},
        endpoint=f"/v2/panels/{panel_id}/status",
        user_id=user.id,
    )


# ── Agent message history (read-only public surface) ──────────────────────

@router.get("/panels/{panel_id}/messages")
def list_panel_messages(
    panel_id:     str = Path(..., max_length=128),
    limit:        int = Query(100, ge=1, le=500),
    offset:       int = Query(0, ge=0),
    newest_first: bool = Query(False),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Read-only history of typed agent-to-agent messages on this
    panel. Default ordering is oldest first (reads naturally
    top-to-bottom in the FE workspace)."""
    _ensure_enabled()
    # Implicit ownership check — list_panel requires user_id.
    msgs = msg_client.list_panel(
        panel_id=panel_id, user_id=user.id,
        limit=limit, offset=offset,
        newest_first=newest_first,
    )
    return envelope_ok(
        data={"messages": [m.to_dict() for m in msgs]},
        endpoint=f"/v2/panels/{panel_id}/messages",
        user_id=user.id,
        count=len(msgs), limit=limit, offset=offset,
    )


__all__ = ["router"]
