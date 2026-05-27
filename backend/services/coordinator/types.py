# coding: utf-8
"""Phase 9 — Coordinator typed payloads."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class AgentInvocation:
    """One node in a Coordinator plan.

    `agent_id`      — must resolve via agent.specs.registry.get_spec().
                      The Coordinator never invents ids; if no
                      specialist applies, it falls back to "supervisor"
                      which knows how to fan out via delegate.

    `reason`        — the human-readable rationale rendered in the FE
                      "Plan" preview. Honest by design — never claims
                      capabilities the agent doesn't actually have.

    `depends_on`    — ids of OTHER invocations in the plan whose
                      outputs feed this one. The FE renders the plan
                      as a small DAG. Empty list = root node.

    `inputs`        — a free-form dict the future executor will pass
                      through to the agent runtime. The preview UI
                      shows the keys for transparency.
    """
    agent_id:   str
    reason:     str
    depends_on: list[str] = field(default_factory=list)
    inputs:     dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Plan:
    """The Coordinator's decision for one user request.

    `routing_method` — "rule_based" today; "llm" / "hybrid" later.
                       Always populated so callers / FE know exactly
                       how the plan was produced and can render an
                       appropriate confidence label.

    `confidence`     — 0.0-1.0; the rule classifier reports a coarse
                       score so the FE can decide whether to render a
                       "Suggested plan" vs a "Suggested agents" hint.

    `agents`         — ordered list of invocations. The first entry
                       is the "primary" agent; depends_on indicates
                       follow-up nodes.

    `notes`          — short bullet points the rule engine wants to
                       surface to the user (e.g. "image attached, will
                       invoke vision-capable model"). Already
                       human-readable; FE renders verbatim.
    """
    intent:         str                       # short tag — "research" | "build_ui" | "analyze_image" | "chat" | …
    routing_method: str = "rule_based"
    confidence:     float = 0.0
    agents:         list[AgentInvocation] = field(default_factory=list)
    notes:          list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent":         self.intent,
            "routing_method": self.routing_method,
            "confidence":     self.confidence,
            "agents":         [a.to_dict() for a in self.agents],
            "notes":          list(self.notes),
        }


__all__ = ["Plan", "AgentInvocation"]
