# coding: utf-8
"""Phase 9 — Agent message envelope types."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Message types ─────────────────────────────────────────────────────────
AGENT_MESSAGE_TYPES: tuple[str, ...] = (
    "request",      # one agent asks another for work
    "response",     # an agent returns work the requester asked for
    "propose",      # an agent suggests a path forward (non-binding)
    "revise",       # critic asks the author to rework a proposal
    "approve",      # a critic / supervisor signs off on a proposal
    "reject",       # a critic / supervisor rejects a proposal
    "final",        # last word — the panel's accepted output
)

MSG_REQUEST  = "request"
MSG_RESPONSE = "response"
MSG_PROPOSE  = "propose"
MSG_REVISE   = "revise"
MSG_APPROVE  = "approve"
MSG_REJECT   = "reject"
MSG_FINAL    = "final"


def normalize_message_type(t: Optional[str]) -> str:
    if not t:
        return MSG_REQUEST
    n = str(t).strip().lower()
    return n if n in AGENT_MESSAGE_TYPES else MSG_REQUEST


@dataclass
class AgentMessage:
    """One typed envelope exchanged between agents inside a panel.

    `from_agent` / `to_agent` are agent ids (matching AgentSpec.id or
    a project-defined custom agent). `to_agent="*"` is a broadcast
    visible to every agent on the panel.

    `in_reply_to` lets us thread response → request without an extra
    join. The FE uses it to render messages as a conversation tree.

    `payload` is structured — concrete shape is per-message-type but
    we keep it open-set so callers can attach references (asset_id,
    scratchpad_entry_id, etc.) without a schema migration.
    """
    panel_id:    str
    user_id:     str
    from_agent:  str
    to_agent:    str
    message_type: str = MSG_REQUEST
    content:     str = ""
    in_reply_to: Optional[str] = None
    payload:     dict = field(default_factory=dict)
    id:          Optional[str] = None
    created_at:  Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


__all__ = [
    "AgentMessage", "AGENT_MESSAGE_TYPES", "normalize_message_type",
    "MSG_REQUEST", "MSG_RESPONSE", "MSG_PROPOSE", "MSG_REVISE",
    "MSG_APPROVE", "MSG_REJECT", "MSG_FINAL",
]
