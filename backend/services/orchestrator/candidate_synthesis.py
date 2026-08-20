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

RICHER HANDOFF, SAME AUTHORITY BOUNDARY
----------------------------------------
Project Intelligence now hands over an INTERPRETATION alongside the state:
which part of the project the subject touches, what kind of change it is, what
the evidence implies, what is still unknown, and which concrete rows are
blocking. All of that is written onto the candidate's detail and provenance so
a reviewer — and `action_prioritizer` after them — sees the reasoning instead
of a bare list of event titles.

It changes nothing about WHO DECIDES. The promotion rules below are byte-for-
byte the ones they were: only `unresolved` / `conflicting`, only when
substantiated. An implication ("nothing proves the fix is live") is a reading
of evidence; the proposal, the ranking and the execution gate remain here,
in `action_prioritizer`, and in `execution_policy` respectively. Understanding
never becomes execution: it becomes a better-argued proposal.

WHAT DID NOT CHANGE — and must not
-----------------------------------
  * This is still not a second brain. Project Intelligence supplies FACTS
    (what the evidence is about, what it says, and what it implies); the
    decision to propose, the ranking and the execution gate stay exactly where
    they were.
  * Still nothing is created at ingestion. `record_observation` does not call
    this, and this is still only reached when a caller explicitly asks.
  * Correlation is NOT promotion. A state is promoted only when it describes a
    live problem (unresolved / conflicting) AND the subject is substantiated —
    either corroborated across sources, or grouping several observations of the
    same recurring problem. A quiet or resolved subject produces no candidate,
    and a lone uncorroborated signal falls through to the unchanged
    high-importance path — noise stays noise.

MEMBERSHIP DECIDES SUPPRESSION; THE SUBJECT'S STATE DECIDES PROMOTION
---------------------------------------------------------------------
These are two different questions and conflating them leaked stale work:

    "has this row already been accounted for?"   → subject MEMBERSHIP
    "is there something to do about it?"         → the subject's CURRENT state

Once a row is a member of a real correlated subject, the legacy per-observation
path does not run for it — whatever that subject's state turns out to be. The
subject then speaks for all of its members: `unresolved`/`conflicting` yields
ONE evidence-backed candidate, while `likely_resolved`/`in_progress`/`observed`
yields none.

That is what stops a deploy failure from proposing work hours after a later
deploy to the same target went green, and what stops six failures of one target
from proposing six investigations of one problem.

Membership comes from the correlation authority's own complete index
(`project_intelligence.project_states_with_membership`) — never from a state's
public, CAPPED `evidence_observation_ids`, whose members past the cap would
look unaccounted-for and be handled twice. A subject must group at least
`MIN_SUBJECT_MEMBERS` distinct observations to claim membership at all, so a
thin or accidental reading can never silence the row it was built from, and a
genuinely uncorrelated signal still reaches the legacy path.
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


def _member_count(state: dict) -> int:
    """How many stored observations this subject speaks for. Falls back to the
    public capped id list for an INJECTED state that predates the field."""
    try:
        count = int(state.get("member_count") or 0)
    except (TypeError, ValueError):
        count = 0
    return count or len(state.get("evidence_observation_ids") or [])


#: Mirrors `project_intelligence.MIN_SUBJECT_MEMBERS`. Read from the authority
#: at call time so the two cannot drift, with a local fallback so this module
#: stays fail-soft if the projection is unavailable (every other path here
#: degrades rather than raising, and this one must too).
_MIN_SUBJECT_MEMBERS_FALLBACK = 2


def _min_subject_members() -> int:
    try:
        from backend.services.project_intelligence import MIN_SUBJECT_MEMBERS
        return int(MIN_SUBJECT_MEMBERS)
    except Exception:  # pragma: no cover — defensive
        return _MIN_SUBJECT_MEMBERS_FALLBACK


def _is_substantiated(state: dict) -> bool:
    """A subject may propose work when it is corroborated across sources, OR
    when it groups several observations of one recurring problem (six failed
    deploys of a single target are one problem, not six, and are still worth
    raising even though only one tool reported them)."""
    return (bool(state.get("corroborated"))
            or _member_count(state) >= _min_subject_members())

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


#: Interpretation codes → the short phrase written onto a candidate's detail.
#: Stable codes in, reviewable English out — and nothing here is an instruction:
#: the candidate's TITLE proposes the work, and even that is only a proposal
#: until `action_prioritizer` ranks it and the execution policy gates it.
_IMPLICATION_TEXT = {
    "production_broken": "the latest production deployment failed",
    "recurrence": "this target was green before and is red again (a regression)",
    "fix_not_proven_live": "the change landed but nothing proves it is live in production",
    "blocked_by_ci": "the latest CI check failed",
    "issue_open": "the tracked issue is still open",
    "preview_only_verified": "only a non-production deployment succeeded",
    "work_in_flight": "the work is proposed but not merged or shipped",
    "reported_but_unconfirmed": "reported in conversation, with no technical evidence either way",
    "verified_live": "the change landed and a production deployment succeeded",
}
_UNCERTAINTY_TEXT = {
    "conflicting_evidence": "the sources disagree",
    "production_unverified": "no production evidence either way",
    "deploy_outcome_unknown": "a deployment started and never reported an outcome",
    "stale_evidence": "the newest evidence is old",
    "single_source": "only one tool reported this",
    "topical_link_only": "linked by wording, not by a shared commit / PR / deployment",
    "thin_evidence": "very little evidence",
    "no_decisive_evidence": "nothing settles it either way",
    "undated_evidence": "the evidence carries no usable timestamp",
    "unknown_affected_scope": "the affected part of the project is unclear",
}


def _codes(rows, table: dict, limit: int) -> List[str]:
    out: List[str] = []
    for row in (rows or [])[:limit]:
        if not isinstance(row, dict):
            continue
        text = table.get(str(row.get("code") or ""))
        if text:
            out.append(text)
    return out


def _state_detail(state: dict) -> str:
    """The evidence AND the reading of it, spelled out.

    This is what makes the candidate reviewable: a human (and the ranking that
    follows) can see exactly which stored rows produced it, which part of the
    project they touch, what the evidence implies, and what is still NOT known
    — instead of a bare list of event titles that every reader had to
    interpret for themselves.

    The understanding is READ here, never re-derived: `project_intelligence`
    owns it, this module owns whether to propose work about it."""
    sources = ", ".join(str(s) for s in (state.get("sources") or []))
    confidence = (state.get("confidence") or {}).get("level", "low")
    count = state.get("evidence_count") or 0
    lines = [
        f"Correlated across {count} piece{'s' if count != 1 else ''} of "
        f"evidence from {len(state.get('sources') or [])} source(s)"
        + (f" ({sources})" if sources else "")
        + f"; confidence {confidence}.",
    ]

    understanding = state.get("understanding")
    if isinstance(understanding, dict):
        areas = [str(a.get("area")) for a in (understanding.get("areas") or [])
                 if isinstance(a, dict) and a.get("area")
                 and a.get("area") != "unknown"]
        kind = str((understanding.get("change_kind") or {}).get("kind") or "")
        scope = []
        if areas:
            scope.append("Affects: " + ", ".join(areas[:3]))
        if kind and kind != "unknown":
            scope.append(f"Kind: {kind}")
        if scope:
            lines.append(" · ".join(scope) + ".")
        implications = _codes(understanding.get("implications"),
                              _IMPLICATION_TEXT, 3)
        if implications:
            lines.append("What this means: " + "; ".join(implications) + ".")
        uncertainty = _codes(understanding.get("uncertainty"),
                             _UNCERTAINTY_TEXT, 3)
        if uncertainty:
            lines.append("Still unknown: " + "; ".join(uncertainty) + ".")
        for blocker in (understanding.get("blockers") or [])[:2]:
            if not isinstance(blocker, dict):
                continue
            title = str(blocker.get("title") or "").strip()
            where = str(blocker.get("environment") or "").strip()
            if title:
                lines.append(f"- Blocked by: [{blocker.get('source', '?')}] {title}"
                             + (f" ({where})" if where else ""))

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
    it. Bounded, and display-safe (internal observation ids only).

    The BLOCKERS come first. They are the rows that made this a finding, and
    a reviewer opening the candidate should meet the failed production deploy
    before the merged PR that preceded it."""
    refs: List[dict] = []
    seen: set = set()
    understanding = state.get("understanding")
    if isinstance(understanding, dict):
        for blocker in (understanding.get("blockers") or []):
            if not isinstance(blocker, dict):
                continue
            ref = str(blocker.get("observation_id") or "")
            if not ref or ref in seen:
                continue
            seen.add(ref)
            refs.append({"type": "observation", "ref": ref,
                         "note": str(blocker.get("code") or "")[:240]})
    for key in ("supporting", "contradicting", "context"):
        for item in (state.get(key) or []):
            if not isinstance(item, dict):
                continue
            ref = str(item.get("observation_id") or "")
            if not ref or ref in seen:
                continue
            seen.add(ref)
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
    # `membership` maps an observation id → the subject that speaks for it. It
    # is the COMPLETE index over the states below, not a state's capped public
    # id list — see the module docstring on why that distinction is the whole
    # fix. An injected `intelligence` (tests) falls back to the public ids.
    membership: Dict[str, dict] = {}
    if intelligence is None:
        try:
            from backend.services import project_intelligence as pi
            intelligence, membership = pi.project_states_with_membership(
                observations or [], limit=max_candidates)
        except Exception:  # pragma: no cover — never block on a projection
            intelligence, membership = [], {}
    else:
        for state in intelligence or []:
            if not isinstance(state, dict) or not _is_substantiated(state):
                continue
            for observation_id in state.get("evidence_observation_ids") or []:
                membership.setdefault(str(observation_id), state)

    for state in (intelligence or [])[:max_candidates]:
        if not isinstance(state, dict):
            continue
        if str(state.get("state")) not in _PROMOTABLE_STATES:
            continue    # resolved / in-progress / merely observed proposes nothing
        if not _is_substantiated(state):
            continue    # a lone uncorroborated signal is not a finding
        state_id = str(state.get("id") or "")
        if not state_id:
            continue
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
        if oid and str(oid) in membership:
            # This row is already a member of a correlated subject, and that
            # subject has spoken for it above — by proposing ONE candidate, or
            # by deliberately proposing none because its current state says the
            # problem is resolved, in flight, or merely being discussed.
            #
            # Falling through here is what used to emit "Act on: Production
            # deployment FAILED" hours after a later deploy to the same target
            # went green, and what used to emit one of those per failure
            # alongside the correlated candidate. Understanding the project has
            # to mean the older path stops acting as if it does not exist.
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
