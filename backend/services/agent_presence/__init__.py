# coding: utf-8
"""
Phase 9 — Agent presence.

In-memory presence registry scoped by (panel_id, agent_id). Updates
flow through the existing events/bus so SSE subscribers get
push-style updates without us building a second pub/sub layer.

Why in-memory (not Redis) today?
  - The bus is also single-process; both will swap to Redis at the
    same time when KorvixAI moves to multi-replica deployment.
  - The interface (`presence.update`, `presence.snapshot`,
    `presence.subscribe`) is what Redis will eventually implement.
    Callers shouldn't have to change when the swap happens.

States are intentionally a small open enum — adding a new state is
free, removing one would be a breaking change for any FE display
component.
"""
from backend.services.agent_presence.client import (
    AgentPresenceClient, client, is_enabled,
)
from backend.services.agent_presence.types import (
    PresenceState, PRESENCE_STATES,
    STATE_IDLE, STATE_THINKING, STATE_RESEARCHING,
    STATE_CODING, STATE_ANALYZING, STATE_WAITING,
    STATE_BLOCKED, STATE_COMPLETED, STATE_FAILED,
    normalize_state,
)

__all__ = [
    "AgentPresenceClient", "client", "is_enabled",
    "PresenceState", "PRESENCE_STATES",
    "STATE_IDLE", "STATE_THINKING", "STATE_RESEARCHING",
    "STATE_CODING", "STATE_ANALYZING", "STATE_WAITING",
    "STATE_BLOCKED", "STATE_COMPLETED", "STATE_FAILED",
    "normalize_state",
]
