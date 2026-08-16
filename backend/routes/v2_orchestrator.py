# coding: utf-8
"""/v2/orchestrator/* — Phase A.2 Project Orchestrator.

The conductor's HTTP surface. Distinct from the Phase-3.4
`/v2/orchestrate` route (single supervisor run) — this one fans a
single request out into a tracked multi-agent PROJECT run (panel +
deliverables + task graph + workflow) and drives it via the Phase-A.1
DAG runner.

Gated by `ENABLE_PROJECT_ORCHESTRATOR` (default false). The run path
also needs `ENABLE_WORKFLOWS` + `ENABLE_WORKFLOW_RUNNER` +
`ENABLE_JOB_QUEUE` to actually execute; `GET /health` surfaces all of
them so a half-enabled deployment is diagnosable instead of silently
stuck.

Routes return the v2 envelope (`backend.core.responses.ok/err`).
Errors are emitted as JSONResponse envelopes (not HTTPException) so the
body matches the success/error contract every /v2 consumer expects —
mirrors the v2_workflows runner route shipped in PR #1.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.core.deps import current_user, require_verified_identity
from backend.core.responses import err as envelope_err
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User

# Import the job-kind module at route load so `agent.run` is registered
# as soon as the app builds (its ensure_registered() runs on import).
from backend.services.orchestrator import agent_run_kind  # noqa: F401
from backend.services.orchestrator import service as orch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/orchestrator", tags=["project-orchestrator"])


_TERMINAL_STATUSES = frozenset({
    "completed", "failed", "cancelled", "finished", "errored",
})


def _err(status_code: int, code: str, message: str, endpoint: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=envelope_err(message, code=code, endpoint=endpoint),
    )


def _disabled_response(endpoint: str) -> JSONResponse:
    return _err(
        503, "project_orchestrator_disabled",
        "Project orchestrator is disabled. "
        "Set ENABLE_PROJECT_ORCHESTRATOR=true to activate.",
        endpoint,
    )


# ── Models ────────────────────────────────────────────────────────────

class RunBody(BaseModel):
    user_request: str = Field(..., min_length=1, max_length=8_000)
    project_id:   Optional[str] = Field(None, max_length=64)
    template_id:  Optional[str] = Field(None, max_length=64)
    metadata:     Optional[Dict[str, Any]] = None


# ── Health (always callable) ─────────────────────────────────────────

@router.get("/health")
def orchestrator_health() -> Dict[str, Any]:
    stats: Dict[str, Any] = {}
    try:
        from backend.services.orchestrator import runs_stats, deliverables_stats
        from backend.services.orchestrator import tasks_stats
        stats = {
            "runs":         runs_stats(),
            "tasks":        tasks_stats(),
            "deliverables": deliverables_stats(),
        }
    except Exception as exc:  # pragma: no cover — defensive
        stats = {"error": str(exc)}
    return {
        "enabled": orch.is_enabled(),
        "phase":   "A.2 — project orchestrator (conductor)",
        "flags":   orch.flags_snapshot(),
        "stats":   stats,
    }


# ── Templates ─────────────────────────────────────────────────────────

@router.get("/templates")
def list_templates_route() -> Any:
    if not orch.is_enabled():
        return _disabled_response("/v2/orchestrator/templates")
    from backend.services.orchestrator import templates as tmpl
    items = [t.to_dict() for t in tmpl.list_templates()]
    return envelope_ok(data={"templates": items},
                       endpoint="/v2/orchestrator/templates",
                       count=len(items))


# ── Start a run ───────────────────────────────────────────────────────

def _project_owned_by(project_id: str, user_id: str) -> bool:
    """Ownership check used only when ENABLE_PROJECTS is on. When
    projects are off there is no ownership model to enforce, so we
    allow the project_id through as an opaque namespace tag."""
    if os.getenv("ENABLE_PROJECTS", "false").strip().lower() != "true":
        return True
    try:
        from backend.services.projects.store import get_project
        proj = get_project(project_id)
        return proj is not None and proj.owner_user_id == str(user_id)
    except Exception:
        return False


@router.post("/run", dependencies=[Depends(require_verified_identity)])
async def start_run_route(
    body: RunBody, request: Request, user: User = Depends(current_user),
) -> Any:
    endpoint = "/v2/orchestrator/run"
    if not orch.is_enabled():
        return _disabled_response(endpoint)

    if body.project_id and not _project_owned_by(body.project_id, user.id):
        return _err(404, "project_not_found",
                    "Project not found.", endpoint)

    try:
        snapshot = await orch.start_project_run(
            user_id=user.id,
            user_request=body.user_request,
            project_id=body.project_id,
            template_id=body.template_id,
            metadata=body.metadata,
        )
    except orch.ProjectOrchestratorDisabled:
        return _disabled_response(endpoint)
    except orch.UnsupportedRequestError as exc:
        return _err(422, "unsupported_request", str(exc), endpoint)
    except orch.UnknownTemplateError as exc:
        return _err(404, "project_template_unknown",
                    f"Unknown template: {exc}", endpoint)
    except Exception as exc:  # pragma: no cover — never leak a traceback
        logger.exception("orchestrator | start_run crashed")
        return _err(500, "orchestrator_run_failed",
                    f"{type(exc).__name__}: {exc}", endpoint)

    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


# ── List a project's runs (the permanent conversation) ───────────────

@router.get("/runs")
def list_runs_route(
    project_id: str = Query(..., max_length=64),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
) -> Any:
    endpoint = "/v2/orchestrator/runs"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    turns = orch.list_project_runs(
        user_id=user.id, project_id=project_id, limit=limit,
    )
    return envelope_ok(data={"runs": turns}, endpoint=endpoint,
                       user_id=user.id, count=len(turns))


# ── Read a run ────────────────────────────────────────────────────────

@router.get("/runs/{run_id}")
def get_run_route(
    run_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    endpoint = f"/v2/orchestrator/runs/{run_id}"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    snapshot = orch.get_run_snapshot(run_id, user_id=user.id)
    if snapshot is None:
        return _err(404, "orchestrator_run_not_found",
                    "Run not found.", endpoint)
    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


@router.post("/runs/{run_id}/cancel")
def cancel_run_route(
    run_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    endpoint = f"/v2/orchestrator/runs/{run_id}/cancel"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    snapshot = orch.cancel_run(run_id, user_id=user.id)
    if snapshot is None:
        return _err(404, "orchestrator_run_not_found",
                    "Run not found.", endpoint)
    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


class ApproveBody(BaseModel):
    capability: str = Field(..., max_length=64)
    fingerprint: str = Field(..., max_length=128)


@router.post("/runs/{run_id}/approve",
             dependencies=[Depends(require_verified_identity)])
async def approve_run_route(
    body: ApproveBody,
    run_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    """Approve a paused (awaiting_approval) operation and resume the run.
    Fingerprint-bound + ownership-checked; idempotent."""
    endpoint = f"/v2/orchestrator/runs/{run_id}/approve"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    snapshot = await orch.approve_operation(
        run_id, user_id=user.id, capability=body.capability,
        fingerprint=body.fingerprint,
    )
    if snapshot is None:
        return _err(404, "orchestrator_run_not_found", "Run not found.", endpoint)
    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


class PlanRunBody(BaseModel):
    user_request: str = Field(..., max_length=8000)
    project_id: Optional[str] = Field(default=None, max_length=64)
    plan_id: Optional[str] = Field(default=None, max_length=64)


@router.post("/plan", dependencies=[Depends(require_verified_identity)])
async def start_planned_run_route(
    body: PlanRunBody,
    user: User = Depends(current_user),
) -> Any:
    """Start a PLANNER-driven project run: the long-horizon planner's capability
    DAG (not a static template) becomes the workflow. Paid build steps pause at
    the approval gate."""
    endpoint = "/v2/orchestrator/plan"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    try:
        snapshot = await orch.start_planned_project_run(
            user_id=user.id, user_request=body.user_request,
            project_id=body.project_id, plan_id=body.plan_id,
        )
    except orch.ProjectOrchestratorDisabled:
        return _disabled_response(endpoint)
    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


@router.get("/runs/{run_id}/assessment")
def run_assessment_route(
    run_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    """Deterministic supervisor assessment of a run: ready/blocked/failed/
    completed counts, pending approvals, stale artifacts, and the recommended
    next action. No model call."""
    endpoint = f"/v2/orchestrator/runs/{run_id}/assessment"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    snapshot = orch.get_run_snapshot(run_id, user_id=user.id)
    if snapshot is None:
        return _err(404, "orchestrator_run_not_found", "Run not found.", endpoint)
    from backend.services.orchestrator import project_supervisor
    assessment = project_supervisor.evaluate_run(snapshot)
    return envelope_ok(data=assessment, endpoint=endpoint, user_id=user.id)


@router.post("/projects/{project_id}/assessment")
def project_assessment_route(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    """LIVE Business Brain assessment for a project — "what matters now?".

    This is the production seam that makes connector (Gmail/GitHub) OBSERVATIONS
    influence a real, user-visible recommendation. It runs the EXISTING Business
    Brain authorities and NOTHING else:

      1. `synthesize_candidates` — the OBSERVE→PRIORITIZE promotion step. It
         reads high-importance observations (already ingested by the connectors)
         and records CANDIDATE ACTIONS. Idempotent (dedupes on the observation's
         external id), so repeated calls never amplify a signal.
      2. `assess_business_brain` — ranks those candidates against active goals
         and emits a single recommended next action.

    Strictly a RECOMMENDATION: it creates NO task, NO run, NO decision, and makes
    NO model call. Operational execution health still outranks business actions
    inside `assess_business_brain`. `snapshot=None` (no active run) is valid — a
    connector-driven project with no run is assessed on its business state.

    Ownership is enforced through the canonical `projects` authority (the same
    record the Gmail/GitHub connectors check on connect); a project the caller
    does not own is 404 (existence-hidden), so observations never leak.
    """
    endpoint = f"/v2/orchestrator/projects/{project_id}/assessment"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    try:
        from backend.services.projects import store as projects_store
        project = projects_store.get_project(project_id)
    except Exception:
        project = None
    if project is None or str(project.owner_user_id) != str(user.id):
        return _err(404, "project_not_found", "Project not found.", endpoint)

    from backend.services.orchestrator import (
        candidate_synthesis, project_supervisor,
    )
    try:
        # OBSERVE → PRIORITIZE promotion (inputs only; never executes).
        candidate_synthesis.synthesize_candidates(project_id, str(user.id))
    except Exception as exc:  # pragma: no cover — never block the assessment
        logger.warning("business brain synthesis failed for %s: %s", project_id, exc)
    assessment = project_supervisor.assess_business_brain(
        None, project_id=project_id, user_id=str(user.id),
    )
    return envelope_ok(data=assessment, endpoint=endpoint, user_id=user.id)


@router.get("/projects/{project_id}/products")
def project_products_route(
    project_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    """The generated Web/App products of a project — the canonical, backend
    authoritative list the project workspace + Project Brain surface.

    Reads the EXISTING build/artifact authorities keyed by project_id
    (`deliverables_store` for produced products, `build_execution_store` for
    in-flight/failed executions) and returns bounded REFERENCES only —
    build_type, title, status, artifact/build ref, originating run — never the
    duplicated source tree (the artifact authority owns that). buildType=web|app
    is preserved. Ownership is enforced through the canonical projects record.
    """
    endpoint = f"/v2/orchestrator/projects/{project_id}/products"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    try:
        from backend.services.projects import store as projects_store
        project = projects_store.get_project(project_id)
    except Exception:
        project = None
    if project is None or str(project.owner_user_id) != str(user.id):
        return _err(404, "project_not_found", "Project not found.", endpoint)

    # The ONE project-product projection — shared verbatim with the Project
    # Brain aggregate and the Project Workspace read model, so a new build kind
    # is understood by every surface at once. Both helpers fail soft to [].
    from backend.services.orchestrator import project_products
    products = project_products.list_products(project_id)
    executions = project_products.list_executions(project_id)
    return envelope_ok(
        data={"products": products, "executions": executions},
        endpoint=endpoint, user_id=user.id,
    )


class AttachProductBody(BaseModel):
    build_type:   str = Field("web", max_length=16)          # "web" | "app"
    title:        str = Field("", max_length=200)
    artifact_ref: str = Field("", max_length=512)            # ref, NOT the source tree
    build_ref:    str = Field("", max_length=512)
    source_id:    Optional[str] = Field(None, max_length=128)  # stable build/session id
    thread_id:    Optional[str] = Field(None, max_length=64)   # originating chat


@router.post("/projects/{project_id}/products")
def attach_product_route(
    project_id: str = Path(..., max_length=64),
    body: AttachProductBody = ...,
    user: User = Depends(current_user),
) -> Any:
    """Attach a generated Web/App product to a project — the backend-authoritative
    "Save to Project" write seam.

    Reuses the EXISTING canonical build/artifact authority (`deliverables_store`)
    rather than inventing a second products system: it records a bounded
    REFERENCE (build_type, title, artifact/build ref, originating thread) — never
    the duplicated source tree, which the artifact authority already owns. The
    linkage is server truth, so it survives a localStorage clear and a reopen.

    IDEMPOTENT: the deliverable id is derived from (project_id, stable source key)
    so a repeated Save updates the same row instead of creating duplicates.
    buildType `web|app` is preserved. Ownership is enforced via the canonical
    projects record — a project the caller does not own is 404 (existence-hidden),
    so a product can never be attached to, or read from, another user's project.
    """
    endpoint = f"/v2/orchestrator/projects/{project_id}/products"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    try:
        from backend.services.projects import store as projects_store
        project = projects_store.get_project(project_id)
    except Exception:
        project = None
    if project is None or str(project.owner_user_id) != str(user.id):
        return _err(404, "project_not_found", "Project not found.", endpoint)

    build_type = "app" if str(body.build_type).strip().lower() == "app" else "web"
    kind = "app_build" if build_type == "app" else "web_build"
    source_key = (body.source_id or body.build_ref or body.artifact_ref
                  or (body.title or "product")).strip()[:120]
    deliverable_id = f"savedproduct:{project_id}:{source_key}"
    content = {
        "build_type":   build_type,
        "build_status": "saved",
        "artifact_ref": (body.artifact_ref or "").strip(),
        "build_ref":    (body.build_ref or "").strip(),
        "source_id":    (body.source_id or "").strip(),
        "thread_id":    (body.thread_id or "").strip(),
    }
    from backend.services.orchestrator import deliverables_store as dls
    try:
        existing = dls.get_deliverable(deliverable_id)
        if existing is None:
            dls.create_deliverable(
                run_id=f"saved:{source_key}", agent_id="save_to_project",
                node_id="product", kind=kind, title=(body.title or "").strip(),
                project_id=project_id, status="completed", content=content,
                deliverable_id=deliverable_id,
            )
        else:
            # Idempotent upsert — repeated Save (e.g. after a revision) refreshes
            # the same row, never adds a duplicate.
            dls.set_content(deliverable_id, content, status="completed")
    except Exception as exc:
        logger.warning("attach product failed for %s: %s", project_id, exc)
        return _err(500, "attach_failed", "Could not attach product.", endpoint)
    return envelope_ok(
        data={"deliverable_id": deliverable_id, "build_type": build_type,
              "project_id": project_id, "title": (body.title or "").strip()},
        endpoint=endpoint, user_id=user.id,
    )


@router.post("/runs/{run_id}/reject")
def reject_run_route(
    run_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
) -> Any:
    """Reject a pending operation (cancels the run — a rejected paid
    operation has no other resolution in the current DAG model)."""
    endpoint = f"/v2/orchestrator/runs/{run_id}/reject"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    snapshot = orch.reject_operation(run_id, user_id=user.id)
    if snapshot is None:
        return _err(404, "orchestrator_run_not_found", "Run not found.", endpoint)
    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


# ── SSE stream ────────────────────────────────────────────────────────

def _sse_poll_interval() -> float:
    try:
        v = float(os.getenv("ORCHESTRATOR_SSE_POLL_INTERVAL_SEC", "1.0") or 1.0)
        return max(0.1, min(v, 10.0))
    except Exception:
        return 1.0


def _sse_max_seconds() -> float:
    try:
        v = float(os.getenv("ORCHESTRATOR_SSE_MAX_SECONDS", "300") or 300)
        return max(1.0, min(v, 3600.0))
    except Exception:
        return 300.0


@router.get("/runs/{run_id}/stream")
async def stream_run_route(
    run_id: str = Path(..., max_length=64),
    user: User = Depends(current_user),
):
    """Server-Sent Events stream of a run's snapshot.

    Polling-based (re-reads the composite snapshot each tick and emits
    on change) so it has zero coupling to the event bus and works
    regardless of whether ENABLE_REALTIME_EVENTS is on. Closes when the
    run reaches a terminal state or after ORCHESTRATOR_SSE_MAX_SECONDS.
    """
    endpoint = f"/v2/orchestrator/runs/{run_id}/stream"
    if not orch.is_enabled():
        return _disabled_response(endpoint)
    # Existence + ownership check up front so a 404 is a clean JSON
    # error rather than an empty event stream.
    if orch.get_run_snapshot(run_id, user_id=user.id) is None:
        return _err(404, "orchestrator_run_not_found",
                    "Run not found.", endpoint)

    interval = _sse_poll_interval()
    max_seconds = _sse_max_seconds()
    uid = user.id

    async def _event_gen():
        elapsed = 0.0
        last_signature: Optional[str] = None
        # Emit an initial snapshot immediately.
        while True:
            snap = orch.get_run_snapshot(run_id, user_id=uid)
            if snap is None:
                yield _sse("error", {"code": "orchestrator_run_not_found"})
                return
            signature = _snapshot_signature(snap)
            if signature != last_signature:
                last_signature = signature
                yield _sse("snapshot", snap)
            status = str(snap.get("status") or "")
            if status in _TERMINAL_STATUSES:
                yield _sse("done", {"run_id": run_id, "status": status})
                return
            if elapsed >= max_seconds:
                yield _sse("timeout", {"run_id": run_id, "status": status})
                return
            await asyncio.sleep(interval)
            elapsed += interval

    return StreamingResponse(
        _event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _snapshot_signature(snap: Dict[str, Any]) -> str:
    """Cheap change-detector: overall status + each deliverable's
    (id, status, version) + each task's (id, status). Avoids re-emitting
    an identical snapshot on every poll tick."""
    parts = [str(snap.get("status"))]
    for d in snap.get("deliverables") or []:
        parts.append(f"{d.get('id')}:{d.get('status')}:{d.get('version')}")
    graph = snap.get("task_graph") or {}
    for t in graph.get("tasks") or []:
        parts.append(f"{t.get('id')}:{t.get('status')}")
    wf = snap.get("workflow") or {}
    parts.append(f"wf:{wf.get('status')}:{wf.get('progress')}")
    return "|".join(parts)


__all__ = ["router"]
