# coding: utf-8
"""Business Brain — Phase 2: deterministic candidate-action prioritization.

This is a small, PURE, inspectable ranking helper owned by the Project
Supervisor authority (it is imported by `project_supervisor`, not a second
top-level supervisor). Given candidate actions (and, optionally, the set of
active goals), it produces a stable, documented ordering answering:

    "of the useful actions available, what matters most — and WHY?"

DESIGN RULES
------------
  * DETERMINISTIC — no model call, no randomness. The same inputs always
    yield the same order. Ties break on explicit, stable keys.
  * CONSERVATIVE + INSPECTABLE — every score carries a per-component
    breakdown so a human (or a test) can see exactly why A outranks B. We
    do NOT manufacture fake precision: coarse level→weight tables, not
    invented percentages.
  * EVIDENCE-AWARE — `unknown` dimensions are treated cautiously (small
    positive for upside, small penalty for cost/risk). Missing evidence is
    reflected by the caller lowering `confidence`; the ranker rewards
    higher confidence but never invents it.
  * GOAL-ALIGNED — a candidate tied to an ACTIVE goal outranks an unrelated
    one, all else equal, and a higher-priority goal contributes more.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# ── Weights (documented + conservative) ──────────────────────────────────
# Positive drivers.
W_GOAL = 2.0        # aligned to an active goal (scaled by goal priority)
W_IMPACT = 1.5      # expected impact level
W_CONFIDENCE = 2.0  # evidence-backed confidence (0..1)
W_URGENCY = 1.0     # time pressure
# Negative drivers (subtracted).
W_COST = 1.0        # resource/credit cost level
W_RISK = 1.5        # downside/risk level

_IMPACT_WEIGHT = {"high": 3.0, "medium": 2.0, "low": 1.0, "unknown": 0.5}
_URGENCY_WEIGHT = {"high": 2.0, "medium": 1.0, "low": 0.5, "unknown": 0.5}
# Cost/risk: higher level = larger penalty. `unknown` is a small penalty
# (uncertainty is mildly discouraging, not disqualifying).
_COST_PENALTY = {"high": 2.0, "medium": 1.0, "low": 0.0, "unknown": 0.5}
_RISK_PENALTY = {"high": 2.0, "medium": 1.0, "low": 0.0, "unknown": 0.5}

# Goal-priority → alignment multiplier (goals_store priorities 1..4).
_GOAL_PRIORITY_MULT = {1: 0.6, 2: 1.0, 3: 1.3, 4: 1.6}


def _num(x: Any, default: float = 0.0) -> float:
    try:
        v = float(x)
        return v if v == v else default   # guard NaN
    except (TypeError, ValueError):
        return default


def score_candidate(
    candidate: dict, *, active_goal_priority: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Return {"score": float, "breakdown": {...}} for one candidate.

    `active_goal_priority` maps active goal_id → priority (1..4). A candidate
    whose goal_id is present contributes a goal-alignment term scaled by that
    priority; a candidate with no active goal contributes zero there (it is
    not penalised, just not boosted)."""
    gp = active_goal_priority or {}
    goal_id = candidate.get("goal_id")
    aligned = bool(goal_id and str(goal_id) in gp)
    goal_mult = _GOAL_PRIORITY_MULT.get(int(gp.get(str(goal_id), 2)), 1.0) if aligned else 0.0

    impact = _IMPACT_WEIGHT.get(str(candidate.get("impact") or "unknown"), 0.5)
    confidence = max(0.0, min(1.0, _num(candidate.get("confidence"), 0.3)))
    urgency = _URGENCY_WEIGHT.get(str(candidate.get("urgency") or "medium"), 1.0)
    cost_pen = _COST_PENALTY.get(str(candidate.get("cost") or "unknown"), 0.5)
    risk_pen = _RISK_PENALTY.get(str(candidate.get("risk") or "unknown"), 0.5)

    goal_term = W_GOAL * goal_mult
    impact_term = W_IMPACT * impact
    conf_term = W_CONFIDENCE * confidence
    urg_term = W_URGENCY * urgency
    cost_term = -W_COST * cost_pen
    risk_term = -W_RISK * risk_pen

    score = goal_term + impact_term + conf_term + urg_term + cost_term + risk_term
    return {
        "score": round(score, 4),
        "breakdown": {
            "goal_alignment": round(goal_term, 4),
            "impact": round(impact_term, 4),
            "confidence": round(conf_term, 4),
            "urgency": round(urg_term, 4),
            "cost": round(cost_term, 4),
            "risk": round(risk_term, 4),
            "aligned_to_goal": aligned,
        },
    }


def rank_candidates(
    candidates: List[dict], *,
    active_goals: Optional[List[dict]] = None,
) -> List[dict]:
    """Return candidates sorted most→least important, each annotated with
    `priority_score` and `priority_breakdown`.

    Ordering (all deterministic):
        1. score DESC
        2. confidence DESC        (more evidence wins a tie)
        3. created_at ASC         (older proposal first — FIFO fairness)
        4. id ASC                 (final stable tiebreak)
    """
    gp: Dict[str, int] = {}
    for g in (active_goals or []):
        gid = g.get("id")
        if gid:
            try:
                gp[str(gid)] = int(g.get("priority") or 2)
            except (TypeError, ValueError):
                gp[str(gid)] = 2

    scored: List[dict] = []
    for cand in candidates or []:
        s = score_candidate(cand, active_goal_priority=gp)
        item = dict(cand)
        item["priority_score"] = s["score"]
        item["priority_breakdown"] = s["breakdown"]
        scored.append(item)

    scored.sort(key=lambda c: (
        -_num(c.get("priority_score")),
        -_num(c.get("confidence")),
        str(c.get("created_at") or ""),
        str(c.get("id") or ""),
    ))
    return scored


def top_candidate(
    candidates: List[dict], *,
    active_goals: Optional[List[dict]] = None,
) -> Optional[dict]:
    """The single highest-priority candidate, or None when there are none."""
    ranked = rank_candidates(candidates, active_goals=active_goals)
    return ranked[0] if ranked else None


__all__ = [
    "W_GOAL", "W_IMPACT", "W_CONFIDENCE", "W_URGENCY", "W_COST", "W_RISK",
    "score_candidate", "rank_candidates", "top_candidate",
]
