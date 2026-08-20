# coding: utf-8
"""Project Intelligence — CORRELATION: from "five observations" to "one thing".

THE QUESTION THIS ANSWERS
-------------------------
Every other authority in the system already answers its own question well. The
observation store answers "what came in". `attention` answers "what should I
look at now". The Business Brain answers "what should we do about it". Nobody
answered the question BETWEEN them:

    "are these five observations five things, or one thing seen five times?"

This module is that answer and nothing more. It resolves entities, aggregates
evidence, and infers a state with an honest confidence. It does not rank work,
does not propose actions, does not decide anything, and writes nothing — the
Business Brain authorities keep every one of those jobs.

NOT A SECOND BUSINESS BRAIN, AND NOT A SECOND STORE
---------------------------------------------------
There is no table here and no cache. A projection is recomputed from the
already-persisted observations each time it is asked for, exactly as
`attention` and `recent_changes` are. That is deliberate: an inferred state is
OPERATIONAL and perishable ("the payment webhook looks fixed as of this
morning"), and persisting perishable inferences is how a system starts telling
you confidently about a world that has moved on. Durable facts and lessons
belong to the existing authorities — `decisions_store`, `business_knowledge`
on the Memory Plane — and this layer never writes to them.

HOW ENTITIES ARE RESOLVED
-------------------------
Events are grouped by the keys they carry (see `keys` for the three classes and
why they differ):

  1. Every LINK key on one event is unioned with every other LINK key on that
     event — a Vercel deployment naming a commit sha AND a branch proves those
     two identities are the same work.
  2. A TOPIC key joins that union ONLY if the same bigram was produced by TWO
     DIFFERENT SOURCES. One person writing "payment webhook" in Slack is not
     evidence of anything; the same phrase appearing in Slack AND in a GitHub
     PR title is.
  3. GROUP keys (a deploy target, a CI check, a meeting) never merge with
     anything but an identical key, so a topic can never swallow every
     production deploy the project has ever had.

This is a union-find over a bounded key set, not a comparison of every event
against every other: cost is O(events × keys-per-event), and keys-per-event is
capped in `keys`. There is no pairwise pass anywhere in this module.

HOW STATE IS INFERRED
---------------------
Only DECISIVE evidence (code / CI / deploy / issue, positive or negative) can
settle anything. Within a facet, the LATEST event per `facet_ref` wins — the
same supersession rule `attention` applies, applied per target rather than per
facet, so a later green PREVIEW deploy cannot resolve an earlier red PRODUCTION
one. A facet reads negative if any of its targets' latest word is negative.

    some facet negative AND some positive  → CONFLICTING   (both stay visible)
    only negative                          → UNRESOLVED
    only positive                          → LIKELY_RESOLVED
    nothing decisive, something pending    → IN_PROGRESS
    nothing decisive at all                → OBSERVED

A merged PR plus a failed deploy is therefore CONFLICTING, never "resolved",
and the failed deploy is still listed. That is the whole point.

CONFIDENCE IS DERIVED, NOT INVENTED
-----------------------------------
The score is the sum of five documented coarse components plus a base, each
of which is reported in `breakdown` so a human can see precisely where the
number came from. Nothing here is fitted, learned or tuned against data we do
not have. Corroboration counts DISTINCT SOURCES over DEDUPLICATED evidence
units, so re-observing the same fact ten times — or one chatty channel — never
manufactures agreement.

COST: pure functions over an already-read, bounded list. ZERO I/O, ZERO model
tokens, ZERO provider calls, ZERO writes.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from backend.services.project_brain.attention import parse_iso
from backend.services.project_intelligence import events as ev
from backend.services.project_intelligence import keys as k

# ── Inferred states (stable codes; the frontend renders them through the
#    shipped locale dictionaries, exactly as attention's reason codes are) ────
STATE_UNRESOLVED = "unresolved"
STATE_CONFLICTING = "conflicting"
STATE_IN_PROGRESS = "in_progress"
STATE_LIKELY_RESOLVED = "likely_resolved"
STATE_OBSERVED = "observed"

#: Presentation order only. This is NOT a priority model: `attention` remains
#: the sole authority on what needs a human now, and `action_prioritizer`
#: remains the sole authority on what is worth doing.
_STATE_RANK = {
    STATE_CONFLICTING: 4,
    STATE_UNRESOLVED: 3,
    STATE_IN_PROGRESS: 2,
    STATE_LIKELY_RESOLVED: 1,
    STATE_OBSERVED: 0,
}

# ── Confidence levels ────────────────────────────────────────────────────────
CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"
_HIGH_AT = 0.70
_MEDIUM_AT = 0.45

# ── Documented coarse evidence weights ───────────────────────────────────────
# Every component is a small table, not a formula, and they sum to at most 1.0
# so the score needs no clamping to look like a probability it is not claiming
# to be. Read this block as the definition of the number.
W_BASE = 0.10                 # we saw something real at all
W_CORROBORATION = {1: 0.00, 2: 0.15}          # 3+ → 0.25 (see `_corroboration`)
W_CORROBORATION_MANY = 0.25
W_ANCHOR_STRUCTURAL = 0.25    # joined on a shared resource identity
W_ANCHOR_TOPICAL = 0.10       # joined on a corroborated phrase only
W_FACETS = {0: 0.00, 1: 0.10}                 # 2+ → 0.20
W_FACETS_MANY = 0.20
W_AGREEMENT = 0.10            # nothing contradicts the inferred state
W_FRESH_RECENT = 0.10         # newest evidence within FRESH_DAYS
W_FRESH_AGING = 0.05          # …within the correlation window
MAX_SCORE = (W_BASE + W_CORROBORATION_MANY + W_ANCHOR_STRUCTURAL
             + W_FACETS_MANY + W_AGREEMENT + W_FRESH_RECENT)   # == 1.00

# ── Bounds ───────────────────────────────────────────────────────────────────
#: Observations read into one projection.
MAX_OBSERVATIONS = 120
#: Events older than this are history and take no part in correlation. Matches
#: `attention.MAX_AGE_DAYS` so the two never disagree about what is current.
CORRELATION_WINDOW_DAYS = 14
#: Evidence newer than this counts as fresh.
FRESH_DAYS = 3
#: Distinct sources a bigram needs before it may merge anything.
MIN_TOPIC_SOURCES = 2
#: Deduplicated evidence units an entity needs to be called corroborated.
MIN_CORROBORATED_EVIDENCE = 2
#: States returned by one projection.
MAX_STATES = 8
#: Evidence rows carried per list, per state.
MAX_EVIDENCE = 4
#: Observation ids carried per state so a consumer can cross-link an item it
#: already holds (a Needs-Attention row) to the story it belongs to, without
#: re-deriving the correlation. Bounded like everything else.
MAX_EVIDENCE_IDS = 12

# ── Entity types (stable codes) ──────────────────────────────────────────────
ENTITY_TOPIC = "topic"
ENTITY_PULL_REQUEST = "pull_request"
ENTITY_ISSUE = "issue"
ENTITY_CHANGE = "change"
ENTITY_DEPLOYMENT = "deployment"
ENTITY_CI = "ci"
ENTITY_MEETING = "meeting"

_TYPE_BY_NAMESPACE = {
    k.KEY_TOPIC: ENTITY_TOPIC,
    k.KEY_PR: ENTITY_PULL_REQUEST,
    k.KEY_ISSUE: ENTITY_ISSUE,
    k.KEY_COMMIT: ENTITY_CHANGE,
    k.KEY_BRANCH: ENTITY_CHANGE,
    k.KEY_DEPLOY: ENTITY_DEPLOYMENT,
    k.KEY_CI: ENTITY_CI,
    k.KEY_MEETING: ENTITY_MEETING,
}
#: Entities that name a recurring TARGET rather than a piece of work. When one
#: of these reports exactly the observations a richer entity already reports,
#: it is dropped as a duplicate view of the same news.
_GROUP_ENTITY_TYPES = frozenset({ENTITY_DEPLOYMENT, ENTITY_CI, ENTITY_MEETING})

#: Which identity names an entity when it holds several. Most specific first.
_TYPE_PRIORITY = (k.KEY_TOPIC, k.KEY_PR, k.KEY_ISSUE, k.KEY_BRANCH,
                  k.KEY_COMMIT, k.KEY_DEPLOY, k.KEY_CI, k.KEY_MEETING)


def _digest(value: str) -> str:
    """A short, stable, opaque id. Entity keys embed provider identifiers (a
    Vercel project id, a calendar event id); those never reach a client, so the
    digest is what travels — the same rule `attention._stable_id` follows."""
    return hashlib.sha1(value.encode("utf-8", "replace")).hexdigest()[:12]


def _s(value: Any, limit: int = 240) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


class _Union:
    """Minimal union-find over string keys."""

    def __init__(self) -> None:
        self._parent: Dict[str, str] = {}

    def add(self, key: str) -> None:
        self._parent.setdefault(key, key)

    def find(self, key: str) -> str:
        self.add(key)
        root = key
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[key] != root:      # path compression
            self._parent[key], key = root, self._parent[key]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # Deterministic: the lexicographically smaller root always wins, so
            # the same input always produces the same component ids.
            lo, hi = (ra, rb) if ra < rb else (rb, ra)
            self._parent[hi] = lo


def _strong_topics(event_list: Sequence[ev.Event]) -> Set[str]:
    """Topic bigrams produced by at least `MIN_TOPIC_SOURCES` DIFFERENT
    sources. Everything else is dropped before it can merge anything — this is
    the single rule that keeps one person's wording from inventing a link."""
    by_key: Dict[str, Set[str]] = {}
    for event in event_list:
        for key in event.topic_keys:
            by_key.setdefault(key, set()).add(event.source)
    return {key for key, sources in by_key.items()
            if len(sources) >= MIN_TOPIC_SOURCES}


def _latest_per_ref(items: Sequence[ev.Event]) -> List[ev.Event]:
    """One event per `facet_ref`: the newest. Undated events lose to any dated
    one and fall back to input order among themselves — the same tolerance
    `attention._latest_per_subject` applies, so an event whose timestamp will
    not parse is never silently dropped."""
    best: Dict[str, Tuple[int, ev.Event]] = {}
    for index, event in enumerate(items):
        ref = event.facet_ref or f"{event.source}:{event.facet}"
        current = best.get(ref)
        if current is None:
            best[ref] = (index, event)
            continue
        keep_index, keep = current
        a, b = event.when, keep.when
        if a is not None and b is None:
            best[ref] = (index, event)
        elif a is not None and b is not None and (
                a > b or (a == b and index < keep_index)):
            best[ref] = (index, event)
    return [pair[1] for _, pair in sorted(best.items(), key=lambda kv: kv[0])]


def _evidence_units(items: Sequence[ev.Event]) -> List[ev.Event]:
    """Deduplicated evidence. Two rows saying the same thing about the same
    target from the same source are ONE unit however many times they were
    ingested — a webhook retry, a re-sync and a chatty channel must not read as
    independent agreement (and a provider that re-sends an event must not move
    a confidence score at all)."""
    seen: Set[Tuple[str, str, str]] = set()
    out: List[ev.Event] = []
    for event in items:
        unit = (event.source, event.semantic_type,
                event.facet_ref or event.facet)
        if unit in seen:
            continue
        seen.add(unit)
        out.append(event)
    return out


def _corroboration(sources: Set[str]) -> float:
    count = len(sources)
    if count >= 3:
        return W_CORROBORATION_MANY
    return W_CORROBORATION.get(count, 0.0)


def _freshness(last_seen: Optional[datetime], now: datetime) -> Tuple[float, str]:
    """Weight + a stable code for how current the newest evidence is. An
    entity we cannot date gets NO freshness credit — never a penalty beyond
    that, and never a pretend timestamp."""
    if last_seen is None:
        return 0.0, "unknown"
    age = now - last_seen
    if age <= timedelta(days=FRESH_DAYS):
        return W_FRESH_RECENT, "recent"
    if age <= timedelta(days=CORRELATION_WINDOW_DAYS):
        return W_FRESH_AGING, "aging"
    return 0.0, "stale"


def _infer_state(decisive: Sequence[ev.Event],
                 pending: Sequence[ev.Event]) -> Tuple[str, Set[str], Set[str]]:
    """(state, positive facets, negative facets). See the module docstring for
    the table; supersession has already been applied by the caller.

    WITHIN one facet, negative DOMINATES: if production is red and preview is
    green, the deploy facet is red. A green preview is not a counter-argument
    to a broken production deploy — it is a different target that happens to be
    fine — so treating the pair as a contradiction would overstate what we
    know. CONFLICT is reserved for facets that genuinely disagree about the
    same work: the code landed, and the deploy of it failed."""
    positive: Set[str] = set()
    negative: Set[str] = set()
    for event in decisive:
        if event.polarity == ev.POLARITY_NEGATIVE:
            negative.add(event.facet)
        elif event.polarity == ev.POLARITY_POSITIVE:
            positive.add(event.facet)
    positive -= negative          # a facet with any red target reads red
    if negative and positive:
        return STATE_CONFLICTING, positive, negative
    if negative:
        return STATE_UNRESOLVED, positive, negative
    if positive:
        return STATE_LIKELY_RESOLVED, positive, negative
    if pending:
        return STATE_IN_PROGRESS, positive, negative
    return STATE_OBSERVED, positive, negative


def _evidence_row(event: ev.Event) -> Dict[str, Any]:
    """One display-safe evidence reference. Provenance is preserved exactly —
    which stored observation produced this — while the raw payload, any
    credential and every opaque provider resource id stay behind."""
    return {
        "observation_id": _s(event.observation_id, 64),
        "source": _s(event.source, 40),
        "kind": _s(event.kind, 120),
        "semantic_type": _s(event.semantic_type, 40),
        "title": _s(event.title, 200),
        "observed_at": _s(event.observed_at, 64),
    }


def _structural_label(component_keys: Sequence[str]) -> str:
    """A human subject built from a LINK key, or "" when none is suitable."""
    for key in sorted(component_keys):
        namespace = k.namespace_of(key)
        body = key.split(":", 1)[1] if ":" in key else ""
        if namespace in (k.KEY_PR, k.KEY_ISSUE) and "#" in body:
            repo, _, number = body.partition("#")
            noun = "PR" if namespace == k.KEY_PR else "Issue"
            return f"{noun} #{number} · {repo}"[:120]
        if namespace == k.KEY_BRANCH:
            repo, _, branch = body.partition(":")
            return (f"{branch} · {repo}" if branch else repo)[:120]
    return ""


def _entity_label(component_keys: Sequence[str],
                  members: Sequence[ev.Event]) -> Tuple[str, str]:
    """(subject, entity_type).

    A corroborated topic names itself — "payment webhook" is already the words
    the humans used. Otherwise the subject is the TITLE the connector's own
    normalizer wrote for the most significant event, which is display-safe by
    construction (it is the same string the activity feed already shows) and
    never a raw provider identifier."""
    namespaces = {k.namespace_of(key) for key in component_keys}
    entity_type = ENTITY_CHANGE
    for namespace in _TYPE_PRIORITY:
        if namespace in namespaces:
            entity_type = _TYPE_BY_NAMESPACE.get(namespace, ENTITY_CHANGE)
            break

    if k.KEY_TOPIC in namespaces:
        topics = sorted(key for key in component_keys if k.is_topic_key(key))
        if topics:
            return k.topic_label(topics[0])[:120], entity_type

    # A PR / issue / branch names itself far better than any event title does,
    # and all three parts are display-safe: a repository full name and a branch
    # name are already shown by the connector panel and the activity feed.
    # DEPLOY / CI / MEETING keys are deliberately NOT used here — those embed
    # opaque provider ids (a Vercel project id, a calendar event id), so those
    # entities fall through to the connector's own human-written title.
    structural = _structural_label(component_keys)
    if structural:
        return structural, entity_type

    decisive = [m for m in members if m.is_decisive]
    pool = decisive or list(members)
    dated = [m for m in pool if m.when is not None]
    chosen = max(dated, key=lambda m: m.when) if dated else (pool[0] if pool else None)
    return (_s(getattr(chosen, "title", ""), 120) or "project activity"), entity_type


def _build_state(component_keys: Sequence[str], members: Sequence[ev.Event],
                 *, now: datetime) -> Optional[Dict[str, Any]]:
    """One resolved entity → one public inferred-state row."""
    if not members:
        return None

    units = _evidence_units(members)
    sources = {m.source for m in units}

    # Supersession is applied per facet target, over the DEDUPLICATED units, so
    # a repeated row can neither win a supersession contest nor lose one.
    decisive_latest = _latest_per_ref([m for m in units if m.is_decisive])
    pending = [m for m in units if m.polarity == ev.POLARITY_PENDING]
    context = [m for m in units
               if not m.is_decisive and m.polarity != ev.POLARITY_PENDING]

    state, positive_facets, negative_facets = _infer_state(decisive_latest, pending)

    # A single neutral row (one chat line, one email) is activity, not a
    # project state. Noise stays noise.
    if state == STATE_OBSERVED and len(units) < MIN_CORROBORATED_EVIDENCE:
        return None

    # Only events from facets that actually READ positive count as positive
    # evidence — `_infer_state` has already ruled that a facet with any red
    # target is red, and the evidence lists must say the same thing.
    positives = [m for m in decisive_latest
                 if m.polarity == ev.POLARITY_POSITIVE and m.facet in positive_facets]
    negatives = [m for m in decisive_latest if m.polarity == ev.POLARITY_NEGATIVE]
    if state == STATE_UNRESOLVED:
        supporting, contradicting = negatives, positives
    elif state == STATE_LIKELY_RESOLVED:
        supporting, contradicting = positives, negatives
    elif state == STATE_CONFLICTING:
        # The state NAMES the disagreement, so both sides are shown as they
        # are: what argues finished, and what argues not.
        supporting, contradicting = positives, negatives
    elif state == STATE_IN_PROGRESS:
        supporting, contradicting = list(pending), negatives
    else:
        supporting, contradicting = [], []

    stamps = [m.when for m in units if m.when is not None]
    first_seen = min(stamps) if stamps else None
    last_seen = max(stamps) if stamps else None

    anchored = any(k.is_link_key(key) or k.is_group_key(key)
                   for key in component_keys)
    anchor_weight = W_ANCHOR_STRUCTURAL if anchored else W_ANCHOR_TOPICAL
    facet_count = len({m.facet for m in decisive_latest})
    facet_weight = (W_FACETS_MANY if facet_count >= 2
                    else W_FACETS.get(facet_count, 0.0))
    corroboration_weight = _corroboration(sources)
    agreement_weight = 0.0 if state == STATE_CONFLICTING else W_AGREEMENT
    freshness_weight, freshness_code = _freshness(last_seen, now)

    score = round(min(MAX_SCORE, W_BASE + corroboration_weight + anchor_weight
                      + facet_weight + agreement_weight + freshness_weight), 2)
    level = (CONFIDENCE_HIGH if score >= _HIGH_AT
             else CONFIDENCE_MEDIUM if score >= _MEDIUM_AT else CONFIDENCE_LOW)

    subject, entity_type = _entity_label(component_keys, units)
    component_id = _digest("|".join(sorted(component_keys)))

    return {
        "id": component_id,
        "subject": subject,
        "entity_type": entity_type,
        "state": state,
        "confidence": {
            "score": score,
            "level": level,
            # Every term of the sum, named. This is what "do not manufacture
            # fake precision" means in practice: the number is reproducible by
            # hand from this block and the weight tables above.
            "breakdown": {
                "base": W_BASE,
                "corroboration": round(corroboration_weight, 2),
                "distinct_sources": len(sources),
                "anchor": round(anchor_weight, 2),
                "anchor_kind": "structural" if anchored else "topical",
                "facets": round(facet_weight, 2),
                "decisive_facets": facet_count,
                "agreement": round(agreement_weight, 2),
                "freshness": round(freshness_weight, 2),
                "freshness_band": freshness_code,
                "max_score": MAX_SCORE,
            },
        },
        "sources": sorted(sources),
        "evidence_count": len(units),
        "corroborated": (len(units) >= MIN_CORROBORATED_EVIDENCE
                         and len(sources) >= MIN_TOPIC_SOURCES),
        # Stable codes naming WHY the state reads as it does; the frontend
        # renders them from its locale dictionaries and the prompt builder
        # composes English from them. The backend never ships prose for this.
        "rationale": sorted({m.semantic_type for m in decisive_latest}
                            or {m.semantic_type for m in pending}
                            or {m.semantic_type for m in units}),
        "supporting": [_evidence_row(m) for m in supporting[:MAX_EVIDENCE]],
        "contradicting": [_evidence_row(m) for m in contradicting[:MAX_EVIDENCE]],
        "context": [_evidence_row(m) for m in context[:MAX_EVIDENCE]],
        # The stored rows this reading was derived from. Provenance, bounded:
        # internal observation ids only — the same ids the activity feed
        # already carries — never a provider payload or resource id.
        "evidence_observation_ids": sorted(
            {m.observation_id for m in members if m.observation_id})[:MAX_EVIDENCE_IDS],
        "first_seen": first_seen.isoformat().replace("+00:00", "Z") if first_seen else "",
        "last_seen": last_seen.isoformat().replace("+00:00", "Z") if last_seen else "",
        "_observation_ids": {m.observation_id for m in members if m.observation_id},
    }


def _sort_key(row: Dict[str, Any]) -> Tuple[int, float, float, str]:
    rank = _STATE_RANK.get(str(row.get("state")), 0)
    stamp = parse_iso(row.get("last_seen"))
    return (-rank,
            -float((row.get("confidence") or {}).get("score") or 0.0),
            -(stamp.timestamp() if stamp is not None else float("-inf")),
            str(row.get("subject") or ""))


def correlate(
    observations: Sequence[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    limit: int = MAX_STATES,
    max_observations: int = MAX_OBSERVATIONS,
    window_days: int = CORRELATION_WINDOW_DAYS,
) -> List[Dict[str, Any]]:
    """The bounded, deterministic inferred-state list for ONE project.

    `observations` MUST already be scoped to a single (owner, project) by the
    caller — this function has no store access and therefore no way to widen a
    scope, which is exactly why isolation cannot be broken here.

    Pure: no store read, no write, no model call, no provider call. Never
    raises on malformed rows."""
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    cutoff = when - timedelta(days=max(1, int(window_days or CORRELATION_WINDOW_DAYS)))

    all_events = ev.events_from_observations(
        observations, limit=max(0, int(max_observations or MAX_OBSERVATIONS)))
    # History takes no part in correlation. An event we cannot date is KEPT —
    # dropping it would hide a real signal on a formatting problem — and simply
    # earns no freshness credit later.
    live = [e for e in all_events if e.when is None or e.when >= cutoff]
    if not live:
        return []

    strong = _strong_topics(live)

    union = _Union()
    group_members: Dict[str, List[ev.Event]] = {}
    key_members: Dict[str, List[ev.Event]] = {}
    for event in live:
        mergeable = list(event.link_keys) + [t for t in event.topic_keys if t in strong]
        for key in mergeable:
            union.add(key)
            key_members.setdefault(key, []).append(event)
        for left in mergeable[1:]:
            union.union(mergeable[0], left)
        for key in event.group_keys:
            group_members.setdefault(key, []).append(event)

    components: Dict[str, Dict[str, Any]] = {}
    for key, members in key_members.items():
        root = union.find(key)
        bucket = components.setdefault(root, {"keys": set(), "events": {}})
        bucket["keys"].add(key)
        for event in members:
            bucket["events"][id(event)] = event
    for key, members in group_members.items():
        bucket = components.setdefault(f"group::{key}", {"keys": set(), "events": {}})
        bucket["keys"].add(key)
        for event in members:
            bucket["events"][id(event)] = event

    rows: List[Dict[str, Any]] = []
    for bucket in components.values():
        row = _build_state(sorted(bucket["keys"]), list(bucket["events"].values()),
                           now=when)
        if row is not None:
            rows.append(row)

    rows.sort(key=_sort_key)

    # A GROUP entity whose every observation is already reported inside a
    # RICHER entity is the same news twice: "fix/payment-webhook · acme/site"
    # and "that one deploy target" would occupy two rows describing one thing.
    # The richer row (a topic, PR, issue or linked change) wins and the bare
    # target row is dropped.
    #
    # The comparison runs over a BOUNDED window of the best rows rather than
    # every component, so this stays a small constant amount of set work and
    # never becomes a pairwise pass over the whole projection.
    bound = max(1, int(limit or MAX_STATES))
    pool = rows[:bound * 3]
    richer_ids = [row.get("_observation_ids") or set() for row in pool
                  if row["entity_type"] not in _GROUP_ENTITY_TYPES]

    kept: List[Dict[str, Any]] = []
    for row in pool:
        ids = row.get("_observation_ids") or set()
        if row["entity_type"] in _GROUP_ENTITY_TYPES and ids and any(
                ids <= other for other in richer_ids):
            continue
        kept.append(row)
        if len(kept) >= bound:
            break

    for row in kept:
        row.pop("_observation_ids", None)
    return kept


__all__ = [
    "STATE_UNRESOLVED", "STATE_CONFLICTING", "STATE_IN_PROGRESS",
    "STATE_LIKELY_RESOLVED", "STATE_OBSERVED",
    "CONFIDENCE_HIGH", "CONFIDENCE_MEDIUM", "CONFIDENCE_LOW",
    "ENTITY_TOPIC", "ENTITY_PULL_REQUEST", "ENTITY_ISSUE", "ENTITY_CHANGE",
    "ENTITY_DEPLOYMENT", "ENTITY_CI", "ENTITY_MEETING",
    "MAX_OBSERVATIONS", "MAX_STATES", "MAX_EVIDENCE", "MAX_EVIDENCE_IDS",
    "CORRELATION_WINDOW_DAYS",
    "FRESH_DAYS", "MIN_TOPIC_SOURCES", "MIN_CORROBORATED_EVIDENCE", "MAX_SCORE",
    "correlate",
]
