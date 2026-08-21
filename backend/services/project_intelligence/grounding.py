# coding: utf-8
"""Project Intelligence — GROUNDING: what this project's evidence does NOT establish.

THE PRODUCTION PROBLEM THIS CLOSES
----------------------------------
A project whose only connected tool is Vercel, with two deployment events in it,
produced inline Workspace answers like:

    "the app's core functionality is ready for use"
    "testing is being performed"
    "the project is progressing toward its goals"
    "the project is currently evaluating user feedback"

None of that was in the evidence. A successful deployment proves that a
deployment was reported as successful. It does not prove the application works,
that a test ever ran, that a single person opened the page, that anyone said
anything about it, or that a goal moved.

`correlation` and `interpretation` were already careful — they emit uncertainty
codes and refuse to round "unverified" up to "fixed". But everything they emit
is about the subjects that DO have evidence. Nothing in the prompt named the
claims for which the project has NO evidence at all, so the model met a short,
confident block of facts and filled the silence around them with the things a
project usually has. Absence was never stated, so absence was never respected.

WHAT THIS MODULE ADDS
---------------------
One pure projection over the SAME rows the caller already read: for each class
of claim a reader might make about a project, whether this project's evidence
establishes it, what establishes it, and — when nothing does — the specific
evidence that would. No new store, no new ranking, no second state machine, no
model call, no I/O. It reads the normalized events `events` already produces
from the observations, plus the recorded goals / decisions / durable knowledge
the caller holds.

THE RULE IT ENCODES
-------------------
A claim is established by the KIND of evidence that can establish it, never by
a different kind that merely tends to accompany it:

    a deploy event          establishes  a deployment happened, with that outcome
    a CI event              establishes  checks ran, with that outcome
    a code event            establishes  a change was proposed / landed
    a meeting / message     establishes  people are coordinating
    a person's report       establishes  what that person said, attributed
    a recorded fact         establishes  what was recorded, with its provenance

and NOTHING here establishes that software works, that users exist, that
feedback was given, or that a business outcome occurred, unless a source
recorded exactly that. `indirect` support means "an adjacent fact exists" and
is never to be reported as the claim itself.

STABLE CODES, NEVER PROSE — the package rule. The frontend renders codes from
its locale dictionaries; `project_brain.client` composes the English the system
prompt needs. Nothing user-facing is written here.

COST: pure functions over rows another authority already read. ZERO provider
calls, ZERO model tokens, ZERO writes, ZERO new tables, ZERO extra queries.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence

from backend.services.project_intelligence import events as ev

logger = logging.getLogger(__name__)


# ── Claim classes (stable codes) ─────────────────────────────────────────────
#
# One per thing a reader might assert about a project. The list is deliberately
# short and closed: these are the assertions that were observed being invented
# in production, plus the three factual ones that anchor them.
CLAIM_DEPLOYMENT = "deployment"              # a deployment was reported
CLAIM_CODE_CHANGE = "code_change"            # a change was proposed / landed
CLAIM_TESTS = "tests"                        # automated tests / checks ran
CLAIM_COORDINATION = "coordination"          # people are meeting / discussing it
CLAIM_FUNCTIONALITY = "functionality"        # the product works / is ready to use
CLAIM_USERS = "users"                        # real people are using it
CLAIM_FEEDBACK = "feedback"                  # users / customers said something
CLAIM_GOAL_PROGRESS = "goal_progress"        # the project is advancing its goals
CLAIM_BUSINESS_OUTCOME = "business_outcome"  # revenue / growth / market result

#: Emission order. Factual classes first, then the ones a model invents — a
#: reader (and a model) meets what IS established before what is not.
CLAIMS: tuple = (
    CLAIM_DEPLOYMENT, CLAIM_CODE_CHANGE, CLAIM_TESTS, CLAIM_COORDINATION,
    CLAIM_FUNCTIONALITY, CLAIM_USERS, CLAIM_FEEDBACK, CLAIM_GOAL_PROGRESS,
    CLAIM_BUSINESS_OUTCOME,
)

#: The claims that must NEVER be asserted from adjacent evidence. Held as a set
#: so a consumer can render them together, and so a future claim added above is
#: an explicit decision about which side of this line it falls on.
INFERRED_CLAIMS: frozenset = frozenset({
    CLAIM_FUNCTIONALITY, CLAIM_USERS, CLAIM_FEEDBACK, CLAIM_GOAL_PROGRESS,
    CLAIM_BUSINESS_OUTCOME,
})


# ── Support levels ───────────────────────────────────────────────────────────
SUPPORT_NONE = "none"          # nothing in this project bears on it
SUPPORT_INDIRECT = "indirect"  # an ADJACENT fact exists; the claim itself is unproven
SUPPORT_DIRECT = "direct"      # a source recorded this claim's own kind of evidence


# ── Evidence classes (stable codes) — used to NAME what is missing ───────────
EV_DEPLOY = "deployment_event"
EV_CODE = "code_change_event"
EV_CI = "ci_or_test_report"
EV_COORDINATION = "meeting_or_message"
EV_HUMAN_REPORT = "person_stating_it"
EV_CUSTOMER_KNOWLEDGE = "recorded_customer_fact"
EV_METRIC_KNOWLEDGE = "recorded_metric_or_business_fact"
EV_GOAL = "recorded_project_goal"

#: Durable-knowledge domains (`orchestrator.business_knowledge`) that speak for
#: a claim class. Read as a vocabulary, not re-derived: the entries are already
#: provenance-tagged by the authority that stored them.
_CUSTOMER_DOMAINS = frozenset({"customer"})
_BUSINESS_DOMAINS = frozenset({"business", "metric", "experiment"})

#: Which normalized facets count as somebody SAYING something (as opposed to a
#: machine reporting a build). Mail and discussion carry a person's words;
#: a meeting is coordination, not a statement about the product.
_REPORT_FACETS = frozenset({ev.FACET_DISCUSSION, ev.FACET_MAIL})
_COORDINATION_FACETS = frozenset({ev.FACET_DISCUSSION, ev.FACET_MAIL,
                                  ev.FACET_MEETING})

_MAX_SOURCES = 4


def _row(claim: str, support: str, sources: Sequence[str], count: int,
         missing: Sequence[str]) -> Dict[str, Any]:
    ordered: List[str] = []
    for s in sources:
        s = str(s or "").strip().lower()
        if s and s not in ordered:
            ordered.append(s)
        if len(ordered) >= _MAX_SOURCES:
            break
    return {
        "claim": claim,
        "support": support,
        "sources": ordered,
        "evidence_count": int(count),
        # One source is never corroboration — the package's standing rule,
        # surfaced per claim so a consumer can say so in the same breath as
        # the claim rather than as a footnote somewhere else.
        "single_source": bool(support != SUPPORT_NONE and len(ordered) == 1),
        "missing": list(missing) if support != SUPPORT_DIRECT else [],
    }


def ground_claims(
    observations: Sequence[Dict[str, Any]],
    *,
    goals: Sequence[Any] = (),
    decisions: Sequence[Any] = (),
    knowledge: Sequence[Dict[str, Any]] = (),
    limit: int = 60,
) -> Dict[str, Any]:
    """What this project's evidence establishes, and what it does not.

    PURE. `observations` are rows the caller already read and already scoped to
    one (user, project); `goals` / `decisions` / `knowledge` are the same
    records the caller already holds. Nothing here reads a store, so this can
    never widen a caller's scope, and it costs no query.

    Returns::

        {"claims":  [{claim, support, sources, evidence_count,
                      single_source, missing}, …],   # one row per CLAIMS entry
         "sources": ["vercel", …],                   # tools reporting at all
         "observations": 12,
         "single_source_project": True}

    Fail-soft: any problem yields an empty, honest structure rather than an
    exception — a grounding failure must never break a project read."""
    try:
        return _ground(observations, goals=goals, decisions=decisions,
                       knowledge=knowledge, limit=limit)
    except Exception as exc:      # pragma: no cover — never break a caller
        logger.debug("project_intelligence.ground_claims failed: %s", exc)
        return {"claims": [], "sources": [], "observations": 0,
                "single_source_project": False}


def _ground(
    observations: Sequence[Dict[str, Any]],
    *,
    goals: Sequence[Any],
    decisions: Sequence[Any],
    knowledge: Sequence[Dict[str, Any]],
    limit: int,
) -> Dict[str, Any]:
    events = ev.events_from_observations(observations, limit=limit)

    # ── What kinds of evidence exist at all, and which tool reported them ────
    by_facet: Dict[str, List[str]] = {}
    positive_ci: List[str] = []
    all_sources: List[str] = []
    for e in events:
        by_facet.setdefault(e.facet, []).append(e.source)
        if e.source and e.source not in all_sources:
            all_sources.append(e.source)
        if e.facet == ev.FACET_CI and e.polarity == ev.POLARITY_POSITIVE:
            positive_ci.append(e.source)

    def facet(*names: str) -> List[str]:
        out: List[str] = []
        for n in names:
            out.extend(by_facet.get(n, []))
        return out

    deploy = facet(ev.FACET_DEPLOY)
    code = facet(ev.FACET_CODE)
    ci = facet(ev.FACET_CI)
    coordination = facet(*_COORDINATION_FACETS)
    reports = facet(*_REPORT_FACETS)

    # Durable knowledge, read as the domains its own authority tagged it with.
    customer_knowledge: List[str] = []
    business_knowledge: List[str] = []
    for row in knowledge or []:
        if not isinstance(row, dict):
            continue
        domain = str(row.get("domain") or "").strip().lower()
        label = f"recorded knowledge ({domain})" if domain else "recorded knowledge"
        if domain in _CUSTOMER_DOMAINS:
            customer_knowledge.append(label)
        elif domain in _BUSINESS_DOMAINS:
            business_knowledge.append(label)

    goal_count = len([g for g in (goals or []) if g])
    decision_count = len([d for d in (decisions or []) if d])

    claims: List[Dict[str, Any]] = []

    # ── The factual classes: a machine reported a thing, so the thing happened
    claims.append(_row(CLAIM_DEPLOYMENT,
                       SUPPORT_DIRECT if deploy else SUPPORT_NONE,
                       deploy, len(deploy), [EV_DEPLOY]))
    claims.append(_row(CLAIM_CODE_CHANGE,
                       SUPPORT_DIRECT if code else SUPPORT_NONE,
                       code, len(code), [EV_CODE]))
    claims.append(_row(CLAIM_TESTS,
                       SUPPORT_DIRECT if ci else SUPPORT_NONE,
                       ci, len(ci), [EV_CI]))
    claims.append(_row(CLAIM_COORDINATION,
                       SUPPORT_DIRECT if coordination else SUPPORT_NONE,
                       coordination, len(coordination), [EV_COORDINATION]))

    # ── FUNCTIONALITY. A deployment is not a working product; that is the
    #    whole point of this module. A green CI run is evidence about the
    #    CHECKS, so it counts as indirect and must be reported as such. Only a
    #    person saying it makes it direct — and then it is attributed, not
    #    stated as fact by Korvix.
    if reports:
        claims.append(_row(CLAIM_FUNCTIONALITY, SUPPORT_DIRECT,
                           reports, len(reports), [EV_HUMAN_REPORT]))
    elif positive_ci:
        claims.append(_row(CLAIM_FUNCTIONALITY, SUPPORT_INDIRECT,
                           positive_ci, len(positive_ci),
                           [EV_HUMAN_REPORT]))
    else:
        claims.append(_row(CLAIM_FUNCTIONALITY, SUPPORT_NONE, [], 0,
                           [EV_CI, EV_HUMAN_REPORT]))

    # ── USERS / FEEDBACK. No build system knows whether anyone used anything.
    #    Only a person's words or a recorded customer fact can establish these.
    if customer_knowledge:
        claims.append(_row(CLAIM_USERS, SUPPORT_DIRECT, customer_knowledge,
                           len(customer_knowledge), [EV_CUSTOMER_KNOWLEDGE]))
        claims.append(_row(CLAIM_FEEDBACK, SUPPORT_DIRECT, customer_knowledge,
                           len(customer_knowledge), [EV_CUSTOMER_KNOWLEDGE]))
    elif reports:
        claims.append(_row(CLAIM_USERS, SUPPORT_INDIRECT, reports,
                           len(reports), [EV_CUSTOMER_KNOWLEDGE]))
        claims.append(_row(CLAIM_FEEDBACK, SUPPORT_DIRECT, reports,
                           len(reports), [EV_HUMAN_REPORT]))
    else:
        claims.append(_row(CLAIM_USERS, SUPPORT_NONE, [], 0,
                           [EV_HUMAN_REPORT, EV_CUSTOMER_KNOWLEDGE]))
        claims.append(_row(CLAIM_FEEDBACK, SUPPORT_NONE, [], 0,
                           [EV_HUMAN_REPORT, EV_CUSTOMER_KNOWLEDGE]))

    # ── GOAL PROGRESS. Without a recorded goal there is nothing to progress
    #    against, and "the project is progressing toward its goals" is a
    #    sentence about nothing. With goals recorded it can be DISCUSSED
    #    against them — but no connector event says "this advanced that goal",
    #    so it never rises above indirect here.
    if goal_count:
        claims.append(_row(CLAIM_GOAL_PROGRESS, SUPPORT_INDIRECT,
                           ["recorded goals"]
                           + (["recorded decisions"] if decision_count else []),
                           goal_count + decision_count, [EV_HUMAN_REPORT]))
    else:
        claims.append(_row(CLAIM_GOAL_PROGRESS, SUPPORT_NONE, [], 0, [EV_GOAL]))

    # ── BUSINESS OUTCOME. Only a recorded business / metric fact.
    if business_knowledge:
        claims.append(_row(CLAIM_BUSINESS_OUTCOME, SUPPORT_DIRECT,
                           business_knowledge, len(business_knowledge),
                           [EV_METRIC_KNOWLEDGE]))
    else:
        claims.append(_row(CLAIM_BUSINESS_OUTCOME, SUPPORT_NONE, [], 0,
                           [EV_METRIC_KNOWLEDGE]))

    # Emitted in the declared order regardless of how they were appended, so a
    # consumer can rely on factual-before-inferred without sorting.
    order = {c: i for i, c in enumerate(CLAIMS)}
    claims.sort(key=lambda r: order.get(r["claim"], len(CLAIMS)))

    return {
        "claims": claims,
        "sources": all_sources[:_MAX_SOURCES],
        "observations": len(events),
        "single_source_project": len(all_sources) == 1,
    }


def unsupported(grounding: Dict[str, Any]) -> List[str]:
    """The claim codes this project establishes NOTHING for. The list a
    consumer names explicitly rather than leaving to inference."""
    return [str(r.get("claim")) for r in (grounding or {}).get("claims") or []
            if isinstance(r, dict) and r.get("support") == SUPPORT_NONE]


def missing_evidence(grounding: Dict[str, Any]) -> List[str]:
    """Every evidence class that would establish something currently
    unestablished, de-duplicated in first-seen order."""
    out: List[str] = []
    for row in (grounding or {}).get("claims") or []:
        if not isinstance(row, dict) or row.get("support") == SUPPORT_DIRECT:
            continue
        for code in row.get("missing") or []:
            if code not in out:
                out.append(str(code))
    return out


__all__ = [
    "CLAIMS", "INFERRED_CLAIMS",
    "CLAIM_DEPLOYMENT", "CLAIM_CODE_CHANGE", "CLAIM_TESTS", "CLAIM_COORDINATION",
    "CLAIM_FUNCTIONALITY", "CLAIM_USERS", "CLAIM_FEEDBACK",
    "CLAIM_GOAL_PROGRESS", "CLAIM_BUSINESS_OUTCOME",
    "SUPPORT_NONE", "SUPPORT_INDIRECT", "SUPPORT_DIRECT",
    "EV_DEPLOY", "EV_CODE", "EV_CI", "EV_COORDINATION", "EV_HUMAN_REPORT",
    "EV_CUSTOMER_KNOWLEDGE", "EV_METRIC_KNOWLEDGE", "EV_GOAL",
    "ground_claims", "unsupported", "missing_evidence",
]
