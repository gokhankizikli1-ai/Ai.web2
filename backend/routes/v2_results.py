# coding: utf-8
"""
Sprint 1.5 — Deliverable Result / preview API.

GET /v2/orchestrator/runs/{run_id}/result
GET /v2/orchestrator/projects/{project_id}/result

Reads completed orchestrator deliverables and returns a stable, renderer-
agnostic PreviewPayload. Read-only; no execution, no fabrication. Identity
comes from the Sprint 1.2 principal; ownership is enforced by the
orchestrator's get_run_snapshot (cross-user → NOT_FOUND) + a project-ownership
check. Gated by ENABLE_DELIVERABLE_RESULT_API (default off → 503).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from backend.core.config import settings

router = APIRouter(prefix="/v2/orchestrator", tags=["orchestrator", "results"])
logger = logging.getLogger(__name__)


def _ensure_enabled() -> None:
    if not settings.ENABLE_DELIVERABLE_RESULT_API:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "deliverable_result_api_disabled",
                "message": "Deliverable result API is disabled. "
                           "Set ENABLE_DELIVERABLE_RESULT_API=true.",
                "rollback": "Unset ENABLE_DELIVERABLE_RESULT_API (or 'false').",
            },
        )


def _enforce_project_ownership(request: Request, project_id: str, principal) -> None:
    """Block cross-user project access (only meaningful when ENABLE_PROJECTS
    is on; otherwise project_id is an opaque namespace tag)."""
    if os.getenv("ENABLE_PROJECTS", "false").strip().lower() != "true":
        return
    try:
        from backend.services.projects import get_project
        p = get_project(project_id)
    except Exception:  # pragma: no cover — defensive
        p = None
    if p is None:
        return
    owner = str(getattr(p, "owner_user_id", "") or "")
    if principal.is_owner:
        return
    if owner and owner != str(principal.user_id):
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})


def _flags() -> dict:
    return {"ENABLE_DELIVERABLE_RESULT_API": settings.ENABLE_DELIVERABLE_RESULT_API}


@router.get("/results/health")
def results_health() -> dict:
    return {
        "enabled": settings.ENABLE_DELIVERABLE_RESULT_API,
        "phase": "1.5 — deliverable result / preview API",
    }


@router.get("/runs/{run_id}/result")
def get_run_result(
    run_id: str,
    request: Request,
    artifact_type: Optional[str] = None,
    renderer: Optional[str] = None,
    include_partial: bool = False,
) -> dict:
    _ensure_enabled()
    from backend.core.principal import resolve_principal
    from backend.services.deliverable_result import resolve_run_result
    principal = resolve_principal(request)
    payload = resolve_run_result(
        run_id, user_id=principal.user_id,
        artifact_type=artifact_type, renderer=renderer,
        include_partial=include_partial,
    )
    return {"result": payload.to_dict(), "feature_flags": _flags()}


@router.get("/projects/{project_id}/result")
def get_project_result(
    project_id: str,
    request: Request,
    artifact_type: Optional[str] = None,
    renderer: Optional[str] = None,
    latest: bool = True,
    include_partial: bool = False,
) -> dict:
    _ensure_enabled()
    from backend.core.principal import resolve_principal
    from backend.services.deliverable_result import resolve_project_result
    principal = resolve_principal(request)
    _enforce_project_ownership(request, project_id, principal)
    payload = resolve_project_result(
        project_id, user_id=principal.user_id, latest=latest,
        artifact_type=artifact_type, renderer=renderer,
        include_partial=include_partial,
    )
    return {"result": payload.to_dict(), "feature_flags": _flags()}


__all__ = ["router"]
