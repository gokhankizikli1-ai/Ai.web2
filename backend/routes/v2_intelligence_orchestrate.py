# coding: utf-8
"""
Sprint 1.4 — Blueprint → Orchestrator HTTP surface.

POST /v2/intelligence/orchestrate
    Turn a natural-language prompt into a ProductPlan, adapt its blueprint to
    an orchestrator-ready request, and either DRY-RUN it (default — pure
    planning, no jobs/LLM) or EXECUTE it (gated, real orchestrator run).

Identity comes from the authenticated context (Sprint 1.2 principal) — never
from the request body. Cross-user project access is blocked. The whole route
is gated by ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE (default off → 503).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.config import settings

router = APIRouter(prefix="/v2/intelligence", tags=["intelligence"])
logger = logging.getLogger(__name__)


def _ensure_enabled() -> None:
    if not settings.ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "blueprint_bridge_disabled",
                "message": "Blueprint→Orchestrator bridge is disabled. "
                           "Set ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE=true.",
                "rollback": "Unset ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE (or 'false').",
            },
        )


class OrchestrateBody(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    project_id: Optional[str] = Field(None, max_length=128)
    dry_run: bool = True
    execute: bool = False
    metadata: Optional[Dict[str, Any]] = None


def _feature_flags() -> Dict[str, bool]:
    def f(name: str) -> bool:
        return os.getenv(name, "false").strip().lower() == "true"
    return {
        "ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE": settings.ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE,
        "ENABLE_PRODUCT_INTELLIGENCE": f("ENABLE_PRODUCT_INTELLIGENCE"),
        "ENABLE_PROJECT_ORCHESTRATOR": f("ENABLE_PROJECT_ORCHESTRATOR"),
        "ENABLE_WORKFLOWS": f("ENABLE_WORKFLOWS"),
        "ENABLE_WORKFLOW_RUNNER": f("ENABLE_WORKFLOW_RUNNER"),
        "ENABLE_JOB_QUEUE": f("ENABLE_JOB_QUEUE"),
    }


def _enforce_project_ownership(request: Request, project_id: str, principal) -> None:
    """Block cross-user project access. Only meaningful when ENABLE_PROJECTS
    is on (otherwise project_id is an opaque namespace tag)."""
    if os.getenv("ENABLE_PROJECTS", "false").strip().lower() != "true":
        return
    try:
        from backend.services.projects import get_project
        p = get_project(project_id)
    except Exception:  # pragma: no cover — defensive
        p = None
    if p is None:
        return  # unknown project → treated as a new namespace tag
    owner = str(getattr(p, "owner_user_id", "") or "")
    if principal.is_owner:
        return
    if owner and owner != str(principal.user_id):
        raise HTTPException(status_code=404, detail={"error": "project_not_found"})


@router.get("/orchestrate/health")
def orchestrate_health() -> dict:
    """Always callable — reports the bridge flag + execution prerequisites."""
    flags = _feature_flags()
    missing: list = []
    try:
        from backend.services.blueprint_bridge import execution_prerequisites
        missing = execution_prerequisites()
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("bridge health: prerequisites unavailable: %s", exc)
        missing = ["execution_prerequisites_unavailable"]
    return {
        "enabled": flags["ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE"],
        "phase": "1.4 — blueprint→orchestrator bridge",
        "feature_flags": flags,
        "execution_ready": not missing,
        "missing_prerequisites": missing,
    }


@router.post("/orchestrate")
async def orchestrate(body: OrchestrateBody, request: Request) -> dict:
    _ensure_enabled()

    # Identity from authenticated context (Sprint 1.2) — never body.user_id.
    from backend.core.principal import resolve_principal
    principal = resolve_principal(request)

    if body.project_id:
        _enforce_project_ownership(request, body.project_id, principal)

    from backend.services.blueprint_bridge import (
        plan_to_orchestration, dry_run as _dry_run, execute as _execute,
    )

    plan, orch_request = plan_to_orchestration(
        body.prompt, project_id=body.project_id, metadata=body.metadata,
    )

    # Safe by default: execute ONLY when the caller explicitly asks
    # (execute=true) AND disables dry_run. Otherwise we dry-run.
    do_execute = bool(body.execute) and not bool(body.dry_run)

    out: dict = {
        "plan": plan.to_dict(),
        "blueprint": plan.blueprint.to_dict(),
        "orchestration_request": orch_request.to_dict(),
        "feature_flags": _feature_flags(),
    }

    if do_execute:
        result = await _execute(orch_request, user_id=principal.user_id)
        out["execution"] = result.to_dict()
        out["disabled_prerequisites"] = result.disabled_prerequisites
        out["mode"] = "execute"
    else:
        dr = _dry_run(orch_request)
        out["dry_run"] = dr.to_dict()
        out["disabled_prerequisites"] = dr.missing_prerequisites
        out["mode"] = "dry_run"

    return out


__all__ = ["router"]
