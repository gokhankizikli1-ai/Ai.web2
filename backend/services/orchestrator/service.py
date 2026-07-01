# coding: utf-8
# Phase A.2 — Project Orchestrator service.
#
# THE CONDUCTOR. Takes a single user request and turns it into a tracked
# multi-agent project run:
#
#   user_request
#     → coordinator plan (or an explicit template_id)
#     → ProjectTemplate (built-in or ad-hoc)
#     → instantiate:  1 panel  +  N deliverables  +  N task-graph rows
#                     +  1 workflow (job steps, kind `agent.run`)
#     → kick the Phase-A.1 workflow DAG runner
#
# Everything it touches already exists — coordinator (Phase 9),
# panels (Phase 9), runs_store + tasks_store + ExecutionGraph
# (Phase 3.4 / 5.1), workflows + DAG runner (Phase A.1), the job queue
# (Phase 7) and the agent runtime (Phase 3.x). This service is the thin
# orchestration LAYER the AI_OS_ROADMAP says is the real gap — it owns
# the lifecycle of a *project run* as one unit. It does NOT re-implement
# any of those subsystems.
#
# Gated by ENABLE_PROJECT_ORCHESTRATOR (default false): zero blast
# radius until the flag is flipped.

from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Errors ────────────────────────────────────────────────────────────

class ProjectOrchestratorDisabled(RuntimeError):
    code = "project_orchestrator_disabled"


class UnknownTemplateError(LookupError):
    code = "project_template_unknown"


class RunNotFoundError(LookupError):
    code = "orchestrator_run_not_found"


class UnsupportedRequestError(ValueError):
    """The request is outside the builder's supported scope (explicit /
    illegal / harmful content). Raised BEFORE template selection so an
    unsupported prompt is never normalised into the closest-matching
    generic template — the frontend shows a polished notice instead."""
    code = "unsupported_request"


# ── Flags ─────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Master gate. Read on every call so a Railway flag flip is live
    without a restart. Default OFF."""
    return os.getenv("ENABLE_PROJECT_ORCHESTRATOR", "false").strip().lower() == "true"


def _flag(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() == "true"


def flags_snapshot() -> Dict[str, bool]:
    """The sub-capability flags a project run depends on. Surfaced in
    the API so an operator can see WHY a run isn't progressing (e.g.
    orchestrator on but job queue off)."""
    return {
        "ENABLE_PROJECT_ORCHESTRATOR": is_enabled(),
        "ENABLE_WORKFLOWS":            _flag("ENABLE_WORKFLOWS"),
        "ENABLE_WORKFLOW_RUNNER":      _flag("ENABLE_WORKFLOW_RUNNER"),
        "ENABLE_JOB_QUEUE":            _flag("ENABLE_JOB_QUEUE"),
        "ENABLE_REAL_COORDINATION":    _flag("ENABLE_REAL_COORDINATION"),
        "ENABLE_COORDINATOR":          _flag("ENABLE_COORDINATOR"),
    }


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _ensure_tables() -> None:
    """Idempotent bring-up of the three projects.db tables this service
    writes to. Cheap; safe to call on every run."""
    from backend.services.orchestrator.runs_store import init_runs_table
    from backend.services.orchestrator.tasks_store import init_tasks_table
    from backend.services.orchestrator.deliverables_store import (
        init_deliverables_table,
    )
    init_runs_table()
    init_tasks_table()
    init_deliverables_table()


# ── Template resolution ───────────────────────────────────────────────

def _resolve_template(template_id: Optional[str], user_request: str):
    """Explicit template_id wins; otherwise ask the coordinator for a
    plan and map it to a template (built-in or ad-hoc)."""
    from backend.services.orchestrator import templates as tmpl

    if template_id:
        t = tmpl.get_template(template_id)
        if t is None:
            raise UnknownTemplateError(template_id)
        return t

    plan = None
    try:
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(user_message=user_request)
    except Exception as exc:  # pragma: no cover — coordinator is stateless + safe
        logger.debug("orchestrator | coordinator.analyze soft-failed: %s", exc)
    return tmpl.choose_template(user_request, plan)


# Sprint 1.9 — a small, JSON-serializable product-context hint forwarded to
# HTML generation. The orchestrator does NOT import or know about any
# upstream planning package — it only recognises a few well-known field
# names if a caller's `metadata` happens to carry them (an upstream layer
# may attach product context here; the orchestrator stays decoupled from
# whatever that layer is). A plain run with no such fields yields None,
# identical to before this sprint. Never raises.
_PRODUCT_CONTEXT_FIELDS = (
    "workspace", "product_category", "audience", "complexity",
    "recommended_renderer", "core_features",
)


def _blueprint_hint(metadata: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    try:
        if not metadata:
            return None
        hint = {k: metadata.get(k) for k in _PRODUCT_CONTEXT_FIELDS if metadata.get(k)}
        return hint or None
    except Exception:  # pragma: no cover — defensive, never blocks a run
        return None


# ── Start a run ───────────────────────────────────────────────────────

async def start_project_run(
    *,
    user_id: str,
    user_request: str,
    project_id: Optional[str] = None,
    template_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Instantiate + kick off a project run. Returns a snapshot dict.

    Raises:
      ProjectOrchestratorDisabled — flag off
      UnknownTemplateError        — bad template_id
    """
    if not is_enabled():
        raise ProjectOrchestratorDisabled(
            "Project orchestrator is disabled. "
            "Set ENABLE_PROJECT_ORCHESTRATOR=true."
        )

    # Build-scope content policy — BEFORE template selection, so an
    # unsupported prompt is never converted into a random dashboard/app.
    try:
        from backend.services.generation.content_policy import unsupported_reason
        reason = unsupported_reason(user_request)
    except Exception:  # pragma: no cover — a broken policy module never blocks legit runs
        reason = None
    if reason:
        raise UnsupportedRequestError(
            f"Korvix can't build this — {reason} is outside the supported "
            "builder scope. Try a product idea instead: a storefront, a SaaS "
            "dashboard, a portfolio, a landing page."
        )

    _ensure_tables()
    # Make sure the `agent.run` job kind is registered even if the
    # registry was reset (tests) or this is the first touch.
    try:
        from backend.services.orchestrator.agent_run_kind import ensure_registered
        ensure_registered()
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator | agent.run registration failed: %s", exc)

    template = _resolve_template(template_id, user_request)
    template.validate()

    run_id = _new_id()

    # Per-node id maps. step_id wires the workflow DAG; task_id wires the
    # Phase-5.1 execution graph; deliverable_id wires the registry. They
    # are distinct ids in distinct tables, joined by node key.
    step_id:        Dict[str, str] = {n.key: _new_id() for n in template.nodes}
    task_id:        Dict[str, str] = {n.key: _new_id() for n in template.nodes}
    deliverable_id: Dict[str, str] = {n.key: _new_id() for n in template.nodes}

    # ── 1. Panel (best effort; no-op when ENABLE_REAL_COORDINATION off)
    panel_id: Optional[str] = None
    try:
        from backend.services.panels.client import client as panels_client
        title = f"Project: {(user_request or template.name)[:60]}"
        panel = panels_client.create(
            user_id=user_id, title=title, project_id=project_id,
            coordinator_intent=template.id,
            metadata={"run_id": run_id, "template_id": template.id},
        )
        panel_id = panel.id if panel is not None else None
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("orchestrator | panel create soft-failed: %s", exc)

    # ── 2. Deliverables scaffold (one per node, status=pending) ──────
    from backend.services.orchestrator import deliverables_store as dstore
    for n in template.nodes:
        dstore.create_deliverable(
            deliverable_id=deliverable_id[n.key],
            run_id=run_id, project_id=project_id,
            agent_id=n.agent_id, node_id=n.key,
            kind=n.deliverable_kind, title=n.title,
            metadata={"step_id": step_id[n.key], "task_id": task_id[n.key]},
        )

    # ── 3. Task-graph rows (Phase 5.1 execution graph) ───────────────
    from backend.services.orchestrator import tasks_store as tstore
    for n in template.nodes:
        tstore.create_task(
            task_id=task_id[n.key], run_id=run_id, project_id=project_id,
            title=n.title, assigned_agent=n.agent_id,
            dependencies=[task_id[d] for d in n.depends_on if d in task_id],
            metadata={
                "node_key":       n.key,
                "deliverable_id": deliverable_id[n.key],
                "step_id":        step_id[n.key],
            },
        )

    # ── 4. Workflow of `agent.run` job steps ─────────────────────────
    blueprint_hint = _blueprint_hint(metadata)
    workflow_id: Optional[str] = None
    steps_payload: List[dict] = []
    for n in template.nodes:
        steps_payload.append({
            "id":           step_id[n.key],
            "label":        n.title,
            "kind":         "job",
            "status":       "pending",
            "dependencies": [step_id[d] for d in n.depends_on if d in step_id],
            "payload": {
                "kind": "agent.run",
                "input": {
                    "assigned_agent_id": n.agent_id,
                    "task_description":  n.task_instructions,
                    "run_id":            run_id,
                    "node_id":           n.key,
                    "deliverable_id":    deliverable_id[n.key],
                    "task_id":           task_id[n.key],
                    "project_id":        project_id,
                    "user_request":      (user_request or "")[:4000],
                    # M2 — let the agent.run handler type the artifact.
                    "deliverable_kind":  n.deliverable_kind,
                    "node_title":        n.title,
                    # Sprint 1.9 — carry the ProductBlueprint summary (when
                    # this run was started via the blueprint bridge) so HTML
                    # generation can use it instead of re-guessing from raw
                    # text alone. None for plain orchestrator runs.
                    "blueprint":         blueprint_hint,
                },
            },
        })

    try:
        from backend.services.workflows import client as wf_client
        wf = wf_client.create(
            user_id=user_id, type=template.workflow_type,
            project_id=project_id, steps=None,
            metadata={"run_id": run_id, "template_id": template.id},
        )
        if wf is not None and wf.id:
            from backend.services.workflows import store as wf_store
            wf_store.update_steps(wf.id, steps=steps_payload)
            workflow_id = wf.id
    except Exception as exc:
        logger.warning("orchestrator | workflow create failed: %s", exc)

    # ── 5. Run row (carries the ids the snapshot needs to re-assemble)
    from backend.services.orchestrator.runs_store import create_run
    create_run(
        run_id=run_id, user_id=user_id, project_id=project_id,
        agent_id=template.lead_agent_id,
        metadata={
            "kind":                  "project_run",
            "template_id":           template.id,
            "template_name":         template.name,
            "requested_template_id": template_id,
            "user_request":          (user_request or "")[:1000],
            "panel_id":              panel_id,
            "workflow_id":           workflow_id,
            "node_count":            len(template.nodes),
            **(metadata or {}),
        },
    )

    # ── 6. Kick the DAG runner ───────────────────────────────────────
    runner_started = False
    runner_error: Optional[str] = None
    if workflow_id:
        try:
            from backend.services.workflows import runner as wf_runner
            if wf_runner.is_enabled():
                from backend.services.workflows import client as wf_client
                await wf_client.start_run(workflow_id, user_id=user_id)
                runner_started = True
            else:
                runner_error = "ENABLE_WORKFLOW_RUNNER is false"
        except Exception as exc:
            runner_error = f"{type(exc).__name__}: {exc}"
            logger.warning("orchestrator | runner kick failed: %s", exc)
    else:
        runner_error = "workflow not created (is ENABLE_WORKFLOWS on?)"

    snapshot = get_run_snapshot(run_id, user_id=user_id) or {}
    snapshot["runner_started"] = runner_started
    if runner_error:
        snapshot["runner_error"] = runner_error
    return snapshot


# ── Read a run ────────────────────────────────────────────────────────

def get_run_snapshot(run_id: str, *, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Composite snapshot: run row + workflow status + deliverables +
    task graph. Reconciles the run's terminal state from the driving
    workflow so the FE sees a single authoritative status.

    Returns None when the run is unknown OR belongs to another user
    (existence-hiding, matching the other v2 routes)."""
    from backend.services.orchestrator.runs_store import (
        get_run, finish_run, error_run,
    )
    run = get_run(run_id)
    if run is None:
        return None
    if user_id is not None and run["user_id"] != str(user_id):
        return None

    meta = run.get("metadata") or {}
    workflow_id = meta.get("workflow_id")
    panel_id    = meta.get("panel_id")
    template_id = meta.get("template_id")

    workflow_block: Optional[dict] = None
    wf_status: Optional[str] = None
    if workflow_id:
        try:
            from backend.services.workflows import client as wf_client
            wf_rec = wf_client.get(workflow_id, user_id=run["user_id"])
            if wf_rec is not None:
                wf_status = wf_rec.status
                workflow_block = {
                    "id":       wf_rec.id,
                    "status":   wf_rec.status,
                    "progress": wf_rec.progress,
                    "steps":    _trim_steps(wf_rec.steps),
                }
        except Exception as exc:  # pragma: no cover — defensive
            logger.debug("orchestrator | workflow read soft-failed: %s", exc)

    # Deliverables + task graph.
    from backend.services.orchestrator import deliverables_store as dstore
    deliverables = dstore.list_for_run(run_id)
    try:
        from backend.services.orchestrator import ExecutionGraph
        task_graph = ExecutionGraph.for_run(run_id).to_envelope()
    except Exception:
        task_graph = {"run_id": run_id, "tasks": [], "counts": {},
                      "total_count": 0, "total_duration_ms": 0}

    # Reconcile run terminal state from the workflow.
    from backend.services.workflows.types import (
        STATUS_COMPLETED as WF_COMPLETED,
        STATUS_FAILED as WF_FAILED,
        STATUS_CANCELLED as WF_CANCELLED,
    )
    if wf_status == WF_COMPLETED and run["status"] == "running":
        finish_run(run_id)
        run["status"] = "finished"
    elif wf_status in (WF_FAILED, WF_CANCELLED) and run["status"] == "running":
        error_run(run_id, error=f"workflow_{wf_status}")
        run["status"] = "errored"
        _skip_open_deliverables(run_id)
        deliverables = dstore.list_for_run(run_id)

    overall = wf_status or run["status"]
    return {
        "run_id":       run_id,
        "status":       overall,
        "run":          run,
        "template_id":  template_id,
        "panel_id":     panel_id,
        "workflow":     workflow_block,
        "deliverables": deliverables,
        "task_graph":   task_graph,
    }


def _trim_steps(steps: Any) -> List[dict]:
    """Project workflow steps down to the FE-relevant fields. Keeps the
    snapshot small even for large DAGs."""
    out: List[dict] = []
    for s in (steps or []):
        if not isinstance(s, dict):
            continue
        out.append({
            "id":           s.get("id"),
            "label":        s.get("label"),
            "status":       s.get("status"),
            "dependencies": s.get("dependencies") or [],
        })
    return out


def _skip_open_deliverables(run_id: str) -> None:
    """Mark still-open deliverables `skipped` when the run terminates
    abnormally — so the FE checklist never shows a permanently-pending
    row after a failed/cancelled run."""
    from backend.services.orchestrator import deliverables_store as dstore
    for d in dstore.list_for_run(run_id):
        if d["status"] in (dstore.STATUS_PENDING, dstore.STATUS_IN_PROGRESS):
            dstore.set_status(d["id"], dstore.STATUS_SKIPPED)


# ── Cancel a run ──────────────────────────────────────────────────────

def cancel_run(run_id: str, *, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Cancel a run: cancel the driving workflow (which cascades to
    in-flight jobs via the runner), mark the run errored, and skip any
    still-open deliverables. Returns the post-cancel snapshot, or None
    if the run is unknown / not owned by the caller."""
    from backend.services.orchestrator.runs_store import get_run, error_run
    run = get_run(run_id)
    if run is None:
        return None
    if user_id is not None and run["user_id"] != str(user_id):
        return None

    meta = run.get("metadata") or {}
    workflow_id = meta.get("workflow_id")
    if workflow_id:
        try:
            from backend.services.workflows import client as wf_client
            wf_client.cancel(workflow_id, user_id=run["user_id"])
        except Exception as exc:  # pragma: no cover — best effort
            logger.debug("orchestrator | workflow cancel soft-failed: %s", exc)

    if run["status"] == "running":
        error_run(run_id, error="cancelled", metadata={"cancelled": True})
    _skip_open_deliverables(run_id)

    return get_run_snapshot(run_id, user_id=user_id)


# ── List a project's runs (the permanent conversation) ────────────────

def list_project_runs(
    *, user_id: str, project_id: str, limit: int = 20,
) -> List[Dict[str, Any]]:
    """Return a project's PROJECT-orchestrator runs, oldest→newest, as
    lightweight conversation turns. Reuses runs_store + get_run_snapshot
    (which reconciles terminal state) and strips deliverable `content`
    so the list payload stays small — the full content is fetched
    on-demand via GET /runs/{id} when a deliverable is previewed.

    Filters to runs created by the Project Orchestrator
    (`metadata.kind == 'project_run'`) so single-agent /v2/orchestrate
    runs (which also live in runs_store) don't leak into the project
    conversation. No new storage — purely a read over existing tables.
    """
    from backend.services.orchestrator.runs_store import list_runs
    limit = max(1, min(int(limit or 20), 100))
    rows = list_runs(user_id=str(user_id), project_id=project_id, limit=limit)
    turns: List[Dict[str, Any]] = []
    for row in rows:
        if (row.get("metadata") or {}).get("kind") != "project_run":
            continue
        snap = get_run_snapshot(row["id"], user_id=user_id)
        if snap is None:
            continue
        meta = (snap.get("run") or {}).get("metadata") or {}
        turns.append({
            "run_id":       snap["run_id"],
            "status":       snap["status"],
            "user_request": meta.get("user_request") or "",
            "template_id":  snap.get("template_id"),
            "created_at":   (snap.get("run") or {}).get("started_at"),
            "deliverables": [_strip_content(d) for d in (snap.get("deliverables") or [])],
            "task_graph":   snap.get("task_graph"),
        })
    # runs_store returns newest-first; reverse to chronological for the
    # conversation transcript.
    turns.reverse()
    return turns


def _strip_content(deliverable: Dict[str, Any]) -> Dict[str, Any]:
    """Deliverable summary without the (potentially large) content blob,
    but WITH the artifact's type/preview/title so the FE can render the
    right affordance (Preview/Download/Open) without fetching the full
    content first. Full content is fetched on demand via GET /runs/{id}."""
    artifact = (deliverable.get("content") or {}).get("artifact") or {}
    return {
        "id":            deliverable.get("id"),
        "node_id":       deliverable.get("node_id"),
        "kind":          deliverable.get("kind"),
        "title":         deliverable.get("title"),
        "agent_id":      deliverable.get("agent_id"),
        "status":        deliverable.get("status"),
        "error":         deliverable.get("error"),
        "artifact_type": artifact.get("type"),
        "artifact_preview": artifact.get("preview"),
    }


__all__ = [
    "is_enabled", "flags_snapshot",
    "start_project_run", "get_run_snapshot", "cancel_run", "list_project_runs",
    "ProjectOrchestratorDisabled", "UnknownTemplateError", "RunNotFoundError",
]
