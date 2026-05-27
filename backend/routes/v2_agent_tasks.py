# coding: utf-8
"""/v2/agents/{id}/tasks + /v2/projects/{id}/agent-activity — Phase 8."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.agent_tasks import client as at_client
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["agent-tasks-v2"])


def _ensure_enabled() -> None:
    if not os.getenv("ENABLE_AGENT_ORCHESTRATION", "false").strip().lower() == "true":
        raise HTTPException(
            status_code=503,
            detail={"code": "AGENT_ORCHESTRATION_DISABLED",
                    "message": "Agent orchestration is disabled. Set ENABLE_AGENT_ORCHESTRATION=true.",
                    "rollback": "Unset ENABLE_AGENT_ORCHESTRATION to disable."},
        )


class CreateTaskBody(BaseModel):
    task_description: str = Field(..., min_length=2, max_length=4000)
    project_id:       Optional[str] = Field(None, max_length=64)
    parent_job_id:    Optional[str] = Field(None, max_length=128)
    payload:          Optional[Dict[str, Any]] = None
    summary:          Optional[str] = Field(None, max_length=400)
    metadata:         Optional[Dict[str, Any]] = None


@router.post("/agents/{agent_id}/tasks")
def create_agent_task(
    agent_id: str = Path(..., max_length=128),
    body: CreateTaskBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = at_client.create(
        user_id=           user.id,
        assigned_agent_id= agent_id,
        task_description=  body.task_description,
        project_id=        body.project_id,
        parent_job_id=     body.parent_job_id,
        payload=           body.payload,
        summary=           body.summary,
        metadata=          body.metadata,
    )
    if rec is None:
        raise HTTPException(status_code=503,
                            detail={"code": "AGENT_ORCHESTRATION_DISABLED",
                                    "message": "Agent orchestration disabled"})
    return envelope_ok(data={"task": rec.to_dict()},
                       endpoint=f"/v2/agents/{agent_id}/tasks",
                       user_id=user.id)


@router.get("/agents/tasks/{task_id}")
def get_agent_task(
    task_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = at_client.get(task_id, user_id=user.id)
    if rec is None:
        raise HTTPException(status_code=404,
                            detail={"code": "AGENT_TASK_NOT_FOUND",
                                    "message": "task not found"})
    return envelope_ok(data={"task": rec.to_dict()},
                       endpoint=f"/v2/agents/tasks/{task_id}",
                       user_id=user.id)


@router.get("/projects/{project_id}/agent-activity")
def list_project_agent_activity(
    project_id: str = Path(..., max_length=64),
    limit:  int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    items = at_client.list_user(user.id, project_id=project_id,
                                  limit=limit, offset=offset)
    return envelope_ok(
        data={"tasks": [t.to_dict() for t in items]},
        endpoint=f"/v2/projects/{project_id}/agent-activity",
        user_id=user.id, count=len(items), limit=limit, offset=offset,
    )


__all__ = ["router"]
