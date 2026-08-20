# coding: utf-8
"""Business Brain — Phase 2: deterministic candidate-action prioritization.

This is a small, PURE, inspectable ranking helper owned by the Project
Supervisor authority (it is imported by `project_supervisor`, not a second
top-level supervisor). Given candidate actions (and, optionally, the set of
active goals and the project's DECISION CONTEXTS), it produces a stable,
documented ordering answering:

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

TIER FIRST, SCORE SECOND — WHY THE SUM IS NO LONGER THE PRIMARY KEY
--------------------------------------------------------------------
AUDIT FINDING, fixed here. The order used to be a single weighted sum over
five coarse levels, and every dimension that fed it was a CONSTANT chosen by
`candidate_synthesis`: every open correlated subject arrived as
`impact=high, urgency=high`, whatever the evidence said. So a tracked README
issue and a production outage twelve hours before a launch produced the same
number, and no amount of reweighting could separate them — the inputs did not
differ.

`decision_context` now supplies real, structural inputs (is production red? is
there an imminent commitment? do two independent humans report it? can Korvix
actually resolve it?) and, with them, a TIER: a small ordered ladder documented
in that module. The tier is the primary sort key and the score only orders
candidates INSIDE a tier.

That distinction is not stylistic. A weighted sum cannot express "one verified
production outage outranks five informational signals however many of them
there are", because any weight honest enough for a single informational signal
is small enough for five of them to out-sum a real one. The ladder can, and it
does it by construction rather than by tuning:

    a candidate with NO decision context is `routine` (the bottom tier)

so nothing unevidenced can ever displace something evidenced, and no number of
weak candidates changes that — count is never an input to a tier.

WHAT THE SCORE IS STILL FOR
---------------------------
Ordering inside one tier, where the candidates genuinely are comparable: two
blocked subjects, one of which serves an active goal and rests on stronger
evidence. Its inputs were widened for the same reason the tier exists — the
old sum could not see production, customers, deadlines or staleness at all —
and every new weight is centralized in the table below, is a coarse LEVEL
rather than a count, and is bounded so that corroboration can never overwhelm
severity (`W_PRODUCTION` 2.0 > `W_CUSTOMER` at most 1.0).

ACTIONABILITY IS VISIBLE, NOT SUPPRESSIVE
-----------------------------------------
An outage Korvix cannot fix is still the most important thing in the project,
so actionability does NOT demote it down the ladder — that would hide the
truth to flatter the tool. It applies a small penalty inside a tier and, far
more importantly, travels in `priority_explanation.actionability` so every
surface can say plainly which part Korvix will do and which part a person must
do in someone else's system.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.services.orchestrator import decision_context as dc

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

# ── Decision-context weights (only reachable WITH evidence) ───────────────
# Every one of these is keyed on a coarse LEVEL that `decision_context`
# derived structurally. None of them is a count, so none of them can be
# climbed by volume, and the ordering between them is the documented claim:
#
#   a verified production failure (2.0)
#     outweighs an imminent commitment (1.5)
#     outweighs two independent humans reporting it (1.0)
#     outweighs one (0.4)
#
# so corroboration HELPS and never overwhelms severity — the failure mode the
# audit named explicitly.
W_PRODUCTION = 2.0
_PRODUCTION_WEIGHT = {
    dc.PRODUCTION_BROKEN: 1.0,
    dc.PRODUCTION_UNVERIFIED: 0.25,
    dc.PRODUCTION_VERIFIED_LIVE: 0.0,
    dc.PRODUCTION_UNKNOWN: 0.0,
}
W_DEADLINE = 1.5
_DEADLINE_WEIGHT = {
    dc.DEADLINE_IMMINENT: 1.0,
    dc.DEADLINE_APPROACHING: 0.33,
    dc.DEADLINE_NONE: 0.0,
}
W_CUSTOMER = 1.0
_CUSTOMER_WEIGHT = {
    dc.CUSTOMER_CORROBORATED: 1.0,
    dc.CUSTOMER_REPORTED: 0.4,
    dc.CUSTOMER_NONE: 0.0,
}
#: Penalties. Small on purpose: they express caution, never suppression.
P_STALE = 1.0        # evidence older than the correlation window itself
P_AGING = 0.25       # inside the window but not fresh
P_CONTRADICTION = 0.5   # the sources disagree about this subject
P_NOT_ACTIONABLE = 0.25  # Korvix cannot finish it; a person must
_FRESHNESS_PENALTY = {"stale": P_STALE, "aging": P_AGING,
                      "unknown": P_AGING, "recent": 0.0}

#: Actionability → the tie-break rank INSIDE a tier (smaller wins). Never a
#: tier input: see the module docstring on why an outage nobody can automate
#: still leads the queue.
_ACTIONABILITY_RANK = {
    dc.RESOLUTION_KORVIX: 0,
    dc.RESOLUTION_UNKNOWN: 1,
    dc.RESOLUTION_HUMAN_EXTERNAL: 2,
}


def actionability_rank(carrier: Optional[Dict[str, Any]]) -> int:
    """The in-tier tie-break rank for who can finish the work (smaller wins).

    Takes anything carrying an `actionability` block — a decision context or a
    `priority_explanation` — because both hold the same one. Exported so the
    page's context ordering and this module's candidate ordering apply the
    identical rule instead of two copies that could drift.

    Never a tier input: an outage nobody can automate still leads the queue."""
    resolution = str(((carrier or {}).get("actionability") or {})
                     .get("resolution") or "")
    return _ACTIONABILITY_RANK.get(resolution, 1)


def _num(x: Any, default: float = 0.0) -> float:
    try:
        v = float(x)
        return v if v == v else default   # guard NaN
    except (TypeError, ValueError):
        return default


def _context_for(candidate: dict,
                 contexts: Optional[Dict[str, dict]]) -> Dict[str, Any]:
    """The decision context belonging to this candidate, or `{}`.

    Looked up by the candidate's own dedup key first — `intel:<subject id>` is
    the identity `candidate_synthesis` writes and the subject id is the
    correlation's own — then by candidate id, so an injected mapping in a test
    and a real one from the supervisor behave identically. A candidate with no
    context is not penalised; it simply ranks on its own dimensions, in the
    bottom tier."""
    if not contexts:
        return {}
    for key in (candidate.get("dedup_key"), candidate.get("id")):
        if key and str(key) in contexts:
            found = contexts[str(key)]
            return found if isinstance(found, dict) else {}
    return {}


def score_candidate(
    candidate: dict, *,
    active_goal_priority: Optional[Dict[str, int]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return {"score": float, "breakdown": {...}} for one candidate.

    `active_goal_priority` maps active goal_id → priority (1..4). A candidate
    whose goal_id is present contributes a goal-alignment term scaled by that
    priority; a candidate with no active goal contributes zero there (it is
    not penalised, just not boosted).

    `context` is this candidate's `decision_context` projection when one
    exists. Its terms are ADDITIVE and every one of them is zero for a
    candidate without a context, so a caller that supplies none gets exactly
    the score this function has always produced."""
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

    ctx = context if isinstance(context, dict) else {}
    production_term = W_PRODUCTION * _PRODUCTION_WEIGHT.get(
        str(ctx.get("production_impact") or ""), 0.0)
    deadline_term = W_DEADLINE * _DEADLINE_WEIGHT.get(
        str(ctx.get("deadline_pressure") or ""), 0.0)
    customer_term = W_CUSTOMER * _CUSTOMER_WEIGHT.get(
        str(ctx.get("customer_impact") or ""), 0.0)
    freshness_term = -_FRESHNESS_PENALTY.get(
        str(ctx.get("freshness") or ""), 0.0) if ctx else 0.0
    contradiction_term = -P_CONTRADICTION if ctx.get("contradictory_evidence") else 0.0
    actionability = str((ctx.get("actionability") or {}).get("resolution") or "")
    actionable_term = (-P_NOT_ACTIONABLE
                       if actionability == dc.RESOLUTION_HUMAN_EXTERNAL else 0.0)

    score = (goal_term + impact_term + conf_term + urg_term + cost_term
             + risk_term + production_term + deadline_term + customer_term
             + freshness_term + contradiction_term + actionable_term)
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
            # Evidence-derived terms. Present always (zero without a context)
            # so a reader never has to guess whether a term was absent or nil.
            "production": round(production_term, 4),
            "deadline": round(deadline_term, 4),
            "customer_impact": round(customer_term, 4),
            "freshness": round(freshness_term, 4),
            "contradiction": round(contradiction_term, 4),
            "actionability": round(actionable_term, 4),
        },
    }


def explain(context: Optional[Dict[str, Any]] = None, *,
            subject_expected: bool = False) -> Dict[str, Any]:
    """The STRUCTURED "why this is #1" a surface can render.

    Reads ONLY the decision context. A candidate's own stored dimensions are
    deliberately not consulted here: they were DERIVED from this context when
    the candidate was written, so re-reading them would let a stale row argue
    with the live evidence about why it matters.

    Codes only, never prose: the frontend renders them through the shipped
    locale dictionaries and `project_brain.client` composes English from them
    for the system prompt, exactly as `attention`'s reason codes and
    `interpretation`'s implication codes already work. The backend ships no
    user-facing sentence here, so every language is a translation rather than
    English leaking through a payload."""
    ctx = context if isinstance(context, dict) else {}
    # A proposal that NAMES a correlated subject but has no live context is not
    # `routine`. `routine` asserts we looked and it is not pressing; the truth
    # here is that this proposal's evidence is outside the bounded observation
    # window, so nothing about its importance can be asserted either way.
    # Saying the first when the second is true is how a commit burst relabelled
    # a verified production outage as unimportant.
    #
    # `subject_expected` reads only the candidate's IDENTITY — whether it
    # claims a subject at all — never its stored dimensions. Those were derived
    # from a context that may no longer hold, and letting a stale row argue
    # with live evidence is the thing this function must not do. A metric or
    # lone-observation proposal never claimed a subject, so it is genuinely
    # routine and says so.
    basis = str(ctx.get("priority_basis") or dc.TIER_CODE[dc.DEFAULT_TIER])
    if not ctx and subject_expected:
        basis = dc.BASIS_EVIDENCE_OUT_OF_WINDOW
    return {
        "tier": int(ctx.get("priority_tier") or dc.DEFAULT_TIER),
        "basis": basis,
        "why_now": list(ctx.get("why_now") or []),
        "caveats": list(ctx.get("caveats") or []),
        "actionability": dict(ctx.get("actionability") or {}),
        "deadline_pressure": str(ctx.get("deadline_pressure") or dc.DEADLINE_NONE),
        "production_impact": str(ctx.get("production_impact")
                                 or dc.PRODUCTION_UNKNOWN),
        "customer_impact": str(ctx.get("customer_impact") or dc.CUSTOMER_NONE),
        "evidence_strength": str(ctx.get("evidence_strength") or ""),
        "goal_alignment": dict(ctx.get("goal_alignment") or {}),
        "unresolved": bool(ctx.get("unresolved")),
        "subject": str(ctx.get("subject") or ""),
        "subject_id": str(ctx.get("subject_id") or ""),
    }


def _sort_key(candidate: dict) -> Tuple[int, float, int, float, str, str]:
    """The one ordering, stated once.

        1. tier ASC              the documented ladder (evidence, not opinion)
        2. score DESC            inside a tier, the weighted evidence sum
        3. actionability ASC     what Korvix can finish, before what it cannot
        4. confidence DESC       more evidence wins a tie
        5. created_at ASC        older proposal first — FIFO fairness
        6. id ASC                final stable tiebreak
    """
    return (
        int(candidate.get("priority_tier") or dc.DEFAULT_TIER),
        -_num(candidate.get("priority_score")),
        actionability_rank(candidate.get("priority_explanation")),
        -_num(candidate.get("confidence")),
        str(candidate.get("created_at") or ""),
        str(candidate.get("id") or ""),
    )


def rank_candidates(
    candidates: List[dict], *,
    active_goals: Optional[List[dict]] = None,
    decision_contexts: Optional[Dict[str, dict]] = None,
) -> List[dict]:
    """Return candidates sorted most→least important, each annotated with
    `priority_score`, `priority_breakdown`, `priority_tier` and the structured
    `priority_explanation` a surface renders as "why this is #1".

    `decision_contexts` maps a candidate's dedup key (or id) to its
    `decision_context` projection. Omitted, every candidate lands in the
    bottom tier and the ordering degrades to the score alone — which is
    exactly the pre-existing behaviour, so no caller is broken by not knowing
    about this parameter."""
    gp: Dict[str, int] = {}
    for g in (active_goals or []):
        if not isinstance(g, dict):
            continue
        gid = g.get("id")
        if gid:
            try:
                gp[str(gid)] = int(g.get("priority") or 2)
            except (TypeError, ValueError):
                gp[str(gid)] = 2

    scored: List[dict] = []
    for cand in candidates or []:
        # TOTAL, like every other pure projection here: a malformed row is
        # skipped, never fatal. It was not, and the consequence was not a
        # crash — `project_supervisor` caught the exception and fell back to
        # the store's own `created_at DESC` order, handing back a list that
        # looked ranked, carried no `priority_*` fields, and answered "what
        # matters most?" with "whatever was written last".
        if not isinstance(cand, dict):
            continue
        context = _context_for(cand, decision_contexts)
        s = score_candidate(cand, active_goal_priority=gp, context=context)
        item = dict(cand)
        item["priority_score"] = s["score"]
        item["priority_breakdown"] = s["breakdown"]
        item["priority_tier"] = int(context.get("priority_tier")
                                    or dc.DEFAULT_TIER)
        item["priority_explanation"] = explain(
            context,
            subject_expected=str(cand.get("dedup_key") or "").startswith(
                dc.CANDIDATE_KEY_PREFIX))
        scored.append(item)

    scored.sort(key=_sort_key)
    return scored


def top_candidate(
    candidates: List[dict], *,
    active_goals: Optional[List[dict]] = None,
    decision_contexts: Optional[Dict[str, dict]] = None,
) -> Optional[dict]:
    """The single highest-priority candidate, or None when there are none."""
    ranked = rank_candidates(candidates, active_goals=active_goals,
                             decision_contexts=decision_contexts)
    return ranked[0] if ranked else None


__all__ = [
    "W_GOAL", "W_IMPACT", "W_CONFIDENCE", "W_URGENCY", "W_COST", "W_RISK",
    "W_PRODUCTION", "W_DEADLINE", "W_CUSTOMER",
    "P_STALE", "P_AGING", "P_CONTRADICTION", "P_NOT_ACTIONABLE",
    "score_candidate", "rank_candidates", "top_candidate", "explain",
    "actionability_rank",
]
