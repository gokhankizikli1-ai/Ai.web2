# coding: utf-8
"""/v2/workflows + /v2/projects/{id}/workflows — Phase 8 workflows."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.workflows import client as wf_client
from backend.services.workflows.types import WORKFLOW_TYPES


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["workflows-v2"])


def _ensure_enabled() -> None:
    if not os.getenv("ENABLE_WORKFLOWS", "false").strip().lower() == "true":
        raise HTTPException(
            status_code=503,
            detail={"code": "WORKFLOWS_DISABLED",
                    "message": "Workflows are disabled. Set ENABLE_WORKFLOWS=true.",
                    "rollback": "Unset ENABLE_WORKFLOWS to disable."},
        )


class CreateBody(BaseModel):
    type:       str = Field(..., max_length=32)
    project_id: Optional[str] = Field(None, max_length=64)
    steps:      Optional[List[str]] = None
    payload:    Optional[Dict[str, Any]] = None
    metadata:   Optional[Dict[str, Any]] = None


@router.post("/workflows")
def create_workflow(body: CreateBody, user: User = Depends(current_user)) -> Dict[str, Any]:
    _ensure_enabled()
    if body.type not in WORKFLOW_TYPES:
        raise HTTPException(
            status_code=400,
            detail={"code": "WORKFLOW_TYPE_UNKNOWN",
                    "message": f"unknown workflow type {body.type!r}",
                    "available": list(WORKFLOW_TYPES)},
        )
    rec = wf_client.create(
        user_id=user.id, type=body.type,
        project_id=body.project_id, steps=body.steps,
        payload=body.payload, metadata=body.metadata,
    )
    if rec is None:
        raise HTTPException(status_code=503,
                            detail={"code": "WORKFLOWS_DISABLED",
                                    "message": "Workflows disabled"})
    return envelope_ok(data={"workflow": rec.to_dict()},
                       endpoint="/v2/workflows", user_id=user.id)


@router.get("/workflows/{workflow_id}")
def get_workflow(
    workflow_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = wf_client.get(workflow_id, user_id=user.id)
    if rec is None:
        raise HTTPException(status_code=404,
                            detail={"code": "WORKFLOW_NOT_FOUND",
                                    "message": "workflow not found"})
    return envelope_ok(data={"workflow": rec.to_dict()},
                       endpoint=f"/v2/workflows/{workflow_id}",
                       user_id=user.id)


@router.get("/projects/{project_id}/workflows")
def list_project_workflows(
    project_id: str = Path(..., max_length=64),
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    items = wf_client.list_user(user.id, project_id=project_id,
                                 limit=limit, offset=offset)
    return envelope_ok(
        data={"workflows": [w.to_dict() for w in items]},
        endpoint=f"/v2/projects/{project_id}/workflows",
        user_id=user.id, count=len(items), limit=limit, offset=offset,
    )


@router.post("/workflows/{workflow_id}/cancel")
def cancel_workflow(
    workflow_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = wf_client.cancel(workflow_id, user_id=user.id)
    if rec is None:
        raise HTTPException(status_code=404,
                            detail={"code": "WORKFLOW_NOT_FOUND",
                                    "message": "workflow not found"})
    return envelope_ok(data={"workflow": rec.to_dict()},
                       endpoint=f"/v2/workflows/{workflow_id}/cancel",
                       user_id=user.id)


__all__ = ["router"]
