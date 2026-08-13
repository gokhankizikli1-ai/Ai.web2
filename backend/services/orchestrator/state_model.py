# coding: utf-8
"""Phase 4 (completion pass) — canonical backend state model + error taxonomy.

ONE BACKEND TRUTH
-----------------
This module is the single reference for the states an orchestrated project's
execution can be in, the legal transitions between them, and the stable
machine-readable error codes a future frontend consumes. It exists so the
state machine is auditable (no impossible states) and the error vocabulary is
stable, rather than scattered as ad-hoc strings.

Nothing here changes runtime behaviour — the runner/stores already emit these
statuses. `is_legal_transition` is a pure validator used by tests (and
available to callers) to catch contradictions like `completed → running` or
`cancelled → running`.
"""
from __future__ import annotations

from typing import Dict, FrozenSet

# ── Workflow-level states ────────────────────────────────────────────────
WF_QUEUED = "queued"
WF_RUNNING = "running"
WF_AWAITING_APPROVAL = "awaiting_approval"
WF_COMPLETED = "completed"
WF_FAILED = "failed"
WF_CANCELLED = "cancelled"

WF_TERMINAL: FrozenSet[str] = frozenset({WF_COMPLETED, WF_FAILED, WF_CANCELLED})

# Legal workflow transitions. A terminal state has no outgoing edges.
WF_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    WF_QUEUED:            frozenset({WF_RUNNING, WF_CANCELLED, WF_FAILED}),
    WF_RUNNING:           frozenset({WF_AWAITING_APPROVAL, WF_COMPLETED,
                                     WF_FAILED, WF_CANCELLED}),
    WF_AWAITING_APPROVAL: frozenset({WF_RUNNING, WF_CANCELLED, WF_FAILED}),
    WF_COMPLETED:         frozenset(),
    WF_FAILED:            frozenset(),
    WF_CANCELLED:         frozenset(),
}

# ── Step-level states ────────────────────────────────────────────────────
STEP_PENDING = "pending"
STEP_DISPATCHED = "dispatched"
STEP_RUNNING = "running"
STEP_AWAITING_APPROVAL = "awaiting_approval"
STEP_COMPLETED = "completed"
STEP_FAILED = "failed"
STEP_SKIPPED = "skipped"

STEP_TERMINAL: FrozenSet[str] = frozenset({STEP_COMPLETED, STEP_FAILED, STEP_SKIPPED})

STEP_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    STEP_PENDING:            frozenset({STEP_DISPATCHED, STEP_AWAITING_APPROVAL,
                                        STEP_COMPLETED, STEP_FAILED, STEP_SKIPPED}),
    STEP_DISPATCHED:         frozenset({STEP_RUNNING, STEP_COMPLETED, STEP_FAILED}),
    STEP_RUNNING:            frozenset({STEP_COMPLETED, STEP_FAILED}),
    STEP_AWAITING_APPROVAL:  frozenset({STEP_PENDING, STEP_SKIPPED, STEP_FAILED}),
    STEP_COMPLETED:          frozenset(),
    STEP_FAILED:             frozenset(),
    STEP_SKIPPED:            frozenset(),
}

# ── Build-execution states (build_execution_store) ───────────────────────
BUILD_QUEUED = "queued"
BUILD_RUNNING = "running"
BUILD_COMPLETED = "completed"
BUILD_FAILED = "failed"
BUILD_CANCELLED = "cancelled"
BUILD_HANDOFF = "handoff"   # worker ran but deferred (executor_unavailable)

BUILD_TERMINAL: FrozenSet[str] = frozenset({
    BUILD_COMPLETED, BUILD_FAILED, BUILD_CANCELLED, BUILD_HANDOFF,
})

BUILD_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    BUILD_QUEUED:    frozenset({BUILD_RUNNING, BUILD_CANCELLED, BUILD_FAILED}),
    BUILD_RUNNING:   frozenset({BUILD_COMPLETED, BUILD_FAILED, BUILD_CANCELLED,
                                BUILD_HANDOFF}),
    BUILD_COMPLETED: frozenset(),
    BUILD_FAILED:    frozenset(),
    BUILD_CANCELLED: frozenset(),
    BUILD_HANDOFF:   frozenset(),
}


def is_legal_transition(table: Dict[str, FrozenSet[str]],
                        frm: str, to: str) -> bool:
    """True if `frm → to` is a legal transition in `table` (identity/no-op is
    always legal). Unknown `frm` → illegal."""
    if frm == to:
        return True
    return to in table.get(frm, frozenset())


# ── Stable error taxonomy ────────────────────────────────────────────────
#
# Reuses existing codes where they already exist (execution_policy /
# ai_guard) so a future frontend has ONE vocabulary. Backend surfaces these
# as `code` fields; they are safe to branch on.

CODE_APPROVAL_REQUIRED = "approval_required"
CODE_APPROVAL_REJECTED = "approval_rejected"
CODE_INSUFFICIENT_CREDITS = "credit_unavailable"        # matches execution_policy
CODE_GLOBAL_SPEND_LIMIT = "global_spend_limit_reached"  # matches execution_policy / ai_guard
CODE_BUILD_FAILED = "build_failed"
CODE_BUILD_TIMEOUT = "build_timeout"
CODE_WORKFLOW_CANCELLED = "workflow_cancelled"
CODE_DEPENDENCY_FAILED = "dependency_failed"
CODE_EXECUTOR_UNAVAILABLE = "executor_unavailable"
CODE_DENIED = "denied"

ERROR_CODES: FrozenSet[str] = frozenset({
    CODE_APPROVAL_REQUIRED, CODE_APPROVAL_REJECTED, CODE_INSUFFICIENT_CREDITS,
    CODE_GLOBAL_SPEND_LIMIT, CODE_BUILD_FAILED, CODE_BUILD_TIMEOUT,
    CODE_WORKFLOW_CANCELLED, CODE_DEPENDENCY_FAILED, CODE_EXECUTOR_UNAVAILABLE,
    CODE_DENIED,
})


def classify_error(detail: str) -> str:
    """Best-effort map a free-text failure detail to a stable code. Falls
    back to build_failed for build-context errors."""
    d = (detail or "").lower()
    if "timed out" in d or "timeout" in d:
        return CODE_BUILD_TIMEOUT
    if "approval" in d and "reject" in d:
        return CODE_APPROVAL_REJECTED
    if "approval" in d:
        return CODE_APPROVAL_REQUIRED
    if "credit" in d:
        return CODE_INSUFFICIENT_CREDITS
    if "spend" in d:
        return CODE_GLOBAL_SPEND_LIMIT
    if "cancel" in d:
        return CODE_WORKFLOW_CANCELLED
    if "executor" in d or "unavailable" in d or "handoff" in d:
        return CODE_EXECUTOR_UNAVAILABLE
    if "depend" in d:
        return CODE_DEPENDENCY_FAILED
    return CODE_BUILD_FAILED


__all__ = [
    "WF_TERMINAL", "WF_TRANSITIONS", "STEP_TERMINAL", "STEP_TRANSITIONS",
    "BUILD_TERMINAL", "BUILD_TRANSITIONS", "is_legal_transition",
    "ERROR_CODES", "classify_error",
    "CODE_APPROVAL_REQUIRED", "CODE_APPROVAL_REJECTED",
    "CODE_INSUFFICIENT_CREDITS", "CODE_GLOBAL_SPEND_LIMIT",
    "CODE_BUILD_FAILED", "CODE_BUILD_TIMEOUT", "CODE_WORKFLOW_CANCELLED",
    "CODE_DEPENDENCY_FAILED", "CODE_EXECUTOR_UNAVAILABLE", "CODE_DENIED",
]
