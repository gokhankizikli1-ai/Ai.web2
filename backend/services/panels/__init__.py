# coding: utf-8
"""
Phase 9 — Panel concept.

A panel is the social workspace several agents share while working on
one coordinated task. NOT a workflow (which models multi-step state
machines). NOT a chat (which models the user-facing conversation
thread). The panel is the SCOPE for:

  - PresenceBus broadcasts ("researcher is thinking")
  - AgentMessenger typed envelopes ("propose" / "approve")
  - scratchpad entries (a panel's per-run journal)

Persistent via SQLite (panels.db, WAL). Feature-flagged via
ENABLE_REAL_COORDINATION.
"""
from backend.services.panels.client import PanelsClient, client, is_enabled
from backend.services.panels.types import (
    PanelRecord, PANEL_STATUSES, TERMINAL_PANEL_STATUSES,
    STATUS_ACTIVE, STATUS_PAUSED, STATUS_COMPLETED,
    STATUS_FAILED, STATUS_CANCELLED, normalize_status,
)

__all__ = [
    "PanelsClient", "client", "is_enabled",
    "PanelRecord", "PANEL_STATUSES", "TERMINAL_PANEL_STATUSES",
    "STATUS_ACTIVE", "STATUS_PAUSED", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_CANCELLED", "normalize_status",
]
