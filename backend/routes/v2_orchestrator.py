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

from backend.core.deps import current_user
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


@router.post("/run")
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
    except orch.UnknownTemplateError as exc:
        return _err(404, "project_template_unknown",
                    f"Unknown template: {exc}", endpoint)
    except Exception as exc:  # pragma: no cover — never leak a traceback
        logger.exception("orchestrator | start_run crashed")
        return _err(500, "orchestrator_run_failed",
                    f"{type(exc).__name__}: {exc}", endpoint)

    return envelope_ok(data=snapshot, endpoint=endpoint, user_id=user.id)


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
