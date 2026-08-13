# coding: utf-8
"""Business Brain — the deterministic OBSERVATION/METRIC → CANDIDATE bridge.

This is the "maybe candidate action" step of the lifecycle:

    observation / metric change → [deterministic assessment] → candidate action

It is DELIBERATELY EXPLICIT (a callable), never auto-fired on ingestion — so
recording an observation or a metric still creates nothing by itself
(observation ≠ execution). A caller (or the Project Supervisor) invokes this to
turn already-persisted signals into candidate ACTIONS. Candidates are still
just proposals: nothing here executes work or bypasses the execution policy.

DETERMINISTIC + CONSERVATIVE + ZERO MODEL COST
----------------------------------------------
  * Only SIGNIFICANT metric changes and HIGH-importance observations become
    candidates. Trivial movement / low-importance noise is retained as raw
    signal but is NOT promoted (so competitor noise never crowds out
    goal-relevant work).
  * Each candidate is deduplicated by a stable signal key, so re-running the
    synthesis (or re-observing the same signal) converges on one candidate.
  * Goal alignment: a synthesized candidate is linked to the metric's target
    goal when one exists, else to the highest-priority active goal — because a
    significant signal on an active project serves that project's objective.
  * No model call, no embedding — pure structured transformation.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _primary_goal(goals: List[dict]) -> Optional[dict]:
    """Highest-priority active goal, deterministically (priority desc, then
    created_at asc for a stable tie-break)."""
    if not goals:
        return None
    return sorted(
        goals,
        key=lambda g: (-int(g.get("priority") or 2), str(g.get("created_at") or "")),
    )[0]


def _goal_for_metric(metric_key: str, goals: List[dict]) -> Optional[dict]:
    """A goal whose success is measured by this metric wins alignment; else
    fall back to the primary active goal."""
    for g in goals or []:
        if str(g.get("target_metric_key") or "") == str(metric_key):
            return g
    return _primary_goal(goals)


def _impact_from_pct(pct: Optional[float]) -> str:
    if pct is None:
        return "medium"
    a = abs(float(pct))
    if a >= 0.25:
        return "high"
    if a >= 0.10:
        return "medium"
    return "low"


def synthesize_candidates(
    project_id: str,
    user_id: str,
    *,
    metric_changes: Optional[List[dict]] = None,
    observations: Optional[List[dict]] = None,
    goals: Optional[List[dict]] = None,
    max_candidates: int = 20,
) -> List[str]:
    """Record candidate actions for significant signals. Returns the list of
    candidate ids created/updated. Injectable inputs support deterministic
    tests; by default signals are read from their own authorities scoped to
    (user, project)."""
    if not (project_id and user_id):
        return []

    from backend.services.orchestrator import candidate_actions_store as cas

    # Resolve signals + goals (fail-soft).
    try:
        if goals is None:
            from backend.services.orchestrator import goals_store
            goals = goals_store.active_goals(str(project_id), limit=10)
        if metric_changes is None:
            from backend.services.orchestrator import metrics_store as ms
            metric_changes = []
            for key in ms.metric_keys(str(project_id))[:25]:
                ch = ms.detect_change(str(project_id), key)
                if ch and ch.get("significant"):
                    metric_changes.append(ch)
        if observations is None:
            from backend.services.orchestrator import observations_store as obs
            observations = obs.recent_observations(str(project_id), limit=20)
    except Exception:  # pragma: no cover — never block on a read
        goals = goals or []
        metric_changes = metric_changes or []
        observations = observations or []

    goals = goals or []
    out: List[str] = []

    # ── Significant metric changes → investigation candidates ────────────
    for ch in (metric_changes or [])[:max_candidates]:
        key = str(ch.get("metric_key") or "")
        if not key:
            continue
        aligned = _goal_for_metric(key, goals)
        pct = ch.get("percentage_change")
        direction = ch.get("direction") or "changed"
        pct_txt = f" ({pct:+.1%})" if isinstance(pct, (int, float)) else ""
        cid = cas.record_candidate_action(
            project_id=str(project_id), user_id=str(user_id),
            title=f"Investigate {key} {direction}{pct_txt}",
            detail=(f"{key} moved from {ch.get('previous')} to {ch.get('current')}"
                    f" during the measured window."),
            goal_id=(aligned or {}).get("id"),
            source="METRIC",
            evidence_refs=[{"type": "metric", "ref": key,
                            "note": ch.get("evidence_ref") or ""}],
            recommended_capability="research",   # investigate — cheap/AUTO
            impact=_impact_from_pct(pct),
            confidence=0.6,                       # backed by a real measurement
            cost="low", risk="low", urgency="high",
            dedup_key=f"metric:{key}")
        if cid:
            out.append(cid)

    # ── HIGH-importance observations → act-on candidates ─────────────────
    for o in (observations or []):
        if str(o.get("importance")) != "high":
            continue   # normal/low importance is retained, NOT promoted
        oid = o.get("id")
        ext = o.get("external_id") if isinstance(o, dict) else None
        aligned = _primary_goal(goals)
        summary = str(o.get("summary") or o.get("kind") or "signal")
        cid = cas.record_candidate_action(
            project_id=str(project_id), user_id=str(user_id),
            title=f"Act on: {summary[:120]}",
            detail=f"High-importance observation from {o.get('source')} ({o.get('kind')}).",
            goal_id=(aligned or {}).get("id"),
            source="OBSERVATION",
            evidence_refs=[{"type": "observation", "ref": str(oid or ext or "")}],
            recommended_capability="research",
            impact="medium",
            confidence=0.5,
            cost="low", risk="low", urgency="medium",
            dedup_key=f"obs:{ext or oid}")
        if cid:
            out.append(cid)

    return out


__all__ = ["synthesize_candidates"]
