# coding: utf-8
"""Phase 9 — Agent presence types."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── States ─────────────────────────────────────────────────────────────────
PRESENCE_STATES: tuple[str, ...] = (
    "idle",         # agent registered but no current task
    "thinking",     # general LLM reasoning (no specific tool)
    "researching",  # web search / RAG / asset analysis in progress
    "coding",       # writing or modifying code
    "analyzing",    # interpreting data / images / docs
    "waiting",      # waiting on another agent or external resource
    "blocked",      # cannot proceed without user intervention
    "completed",    # task finished successfully (terminal)
    "failed",       # task ended in error (terminal)
)

STATE_IDLE        = "idle"
STATE_THINKING    = "thinking"
STATE_RESEARCHING = "researching"
STATE_CODING      = "coding"
STATE_ANALYZING   = "analyzing"
STATE_WAITING     = "waiting"
STATE_BLOCKED     = "blocked"
STATE_COMPLETED   = "completed"
STATE_FAILED      = "failed"

TERMINAL_STATES: frozenset[str] = frozenset({STATE_COMPLETED, STATE_FAILED})


def normalize_state(s: Optional[str]) -> str:
    if not s:
        return STATE_IDLE
    n = str(s).strip().lower()
    return n if n in PRESENCE_STATES else STATE_IDLE


@dataclass
class PresenceState:
    """One row in the presence snapshot.

    `last_seen_at_ms` lets the FE dim a card whose agent hasn't sent
    any signal in N seconds (treat as ghost / disconnected). The
    cleanup thread also uses it to garbage-collect stale rows so an
    abandoned panel doesn't keep its agents "thinking" forever.
    """
    panel_id:        str
    agent_id:        str
    state:           str = STATE_IDLE
    current_task:    Optional[str] = None    # short human label rendered next to the dot
    progress:        Optional[int] = None    # 0..100; None = indeterminate
    detail:          Optional[str] = None    # extra metadata: tool name / step name
    metadata:        dict = field(default_factory=dict)
    started_at_ms:   int = 0                 # when this STATE was entered (for "active for 12s" UI)
    last_seen_at_ms: int = 0                 # when this row was last touched

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


__all__ = [
    "PresenceState", "PRESENCE_STATES", "TERMINAL_STATES",
    "STATE_IDLE", "STATE_THINKING", "STATE_RESEARCHING",
    "STATE_CODING", "STATE_ANALYZING", "STATE_WAITING",
    "STATE_BLOCKED", "STATE_COMPLETED", "STATE_FAILED",
    "normalize_state",
]
