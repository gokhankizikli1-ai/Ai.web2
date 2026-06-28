# coding: utf-8
"""Phase 8 — Workflow typed payloads."""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Taxonomy ─────────────────────────────────────────────────────────────────

WORKFLOW_TYPES: tuple[str, ...] = (
    "research",
    "ecommerce",
    "website_recreation",
    "startup_validation",
    "trading_research",
)


def normalize_workflow_type(t: Optional[str]) -> str:
    if not t:
        return "research"
    norm = str(t).lower().strip()
    return norm if norm in WORKFLOW_TYPES else "research"


WORKFLOW_STATUSES: tuple[str, ...] = (
    "queued", "running", "completed", "failed", "cancelled",
)

STATUS_QUEUED    = "queued"
STATUS_RUNNING   = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED    = "failed"
STATUS_CANCELLED = "cancelled"

TERMINAL_WORKFLOW_STATUSES: frozenset[str] = frozenset({
    STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED,
})


def normalize_workflow_status(s: Optional[str]) -> str:
    if not s:
        return STATUS_QUEUED
    norm = str(s).lower().strip()
    return norm if norm in WORKFLOW_STATUSES else STATUS_QUEUED


# ── Records ──────────────────────────────────────────────────────────────────

@dataclass
class WorkflowRecord:
    user_id:      str
    type:         str = "research"
    status:       str = STATUS_QUEUED
    project_id:   Optional[str] = None
    steps:        list[str]  = field(default_factory=list)     # ordered step labels
    current_step: int = 0
    progress:     int = 0                                       # 0..100
    payload:      dict = field(default_factory=dict)
    result:       Optional[dict] = None
    metadata:     dict = field(default_factory=dict)
    id:           Optional[str] = None
    created_at:   Optional[str] = None
    updated_at:   Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_WORKFLOW_STATUSES


# Re-export the typed Step record so callers can do
# `from backend.services.workflows.types import Step` without needing
# to know it lives in `steps.py`. Avoids cyclic imports — steps.py is
# import-cheap and does not depend on types.py.
from backend.services.workflows.steps import Step  # noqa: E402,F401  (re-export)


__all__ = [
    "WorkflowRecord",
    "Step",
    "WORKFLOW_TYPES", "WORKFLOW_STATUSES",
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_COMPLETED",
    "STATUS_FAILED", "STATUS_CANCELLED",
    "TERMINAL_WORKFLOW_STATUSES",
    "normalize_workflow_type", "normalize_workflow_status",
]
