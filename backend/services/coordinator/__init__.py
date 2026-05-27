# coding: utf-8
"""
Phase 9 — Coordinator.

The Coordinator is the "intelligence layer" that decides which agent(s)
to invoke for a given user request. It does NOT execute agents — it
produces a Plan that the route layer (or a future executor) walks.

Why a separate service from agent/delegate.py?
  - delegate.py is the policy layer applied AFTER a supervisor has
    decided to call the `delegate` tool. It enforces depth, parallel
    caps, budget. It doesn't decide WHICH agent the supervisor needs
    in the first place.
  - The Coordinator runs BEFORE any LLM call. It looks at the raw
    user message, project context, and attached assets, and produces
    an honest plan (e.g. "this needs researcher + ux_designer because
    the request mentions 'landing page' and references a screenshot").
  - The plan is preview-only in this PR. A follow-up PR will wire it
    into automatic agent invocation. Honest scoping today, no fake
    auto-execution.

Routing implementation:
  - Rule-based intent classification using keyword + asset-type
    signals. Honestly labeled in the response: `routing_method =
    "rule_based"`. LLM-based routing is a follow-up.
  - The rules map to the existing AgentSpec registry; no new agent
    ids are invented.
"""
from backend.services.coordinator.coordinator import (
    Coordinator, coordinator, is_enabled,
)
from backend.services.coordinator.types import (
    Plan, AgentInvocation,
)

__all__ = [
    "Coordinator", "coordinator", "is_enabled",
    "Plan", "AgentInvocation",
]
