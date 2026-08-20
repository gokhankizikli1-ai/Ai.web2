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

DIMENSIONS ARE NOW DERIVED, NOT DECLARED
-----------------------------------------
AUDIT FINDING, fixed here. Every promoted subject used to be written with
`impact="high", urgency="high"` from a two-entry constant table, and stamped
with the project's highest-priority active goal whatever it was about. Three
consequences, all of them wrong:

  * a tracked README issue and a production outage produced identical rows, so
    `action_prioritizer` — which can only rank what it is given — had nothing
    to tell them apart;
  * "aligned to a goal" was true of every candidate and therefore meant
    nothing;
  * a launch tomorrow, already ingested by the calendar connector, took no
    part in anything.

`decision_context` now derives those dimensions from the evidence — is
production verifiably red, do two independent humans report it, is there a
dated commitment inside 48 hours, can Korvix actually resolve it, does a
durable decision post-date the reading — and this module writes what it
derived. It still decides WHETHER to propose; it no longer invents HOW MUCH
the proposal matters.

STALE PROPOSALS ARE RECONCILED, NOT LEFT BEHIND
------------------------------------------------
AUDIT FINDING, fixed here. Suppression only ever governed whether a NEW
candidate was written. A candidate already recorded for a subject stayed
`proposed` for ever: after a later production deploy went green the subject
became `likely_resolved`, this module correctly proposed nothing further —
and the row written yesterday was still sitting in the open list, still being
ranked, still being recommended. "A resolved subject proposes nothing" was
true only of the future.

`_reconcile` closes that loop through the store's EXISTING lifecycle
(`STATUS_SUPERSEDED`), and only on evidence it can actually see: a proposed
candidate is retired when every one of its referenced observations is now
accounted for by a subject that is no longer promotable, or by a DIFFERENT
candidate written in this same pass. A candidate whose evidence has simply
aged out of the bounded read is left strictly alone — silence is not proof of
resolution, and inferring it from a capped query would be the same class of
mistake this module exists to stop.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence, Set

logger = logging.getLogger(__name__)

#: Observations read when the caller does not supply them. Wider than the
#: former 20 because correlation must SEE related rows to relate them; still a
#: single bounded query.
_MAX_OBSERVATIONS_READ = 60
#: Exported so a caller that reads the observations ITSELF (the assessment
#: route) reads the same slice this module would have, rather than a second
#: number that could drift from it.
MAX_OBSERVATIONS_READ = _MAX_OBSERVATIONS_READ

#: The default bound on how many correlated subjects one pass may promote —
#: exported for the same reason, so a caller that pre-computes the projection
#: correlates to the same depth this module would have.
MAX_CANDIDATES = 20

#: Open proposals examined by `_reconcile`. One bounded query, and the same
#: order the Business Brain ranks (newest first), so the rows a user is
#: actually being shown are the rows kept honest.
_MAX_CANDIDATES_RECONCILED = 50


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


def _line(value: Any, limit: int = 200) -> str:
    """One prompt- and document-safe line of provider/user text.

    The same rule `project_brain.client._clean` applies to everything a
    connector wrote, applied here for the same reason: a candidate's detail is
    a line-structured document, and untrusted text that can introduce a NEWLINE
    can introduce a heading."""
    return " ".join(str(value or "").split())[:limit]


def _state_title(state: dict) -> str:
    """A candidate title that names the SUBJECT and what is wrong with it,
    rather than echoing whichever single event happened to arrive last."""
    subject = _line(state.get("subject"), 200) or "project signal"
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


#: Decision-context codes → the short phrase written onto a candidate's
#: detail. The implication/uncertainty codes above already cover most of the
#: vocabulary; only the concepts `decision_context` adds need an entry here.
#: Nothing in either table is an instruction — a candidate's TITLE proposes the
#: work, and even that is a proposal until `action_prioritizer` ranks it and
#: `execution_policy` gates it.
_WHY_NOW_TEXT = {
    "deadline_imminent": "a dated commitment is less than 48 hours away",
    "deadline_approaching": "a dated commitment is inside a week",
    "customer_impact_corroborated":
        "two independent people reported it (conversation and mail)",
    "customer_impact_reported": "a person reported it outside the tooling",
    "goal_aligned": "it touches an active project goal",
    "recurring_failure": "the same target has reported this repeatedly",
}
_WHY_NOW_TEXT.update(_IMPLICATION_TEXT)

_CAVEAT_TEXT = {
    "decision_recorded_after_evidence":
        "a project decision was recorded after this evidence, so the reading "
        "may already be settled",
    "part_of_related_story":
        "this shares evidence with another open subject and may be one problem",
}
_CAVEAT_TEXT.update(_UNCERTAINTY_TEXT)

#: What Korvix can and cannot do, said plainly on the candidate itself.
_RESOLUTION_TEXT = {
    "human_external":
        "Korvix can investigate and summarize; resolving this needs a change "
        "in {providers}, which Korvix reads but cannot write",
    "korvix": "Korvix can carry this out itself",
    "unknown": "who has to act on this is not established by the evidence",
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


def _plain_codes(codes, table: dict, limit: int) -> List[str]:
    """The same mapping for the flat code lists `decision_context` produces."""
    out: List[str] = []
    for code in (codes or [])[:limit]:
        text = table.get(str(code))
        if text:
            out.append(text)
    return out


def _context_lines(context: Optional[dict]) -> List[str]:
    """The DECISION reading, spelled out on the candidate: why it matters now,
    what would make that wrong, and who can actually resolve it.

    Read from `decision_context`, never re-derived here — this module owns
    whether to propose work, not how much it matters."""
    if not isinstance(context, dict) or not context:
        return []
    lines: List[str] = []
    why = _plain_codes(context.get("why_now"), _WHY_NOW_TEXT, 3)
    if why:
        lines.append("Why now: " + "; ".join(why) + ".")
    caveats = _plain_codes(context.get("caveats"), _CAVEAT_TEXT, 3)
    if caveats:
        lines.append("Treat with care: " + "; ".join(caveats) + ".")
    actionability = context.get("actionability") or {}
    template = _RESOLUTION_TEXT.get(str(actionability.get("resolution") or ""))
    if template:
        providers = ", ".join(str(p) for p in
                              (actionability.get("external_providers") or [])[:3])
        lines.append(template.format(providers=providers or "an external system")
                     + ".")
    return lines


def _state_detail(state: dict, context: Optional[dict] = None) -> str:
    """The evidence AND the reading of it, spelled out.

    This is what makes the candidate reviewable: a human (and the ranking that
    follows) can see exactly which stored rows produced it, which part of the
    project they touch, what the evidence implies, and what is still NOT known
    — instead of a bare list of event titles that every reader had to
    interpret for themselves.

    The understanding is READ here, never re-derived: `project_intelligence`
    owns it, this module owns whether to propose work about it; the decision
    reading is READ from `decision_context` for the same reason.

    Every provider-authored string that lands in here goes through `_line`
    first. A PR title or a Slack message is UNTRUSTED text and may contain
    newlines, and this detail is a line-structured document with headings a
    reader (and a reviewer) trusts — collapsing whitespace means such a string
    can add words to a line but can never add a LINE, so it cannot forge
    "Why now:" or any other heading around itself."""
    sources = ", ".join(_line(s, 40) for s in (state.get("sources") or []))
    confidence = _line((state.get("confidence") or {}).get("level", "low"), 16)
    count = state.get("evidence_count") or 0
    lines = [
        f"Correlated across {count} piece{'s' if count != 1 else ''} of "
        f"evidence from {len(state.get('sources') or [])} source(s)"
        + (f" ({sources})" if sources else "")
        + f"; confidence {confidence}.",
    ]
    lines.extend(_context_lines(context))

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
            title = _line(blocker.get("title"), 200)
            where = _line(blocker.get("environment"), 40)
            if title:
                lines.append(f"- Blocked by: [{_line(blocker.get('source'), 40) or '?'}] "
                             f"{title}" + (f" ({where})" if where else ""))

    for label, key in (("Evidence", "supporting"),
                       ("Contradicting", "contradicting")):
        for item in (state.get(key) or [])[:4]:
            if not isinstance(item, dict):
                continue
            title = _line(item.get("title") or item.get("kind"), 200)
            if title:
                lines.append(f"- {label}: [{_line(item.get('source'), 40) or '?'}] "
                             f"{title}")
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


def _open_proposals(project_id: str) -> List[dict]:
    """The project's PROPOSED candidates — read once, used twice.

    Both questions this module asks about an existing proposal need the same
    rows: "does an open proposal already speak for this observation?" (before
    the legacy path runs) and "has this proposal's problem gone away?" (after).
    One bounded query answers both; two would be the same query twice."""
    from backend.services.orchestrator import candidate_actions_store as cas
    try:
        return cas.list_candidate_actions(str(project_id),
                                          status=cas.STATUS_PROPOSED,
                                          limit=_MAX_CANDIDATES_RECONCILED)
    except Exception:      # pragma: no cover — never block the synthesis
        return []


def _already_proposed(rows: Sequence[dict]) -> Set[str]:
    """Observation ids an OPEN proposal already cites as its evidence.

    AUDIT FINDING, fixed here. Suppression asked exactly one question — "is
    this row a member of a correlated subject in the CURRENT projection?" — and
    the projection is computed from a bounded read. A busy project pushes an
    older story's rows past that bound, the subject stops forming, its
    surviving row looks uncorrelated, and the legacy path proposes "Act on:
    Production deployment FAILED" beside the evidence-backed proposal that is
    still open about the very same failure. One problem, two recommendations —
    the failure mode this module exists to prevent, re-entering through the
    window rather than through the state machine.

    An open proposal citing a row is another true answer to the module's own
    question, "has this row already been accounted for?". Membership answers it
    for what is in the window; this answers it for what an earlier window
    already accounted for, and neither needs an unbounded read to do so."""
    out: Set[str] = set()
    for row in rows or []:
        for ref in (row.get("evidence_refs") or []):
            if not isinstance(ref, dict):
                continue
            if str(ref.get("type") or "") != "observation":
                continue
            ref_id = str(ref.get("ref") or "")
            if ref_id:
                out.add(ref_id)
    return out


def _reconcile(project_id: str, *, rows: Sequence[dict],
               membership: Dict[str, dict],
               promoted_keys: Dict[str, str], written_keys: Set[str],
               visible_observations: Set[str]) -> List[str]:
    """Retire PROPOSED candidates whose problem the live evidence says is over.

    THE RULE, stated once. A proposed candidate is superseded only when every
    one of its referenced observations that this projection can actually SEE is
    now spoken for by

      * a subject whose current state is no longer promotable (resolved, in
        flight, merely being discussed), or
      * a DIFFERENT candidate written in this same pass — which is what
        happens when a subject grows: a merged PR joining a deploy target
        changes the correlation's component key set, and therefore its id, so
        yesterday's `intel:<old id>` and today's `intel:<new id>` describe one
        problem and only the newer one should be open.

    THE GUARD, equally important. A candidate none of whose evidence is visible
    is left strictly alone. The observation read is bounded, so "I cannot see
    it" and "it is resolved" are different sentences, and inferring the second
    from the first would retire live work the moment a project got busy.

    `accepted` candidates are never touched: a person took that one, and no
    projection gets to close something a human picked up. Only the store's
    EXISTING lifecycle is used — no new status, no new column, no new table."""
    from backend.services.orchestrator import candidate_actions_store as cas

    retired: List[str] = []
    for row in rows:
        dedup_key = str(row.get("dedup_key") or "")
        if dedup_key and dedup_key in written_keys:
            continue          # just written/refreshed in this pass
        refs = {str(r.get("ref") or "") for r in (row.get("evidence_refs") or [])
                if isinstance(r, dict) and str(r.get("type") or "") == "observation"}
        visible = {r for r in refs if r and r in visible_observations}
        if not visible:
            continue          # cannot see its evidence ⇒ cannot judge it
        accounted = True
        for observation_id in visible:
            subject = membership.get(observation_id)
            if subject is None:
                accounted = False        # still a live, unaccounted signal
                break
            promoted = promoted_keys.get(str(subject.get("id") or ""))
            if promoted is None:
                continue                 # subject exists and proposes nothing
            if promoted != dedup_key:
                continue                 # a newer candidate speaks for it
            accounted = False            # this very candidate is the live one
            break
        if not accounted:
            continue
        try:
            if cas.set_status(str(row.get("id")), cas.STATUS_SUPERSEDED):
                retired.append(str(row.get("id")))
        except Exception:  # pragma: no cover — never block the synthesis
            continue
    return retired


def synthesize_candidates(
    project_id: str,
    user_id: str,
    *,
    metric_changes: Optional[List[dict]] = None,
    observations: Optional[List[dict]] = None,
    goals: Optional[List[dict]] = None,
    decisions: Optional[List[dict]] = None,
    intelligence: Optional[List[dict]] = None,
    membership: Optional[Dict[str, dict]] = None,
    decision_contexts: Optional[Dict[str, dict]] = None,
    max_candidates: int = MAX_CANDIDATES,
) -> List[str]:
    """Record candidate actions for significant signals. Returns the list of
    candidate ids created/updated. Injectable inputs support deterministic
    tests; by default signals are read from their own authorities scoped to
    (user, project).

    `intelligence` is the correlated project-state list (see
    `services.project_intelligence`). Left as None it is DERIVED from the same
    observations this call already read — no extra query, no provider call, no
    model call. Pass `[]` to synthesize from raw signals only.

    `membership` and `decision_contexts` let a caller that has ALREADY computed
    the projection (see `decision_context.build`) hand it over instead of
    paying for a second correlation of the same rows inside one request. Left
    as None both are derived here, so no existing caller changes."""
    if not (project_id and user_id):
        return []

    from backend.services.orchestrator import candidate_actions_store as cas
    from backend.services.orchestrator import decision_context as dc

    # Resolve signals + goals + decisions (fail-soft).
    try:
        if goals is None:
            from backend.services.orchestrator import goals_store
            goals = goals_store.active_goals(str(project_id), limit=10)
        if decisions is None:
            # The DURABLE authority on what this project has already settled.
            # One bounded read, and the reason it is worth a query: a decision
            # recorded after the evidence reframes the recommendation instead
            # of letting a perishable correlation argue with a durable choice.
            from backend.services.orchestrator import decisions_store
            decisions = decisions_store.active_decisions(
                str(project_id), limit=dc.MAX_DECISIONS_SCANNED)
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
        decisions = decisions or []
        metric_changes = metric_changes or []
        observations = observations or []

    goals = goals or []
    decisions = decisions or []
    out: List[str] = []

    # ── Correlated project states → EVIDENCE-BACKED candidates ───────────
    # Derived from the observations already in hand. Pure computation.
    # `membership` maps an observation id → the subject that speaks for it. It
    # is the COMPLETE index over the states below, not a state's capped public
    # id list — see the module docstring on why that distinction is the whole
    # fix. An injected `intelligence` (tests) falls back to the public ids.
    if intelligence is None:
        try:
            from backend.services import project_intelligence as pi
            intelligence, derived = pi.project_states_with_membership(
                observations or [], limit=max_candidates)
            if membership is None:
                membership = derived
        except Exception:  # pragma: no cover — never block on a projection
            intelligence, membership = [], (membership or {})
    if membership is None:
        membership = {}
        for state in intelligence or []:
            if not isinstance(state, dict) or not _is_substantiated(state):
                continue
            for observation_id in state.get("evidence_observation_ids") or []:
                membership.setdefault(str(observation_id), state)

    # ── The DECISION reading over those subjects ─────────────────────────
    # Pure, and computed once: why each subject matters now, how strong its
    # evidence is, whether a commitment is imminent, who can actually resolve
    # it, and whether a durable decision has already settled it. This module
    # writes what that authority derived; it no longer declares constants.
    if decision_contexts is None:
        try:
            decision_contexts = dc.project_contexts(
                intelligence or [], observations=observations or [],
                goals=goals, decisions=decisions)
        except Exception:  # pragma: no cover — never block on a projection
            decision_contexts = {}

    # The project's existing PROPOSALS, read once. They answer "has this row
    # already been accounted for?" for evidence that an earlier, wider window
    # correlated and this one cannot see — see `_already_proposed`.
    open_proposals = _open_proposals(str(project_id))
    accounted_elsewhere = _already_proposed(open_proposals)

    #: subject id → the dedup key written for it in THIS pass, and every
    #: dedup key written at all (metric and legacy rows included). The first
    #: answers "does this subject still propose work?", the second answers
    #: "did this very pass just refresh that row?" — two different questions,
    #: and conflating them would let the reconciliation retire a candidate it
    #: had itself just written.
    promoted_keys: Dict[str, str] = {}
    written_keys: Set[str] = set()

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
        context = (decision_contexts or {}).get(state_id) or {}
        # DERIVED, not declared, and derived in ONE place. Production evidence,
        # corroboration across independent humans, a dated commitment and the
        # recurrence of a failure decide these — see `decision_context`, which
        # also hands the SAME dimensions to the page when it orders subjects
        # without a candidate to rank. Two derivations would be two answers.
        #
        # Goal alignment now needs a REASON, so an unrelated goal no longer
        # stamps every candidate and "aligned" once again discriminates between
        # candidates instead of being universal.
        #
        # `confidence` is the correlation's OWN evidence-derived score, passed
        # in rather than taken from the context so the stored number is the
        # authority's verbatim; where it came from stays inspectable in the
        # state's breakdown.
        raw_confidence = (state.get("confidence") or {}).get("score")
        dimensions = dc.as_dimensions(
            context,
            confidence=(float(raw_confidence)
                        if isinstance(raw_confidence, (int, float)) else 0.5))
        dedup_key = dc.candidate_key(state_id)
        cid = cas.record_candidate_action(
            project_id=str(project_id), user_id=str(user_id),
            title=_state_title(state),
            detail=_state_detail(state, context),
            source="OBSERVATION",
            evidence_refs=_state_evidence_refs(state),
            # Dedup converges on the SUBJECT, so re-running after three more
            # deploy failures updates one candidate instead of adding three.
            dedup_key=dedup_key,
            **dimensions)
        if cid:
            out.append(cid)
            promoted_keys[state_id] = dedup_key
            written_keys.add(dedup_key)

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
            written_keys.add(f"metric:{key}")

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
        if oid and str(oid) in accounted_elsewhere:
            # No subject speaks for this row in the CURRENT window, but an open
            # proposal already does — it was correlated when the window still
            # reached the rest of its story. Proposing it again would put two
            # recommendations on one problem, which is exactly what correlating
            # was for. See `_already_proposed`.
            continue
        ext = o.get("external_id") if isinstance(o, dict) else None
        aligned = _primary_goal(goals)
        summary = _line(o.get("summary") or o.get("kind") or "signal", 120)
        dedup_key = f"obs:{ext or oid}"
        cid = cas.record_candidate_action(
            project_id=str(project_id), user_id=str(user_id),
            title=f"Act on: {summary}",
            detail=(f"High-importance observation from {_line(o.get('source'), 40)} "
                    f"({_line(o.get('kind'), 120)})."),
            goal_id=(aligned or {}).get("id"),
            source="OBSERVATION",
            evidence_refs=[{"type": "observation", "ref": str(oid or ext or "")}],
            recommended_capability="research",
            impact="medium",
            confidence=0.5,
            cost="low", risk="low", urgency="medium",
            dedup_key=dedup_key)
        if cid:
            out.append(cid)
            written_keys.add(dedup_key)

    # ── Close the loop: what the evidence now says is over ───────────────
    # Suppression above only governs what is WRITTEN. Without this, a proposal
    # recorded yesterday for a subject that has since gone green stayed open,
    # was still ranked, and was still recommended — "a resolved subject
    # proposes nothing" was true only of the future. See `_reconcile` for the
    # rule and, just as importantly, for the guard that stops a bounded read
    # from being mistaken for proof of resolution.
    visible = {str(o.get("id")) for o in (observations or [])
               if isinstance(o, dict) and o.get("id")}
    _reconcile(str(project_id), rows=open_proposals, membership=membership,
               promoted_keys=promoted_keys, written_keys=written_keys,
               visible_observations=visible)

    return out


__all__ = ["synthesize_candidates", "MAX_OBSERVATIONS_READ", "MAX_CANDIDATES"]
