# coding: utf-8
"""Business Brain — DECISION CONTEXT: from "what is true" to "why it matters now".

WHERE THIS SITS, AND THE GAP IT CLOSES
--------------------------------------
    observations_store        what came in                    (authority)
    project_intelligence      what it IS and what it MEANS    (authority)
    ─────────────────────────────────────────────────────────────────────
    decision_context          why it matters NOW              ← this module
    ─────────────────────────────────────────────────────────────────────
    candidate_synthesis       what could be worth doing       (authority)
    action_prioritizer        what to do FIRST                (authority)
    execution_policy          whether it may run              (authority)

`project_intelligence` answers "the production deploy of the merged payment fix
failed" and stops there, correctly: it owns facts, not priority. Everything
downstream then had to decide importance from constants. `candidate_synthesis`
gave EVERY open subject `impact="high", urgency="high"`, and `action_prioritizer`
turned those constants into a score. So a README typo tracked as an open issue
and a production outage twelve hours before a launch produced the SAME numbers,
and the launch tomorrow — which the calendar connector had already ingested —
took no part in the ranking at all.

This module is the missing projection: it reads the interpreted subject, the
project's own commitments, its goals and its durable decisions, and states —
in bounded, explainable fields — WHY a subject deserves attention now, HOW
strong the evidence is, WHO can actually resolve it, and WHAT would make the
reading wrong.

WHAT IT IS NOT
--------------
  * NOT a store. Nothing here is persisted, ever. It is recomputed from rows a
    caller already read, exactly like `attention`, `correlation` and
    `synthesis` — an operational reading must not outlive its evidence.
  * NOT a second ranking engine. It produces the INPUTS to the one ranking
    authority (`action_prioritizer`), which still owns the order, and a TIER
    that authority applies. There is no second sort anywhere in this file.
  * NOT a proposal of work. `candidate_synthesis` still decides what to
    propose; this says how much it matters if proposed.
  * NOT an execution path. Nothing here can run, approve, or write anything.
  * NOT a new interpretation layer. Every fact about a subject is READ from
    `project_intelligence`'s `understanding`; none of it is re-derived from
    prose here.

THE TIER LADDER — WHY LEXICOGRAPHIC, NOT A WEIGHTED SUM
--------------------------------------------------------
A single weighted score cannot express "a verified production outage outranks
five informational signals no matter how many of them there are", because any
weight small enough to be honest is also small enough to be out-summed by
volume. So the primary ordering key is a small, ordered, DOCUMENTED tier — a
lexicographic ladder — and the existing score only breaks ties INSIDE a tier:

    1 deadline_risk       an open blocker AND an imminent commitment
    2 production_broken   production is verifiably red, unresolved
    3 customer_impact     unresolved AND corroborated by independent humans
    4 blocked             unresolved with a concrete blocker (CI, issue, deploy)
    5 unverified          open, but nothing concrete is broken
    6 time_sensitive      an imminent commitment and nothing broken
    7 routine             everything else, and everything with no evidence

Only a subject carrying real evidence can claim a tier above `routine`, so a
metric candidate, a lone high-importance observation, or anything else without
a decision context can never displace a verified outage. Counting is never a
tier input: corroboration is capped at a LEVEL (`reported` / `corroborated`),
so a chatty channel cannot climb.

TIME IS STRUCTURAL; WORDING IS NEVER A RANKING INPUT
-----------------------------------------------------
Deadline pressure is computed from a calendar event's own `start` against
`now`. Nothing else. The event's TITLE is classified into `milestone` vs
`meeting` for display only, is marked `basis: "textual"`, and is deliberately
NOT used by `_tier` — so no connector text, in any language, can move a subject
up the ladder. That is the whole defense against prompt-injection-by-wording,
and it is structural rather than a filter.

A commitment on its own creates NOTHING. It cannot invent a blocker, cannot
propose work, and cannot raise a project with no open problem above `routine`
unless it is genuinely imminent (tier 6, below everything that is broken).

COST: pure functions over rows the caller already read. ZERO I/O, ZERO model
tokens, ZERO provider calls, ZERO writes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from backend.services.project_brain.attention import parse_iso, stable_id
from backend.services.project_intelligence import correlation as corr
from backend.services.project_intelligence import interpretation as interp
from backend.services.project_intelligence import keys as k

logger = logging.getLogger(__name__)

# ── Priority tiers (ordered; SMALLER IS MORE IMPORTANT) ──────────────────────
TIER_DEADLINE_RISK = 1
TIER_PRODUCTION_BROKEN = 2
TIER_CUSTOMER_IMPACT = 3
TIER_BLOCKED = 4
TIER_UNVERIFIED = 5
TIER_TIME_SENSITIVE = 6
TIER_ROUTINE = 7

#: Tier → stable code. The code is what travels; the integer is an ordering
#: detail and nothing renders it as a number.
TIER_CODE = {
    TIER_DEADLINE_RISK:     "deadline_risk",
    TIER_PRODUCTION_BROKEN: "production_broken",
    TIER_CUSTOMER_IMPACT:   "customer_impact",
    TIER_BLOCKED:           "blocked",
    TIER_UNVERIFIED:        "unverified",
    TIER_TIME_SENSITIVE:    "time_sensitive",
    TIER_ROUTINE:           "routine",
}
#: The tier a candidate gets when no evidence-backed context exists for it.
#: Deliberately the bottom: an unevidenced proposal may never outrank an
#: evidenced one on tier alone.
DEFAULT_TIER = TIER_ROUTINE

# ── Deadline pressure (STRUCTURAL — derived from time, never from wording) ───
DEADLINE_NONE = "none"
DEADLINE_APPROACHING = "approaching"
DEADLINE_IMMINENT = "imminent"

#: A commitment inside this window is imminent. Matches `attention`'s own
#: "a meeting starts soon" window doubled: attention answers "look now", this
#: answers "is the work at risk before it", and a launch the morning after
#: tomorrow is at risk from a deploy that is red tonight.
IMMINENT_WITHIN = timedelta(hours=48)
#: Beyond this a dated commitment exerts no pressure at all. A launch a month
#: away is a plan, not a deadline, and treating a date as urgency is exactly
#: the fake alarm this layer refuses to raise.
APPROACHING_WITHIN = timedelta(days=7)

#: Commitment kinds — DISPLAY ONLY. Never read by `_tier`. See the docstring.
COMMITMENT_MILESTONE = "milestone"
COMMITMENT_MEETING = "meeting"

#: Tokens that name a milestone rather than a conversation. Compared AFTER
#: `keys.normalize_token`, so they inherit the existing folding (Turkish
#: `yayın` → `yayin`, German `Veröffentlichung` → `veroffentlichung`) and no
#: second tokenizer is introduced. EN / TR / DE, the product's languages.
_MILESTONE_TOKENS = frozenset({
    # English
    "launch", "release", "ship", "shipping", "golive", "cutover", "demo",
    "deadline", "handover", "rollout", "onboarding", "kickoff", "presentation",
    # Turkish
    "lansman", "yayin", "sunum", "teslim", "canli", "duyuru", "tanitim",
    # German
    "veroffentlichung", "abgabe", "frist", "vorstellung", "auslieferung",
})

# ── Impact / urgency levels (the vocabulary `candidate_actions_store` stores) ─
LEVEL_HIGH = "high"
LEVEL_MEDIUM = "medium"
LEVEL_LOW = "low"
LEVEL_UNKNOWN = "unknown"

# ── Production impact (structural — from the deploy facets' environments) ────
PRODUCTION_BROKEN = "broken"
PRODUCTION_UNVERIFIED = "unverified"
PRODUCTION_VERIFIED_LIVE = "verified_live"
PRODUCTION_UNKNOWN = "unknown"

# ── Customer impact (independent human reports, deduplicated by SOURCE) ──────
CUSTOMER_NONE = "none"
CUSTOMER_REPORTED = "reported"
CUSTOMER_CORROBORATED = "corroborated"

#: The sources that carry a human saying something is wrong. Slack is a
#: colleague, Gmail is (often) a customer; two DIFFERENT ones agreeing is the
#: only thing this module will call corroboration. Repetition inside one source
#: cannot climb, because `correlation` already collapses a source's discussion
#: rows into ONE deduplicated evidence unit before this ever sees them.
_HUMAN_SOURCES = ("slack", "gmail")

# ── Evidence strength ────────────────────────────────────────────────────────
EVIDENCE_STRONG = "strong"
EVIDENCE_MODERATE = "moderate"
EVIDENCE_THIN = "thin"

# ── Blocker / dependency / resolution ────────────────────────────────────────
BLOCKER_BLOCKED = "blocked"
BLOCKER_CLEAR = "clear"
BLOCKER_UNKNOWN = "unknown"

DEPENDENCY_INDEPENDENT = "independent"
DEPENDENCY_EXTERNAL_SYSTEM = "waiting_on_external_system"
DEPENDENCY_SHARED_STORY = "part_of_related_story"

RESOLUTION_KORVIX = "korvix"
RESOLUTION_HUMAN_EXTERNAL = "human_external"
RESOLUTION_UNKNOWN = "unknown"

#: What Korvix itself can do about a connector-observed problem TODAY. It can
#: read, correlate and investigate; it has no write access to GitHub, Vercel,
#: Slack, Gmail or Calendar, so it cannot merge, redeploy or reply. Saying so
#: is the point: a queue that implies otherwise is lying to the user.
KORVIX_INVESTIGATE = "investigate"
KORVIX_NOTHING = "none"

#: Providers whose systems a fix would have to change. Read from the ONE
#: connector registry so a new connector cannot be forgotten here.
try:                                                    # pragma: no cover
    from backend.services.orchestrator.observations_store import CONNECTOR_SOURCES
except Exception:                                       # pragma: no cover
    CONNECTOR_SOURCES = ("github", "gmail", "vercel", "calendar", "slack")

# ── Reason codes — WHY NOW (importance) ──────────────────────────────────────
# The interpretation codes are REUSED verbatim wherever one already says the
# thing; only concepts that layer genuinely does not have get a new code.
WHY_DEADLINE_IMMINENT = "deadline_imminent"
WHY_DEADLINE_APPROACHING = "deadline_approaching"
WHY_CUSTOMER_CORROBORATED = "customer_impact_corroborated"
WHY_CUSTOMER_REPORTED = "customer_impact_reported"
WHY_GOAL_ALIGNED = "goal_aligned"
WHY_RECURRING_FAILURE = "recurring_failure"

_WHY_ORDER = (
    WHY_DEADLINE_IMMINENT,
    interp.IMP_PRODUCTION_BROKEN,
    interp.IMP_RECURRENCE,
    WHY_CUSTOMER_CORROBORATED,
    interp.IMP_BLOCKED_BY_CI,
    interp.IMP_ISSUE_OPEN,
    interp.IMP_FIX_NOT_PROVEN_LIVE,
    WHY_CUSTOMER_REPORTED,
    WHY_DEADLINE_APPROACHING,
    WHY_RECURRING_FAILURE,
    WHY_GOAL_ALIGNED,
)

# ── Reason codes — CAVEATS (what would make this reading wrong) ──────────────
CAVEAT_DECISION_RECORDED = "decision_recorded_after_evidence"
CAVEAT_RELATED_SUBJECT = "part_of_related_story"

_CAVEAT_ORDER = (
    interp.UNC_CONFLICTING_EVIDENCE,
    CAVEAT_DECISION_RECORDED,
    interp.UNC_PRODUCTION_UNVERIFIED,
    interp.UNC_DEPLOY_OUTCOME_UNKNOWN,
    interp.UNC_STALE_EVIDENCE,
    interp.UNC_SINGLE_SOURCE,
    interp.UNC_TOPICAL_LINK_ONLY,
    interp.UNC_THIN_EVIDENCE,
    interp.UNC_NO_DECISIVE_EVIDENCE,
    interp.UNC_UNDATED_EVIDENCE,
    interp.UNC_UNKNOWN_AFFECTED_SCOPE,
    CAVEAT_RELATED_SUBJECT,
)

# ── Bounds ───────────────────────────────────────────────────────────────────
MAX_WHY_NOW = 4
MAX_CAVEATS = 4
MAX_COMMITMENTS = 3
MAX_FOCUS_NEXT = 3
MAX_GOALS_SCANNED = 10
MAX_DECISIONS_SCANNED = 10
#: Distinctive words a goal / decision must share with a subject before it is
#: called related. One is enough only when it is distinctive — `keys` already
#: knows which words describe half of any project.
MIN_SHARED_TOKENS = 1


def _s(value: Any, limit: int = 200) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _clean(value: Any, limit: int = 200) -> str:
    """One display-safe line of provider/user text.

    Whitespace is collapsed, so a Slack message or a calendar title can add
    words to a line but can never add a LINE — it cannot forge a prompt header
    or close the block it sits in. The same rule `project_brain.client._clean`
    applies, applied here because these strings travel into the same places."""
    return " ".join(str(value or "").split())[:limit]


def _iso(when: Optional[datetime]) -> str:
    return when.isoformat().replace("+00:00", "Z") if when is not None else ""


def _now(now: Optional[datetime]) -> datetime:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc)


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


def _distinctive(text: Any) -> Set[str]:
    """The words in `text` that could identify a subject.

    `keys.GENERIC_TOKENS` is the EXISTING list of words too common inside a
    software project to identify anything ("production", "deploy", "issue"),
    and it is read rather than re-listed so the two can never disagree about
    what "distinctive" means."""
    return {t for t in k.tokenize(text) if t not in k.GENERIC_TOKENS}


# ══════════════════════════════════════════════════════════════════════════
# COMMITMENTS — the project's own dated obligations
# ══════════════════════════════════════════════════════════════════════════

def _commitment_kind(title: str) -> Tuple[str, str]:
    """`(kind, basis)` — DISPLAY ONLY, never a ranking input."""
    tokens = set(k.tokenize(title))
    if tokens & _MILESTONE_TOKENS:
        return COMMITMENT_MILESTONE, "textual"
    return COMMITMENT_MEETING, "none"


def _pressure(hours: float) -> str:
    if hours <= IMMINENT_WITHIN.total_seconds() / 3600.0:
        return DEADLINE_IMMINENT
    if hours <= APPROACHING_WITHIN.total_seconds() / 3600.0:
        return DEADLINE_APPROACHING
    return DEADLINE_NONE


def commitments(observations: Sequence[Dict[str, Any]], *,
                now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """The project's dated FUTURE commitments, soonest first, bounded.

    Read from the calendar observations the caller already holds — no query, no
    provider call. Only the event's own `start` decides pressure.

    Deliberately conservative:
      * a cancelled event is not a commitment;
      * an event that already started is history, not pressure;
      * an event with no parseable start exerts NO pressure (an undated
        obligation is not an urgent one, and guessing would manufacture alarm);
      * an event beyond `APPROACHING_WITHIN` is dropped entirely, so a date a
        month out cannot make anything urgent.

    One row per calendar event id — the connector re-records an event on every
    edit, and five edits of one launch are one commitment."""
    when = _now(now)
    best: Dict[str, Dict[str, Any]] = {}
    for obs in observations or []:
        if not isinstance(obs, dict):
            continue
        if _s(obs.get("source"), 40).strip().lower() != "calendar":
            continue
        kind = _s(obs.get("kind"), 120)
        if not kind.startswith("calendar.event."):
            continue
        if kind.rsplit(".", 1)[-1] == "cancelled":
            continue          # a commitment that disappeared exerts no pressure
        payload = obs.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        start = parse_iso(payload.get("start"))
        if start is None or start < when:
            continue
        hours = (start - when).total_seconds() / 3600.0
        pressure = _pressure(hours)
        if pressure == DEADLINE_NONE:
            continue
        title = _clean(payload.get("title") or obs.get("summary"), 160)
        kind_code, kind_basis = _commitment_kind(title)
        event_id = _s(payload.get("event_id"), 160) or _s(obs.get("id"), 64)
        row = {
            # The provider's own event id never leaves: the digest travels, the
            # same rule `attention` applies to every subject-derived identity.
            "event_key": stable_id(f"calendar:event:{event_id}"),
            "title": title,
            "at": _iso(start),
            "hours_until": round(hours, 2),
            "pressure": pressure,
            "kind": kind_code,
            "kind_basis": kind_basis,
            "observation_id": _s(obs.get("id"), 64),
        }
        current = best.get(event_id)
        if current is None or row["hours_until"] < current["hours_until"]:
            best[event_id] = row
    rows = sorted(best.values(), key=lambda r: (r["hours_until"], r["event_key"]))
    return rows[:MAX_COMMITMENTS]


def nearest_commitment(observations: Sequence[Dict[str, Any]], *,
                       now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """The soonest dated future commitment, or None. See `commitments`."""
    rows = commitments(observations, now=now)
    return rows[0] if rows else None


# ══════════════════════════════════════════════════════════════════════════
# SUBJECT DIMENSIONS — every one READ from the interpretation, never re-derived
# ══════════════════════════════════════════════════════════════════════════

def _production_impact(implications: Set[str]) -> str:
    if interp.IMP_PRODUCTION_BROKEN in implications:
        return PRODUCTION_BROKEN
    if interp.IMP_VERIFIED_LIVE in implications:
        return PRODUCTION_VERIFIED_LIVE
    if (interp.IMP_FIX_NOT_PROVEN_LIVE in implications
            or interp.IMP_PREVIEW_ONLY_VERIFIED in implications):
        return PRODUCTION_UNVERIFIED
    return PRODUCTION_UNKNOWN


def _customer_impact(state: Dict[str, Any]) -> Tuple[str, List[str]]:
    """`(level, the human sources that reported it)`.

    Counted over `state["sources"]`, which `correlation` derives from
    DEDUPLICATED evidence units — so twelve Slack messages in one channel are
    one source, and this can never be inflated by repetition. Two DIFFERENT
    human sources are corroboration; one is a report."""
    sources = {_s(s, 40).strip().lower() for s in (state.get("sources") or [])}
    human = [s for s in _HUMAN_SOURCES if s in sources]
    if len(human) >= 2:
        return CUSTOMER_CORROBORATED, human
    if human:
        return CUSTOMER_REPORTED, human
    return CUSTOMER_NONE, []


def _evidence_strength(state: Dict[str, Any], breakdown: Dict[str, Any]) -> str:
    """How much this reading rests on. Coarse and honest: an anchor on a shared
    resource identity plus more than one source is strong; a wording-only link
    with one source is thin."""
    try:
        sources = int(breakdown.get("distinct_sources") or 0)
    except (TypeError, ValueError):
        sources = 0
    try:
        evidence = int(state.get("evidence_count") or 0)
    except (TypeError, ValueError):
        evidence = 0
    structural = _s(breakdown.get("anchor_kind"), 24) == "structural"
    decisive = 0
    try:
        decisive = int(breakdown.get("decisive_facets") or 0)
    except (TypeError, ValueError):
        pass
    if structural and sources >= 2 and decisive >= 1:
        return EVIDENCE_STRONG
    if evidence >= corr.MIN_CORROBORATED_EVIDENCE and (structural or sources >= 2):
        return EVIDENCE_MODERATE
    return EVIDENCE_THIN


def _blockers(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = _understanding(state).get("blockers")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _dependency(blockers: Sequence[Dict[str, Any]]) -> str:
    for row in blockers:
        source = _s(row.get("source"), 40).strip().lower()
        if source in CONNECTOR_SOURCES:
            return DEPENDENCY_EXTERNAL_SYSTEM
    return DEPENDENCY_INDEPENDENT


def _actionability(blockers: Sequence[Dict[str, Any]], *,
                   capability: str) -> Dict[str, Any]:
    """What Korvix can ACTUALLY do, and who has to do the rest.

    A production deployment, a merge and a customer reply all live in systems
    Korvix reads and cannot write. Investigating is genuinely useful and
    genuinely automatic; resolving is not, and a queue that implies it is would
    be telling the user something false. Both halves are stated."""
    providers: List[str] = []
    for row in blockers:
        source = _s(row.get("source"), 40).strip().lower()
        if source in CONNECTOR_SOURCES and source not in providers:
            providers.append(source)
    if providers:
        resolution = RESOLUTION_HUMAN_EXTERNAL
    elif capability:
        # Nothing is blocked inside somebody else's system, so the useful next
        # step IS the one Korvix can take on its own.
        resolution = RESOLUTION_KORVIX
    else:
        resolution = RESOLUTION_UNKNOWN
    autonomy = "REVIEW"
    try:
        from backend.services.orchestrator import project_supervisor as sup
        autonomy = sup.autonomy_for_capability(capability)
    except Exception:      # pragma: no cover — fail conservative
        pass
    return {
        # What Korvix may do on its own, through the EXISTING capability +
        # policy authorities. Never a new execution path.
        "korvix": KORVIX_INVESTIGATE if capability else KORVIX_NOTHING,
        "capability": _s(capability, 40),
        "autonomy": autonomy,
        # Who must act for the PROBLEM to go away — a different question, and
        # the one that was previously unanswered.
        "resolution": resolution,
        "external_providers": providers[:3],
    }


def _risk(capability: str) -> Tuple[str, str]:
    """`(risk level, reversibility)` for the proposed work, read from the
    EXISTING execution policy rather than guessed. Investigation is cheap and
    undoable; a paid build is not; a denied capability is not offered."""
    try:
        from backend.services.orchestrator import execution_policy as ep
        tier = ep.classify_capability(capability)
        if tier == ep.POLICY_DENIED:
            return LEVEL_HIGH, "irreversible"
        if tier == ep.POLICY_APPROVAL_REQUIRED:
            return LEVEL_MEDIUM, "reversible"
    except Exception:      # pragma: no cover — fail conservative
        return LEVEL_MEDIUM, "unknown"
    return LEVEL_LOW, "reversible"


def _goal_alignment(state: Dict[str, Any],
                    goals: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """The active goal this subject actually serves, or none.

    AUDIT FINDING, fixed here. Every correlated candidate used to be stamped
    with the project's highest-priority active goal whatever it was about, so
    "aligned to a goal" was true of everything and therefore discriminated
    between nothing — the goal term in `action_prioritizer` was a constant
    added to every row.

    Alignment now needs a REASON: a distinctive word shared between the goal's
    title and the subject. `keys.GENERIC_TOKENS` is what makes that meaningful
    — "improve production" shares "production" with everything and so shares
    nothing. Basis is reported as `topical` because that is what it is, and
    `_tier` never reads it: a goal can move a subject WITHIN its tier, never
    across one, so wording cannot promote work past a verified outage."""
    subject_tokens = _distinctive(state.get("subject"))
    for row in (_understanding(state).get("areas") or []):
        if isinstance(row, dict) and row.get("area") not in (None, "", interp.AREA_UNKNOWN):
            subject_tokens.add(_s(row.get("area"), 40))
    best: Optional[Dict[str, Any]] = None
    for goal in list(goals or [])[:MAX_GOALS_SCANNED]:
        if not isinstance(goal, dict):
            continue
        gid = _s(goal.get("id"), 64)
        if not gid:
            continue
        shared = sorted(_distinctive(goal.get("title")) & subject_tokens)
        if len(shared) < MIN_SHARED_TOKENS:
            continue
        try:
            priority = int(goal.get("priority") or 2)
        except (TypeError, ValueError):
            priority = 2
        row = {"goal_id": gid, "title": _clean(goal.get("title"), 160),
               "priority": priority, "basis": "topical",
               "aligned": True, "shared": shared[:3]}
        # Highest priority wins; a stable tie-break on the id keeps the
        # projection byte-identical across runs.
        if best is None or (priority, row["goal_id"]) > (best["priority"], best["goal_id"]):
            best = row
    if best is not None:
        return best
    return {"goal_id": "", "title": "", "priority": 0, "basis": "none",
            "aligned": False, "shared": []}


def _decision_override(state: Dict[str, Any],
                       decisions: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """A durable decision recorded AFTER this subject's newest evidence, on a
    topic that shares a distinctive word with it.

    This is the SAME rule `project_supervisor._stale_artifacts` already applies
    to build artifacts — "a newer project decision post-dates this" — reused
    rather than reinvented, and applied to a recommendation instead of a file.
    It never deletes the recommendation: it reframes it, because the decision
    is the durable authority and the correlation is a perishable reading of
    events that predate it."""
    last_seen = parse_iso(state.get("last_seen"))
    if last_seen is None:
        return {"decided": False}
    subject_tokens = _distinctive(state.get("subject"))
    if not subject_tokens:
        return {"decided": False}
    for row in list(decisions or [])[:MAX_DECISIONS_SCANNED]:
        if not isinstance(row, dict):
            continue
        when = parse_iso(row.get("created_at"))
        if when is None or when < last_seen:
            continue
        topic = row.get("topic") or row.get("label") or ""
        text = row.get("value") or row.get("text") or ""
        shared = sorted(_distinctive(f"{topic} {text}") & subject_tokens)
        if len(shared) < MIN_SHARED_TOKENS:
            continue
        return {"decided": True, "topic": _clean(topic, 120),
                "at": _s(row.get("created_at"), 64), "shared": shared[:3]}
    return {"decided": False}


# ══════════════════════════════════════════════════════════════════════════
# THE PROJECTION
# ══════════════════════════════════════════════════════════════════════════

def _impact(*, production: str, customer: str, implications: Set[str],
            open_subject: bool) -> str:
    """How much this matters to the PROJECT, from evidence rather than from a
    constant. Only a verified production failure, a regression, or an
    independently corroborated report is `high`."""
    if not open_subject:
        return LEVEL_LOW
    if production == PRODUCTION_BROKEN or interp.IMP_RECURRENCE in implications:
        return LEVEL_HIGH
    if customer == CUSTOMER_CORROBORATED:
        return LEVEL_HIGH
    if (implications & {interp.IMP_BLOCKED_BY_CI, interp.IMP_ISSUE_OPEN,
                        interp.IMP_FIX_NOT_PROVEN_LIVE}
            or customer == CUSTOMER_REPORTED):
        return LEVEL_MEDIUM
    return LEVEL_LOW


def _urgency(*, tier: int) -> str:
    """Urgency is the tier, expressed in the coarse vocabulary the candidate
    store already stores. One concept, two spellings — never two opinions."""
    if tier <= TIER_CUSTOMER_IMPACT:
        return LEVEL_HIGH
    if tier <= TIER_TIME_SENSITIVE:
        return LEVEL_MEDIUM
    return LEVEL_LOW


def _tier(*, open_subject: bool, production: str, customer: str,
          blocked: bool, pressure: str, freshness: str, decided: bool) -> int:
    """The ladder. Every input is STRUCTURAL (a facet polarity, a deploy
    environment, a distinct source count, a clock comparison) — none of them is
    a word anybody typed, which is what makes the ordering un-manipulable by
    connector text."""
    if decided:
        # A durable decision post-dating the evidence outranks the reading:
        # the recommendation survives to be visible, at the bottom.
        return TIER_ROUTINE
    if open_subject:
        if (production == PRODUCTION_BROKEN or blocked) and pressure == DEADLINE_IMMINENT:
            tier = TIER_DEADLINE_RISK
        elif production == PRODUCTION_BROKEN:
            tier = TIER_PRODUCTION_BROKEN
        elif customer == CUSTOMER_CORROBORATED:
            tier = TIER_CUSTOMER_IMPACT
        elif blocked:
            tier = TIER_BLOCKED
        else:
            tier = TIER_UNVERIFIED
    elif pressure == DEADLINE_IMMINENT:
        tier = TIER_TIME_SENSITIVE
    else:
        tier = TIER_ROUTINE
    if freshness == "stale":
        # The evidence is older than the correlation window itself. It may
        # still be true; it may equally have been fixed without telling us, so
        # it steps down one rung rather than commanding the queue.
        tier = min(TIER_ROUTINE, tier + 1)
    return tier


def for_subject(
    state: Dict[str, Any], *,
    goals: Sequence[Dict[str, Any]] = (),
    decisions: Sequence[Dict[str, Any]] = (),
    commitment: Optional[Dict[str, Any]] = None,
    capability: str = "research",
) -> Dict[str, Any]:
    """One INTERPRETED subject → the bounded decision context for it.

    Deliberately CLOCK-FREE. Every time-dependent fact it needs has already
    been decided against one `now` by an authority that owns it — freshness by
    `correlation`, deadline pressure by `commitments` — so this function cannot
    disagree with the projection it describes by being called a second later.

    PURE and total: a malformed or partial state row yields a fully-shaped
    context with honest `unknown` values rather than raising, because every
    consumer renders or ranks it and none of them may crash on a row an older
    projection produced."""
    if not isinstance(state, dict):
        state = {}
    understanding = _understanding(state)
    implications = _codes(understanding.get("implications"))
    uncertainty = _codes(understanding.get("uncertainty"))
    confidence = state.get("confidence")
    confidence = confidence if isinstance(confidence, dict) else {}
    breakdown = confidence.get("breakdown")
    breakdown = breakdown if isinstance(breakdown, dict) else {}

    subject_state = _s(state.get("state"), 40)
    open_subject = subject_state in (corr.STATE_UNRESOLVED, corr.STATE_CONFLICTING)
    blockers = _blockers(state)
    production = _production_impact(implications)
    customer, human_sources = _customer_impact(state)
    freshness = _s(breakdown.get("freshness_band"), 24) or "unknown"
    pressure = _s((commitment or {}).get("pressure"), 24) or DEADLINE_NONE
    goal = _goal_alignment(state, goals)
    decision = _decision_override(state, decisions)

    tier = _tier(open_subject=open_subject, production=production,
                 customer=customer, blocked=bool(blockers), pressure=pressure,
                 freshness=freshness, decided=bool(decision.get("decided")))
    impact = _impact(production=production, customer=customer,
                     implications=implications, open_subject=open_subject)
    risk, reversibility = _risk(capability)

    # ── why now / caveats — stable codes, ordered, bounded ────────────────
    why: Set[str] = set()
    if pressure == DEADLINE_IMMINENT and (open_subject or blockers):
        why.add(WHY_DEADLINE_IMMINENT)
    elif pressure == DEADLINE_APPROACHING and open_subject:
        why.add(WHY_DEADLINE_APPROACHING)
    for code in (interp.IMP_PRODUCTION_BROKEN, interp.IMP_RECURRENCE,
                 interp.IMP_BLOCKED_BY_CI, interp.IMP_ISSUE_OPEN,
                 interp.IMP_FIX_NOT_PROVEN_LIVE):
        if code in implications:
            why.add(code)
    if customer == CUSTOMER_CORROBORATED:
        why.add(WHY_CUSTOMER_CORROBORATED)
    elif customer == CUSTOMER_REPORTED:
        why.add(WHY_CUSTOMER_REPORTED)
    if goal.get("aligned"):
        why.add(WHY_GOAL_ALIGNED)
    try:
        members = int(state.get("member_count") or 0)
    except (TypeError, ValueError):
        members = 0
    if open_subject and members >= 3 and interp.IMP_RECURRENCE not in implications:
        # One target reported failing several times is one recurring problem —
        # a fact about the evidence, not a count that climbs without bound.
        why.add(WHY_RECURRING_FAILURE)

    caveats = set(uncertainty)
    if decision.get("decided"):
        caveats.add(CAVEAT_DECISION_RECORDED)

    try:
        score = float(confidence.get("score") or 0.0)
    except (TypeError, ValueError):
        score = 0.0
    try:
        sources = int(breakdown.get("distinct_sources") or 0)
    except (TypeError, ValueError):
        sources = 0
    try:
        evidence_count = int(state.get("evidence_count") or 0)
    except (TypeError, ValueError):
        evidence_count = 0

    return {
        "subject_id": _s(state.get("id"), 64),
        "subject": _clean(state.get("subject"), 120),
        "project_state": subject_state,
        "unresolved": open_subject,
        "resolved": subject_state == corr.STATE_LIKELY_RESOLVED,
        "areas": [_s(a.get("area"), 40)
                  for a in (understanding.get("areas") or [])
                  if isinstance(a, dict)][:interp.MAX_AREAS],
        "change_kind": _s((understanding.get("change_kind") or {}).get("kind"), 40),

        "priority_tier": tier,
        "priority_basis": TIER_CODE.get(tier, TIER_CODE[TIER_ROUTINE]),
        "urgency": _urgency(tier=tier),
        "impact": impact,

        "confidence": round(score, 4),
        "confidence_level": _s(confidence.get("level"), 16) or "low",
        "evidence_strength": _evidence_strength(state, breakdown),
        "corroboration_count": evidence_count,
        "source_diversity": sources,
        "customer_impact": customer,
        "customer_sources": human_sources,
        "production_impact": production,

        "deadline_pressure": pressure,
        "deadline": dict(commitment) if commitment else None,

        "goal_alignment": goal,
        "decision_state": decision,

        "blocker_state": (BLOCKER_BLOCKED if blockers else
                          BLOCKER_CLEAR if subject_state == corr.STATE_LIKELY_RESOLVED
                          else BLOCKER_UNKNOWN),
        "blocker_count": len(blockers),
        "dependency_state": _dependency(blockers),
        "related_subject_ids": [],       # filled by `project_contexts`

        "risk": risk,
        "reversibility": reversibility,
        "actionability": _actionability(blockers, capability=capability),
        "freshness": freshness,
        "contradictory_evidence": (subject_state == corr.STATE_CONFLICTING
                                   or bool(state.get("contradicting"))),

        "why_now": [c for c in _WHY_ORDER if c in why][:MAX_WHY_NOW],
        "caveats": [c for c in _CAVEAT_ORDER if c in caveats][:MAX_CAVEATS],
    }


def project_contexts(
    states: Sequence[Dict[str, Any]], *,
    observations: Sequence[Dict[str, Any]] = (),
    goals: Sequence[Dict[str, Any]] = (),
    decisions: Sequence[Dict[str, Any]] = (),
    commitment: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Dict[str, Any]]:
    """`{subject_id: decision context}` for a whole project, in ONE pass.

    `commitment` is resolved from `observations` when not supplied, so a caller
    that already holds the rows pays nothing extra for deadline awareness.

    Subjects built from some of the SAME stored observations are marked as one
    story (`dependency_state = part_of_related_story` on the later one), so a
    consumer never presents two rows as two independent problems when the
    evidence itself says they are two views of one. The comparison runs over
    the already-capped subject list, so it is a small constant amount of set
    work — never a pairwise pass over the projection."""
    when = _now(now)
    if commitment is None:
        commitment = nearest_commitment(observations, now=when)

    rows = [s for s in (states or []) if isinstance(s, dict)]
    out: Dict[str, Dict[str, Any]] = {}
    seen_ids: List[Tuple[str, Set[str]]] = []
    for state in rows:
        context = for_subject(state, goals=goals, decisions=decisions,
                              commitment=commitment)
        subject_id = context["subject_id"]
        if not subject_id:
            continue
        members = {str(x) for x in (state.get("evidence_observation_ids") or [])}
        related = [other_id for other_id, other in seen_ids if members & other]
        if related:
            context["related_subject_ids"] = related[:MAX_FOCUS_NEXT]
            context["dependency_state"] = DEPENDENCY_SHARED_STORY
            if CAVEAT_RELATED_SUBJECT not in context["caveats"]:
                context["caveats"] = (context["caveats"]
                                      + [CAVEAT_RELATED_SUBJECT])[:MAX_CAVEATS]
        seen_ids.append((subject_id, members))
        out[subject_id] = context
    return out


def order_key(context: Dict[str, Any]) -> Tuple[int, float, int, str]:
    """The deterministic ordering of decision contexts among themselves.

    Used ONLY where there are no candidate actions to rank — the Project page,
    which must not write and therefore cannot go through `candidate_synthesis`.
    It is the same ladder `action_prioritizer` applies (tier, then evidence,
    then a stable id), so the page and the Business Brain cannot disagree about
    what matters most; it is not a second opinion, it is the same one reached
    without writing a proposal first."""
    return (int(context.get("priority_tier") or DEFAULT_TIER),
            -float(context.get("confidence") or 0.0),
            -int(context.get("corroboration_count") or 0),
            _s(context.get("subject_id"), 64))


def _focus(ordered: Sequence[Dict[str, Any]],
           commitment: Optional[Dict[str, Any]],
           when: datetime) -> Dict[str, Any]:
    """The bounded focus block, from contexts ALREADY in `order_key` order.

    A slice, never a second sort: `top` is simply the first row, and it is
    withheld entirely when even that row is `routine` — a project whose most
    notable subject is routine has no "top priority", and saying otherwise
    would manufacture one."""
    top = (ordered[0] if ordered and int(ordered[0].get("priority_tier")
                                         or DEFAULT_TIER) < DEFAULT_TIER
           else None)
    return {
        "generated_at": _iso(when),
        "top": top,
        "next": [c for c in ordered if c is not top][:MAX_FOCUS_NEXT],
        "commitment": commitment,
        "blocked": bool(top and top.get("blocker_state") == BLOCKER_BLOCKED),
        # Who the ball is with. `korvix` only when Korvix can genuinely finish
        # the thing; anything resting on an external system says so.
        "waiting_on": (((top or {}).get("actionability") or {})
                       .get("resolution", RESOLUTION_UNKNOWN) if top else ""),
        "counts": {
            "subjects": len(ordered),
            "open": len([c for c in ordered if c.get("unresolved")]),
            "blocked": len([c for c in ordered
                            if c.get("blocker_state") == BLOCKER_BLOCKED]),
        },
    }


def project_focus(
    states: Sequence[Dict[str, Any]], *,
    observations: Sequence[Dict[str, Any]] = (),
    goals: Sequence[Dict[str, Any]] = (),
    decisions: Sequence[Dict[str, Any]] = (),
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """The bounded "what matters right now, and why" reading for a project,
    from subjects the caller ALREADY correlated.

    This is what a surface that must not write calls — the Project page holds
    its interpreted subjects already, and going through `candidate_synthesis`
    to learn what matters would turn opening a page into a Business Brain
    mutation. It proposes no work, writes nothing, and creates nothing.

    An empty project produces the honest empty reading — `top: None`, empty
    lists — never "everything looks good"."""
    when = _now(now)
    commitment = nearest_commitment(observations, now=when)
    contexts = project_contexts(states, observations=observations, goals=goals,
                                decisions=decisions, commitment=commitment,
                                now=when)
    return _focus(sorted(contexts.values(), key=order_key), commitment, when)


#: The dedup-key namespace `candidate_synthesis` writes for a correlated
#: subject. Defined HERE, next to the code that builds the lookup table, so
#: the writer and the ranker cannot drift apart on the identity that joins
#: a stored candidate to its live evidence.
CANDIDATE_KEY_PREFIX = "intel:"


def candidate_key(subject_id: Any) -> str:
    """The candidate dedup key for a correlated subject."""
    return f"{CANDIDATE_KEY_PREFIX}{_s(subject_id, 64)}"


def build(
    observations: Sequence[Dict[str, Any]], *,
    goals: Sequence[Dict[str, Any]] = (),
    decisions: Sequence[Dict[str, Any]] = (),
    now: Optional[datetime] = None,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    """The whole decision projection for one project, computed ONCE.

    `observations` must already be scoped to a single (owner, project) by the
    caller — like every other pure layer here, this function has no store
    access and therefore no query that could widen a scope.

    Returns the correlated subjects, the project synthesis, the COMPLETE
    membership index, the decision contexts keyed both by subject id and by
    the candidate dedup key, the nearest commitment, and the project focus.

    It exists so one request computes the correlation once and hands the SAME
    object to the writer (`candidate_synthesis`) and the ranker
    (`project_supervisor` → `action_prioritizer`). Two independent
    projections of the same rows would be two chances to disagree — about
    which subject a candidate belongs to, and about how urgent it is.

    Fail-soft: any problem yields the honest empty bundle, which degrades each
    consumer to its pre-existing behaviour rather than failing the request."""
    when = _now(now)
    empty: Dict[str, Any] = {
        "generated_at": _iso(when), "subjects": [], "synthesis": {},
        "membership": {}, "contexts": {}, "by_dedup_key": {},
        "commitment": None, "focus": {},
    }
    try:
        from backend.services import project_intelligence as pi
        kwargs: Dict[str, Any] = {"now": when}
        if limit:
            kwargs["limit"] = int(limit)
        subjects, synthesis, membership = pi.understand_with_membership(
            observations, **kwargs)
    except Exception as exc:      # pragma: no cover — never break a caller
        logger.debug("decision_context.build projection failed: %s", exc)
        return empty

    commitment = nearest_commitment(observations, now=when)
    contexts = project_contexts(subjects, observations=observations,
                                goals=goals, decisions=decisions,
                                commitment=commitment, now=when)
    ordered = sorted(contexts.values(), key=order_key)
    return {
        "generated_at": _iso(when),
        "subjects": subjects,
        "synthesis": synthesis,
        "membership": membership,
        "contexts": contexts,
        "by_dedup_key": {candidate_key(sid): ctx
                         for sid, ctx in contexts.items()},
        "commitment": commitment,
        "focus": _focus(ordered, commitment, when),
    }


__all__ = [
    "TIER_DEADLINE_RISK", "TIER_PRODUCTION_BROKEN", "TIER_CUSTOMER_IMPACT",
    "TIER_BLOCKED", "TIER_UNVERIFIED", "TIER_TIME_SENSITIVE", "TIER_ROUTINE",
    "TIER_CODE", "DEFAULT_TIER",
    "DEADLINE_NONE", "DEADLINE_APPROACHING", "DEADLINE_IMMINENT",
    "IMMINENT_WITHIN", "APPROACHING_WITHIN",
    "COMMITMENT_MILESTONE", "COMMITMENT_MEETING",
    "LEVEL_HIGH", "LEVEL_MEDIUM", "LEVEL_LOW", "LEVEL_UNKNOWN",
    "PRODUCTION_BROKEN", "PRODUCTION_UNVERIFIED", "PRODUCTION_VERIFIED_LIVE",
    "PRODUCTION_UNKNOWN",
    "CUSTOMER_NONE", "CUSTOMER_REPORTED", "CUSTOMER_CORROBORATED",
    "EVIDENCE_STRONG", "EVIDENCE_MODERATE", "EVIDENCE_THIN",
    "BLOCKER_BLOCKED", "BLOCKER_CLEAR", "BLOCKER_UNKNOWN",
    "DEPENDENCY_INDEPENDENT", "DEPENDENCY_EXTERNAL_SYSTEM",
    "DEPENDENCY_SHARED_STORY",
    "RESOLUTION_KORVIX", "RESOLUTION_HUMAN_EXTERNAL", "RESOLUTION_UNKNOWN",
    "KORVIX_INVESTIGATE", "KORVIX_NOTHING",
    "WHY_DEADLINE_IMMINENT", "WHY_DEADLINE_APPROACHING",
    "WHY_CUSTOMER_CORROBORATED", "WHY_CUSTOMER_REPORTED", "WHY_GOAL_ALIGNED",
    "WHY_RECURRING_FAILURE",
    "CAVEAT_DECISION_RECORDED", "CAVEAT_RELATED_SUBJECT",
    "MAX_WHY_NOW", "MAX_CAVEATS", "MAX_COMMITMENTS", "MAX_FOCUS_NEXT",
    "CANDIDATE_KEY_PREFIX", "candidate_key",
    "commitments", "nearest_commitment", "for_subject", "project_contexts",
    "project_focus", "order_key", "build",
]
