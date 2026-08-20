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

EVIDENCE-BACKED CANDIDATES (Project Intelligence)
-------------------------------------------------
The observation path used to promote every HIGH-importance row on its own,
producing "Act on: Production deployment FAILED for korvix" with a hardcoded
confidence of 0.5 and impact "medium" — the same shape whether the system knew
one thing or ten. When `project_intelligence` has CORRELATED those rows into a
subject, this module now consumes that instead:

    "Investigate payment webhook — conflicting evidence across 3 sources"
      evidence: the failed Vercel deployment, the merged GitHub PR,
                the Slack discussion

and the candidate's confidence is the correlation's own evidence-derived score
rather than a constant. Every raw observation that is already evidence for a
promoted state is SUPPRESSED, so the dedup converges on the underlying subject
instead of emitting one candidate per event.

WHAT DID NOT CHANGE — and must not
-----------------------------------
  * This is still not a second brain. Project Intelligence supplies FACTS
    (what the evidence is about, and what it says); the decision to propose,
    the ranking and the execution gate stay exactly where they were.
  * Still nothing is created at ingestion. `record_observation` does not call
    this, and this is still only reached when a caller explicitly asks.
  * Correlation is NOT promotion. A state is promoted only when it describes a
    live problem (unresolved / conflicting) AND is corroborated by at least two
    independent sources. A quiet or resolved subject produces no candidate, and
    a lone uncorroborated signal falls through to the unchanged
    high-importance path — noise stays noise.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

#: Observations read when the caller does not supply them. Wider than the
#: former 20 because correlation must SEE related rows to relate them; still a
#: single bounded query.
_MAX_OBSERVATIONS_READ = 60


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


#: Inferred states worth proposing work about. A resolved or merely observed
#: subject is understanding, not a to-do.
_PROMOTABLE_STATES = ("unresolved", "conflicting")

#: Correlated states → the impact level of the candidate they justify. Coarse
#: and honest, consistent with the rest of the candidate dimensions.
_IMPACT_BY_STATE = {"conflicting": "high", "unresolved": "high"}

#: Correlated states → urgency.
_URGENCY_BY_STATE = {"conflicting": "high", "unresolved": "high"}


def _state_title(state: dict) -> str:
    """A candidate title that names the SUBJECT and what is wrong with it,
    rather than echoing whichever single event happened to arrive last."""
    subject = str(state.get("subject") or "").strip() or "project signal"
    if str(state.get("state")) == "conflicting":
        return f"Investigate {subject} — conflicting evidence"[:300]
    return f"Investigate {subject}"[:300]


def _state_detail(state: dict) -> str:
    """The evidence, spelled out. This is what makes the candidate reviewable:
    a human can see exactly which stored rows produced it and decide."""
    sources = ", ".join(str(s) for s in (state.get("sources") or []))
    confidence = (state.get("confidence") or {}).get("level", "low")
    lines = [
        f"Correlated across {state.get('evidence_count') or 0} pieces of "
        f"evidence from {len(state.get('sources') or [])} source(s)"
        + (f" ({sources})" if sources else "")
        + f"; confidence {confidence}.",
    ]
    for label, key in (("Evidence", "supporting"),
                       ("Contradicting", "contradicting")):
        for item in (state.get(key) or [])[:4]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or item.get("kind") or "").strip()
            if title:
                lines.append(f"- {label}: [{item.get('source', '?')}] {title}")
    return "\n".join(lines)[:2000]


def _state_evidence_refs(state: dict) -> List[dict]:
    """Provenance carried onto the candidate: which stored observations back
    it. Bounded, and display-safe (internal observation ids only)."""
    refs: List[dict] = []
    for key in ("supporting", "contradicting", "context"):
        for item in (state.get(key) or []):
            if not isinstance(item, dict):
                continue
            ref = str(item.get("observation_id") or "")
            if not ref:
                continue
            refs.append({"type": "observation", "ref": ref,
                         "note": str(item.get("semantic_type") or "")[:240]})
            if len(refs) >= 12:
                return refs
    return refs


def synthesize_candidates(
    project_id: str,
    user_id: str,
    *,
    metric_changes: Optional[List[dict]] = None,
    observations: Optional[List[dict]] = None,
    goals: Optional[List[dict]] = None,
    intelligence: Optional[List[dict]] = None,
    max_candidates: int = 20,
) -> List[str]:
    """Record candidate actions for significant signals. Returns the list of
    candidate ids created/updated. Injectable inputs support deterministic
    tests; by default signals are read from their own authorities scoped to
    (user, project).

    `intelligence` is the correlated project-state list (see
    `services.project_intelligence`). Left as None it is DERIVED from the same
    observations this call already read — no extra query, no provider call, no
    model call. Pass `[]` to synthesize from raw signals only."""
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
            # Owner-scoped: this synthesis writes candidates owned by
            # `user_id`, so it must only ever read observations owned by
            # `user_id`. The store's `user_id` filter makes that structural
            # rather than assumed. A wider slice than the old 20 is read
            # because correlation needs to SEE the related rows to relate
            # them — still one bounded query, still no provider call.
            observations = obs.list_observations(
                str(project_id), user_id=str(user_id),
                limit=_MAX_OBSERVATIONS_READ)
    except Exception:  # pragma: no cover — never block on a read
        goals = goals or []
        metric_changes = metric_changes or []
        observations = observations or []

    goals = goals or []
    out: List[str] = []

    # ── Correlated project states → EVIDENCE-BACKED candidates ───────────
    # Derived from the observations already in hand. Pure computation.
    if intelligence is None:
        try:
            from backend.services import project_intelligence as pi
            intelligence = pi.project_states(observations or [])
        except Exception:  # pragma: no cover — never block on a projection
            intelligence = []

    # Observations already accounted for by a promoted state. Their raw
    # "Act on:" candidates are suppressed below so one real-world problem
    # yields ONE candidate rather than one per event that evidenced it.
    covered_observations: set = set()

    for state in (intelligence or [])[:max_candidates]:
        if not isinstance(state, dict):
            continue
        if str(state.get("state")) not in _PROMOTABLE_STATES:
            continue    # resolved / in-progress / merely observed proposes nothing
        if not state.get("corroborated"):
            continue    # a lone uncorroborated signal is not a finding
        state_id = str(state.get("id") or "")
        if not state_id:
            continue
        covered_observations.update(
            str(o) for o in (state.get("evidence_observation_ids") or []))
        aligned = _primary_goal(goals)
        confidence = (state.get("confidence") or {}).get("score")
        cid = cas.record_candidate_action(
            project_id=str(project_id), user_id=str(user_id),
            title=_state_title(state),
            detail=_state_detail(state),
            goal_id=(aligned or {}).get("id"),
            source="OBSERVATION",
            evidence_refs=_state_evidence_refs(state),
            recommended_capability="research",   # investigate — cheap/AUTO
            impact=_IMPACT_BY_STATE.get(str(state.get("state")), "medium"),
            # The correlation's OWN evidence-derived score, not a constant.
            # Where it came from is inspectable in the state's breakdown.
            confidence=(float(confidence) if isinstance(confidence, (int, float))
                        else 0.5),
            cost="low", risk="low",
            urgency=_URGENCY_BY_STATE.get(str(state.get("state")), "medium"),
            # Dedup converges on the SUBJECT, so re-running after three more
            # deploy failures updates one candidate instead of adding three.
            dedup_key=f"intel:{state_id}")
        if cid:
            out.append(cid)

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
        if not isinstance(o, dict):
            continue
        if str(o.get("importance")) != "high":
            continue   # normal/low importance is retained, NOT promoted
        oid = o.get("id")
        if oid and str(oid) in covered_observations:
            # Already evidence for a correlated candidate above. Emitting
            # "Act on: Deployment failed" alongside "Investigate payment
            # webhook — conflicting evidence" would be the same problem twice,
            # with the poorer of the two descriptions.
            continue
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
