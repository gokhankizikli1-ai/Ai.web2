# coding: utf-8
"""Phase 8 — Agent task typed payloads."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


AGENT_TASK_STATUSES: tuple[str, ...] = (
    "queued", "running", "completed", "failed", "cancelled",
)

STATUS_QUEUED    = "queued"
STATUS_RUNNING   = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED    = "failed"
STATUS_CANCELLED = "cancelled"


def normalize_status(s: Optional[str]) -> str:
    if not s:
        return STATUS_QUEUED
    norm = str(s).lower().strip()
    return norm if norm in AGENT_TASK_STATUSES else STATUS_QUEUED


@dataclass
class AgentTaskRecord:
    user_id:            str
    assigned_agent_id:  str
    task_description:   str
    status:             str = STATUS_QUEUED
    project_id:         Optional[str] = None
    parent_job_id:      Optional[str] = None
    delegation_status:  Optional[str] = None      # "delegated", "pending", "rejected", etc.
    payload:            dict = field(default_factory=dict)
    result:             Optional[dict] = None
    summary:            Optional[str] = None      # short human-readable
    metadata:           dict = field(default_factory=dict)
    id:                 Optional[str] = None
    created_at:         Optional[str] = None
    updated_at:         Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


__all__ = [
    "AgentTaskRecord",
    "AGENT_TASK_STATUSES",
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_CANCELLED",
    "normalize_status",
]
