# coding: utf-8
"""Phase 9 — Panel typed payloads.

A "panel" groups the agents collaborating on one coordinated task. It
is the unit of orchestration the FE workspace renders, the scope the
PresenceBus broadcasts on, and the correlation id the AgentMessenger
attaches to typed messages.

A panel is NOT a workflow:
  - workflows model multi-step state machines (queued → running → done)
    with per-step progress.
  - panels model the SOCIAL space several agents inhabit together
    while working — who's online, what they're saying to each other,
    which scratchpad entries belong to this round.

A single workflow may spawn a single panel (1:1 in the simple case).
Complex requests may span multiple panels (e.g. a "build SaaS" panel
that spawns a child "design palette" panel). `parent_panel_id` records
the lineage; it's used by the FE to render the nested workspace.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Statuses ───────────────────────────────────────────────────────────────
PANEL_STATUSES: tuple[str, ...] = (
    "active",      # at least one agent is currently working
    "paused",      # all agents reported "waiting" / "blocked"
    "completed",   # final result accepted by the coordinator
    "failed",      # one or more agents failed and recovery was abandoned
    "cancelled",   # explicit user / coordinator cancel
)

TERMINAL_PANEL_STATUSES: frozenset[str] = frozenset({
    "completed", "failed", "cancelled",
})

STATUS_ACTIVE    = "active"
STATUS_PAUSED    = "paused"
STATUS_COMPLETED = "completed"
STATUS_FAILED    = "failed"
STATUS_CANCELLED = "cancelled"


def normalize_status(s: Optional[str]) -> str:
    if not s:
        return STATUS_ACTIVE
    n = str(s).strip().lower()
    return n if n in PANEL_STATUSES else STATUS_ACTIVE


@dataclass
class PanelRecord:
    """One coordinated task — the social workspace several agents share."""
    user_id:         str
    title:           str
    status:          str = STATUS_ACTIVE
    project_id:      Optional[str] = None
    parent_panel_id: Optional[str] = None   # for nested panels / sub-tasks
    chat_id:         Optional[str] = None   # which chat opened the panel
    coordinator_intent: Optional[str] = None  # plan.intent from /v2/coordinator/plan
    metadata:        dict = field(default_factory=dict)
    id:              Optional[str] = None
    created_at:      Optional[str] = None
    updated_at:      Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


__all__ = [
    "PanelRecord",
    "PANEL_STATUSES", "TERMINAL_PANEL_STATUSES",
    "STATUS_ACTIVE", "STATUS_PAUSED", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_CANCELLED",
    "normalize_status",
]
