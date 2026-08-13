# coding: utf-8
"""Phase 6 — capability registry.

A plan may only reference REAL capabilities. This registry is the single
source of truth for which capabilities exist, whether they are executable
today, how they map to execution (agent.run vs the build capability kinds),
and what deliverable they produce. Future capabilities (qa, launch, growth)
are listed truthfully as NOT-yet-available so a planner can reference them as
`blocked` / `planned` instead of pretending they can run.

This is deliberately a small, static, deterministic table — no model call,
no dynamic discovery — so planning stays cheap and honest.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from backend.services.orchestrator import execution_policy

# Execution routes.
ROUTE_AGENT_RUN = "agent.run"        # the specialist agent.run job kind
ROUTE_WEB_BUILD = "web_build.run"    # production web build capability kind
ROUTE_APP_BUILD = "app_build.run"    # production app build capability kind
ROUTE_NONE = ""                       # not executable yet


@dataclass(frozen=True)
class Capability:
    name: str
    available: bool
    route: str
    deliverable_kind: str
    description: str
    status: str = "available"        # available | planned | not_supported

    @property
    def tier(self) -> str:
        """Policy tier for this capability (AUTO / APPROVAL_REQUIRED / DENIED)."""
        return execution_policy.classify_capability(self.name)

    @property
    def approval_required(self) -> bool:
        return self.tier == execution_policy.POLICY_APPROVAL_REQUIRED


_REGISTRY: Dict[str, Capability] = {
    "research": Capability(
        "research", available=True, route=ROUTE_AGENT_RUN,
        deliverable_kind="research_report",
        description="Market / domain research producing findings and facts.",
    ),
    "product": Capability(
        "product", available=True, route=ROUTE_AGENT_RUN,
        deliverable_kind="product_spec",
        description="Define the product: spec, decisions, constraints.",
    ),
    "web_build": Capability(
        "web_build", available=True, route=ROUTE_WEB_BUILD,
        deliverable_kind="web_build",
        description="Production Web Build (paid). Requires approval.",
    ),
    "app_build": Capability(
        "app_build", available=True, route=ROUTE_APP_BUILD,
        deliverable_kind="app_build",
        description="Production App Build (paid, multi-screen). Requires approval.",
    ),
    # Future capabilities — declared, NOT executable. A plan referencing
    # these must represent them as blocked/planned, never runnable.
    "qa": Capability(
        "qa", available=False, route=ROUTE_NONE, deliverable_kind="qa_report",
        description="QA pass over produced artifacts.", status="planned",
    ),
    "launch": Capability(
        "launch", available=False, route=ROUTE_NONE, deliverable_kind="launch_plan",
        description="Launch coordination.", status="planned",
    ),
    "growth": Capability(
        "growth", available=False, route=ROUTE_NONE, deliverable_kind="growth_plan",
        description="Growth / marketing follow-up.", status="planned",
    ),
}


def get(name: str) -> Optional[Capability]:
    return _REGISTRY.get((name or "").strip().lower())


def is_available(name: str) -> bool:
    cap = get(name)
    return bool(cap and cap.available)


def list_capabilities() -> List[Capability]:
    return list(_REGISTRY.values())


def available_names() -> List[str]:
    return [c.name for c in _REGISTRY.values() if c.available]


__all__ = [
    "Capability", "ROUTE_AGENT_RUN", "ROUTE_WEB_BUILD", "ROUTE_APP_BUILD",
    "ROUTE_NONE", "get", "is_available", "list_capabilities", "available_names",
]
