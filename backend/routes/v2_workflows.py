# coding: utf-8
"""/v2/workflows + /v2/projects/{id}/workflows — Phase 8 workflows."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import err as envelope_err
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.workflows import client as wf_client
from backend.services.workflows.client import client as workflows_client
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


# ── Phase A.1 — Workflow DAG Runner entry point ───────────────────────────
#
# Single new route in this PR. Returns v2 envelope shape via
# JSONResponse (NOT HTTPException) so the body matches the
# success/error envelope contract every /v2/* consumer already
# expects. Mirrors the /v2/auth/register pattern shipped in PR #176.

def _envelope_error_response(
    status_code: int, code: str, message: str, endpoint: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=envelope_err(message, code=code, endpoint=endpoint),
    )


@router.post("/workflows/{workflow_id}/run")
async def run_workflow_route(
    workflow_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
):
    """Start a DAG-runner driver for an existing workflow.

    Gated by `ENABLE_WORKFLOW_RUNNER` — independent of the
    `ENABLE_WORKFLOWS` flag that gates the CRUD routes above. The
    runner is a sub-capability that ships to production behind its
    OWN flag so we can defer its activation until production
    verification of Phase A.1 is complete.
    """
    # Defer to the runner module entirely — the route is a thin v2
    # envelope adapter over its exceptions.
    from backend.services.workflows import runner as wf_runner
    from backend.services.workflows.steps import StepsParseError

    if not wf_runner.is_enabled():
        return _envelope_error_response(
            503, "workflow_runner_disabled",
            "Workflow runner is disabled. "
            "Set ENABLE_WORKFLOW_RUNNER=true to activate.",
            f"/v2/workflows/{workflow_id}/run",
        )
    # The CRUD routes above gate on ENABLE_WORKFLOWS; mirror that
    # here so a half-enabled deployment (runner on, workflows off)
    # produces a sensible error instead of a hidden 500.
    if not workflows_client.is_enabled():
        return _envelope_error_response(
            503, "workflows_disabled",
            "Workflows are disabled. Set ENABLE_WORKFLOWS=true.",
            f"/v2/workflows/{workflow_id}/run",
        )
    try:
        snapshot = await workflows_client.start_run(workflow_id, user_id=user.id)
    except wf_runner.WorkflowNotFound:
        return _envelope_error_response(
            404, "workflow_not_found",
            "Workflow not found.",
            f"/v2/workflows/{workflow_id}/run",
        )
    except wf_runner.WorkflowAlreadyTerminalError as exc:
        return _envelope_error_response(
            409, "workflow_already_terminal",
            str(exc),
            f"/v2/workflows/{workflow_id}/run",
        )
    except wf_runner.WorkflowAlreadyRunningError as exc:
        return _envelope_error_response(
            409, "workflow_already_running",
            str(exc),
            f"/v2/workflows/{workflow_id}/run",
        )
    except StepsParseError as exc:
        return _envelope_error_response(
            400, "workflow_steps_invalid",
            str(exc),
            f"/v2/workflows/{workflow_id}/run",
        )
    return envelope_ok(
        data=snapshot,
        endpoint=f"/v2/workflows/{workflow_id}/run",
        user_id=user.id,
    )


__all__ = ["router"]
