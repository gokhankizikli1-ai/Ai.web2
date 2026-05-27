# coding: utf-8
"""
/v2/orchestration — Phase 9 live activity aggregator.

Read-only endpoint that merges the caller's recent Job Queue +
Workflows + Agent Tasks into a single time-ordered feed. The
frontend AIActivityFeed polls this so the "AI OS" feel comes from
REAL orchestration state — no demo or hardcoded activity.

Output shape mirrors the FE `AIActivity` type so the existing
component renders the merged feed without any prop-name remapping:

    {
      id, status: 'active'|'completed'|'queued',
      message, detail?, progress?, timestamp, source
    }

Each subsystem (jobs / workflows / agent_tasks) is fetched
independently and folded only when its own feature flag is enabled.
If all three are off, the response is an empty list — the FE then
gracefully falls back to its demo-activity prop.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/orchestration", tags=["orchestration-v2"])


# ── Status mapping helpers ──────────────────────────────────────────────────

def _job_status_to_activity(status: str) -> str:
    """Job statuses are richer than the FE's AIActivity vocab (which
    is just active|completed|queued). Map terminal-good→completed,
    in-flight→active, everything else→queued (the neutral icon)."""
    s = (status or "").lower()
    if s in {"queued", "retrying"}:
        return "queued"
    if s in {"running"}:
        return "active"
    if s == "succeeded":
        return "completed"
    return "queued"


def _workflow_status_to_activity(status: str) -> str:
    s = (status or "").lower()
    if s == "queued":
        return "queued"
    if s == "running":
        return "active"
    if s == "completed":
        return "completed"
    return "queued"


def _task_status_to_activity(status: str) -> str:
    s = (status or "").lower()
    if s in {"queued"}:
        return "queued"
    if s == "running":
        return "active"
    if s == "completed":
        return "completed"
    return "queued"


# ── Pretty-name helpers ─────────────────────────────────────────────────────

_JOB_KIND_LABELS = {
    "echo":                      "Echo task",
    "sleep_progress":            "Progress task",
    "memory_consolidation_stub": "Memory review",
}


def _pretty_job(kind: str) -> str:
    return _JOB_KIND_LABELS.get((kind or "").lower(),
                                kind.replace("_", " ").title() if kind else "Job")


_WORKFLOW_TYPE_LABELS = {
    "research":            "Research workflow",
    "ecommerce":           "Ecommerce workflow",
    "website_recreation":  "Website recreation",
    "startup_validation":  "Startup validation",
    "trading_research":    "Trading research",
}


def _pretty_workflow(t: str) -> str:
    return _WORKFLOW_TYPE_LABELS.get((t or "").lower(),
                                    (t or "Workflow").replace("_", " ").title())


# ── Aggregator ──────────────────────────────────────────────────────────────

def _gather_jobs(user: User, *, project_id: Optional[str], limit: int) -> List[Dict[str, Any]]:
    if os.getenv("ENABLE_JOB_QUEUE", "false").strip().lower() != "true":
        return []
    try:
        from backend.services.jobs import client as jc
        rows = jc.list_user(user.id, project_id=project_id, limit=limit) or []
    except Exception as e:
        logger.debug("orchestration: jobs unavailable: %s", e)
        return []
    out = []
    for j in rows:
        out.append({
            "id":        j.id,
            "source":    "job",
            "status":    _job_status_to_activity(j.status),
            "raw_status": j.status,
            "message":   _pretty_job(j.kind),
            "detail":    j.progress_label or None,
            "progress":  (j.progress if j.status in {"running", "retrying"} else None),
            "timestamp": j.updated_at or j.created_at,
        })
    return out


def _gather_workflows(user: User, *, project_id: Optional[str], limit: int) -> List[Dict[str, Any]]:
    if os.getenv("ENABLE_WORKFLOWS", "false").strip().lower() != "true":
        return []
    try:
        from backend.services.workflows import client as wfc
        rows = wfc.list_user(user.id, project_id=project_id, limit=limit) or []
    except Exception as e:
        logger.debug("orchestration: workflows unavailable: %s", e)
        return []
    out = []
    for w in rows:
        # Compose detail from current_step / total_steps so the feed
        # surfaces real progress, not just status.
        steps_total = len(w.steps or [])
        detail = None
        if steps_total > 0:
            detail = f"Step {min(w.current_step + 1, steps_total)} of {steps_total}"
        out.append({
            "id":        w.id,
            "source":    "workflow",
            "status":    _workflow_status_to_activity(w.status),
            "raw_status": w.status,
            "message":   _pretty_workflow(w.type),
            "detail":    detail,
            "progress":  (w.progress if w.status == "running" else None),
            "timestamp": w.updated_at or w.created_at,
        })
    return out


def _gather_tasks(user: User, *, project_id: Optional[str], limit: int) -> List[Dict[str, Any]]:
    if os.getenv("ENABLE_AGENT_ORCHESTRATION", "false").strip().lower() != "true":
        return []
    try:
        from backend.services.agent_tasks import client as atc
        rows = atc.list_user(user.id, project_id=project_id, limit=limit) or []
    except Exception as e:
        logger.debug("orchestration: agent_tasks unavailable: %s", e)
        return []
    out = []
    for t in rows:
        # Agent task description is freeform; truncate to a feed-friendly length.
        msg = (t.task_description or "Agent task").strip()
        if len(msg) > 60:
            msg = msg[:57] + "…"
        out.append({
            "id":        t.id,
            "source":    "agent_task",
            "status":    _task_status_to_activity(t.status),
            "raw_status": t.status,
            "message":   msg,
            "detail":    t.summary or None,
            "progress":  None,    # tasks don't carry numeric progress yet
            "timestamp": t.updated_at or t.created_at,
            "agent_id":  t.assigned_agent_id,
        })
    return out


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/activity")
def get_activity(
    project_id: Optional[str] = Query(None, max_length=64),
    limit: int = Query(15, ge=1, le=50),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Merged time-ordered activity feed. Picks the most-recent
    items across jobs, workflows, and agent tasks; truncates to
    `limit` rows.

    Always 200 (never 503) — when every subsystem is off, the list
    is empty and the FE shows its demo fallback. This keeps the
    feed surface stable across flag flips."""
    jobs      = _gather_jobs(user,      project_id=project_id, limit=limit)
    workflows = _gather_workflows(user, project_id=project_id, limit=limit)
    tasks     = _gather_tasks(user,     project_id=project_id, limit=limit)
    merged: List[Dict[str, Any]] = [*jobs, *workflows, *tasks]
    # Sort newest first by timestamp (ISO-8601 strings sort
    # chronologically). Rows without a timestamp sink to the bottom.
    merged.sort(key=lambda d: d.get("timestamp") or "", reverse=True)
    merged = merged[:limit]
    # Counts surface in metadata so the FE can render an "N active"
    # badge without re-counting.
    active = sum(1 for d in merged if d["status"] == "active")
    queued = sum(1 for d in merged if d["status"] == "queued")
    return envelope_ok(
        data={"activity": merged},
        endpoint="/v2/orchestration/activity",
        user_id=user.id,
        active_count=active,
        queued_count=queued,
        sources={
            "jobs":      len(jobs),
            "workflows": len(workflows),
            "agent_tasks": len(tasks),
        },
    )


__all__ = ["router"]
