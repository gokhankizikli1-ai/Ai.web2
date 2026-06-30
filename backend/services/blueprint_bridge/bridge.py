# coding: utf-8
"""
Blueprint → Orchestrator bridge — dry-run + gated execution.

  plan_to_orchestration(prompt)        → ProductPlan + OrchestrationRequest
  dry_run(request)                     → DryRunResult   (NO jobs / NO LLM)
  execute(request, user_id)            → ExecutionResult (gated, real run)

Safe by default: callers should dry-run first. Execution is gated behind
explicit feature flags and never silently falls back to mock execution.
"""
from __future__ import annotations

import os
from typing import List, Optional, Tuple

from backend.services.blueprint_bridge.adapter import blueprint_to_request
from backend.services.blueprint_bridge.types import (
    OrchestrationRequest, DryRunResult, ExecutionResult, ProposedStep,
)
from backend.services.product_intelligence import plan_product
from backend.services.product_intelligence.types import ProductPlan


class BridgeDisabled(Exception):
    """Raised when the bridge master flag is off."""


def _flag(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() == "true"


def is_enabled() -> bool:
    return _flag("ENABLE_BLUEPRINT_ORCHESTRATOR_BRIDGE")


# ── Planning → request ────────────────────────────────────────────────────

def plan_to_orchestration(
    prompt: str,
    *,
    project_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> Tuple[ProductPlan, OrchestrationRequest]:
    """Run the intelligence engine and adapt its blueprint to an
    orchestrator-ready request. Pure planning — no side effects."""
    plan = plan_product(prompt)
    request = blueprint_to_request(
        plan.blueprint, user_request=prompt,
        project_id=project_id, metadata=metadata,
    )
    return plan, request


# ── Execution prerequisites ───────────────────────────────────────────────

def execution_prerequisites() -> List[str]:
    """Flags that MUST be on for a real run. Empty list = ready to execute.

    Returns the names of the DISABLED prerequisites so the caller can report
    them honestly instead of silently mocking."""
    missing: List[str] = []
    if not _flag("ENABLE_PRODUCT_INTELLIGENCE"):
        missing.append("ENABLE_PRODUCT_INTELLIGENCE")
    try:
        from backend.services.orchestrator import project_orchestrator_enabled
        if not project_orchestrator_enabled():
            missing.append("ENABLE_PROJECT_ORCHESTRATOR")
    except Exception:  # pragma: no cover — defensive
        missing.append("ENABLE_PROJECT_ORCHESTRATOR")
    # The orchestrator itself drives workflows/jobs; surface those too so the
    # operator sees the full picture (the run is created either way, but
    # agents only execute when these are on).
    if not _flag("ENABLE_WORKFLOWS"):
        missing.append("ENABLE_WORKFLOWS")
    if not _flag("ENABLE_WORKFLOW_RUNNER"):
        missing.append("ENABLE_WORKFLOW_RUNNER")
    if not _flag("ENABLE_JOB_QUEUE"):
        missing.append("ENABLE_JOB_QUEUE")
    return missing


# ── Dry-run (NO execution) ────────────────────────────────────────────────

def _project_title(request: OrchestrationRequest) -> str:
    text = (request.user_request or "").strip().splitlines()[0] if request.user_request else ""
    text = text[:60].strip() or request.workspace.replace("_", " ").title()
    return text


def _resolve_template_preview(request: OrchestrationRequest):
    """Resolve which orchestrator template WOULD run — pure, no LLM/jobs.

    Honours an explicit suggested_template_id; otherwise uses the
    orchestrator's own regex-only `choose_template` (no coordinator/LLM)."""
    from backend.services.orchestrator.templates import catalog
    if request.suggested_template_id:
        t = catalog.get_template(request.suggested_template_id)
        if t is not None:
            return t
    # plan=None → choose_template runs its regex heuristics only (no LLM).
    return catalog.choose_template(request.user_request, plan=None)


def dry_run(request: OrchestrationRequest) -> DryRunResult:
    """Compute what WOULD happen without executing any agent/job/LLM."""
    template = _resolve_template_preview(request)
    steps = [
        ProposedStep(
            key=n.key, agent_id=n.agent_id, title=n.title,
            deliverable_kind=n.deliverable_kind, depends_on=list(n.depends_on),
        )
        for n in template.nodes
    ]
    # Proposed agents: prefer the blueprint's recommendation; fall back to the
    # resolved template's node agents so the preview is never empty.
    proposed_agents = request.recommended_agents or [n.agent_id for n in template.nodes]
    proposed_deliverables = (
        request.recommended_deliverables or [n.deliverable_kind for n in template.nodes]
    )
    return DryRunResult(
        project_title=_project_title(request),
        resolved_template_id=template.id,
        proposed_agents=proposed_agents,
        proposed_deliverables=proposed_deliverables,
        proposed_steps=steps,
        recommended_renderer=request.recommended_renderer,
        estimated_complexity=request.complexity,
        missing_prerequisites=execution_prerequisites(),
    )


# ── Execution (gated) ─────────────────────────────────────────────────────

async def execute(request: OrchestrationRequest, *, user_id: str) -> ExecutionResult:
    """Start a real orchestrator run for the request. GATED.

    Never silently mocks: when a prerequisite flag is off, returns
    executed=False with the disabled flags listed. Identity (`user_id`) MUST
    come from the authenticated context — callers pass principal.user_id.
    """
    missing = execution_prerequisites()
    if missing:
        return ExecutionResult(executed=False, disabled_prerequisites=missing)

    from backend.services.orchestrator import start_project_run
    snapshot = await start_project_run(
        user_id=user_id,
        user_request=request.user_request,
        project_id=request.project_id,
        template_id=request.suggested_template_id,   # may be None → orchestrator chooses
        metadata=request.orchestrator_metadata(),
    )
    # Extract ids defensively from the orchestrator snapshot shape.
    run_id = snapshot.get("run_id") or snapshot.get("id")
    workflow_id = snapshot.get("workflow_id")
    meta = snapshot.get("metadata") or {}
    if not workflow_id:
        workflow_id = meta.get("workflow_id")
    project_id = snapshot.get("project_id") or request.project_id
    status = snapshot.get("status")
    return ExecutionResult(
        executed=True, run_id=run_id, project_id=project_id,
        workflow_id=workflow_id, status=status, snapshot=snapshot,
    )


__all__ = [
    "is_enabled", "BridgeDisabled", "plan_to_orchestration",
    "execution_prerequisites", "dry_run", "execute",
]
