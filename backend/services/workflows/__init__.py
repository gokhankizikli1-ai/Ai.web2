# coding: utf-8
"""
Phase 8 — Workflow engine foundation.

Reusable multi-step workflow primitives that sit on top of the
Phase 7 Job Queue. Each workflow has a TEMPLATE (a known type —
research / ecommerce / website_recreation / startup_validation /
trading_research) with a list of steps; the manager creates rows in
workflows.db, optionally enqueues jobs, and reports progress.

Single-file package: types + store + manager + client in one module
for clarity at Phase 8 scope. Splits into per-concern files when
the workflow logic gets richer in Phase 9+.
"""
from backend.services.workflows.client import (
    WorkflowsClient, client, is_enabled,
)
from backend.services.workflows.types import (
    WorkflowRecord, WORKFLOW_TYPES, WORKFLOW_STATUSES,
)

__all__ = [
    "WorkflowsClient", "client", "is_enabled",
    "WorkflowRecord", "WORKFLOW_TYPES", "WORKFLOW_STATUSES",
]
