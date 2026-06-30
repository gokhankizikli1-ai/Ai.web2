# coding: utf-8
"""
Blueprint → Orchestrator bridge — typed contracts.

This package is the THIN, typed seam between two existing, independent
subsystems:

  product_intelligence  (planning — "what to build")
        │
        ▼   blueprint_bridge  (this package — the only connector)
        │
        ▼
  orchestrator          (execution — runs/workflows/deliverables)

It imports BOTH; neither of them imports the other or this bridge, so module
separation is preserved (product_intelligence stays renderer/orchestrator-
independent, the orchestrator never becomes product intelligence).

Nothing here imports a renderer, the website builder, or a game/ecommerce
module — verticals are NOT hardcoded into the orchestrator; the only
vertical-aware mapping (workspace → template id) lives in adapter.py as data.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class OrchestrationRequest:
    """A clean, typed execution request derived from a ProductBlueprint.

    This is the orchestrator-ready shape: `user_request` + an optional
    `suggested_template_id` + `metadata` (the preserved blueprint summary).
    It maps 1:1 onto orchestrator.start_project_run's parameters.
    """
    user_request: str                         # the ORIGINAL user prompt (preserved)
    workspace: str
    product_category: str
    audience: str
    complexity: str
    recommended_renderer: str
    core_features: List[str] = field(default_factory=list)
    recommended_agents: List[str] = field(default_factory=list)
    recommended_deliverables: List[str] = field(default_factory=list)
    risk_analysis: List[str] = field(default_factory=list)
    success_metrics: List[str] = field(default_factory=list)
    suggested_template_id: Optional[str] = None   # may be None → orchestrator chooses
    project_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "user_request": self.user_request,
            "workspace": self.workspace,
            "product_category": self.product_category,
            "audience": self.audience,
            "complexity": self.complexity,
            "recommended_renderer": self.recommended_renderer,
            "core_features": list(self.core_features),
            "recommended_agents": list(self.recommended_agents),
            "recommended_deliverables": list(self.recommended_deliverables),
            "risk_analysis": list(self.risk_analysis),
            "success_metrics": list(self.success_metrics),
            "suggested_template_id": self.suggested_template_id,
            "project_id": self.project_id,
            "metadata": self.metadata,
        }

    def orchestrator_metadata(self) -> Dict[str, Any]:
        """The metadata blob attached to the orchestrator run so the
        blueprint travels WITH the run (renderer hint, agents, etc.)."""
        return {
            "source": "blueprint_bridge",
            "workspace": self.workspace,
            "product_category": self.product_category,
            "audience": self.audience,
            "complexity": self.complexity,
            "recommended_renderer": self.recommended_renderer,
            "recommended_agents": list(self.recommended_agents),
            "recommended_deliverables": list(self.recommended_deliverables),
            **(self.metadata or {}),
        }


@dataclass
class ProposedStep:
    """One step the orchestrator WOULD run for this request (preview only)."""
    key: str
    agent_id: str
    title: str
    deliverable_kind: str
    depends_on: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "key": self.key, "agent_id": self.agent_id, "title": self.title,
            "deliverable_kind": self.deliverable_kind, "depends_on": list(self.depends_on),
        }


@dataclass
class DryRunResult:
    """What WOULD happen — computed without executing any agent, job or LLM."""
    project_title: str
    resolved_template_id: str
    proposed_agents: List[str]
    proposed_deliverables: List[str]
    proposed_steps: List[ProposedStep]
    recommended_renderer: str
    estimated_complexity: str
    missing_prerequisites: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "mode": "dry_run",
            "project_title": self.project_title,
            "resolved_template_id": self.resolved_template_id,
            "proposed_agents": list(self.proposed_agents),
            "proposed_deliverables": list(self.proposed_deliverables),
            "proposed_steps": [s.to_dict() for s in self.proposed_steps],
            "recommended_renderer": self.recommended_renderer,
            "estimated_complexity": self.estimated_complexity,
            "missing_prerequisites": list(self.missing_prerequisites),
        }


@dataclass
class ExecutionResult:
    """The outcome of a gated, real orchestrator run."""
    executed: bool
    run_id: Optional[str] = None
    project_id: Optional[str] = None
    workflow_id: Optional[str] = None
    status: Optional[str] = None
    disabled_prerequisites: List[str] = field(default_factory=list)
    snapshot: Optional[Dict[str, Any]] = None

    def to_dict(self) -> dict:
        return {
            "mode": "execute",
            "executed": self.executed,
            "run_id": self.run_id,
            "project_id": self.project_id,
            "workflow_id": self.workflow_id,
            "status": self.status,
            "disabled_prerequisites": list(self.disabled_prerequisites),
            "snapshot": self.snapshot,
        }


__all__ = [
    "OrchestrationRequest", "ProposedStep", "DryRunResult", "ExecutionResult",
]
