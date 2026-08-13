# coding: utf-8
"""Phase 6 (connected brain) — deterministic project supervisor.

Evaluates a run's CURRENT state (from the durable snapshot + decisions) and
returns a structured assessment + a single recommended next action. It is
DETERMINISTIC — no model call, no agent↔agent loop. The Workflow Runner
remains the execution authority; this only reads state and recommends.

It surfaces partial-completion truthfully (a failed App Build never discards a
completed Web Build) and marks artifacts STALE when a newer authoritative
decision post-dates the artifact — without triggering any automatic rebuild.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Recommended next actions (stable codes).
NA_RESOLVE_RUNNER = "resolve_runner_error"
NA_APPROVE = "approve_pending_operation"
NA_RETRY_FAILED = "retry_failed_task"
NA_UPDATE_STALE = "update_stale_artifact"
NA_REVIEW = "review_deliverables"
NA_REVIEW_CANCELLED = "review_cancelled"
NA_WAIT = "wait_for_run"


def _stale_artifacts(snapshot: dict, decisions: List[dict]) -> List[dict]:
    """An artifact is stale when an ACTIVE decision was recorded AFTER the
    artifact deliverable was last updated. Deterministic (timestamp compare);
    never rebuilds — just flags."""
    if not decisions:
        return []
    latest_decision = max((str(d.get("created_at") or "") for d in decisions),
                          default="")
    if not latest_decision:
        return []
    stale = []
    for d in snapshot.get("deliverables") or []:
        content = d.get("content") or {}
        if not isinstance(content, dict):
            continue
        if d.get("kind") in ("web_build", "app_build") and \
                content.get("build_status") in ("completed", "handoff"):
            updated = str(d.get("updated_at") or "")
            if updated and latest_decision > updated:
                stale.append({
                    "deliverable_id": d.get("id"),
                    "build_type": content.get("build_type"),
                    "artifact_ref": content.get("artifact_ref"),
                    "reason": "a newer project decision post-dates this artifact",
                })
    return stale


def evaluate_run(
    snapshot: Optional[dict], *, decisions: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    """Return a deterministic assessment of a run snapshot."""
    if not snapshot:
        return {"status": "unknown", "recommended_next_action": NA_WAIT,
                "tasks": {}, "awaiting_approval": [], "failed": [],
                "completed": [], "blocked": [], "stale_artifacts": [],
                "partial": False}

    status = snapshot.get("status")
    obs = snapshot.get("observability") or {}
    tasks = (snapshot.get("task_graph") or {}).get("tasks") or []

    by_status: Dict[str, List[dict]] = {}
    for t in tasks:
        by_status.setdefault(str(t.get("status")), []).append(
            {"id": t.get("id"), "title": t.get("title"),
             "capability": t.get("assigned_agent")})

    completed = by_status.get("completed", [])
    failed = by_status.get("failed", [])
    # Blocked = a task not started whose deps aren't all complete, or an
    # unavailable capability (skipped).
    blocked = by_status.get("skipped", []) + by_status.get("waiting", [])

    # Partial: at least one completed AND at least one failed/blocked branch.
    partial = bool(completed) and bool(failed or blocked)

    if decisions is None:
        # Resolve project_id from the run row for a durable staleness read.
        pid = ((snapshot.get("run") or {}).get("project_id"))
        if pid:
            try:
                from backend.services.orchestrator import decisions_store as dec
                decisions = dec.active_decisions(str(pid))
            except Exception:
                decisions = []
        else:
            decisions = []
    stale = _stale_artifacts(snapshot, decisions or [])

    # Recommended next action — deterministic priority order.
    if snapshot.get("runner_error"):
        nxt = NA_RESOLVE_RUNNER
    elif obs.get("pending_approvals"):
        nxt = NA_APPROVE
    elif failed:
        nxt = NA_RETRY_FAILED
    elif stale:
        nxt = NA_UPDATE_STALE
    elif status == "cancelled":
        nxt = NA_REVIEW_CANCELLED
    elif status in ("completed", "finished"):
        nxt = NA_REVIEW
    else:
        nxt = NA_WAIT

    return {
        "status": status,
        "recommended_next_action": nxt,
        "tasks": {k: len(v) for k, v in by_status.items()},
        "awaiting_approval": obs.get("pending_approvals") or [],
        "failed": failed,
        "completed": completed,
        "blocked": blocked,
        "stale_artifacts": stale,
        "partial": partial,
        "build_artifacts": obs.get("build_artifacts") or [],
    }


__all__ = [
    "evaluate_run",
    "NA_RESOLVE_RUNNER", "NA_APPROVE", "NA_RETRY_FAILED", "NA_UPDATE_STALE",
    "NA_REVIEW", "NA_REVIEW_CANCELLED", "NA_WAIT",
]
