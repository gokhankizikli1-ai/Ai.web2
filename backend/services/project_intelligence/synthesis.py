# coding: utf-8
"""Project Intelligence — SYNTHESIS: the project as one picture.

WHAT THIS ANSWERS
-----------------
`correlation` says what each subject is; `interpretation` says what each one
means. Nobody said what the PROJECT adds up to, so every surface that wanted
to open with one honest paragraph — the workspace header, a project-scoped
chat — had to re-derive it, differently, from a list of subjects.

This is that paragraph, as structure:

    the overall reading, in the SAME state vocabulary the subjects use
    what is open · what just resolved · what is uncertain
    what is blocking · what changed last · what we still do not know
    which subjects the evidence itself relates

WHAT IT IS NOT
--------------
  * NOT a health score. There is no number, no percentage and no 72/100 — a
    fabricated aggregate is precisely the kind of confident nonsense this
    layer exists to avoid, and no authority in this codebase owns one.
  * NOT a second ranking. The lists here are SLICES of the order
    `correlation` already produced; nothing is re-scored, re-weighted or
    re-ordered against it. `attention` remains the sole authority on what a
    human should look at now, and `action_prioritizer` on what is worth doing.
  * NOT a second change feed. `project_brain.recent_changes` answers "what
    happened since YOU were last here", per user, across chats, builds, tasks
    and knowledge. `meaningful_changes` here is the last evidence movement per
    UNDERSTOOD SUBJECT — a projection of the subjects, not a rival window.
  * NOT a proposal of work, and not a writer.

DEGRADATION IS THE CONTRACT
---------------------------
    no observations          → state `no_evidence`, empty lists, `no_evidence`
                               gap. Never "everything looks good".
    one connector            → `single_source_project`; no cross-source claim.
    nothing recent           → `no_recent_evidence`, with the real timestamp.
    conflicting subjects     → the conflict survives into `uncertain` and into
                               the overall state; it is never averaged away.
    a merged change, no
    production evidence      → `production_unverified`, never "resolved".

COST: pure functions over the already-bounded subject list plus ONE pass over
the observations already read by the caller. ZERO I/O, ZERO model tokens, ZERO
provider calls, ZERO writes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from backend.services.project_brain.attention import parse_iso
from backend.services.project_intelligence import correlation as corr
from backend.services.project_intelligence import events as ev
from backend.services.project_intelligence import interpretation as interp

# ── The one project-level state code that the subject vocabulary lacks ───────
#: There is nothing to read. Deliberately distinct from `observed` (we saw
#: things and none of them settled anything) — "we know nothing" and "we know
#: things that decide nothing" are different sentences to a user.
STATE_NO_EVIDENCE = "no_evidence"

#: The project reading, derived from the subjects present. First match wins, in
#: this order. It reuses `correlation`'s codes rather than inventing a second
#: state machine — the project is conflicting because a subject is.
_PROJECT_STATE_ORDER = (
    corr.STATE_CONFLICTING,
    corr.STATE_UNRESOLVED,
    corr.STATE_IN_PROGRESS,
    corr.STATE_LIKELY_RESOLVED,
    corr.STATE_OBSERVED,
)

# ── Knowledge-gap codes (stable) ─────────────────────────────────────────────
GAP_NO_EVIDENCE = "no_evidence"
GAP_SINGLE_SOURCE_PROJECT = "single_source_project"
GAP_NO_RECENT_EVIDENCE = "no_recent_evidence"
GAP_PRODUCTION_UNVERIFIED = "production_unverified"
GAP_NO_DEPLOYMENT_EVIDENCE = "no_deployment_evidence"
GAP_UNKNOWN_AFFECTED_SCOPE = "unknown_affected_scope"

_GAP_ORDER = (GAP_NO_EVIDENCE, GAP_NO_RECENT_EVIDENCE,
              GAP_SINGLE_SOURCE_PROJECT, GAP_NO_DEPLOYMENT_EVIDENCE,
              GAP_PRODUCTION_UNVERIFIED, GAP_UNKNOWN_AFFECTED_SCOPE)

# ── Relationship kinds (stable) ──────────────────────────────────────────────
#: Two subjects that were built from at least one of the SAME stored
#: observations. This is the only relationship the evidence itself proves, so
#: it is the only one reported: anything softer would be a guess dressed as a
#: link, which is the failure mode `correlation` is built to avoid.
REL_SHARED_EVIDENCE = "shared_evidence"

# ── Bounds ───────────────────────────────────────────────────────────────────
MAX_OPEN = 5
MAX_RESOLVED = 3
MAX_UNCERTAIN = 4
MAX_BLOCKERS = 4
MAX_CHANGES = 5
MAX_GAPS = 4
MAX_RELATIONSHIPS = 3
#: A subject counts as "recently resolved" when its newest evidence is inside
#: the SAME freshness window correlation already uses. One definition of
#: "recent", not two.
RESOLVED_WINDOW_DAYS = corr.FRESH_DAYS


def _s(value: Any, limit: int = 200) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _iso(when: Optional[datetime]) -> str:
    return when.isoformat().replace("+00:00", "Z") if when is not None else ""


def _understanding(state: Dict[str, Any]) -> Dict[str, Any]:
    value = state.get("understanding")
    return value if isinstance(value, dict) else {}


def _codes(rows: Any) -> Set[str]:
    out: Set[str] = set()
    for row in rows or []:
        if isinstance(row, dict):
            code = _s(row.get("code"), 60)
            if code:
                out.add(code)
    return out


def _reference(state: Dict[str, Any]) -> Dict[str, Any]:
    """One subject, as the compact reference every list here carries.

    Deliberately NOT the whole state row: a synthesis that embedded full
    evidence would grow without bound and would become a second copy of the
    subject list. A consumer that needs the detail looks the subject up by
    `id` — the correlation's identity, not a new one."""
    understanding = _understanding(state)
    change = understanding.get("last_meaningful_change") or {}
    return {
        "id": _s(state.get("id"), 64),
        "subject": _s(state.get("subject"), 120),
        "state": _s(state.get("state"), 40),
        "entity_type": _s(state.get("entity_type"), 40),
        "confidence": _s((state.get("confidence") or {}).get("level"), 16),
        "areas": [_s(a.get("area"), 40)
                  for a in (understanding.get("areas") or [])
                  if isinstance(a, dict)][:interp.MAX_AREAS],
        "change_kind": _s((understanding.get("change_kind") or {}).get("kind"), 40),
        "sources": [_s(s, 40) for s in (state.get("sources") or [])][:5],
        "last_seen": _s(state.get("last_seen"), 64),
        "last_change_at": _s(change.get("at"), 64),
    }


def _coverage(observations: Sequence[Dict[str, Any]],
              states: Sequence[Dict[str, Any]],
              *, now: datetime) -> Dict[str, Any]:
    """What this reading is actually BASED on.

    Every honesty claim downstream is a function of this block, so it is
    computed from the raw rows rather than from the subjects: a project whose
    observations all fell outside the correlation window has evidence and no
    subjects, and the two facts must both be visible."""
    sources: Set[str] = set()
    oldest: Optional[datetime] = None
    newest: Optional[datetime] = None
    counted = 0
    for row in observations or []:
        if not isinstance(row, dict):
            continue
        counted += 1
        source = _s(row.get("source"), 40).strip().lower()
        if source:
            sources.add(source)
        when = parse_iso(row.get("observed_at"))
        if when is None:
            continue
        if oldest is None or when < oldest:
            oldest = when
        if newest is None or when > newest:
            newest = when
    fresh_cutoff = now - timedelta(days=corr.FRESH_DAYS)
    return {
        "observations": counted,
        "sources": sorted(sources),
        "source_count": len(sources),
        "subjects": len([s for s in states or [] if isinstance(s, dict)]),
        "single_source": len(sources) == 1,
        "oldest_observed_at": _iso(oldest),
        "newest_observed_at": _iso(newest),
        # "We have not heard anything lately" — a fact about the EVIDENCE, not
        # a judgement about the project.
        "recent": bool(newest is not None and newest >= fresh_cutoff),
        "window_days": corr.CORRELATION_WINDOW_DAYS,
    }


def _project_state(states: Sequence[Dict[str, Any]]) -> str:
    """The project reading. First subject state present, in the documented
    order — so a project with one conflicting subject reads as conflicting
    rather than being averaged into something calmer."""
    if not states:
        return STATE_NO_EVIDENCE
    present = {_s(s.get("state"), 40) for s in states if isinstance(s, dict)}
    for code in _PROJECT_STATE_ORDER:
        if code in present:
            return code
    return corr.STATE_OBSERVED


def _is_uncertain(state: Dict[str, Any]) -> bool:
    """A subject whose reading a careful person would not act on as settled.

    Conflict, an unproven production claim, an unknown deploy outcome or a
    single-source story — the codes `interpretation` already derived. Thin or
    stale evidence alone does not qualify: those are qualities of every quiet
    project and would make the list mean nothing."""
    codes = _codes(_understanding(state).get("uncertainty"))
    return bool(codes & {interp.UNC_CONFLICTING_EVIDENCE,
                         interp.UNC_PRODUCTION_UNVERIFIED,
                         interp.UNC_DEPLOY_OUTCOME_UNKNOWN,
                         interp.UNC_SINGLE_SOURCE,
                         interp.UNC_TOPICAL_LINK_ONLY})


def _relationships(states: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Subjects the EVIDENCE relates, because they were built from at least one
    of the same stored observations.

    Correlation's components are disjoint over LINK/TOPIC keys, but a recurring
    TARGET (a deploy environment, a CI check) forms its own subject from rows a
    richer subject may also speak for. That overlap is a real, provable
    relationship — "this production target and this fix are the same story from
    two angles" — and it is the only one reported.

    Bounded and NOT pairwise over the projection: the comparison runs over the
    already-capped subject list (at most `MAX_STATES`), which is a small
    constant, and stops at `MAX_RELATIONSHIPS`."""
    rows = [s for s in states or [] if isinstance(s, dict)]
    ids: List[Tuple[str, Set[str], str]] = []
    for state in rows:
        members = {str(x) for x in (state.get("evidence_observation_ids") or [])}
        if members:
            ids.append((_s(state.get("id"), 64), members,
                        _s(state.get("subject"), 120)))
    out: List[Dict[str, Any]] = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            shared = ids[i][1] & ids[j][1]
            if not shared:
                continue
            out.append({
                "kind": REL_SHARED_EVIDENCE,
                "a_id": ids[i][0], "a_subject": ids[i][2],
                "b_id": ids[j][0], "b_subject": ids[j][2],
                "shared_evidence": len(shared),
            })
            if len(out) >= MAX_RELATIONSHIPS:
                return out
    return out


def _gaps(states: Sequence[Dict[str, Any]],
          coverage: Dict[str, Any]) -> List[Dict[str, Any]]:
    """What the project does not know about itself. Codes, never prose."""
    found: Dict[str, Dict[str, Any]] = {}

    def add(code: str, **params: Any) -> None:
        found.setdefault(code, {"code": code, **params})

    if not coverage.get("observations"):
        add(GAP_NO_EVIDENCE)
        return [found[GAP_NO_EVIDENCE]]

    if not coverage.get("recent"):
        add(GAP_NO_RECENT_EVIDENCE,
            newest_observed_at=coverage.get("newest_observed_at") or "")
    if coverage.get("single_source"):
        add(GAP_SINGLE_SOURCE_PROJECT,
            source=(coverage.get("sources") or [""])[0])

    saw_deploy_facet = False
    code_landed = False
    for state in states or []:
        if not isinstance(state, dict):
            continue
        for row in (state.get("facets") or []):
            if not isinstance(row, dict):
                continue
            # Read from the events vocabulary, never re-spelled here, so a
            # rename in the authority cannot silently disable this gap.
            if _s(row.get("facet"), 24) == ev.FACET_DEPLOY:
                saw_deploy_facet = True
            if _s(row.get("semantic_type"), 40) == ev.SEM_CHANGE_LANDED:
                code_landed = True
        understanding = _understanding(state)
        codes = _codes(understanding.get("uncertainty"))
        if interp.UNC_PRODUCTION_UNVERIFIED in codes:
            add(GAP_PRODUCTION_UNVERIFIED)
        if interp.UNC_UNKNOWN_AFFECTED_SCOPE in codes:
            add(GAP_UNKNOWN_AFFECTED_SCOPE)
    if code_landed and not saw_deploy_facet:
        # Work is landing and nothing anywhere reports a deployment. That is a
        # blind spot in what Korvix can see, stated as one.
        add(GAP_NO_DEPLOYMENT_EVIDENCE)

    return [found[code] for code in _GAP_ORDER if code in found][:MAX_GAPS]


def synthesize(states: Sequence[Dict[str, Any]],
               *,
               observations: Sequence[Dict[str, Any]] = (),
               now: Optional[datetime] = None) -> Dict[str, Any]:
    """The bounded, deterministic project-level reading.

    `states` MUST be the interpreted subject list for ONE (owner, project) —
    this function has no store access, so it can neither widen a scope nor
    read a row the caller was not already allowed to see. `observations` is
    the SAME list the states were derived from, passed only so coverage can be
    stated honestly; it is never re-read.

    Pure and total: malformed rows are skipped, and an empty project produces
    the honest empty reading rather than an exception."""
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    rows = [s for s in (states or []) if isinstance(s, dict)]
    coverage = _coverage(observations, rows, now=when)

    # ORDER IS INHERITED, NOT INVENTED. `correlation` already sorted these; a
    # slice of that order is not a second ranking.
    open_rows = [s for s in rows
                 if _s(s.get("state"), 40) in corr_open_states()]
    resolved_cutoff = when - timedelta(days=RESOLVED_WINDOW_DAYS)
    resolved_rows = []
    for state in rows:
        if _s(state.get("state"), 40) != corr.STATE_LIKELY_RESOLVED:
            continue
        seen = parse_iso(state.get("last_seen"))
        if seen is not None and seen >= resolved_cutoff:
            resolved_rows.append(state)
    uncertain_rows = [s for s in rows if _is_uncertain(s)]

    blockers: List[Dict[str, Any]] = []
    changes: List[Dict[str, Any]] = []
    for state in rows:
        understanding = _understanding(state)
        subject_id = _s(state.get("id"), 64)
        subject = _s(state.get("subject"), 120)
        for blocker in (understanding.get("blockers") or []):
            if not isinstance(blocker, dict):
                continue
            entry = dict(blocker)
            entry["subject_id"] = subject_id
            entry["subject"] = subject
            blockers.append(entry)
        change = understanding.get("last_meaningful_change") or {}
        if isinstance(change, dict) and change.get("at"):
            entry = dict(change)
            entry["subject_id"] = subject_id
            entry["subject"] = subject
            changes.append(entry)
    # Newest first; ties break on subject id so the payload is byte-stable.
    changes.sort(key=lambda c: (
        -(parse_iso(c.get("at")).timestamp()
          if parse_iso(c.get("at")) is not None else float("-inf")),
        _s(c.get("subject_id"), 64)))

    return {
        "generated_at": _iso(when),
        "window_days": corr.CORRELATION_WINDOW_DAYS,
        "state": _project_state(rows),
        "coverage": coverage,
        "open": [_reference(s) for s in open_rows[:MAX_OPEN]],
        "resolved_recently": [_reference(s) for s in resolved_rows[:MAX_RESOLVED]],
        "uncertain": [_reference(s) for s in uncertain_rows[:MAX_UNCERTAIN]],
        "blockers": blockers[:MAX_BLOCKERS],
        "meaningful_changes": changes[:MAX_CHANGES],
        "gaps": _gaps(rows, coverage),
        "relationships": _relationships(rows),
        "counts": {
            "subjects": len(rows),
            "open": len(open_rows),
            "resolved_recently": len(resolved_rows),
            "uncertain": len(uncertain_rows),
            "blockers": len(blockers),
        },
    }


def corr_open_states() -> frozenset:
    """The open-state set, read from the correlation authority rather than
    re-listed here, so the two can never disagree about what "open" means."""
    return frozenset({corr.STATE_UNRESOLVED, corr.STATE_CONFLICTING})


__all__ = [
    "STATE_NO_EVIDENCE",
    "GAP_NO_EVIDENCE", "GAP_SINGLE_SOURCE_PROJECT", "GAP_NO_RECENT_EVIDENCE",
    "GAP_PRODUCTION_UNVERIFIED", "GAP_NO_DEPLOYMENT_EVIDENCE",
    "GAP_UNKNOWN_AFFECTED_SCOPE",
    "REL_SHARED_EVIDENCE",
    "MAX_OPEN", "MAX_RESOLVED", "MAX_UNCERTAIN", "MAX_BLOCKERS",
    "MAX_CHANGES", "MAX_GAPS", "MAX_RELATIONSHIPS", "RESOLVED_WINDOW_DAYS",
    "synthesize",
]
