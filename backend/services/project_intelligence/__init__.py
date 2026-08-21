# coding: utf-8
"""PROJECT INTELLIGENCE — the correlation layer between observation and action.

    Gmail / GitHub / Slack / Calendar / Vercel
            ↓   (unchanged connectors)
    observations_store                      ← the ONE ingestion authority
            ↓
    PROJECT INTELLIGENCE  ← this package
      entity resolution · event understanding · cross-source correlation
      evidence aggregation · state inference · confidence      (`correlation`)
      affected area · change kind · implications · uncertainty  (`interpretation`)
      the project as one picture                                (`synthesis`)
            ↓
    Business Brain / candidate / priority authorities   ← unchanged deciders
            ↓
    Project Workspace · Project chat

WHAT IT OWNS
------------
Facts, relationships and the reading of them: whether two observations are
about the same real-world thing, what the accumulated evidence says about that
thing's state, how much that reading can be trusted, which part of the project
it touches, what it IMPLIES, and what is still unknown. That is all.

AN IMPLICATION IS NOT AN ACTION
-------------------------------
    "the merged change is not proven live: its production deploy failed"   ✓
    "redeploy production"                                                  ✗

The first is a consequence of evidence and belongs here. The second is a
proposal of work and belongs to `candidate_synthesis`, ranked by
`action_prioritizer`, gated by `execution_policy`. This package hands richer
structure to those authorities; it never becomes one.

WHAT IT DOES NOT OWN
--------------------
Priority, action, execution, approval, durable memory. `candidate_synthesis`
still decides what could be worth doing, `action_prioritizer` still ranks it,
`execution_policy` still gates it, `attention` still decides what a human is
shown first, and `decisions_store` / `business_knowledge` still hold everything
durable. This layer proposes no work and writes nothing, anywhere.

NOT TO BE CONFUSED WITH `orchestrator.project_intelligence`
-----------------------------------------------------------
That module is a RUN-scoped, capability-aware PROMPT PACKET builder: it
projects a specialist's slice of goals/decisions/deliverables into a system
prompt for one agent run. It is untouched, still the authority for that job,
and shares nothing with this package but a word. This package is PROJECT-scoped
and connector-driven, and produces structured state rather than prompt text.

OPERATIONAL vs DURABLE — the boundary, stated once
---------------------------------------------------
Everything here is OPERATIONAL and perishable: "as of now, the evidence
suggests the payment webhook is fixed". It is recomputed on every read from
the observations that are still inside the correlation window, and it is never
persisted — precisely so it cannot outlive the evidence it was derived from.

A DURABLE fact ("we decided to bill annually", "retrying webhooks 3× fixed the
dropped-payment class of bug") belongs to the existing authorities:
`decisions_store` for choices, `business_knowledge` on the Memory Plane for
learnings. Promotion across that boundary is a deliberate, explicit act by a
user or by an authority that already owns it — never a side effect of a
correlation happening to look confident. Nothing in this package writes.

NO HEALTH SCORE, NO SECOND RANKING
----------------------------------
There is no project health number anywhere in this package, and there will not
be: a fabricated aggregate ("72/100") is exactly the confident nonsense this
layer exists to avoid. The project-level lists are SLICES of the order
`correlation` already produced — `attention` remains the sole authority on what
a human should look at now.

COST: pure computation over rows another authority already read. ZERO provider
calls, ZERO model tokens, ZERO writes, ZERO new tables.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from backend.services.project_intelligence.correlation import (
    CONFIDENCE_HIGH, CONFIDENCE_LOW, CONFIDENCE_MEDIUM,
    CORRELATION_WINDOW_DAYS, ENTITY_CHANGE, ENTITY_CI, ENTITY_DEPLOYMENT,
    ENTITY_ISSUE, ENTITY_MEETING, ENTITY_PULL_REQUEST, ENTITY_TOPIC,
    MAX_EVIDENCE, MAX_EVIDENCE_IDS, MAX_FACETS, MAX_OBSERVATIONS, MAX_STATES,
    MIN_CORROBORATED_EVIDENCE, MIN_SUBJECT_MEMBERS,
    STATE_CONFLICTING, STATE_IN_PROGRESS, STATE_LIKELY_RESOLVED,
    STATE_OBSERVED, STATE_UNRESOLVED, correlate, correlate_with_membership,
)
from backend.services.project_intelligence.synthesis import (
    STATE_NO_EVIDENCE, synthesize,
)
from backend.services.project_intelligence.grounding import (
    CLAIMS, INFERRED_CLAIMS,
    CLAIM_DEPLOYMENT, CLAIM_CODE_CHANGE, CLAIM_TESTS, CLAIM_COORDINATION,
    CLAIM_FUNCTIONALITY, CLAIM_USERS, CLAIM_FEEDBACK, CLAIM_GOAL_PROGRESS,
    CLAIM_BUSINESS_OUTCOME,
    SUPPORT_NONE, SUPPORT_INDIRECT, SUPPORT_DIRECT,
    EV_DEPLOY, EV_CODE, EV_CI, EV_COORDINATION, EV_HUMAN_REPORT,
    EV_CUSTOMER_KNOWLEDGE, EV_METRIC_KNOWLEDGE, EV_GOAL,
    ground_claims, missing_evidence, unsupported,
)

logger = logging.getLogger(__name__)

#: States that describe a live problem rather than a settled or quiet one.
OPEN_STATES = frozenset({STATE_UNRESOLVED, STATE_CONFLICTING})


def project_states(
    observations: Sequence[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    limit: int = MAX_STATES,
) -> List[Dict[str, Any]]:
    """PURE entry point: already-read, already-scoped observations → bounded
    inferred states. Prefer this wherever the caller has the rows in hand (the
    workspace read model does), because it costs no additional database read."""
    try:
        return correlate(observations, now=now, limit=limit)
    except Exception as exc:      # pragma: no cover — never break a caller
        logger.debug("project_intelligence.project_states failed: %s", exc)
        return []


def project_states_with_membership(
    observations: Sequence[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    limit: int = MAX_STATES,
) -> "tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]":
    """`(states, membership)` for a backend consumer that must know which rows a
    subject already speaks for — see `correlation.correlate_with_membership`.

    Use this instead of `project_states` wherever an OLDER path would otherwise
    act on a raw observation as though this layer did not exist. Fail-soft:
    any problem yields `([], {})`, which degrades to the legacy behaviour rather
    than silently swallowing signals."""
    try:
        return correlate_with_membership(observations, now=now, limit=limit)
    except Exception as exc:      # pragma: no cover — never break a caller
        logger.debug("project_intelligence.project_states_with_membership "
                     "failed: %s", exc)
        return [], {}


def for_project(
    user_id: str, project_id: str, *,
    now: Optional[datetime] = None,
    limit: int = MAX_STATES,
    observation_limit: int = MAX_OBSERVATIONS,
) -> List[Dict[str, Any]]:
    """Owner-scoped convenience read for callers that do NOT already hold the
    observations.

    Ownership is inherited, never asserted here: the rows come from the single
    canonical `observations_store`, filtered by BOTH `project_id` AND
    `user_id`, so a projection can only ever be computed from observations that
    already belong to that pair. There is no cross-project or cross-owner path
    through this function, because there is no query here that could express
    one. A caller with no owner id gets nothing rather than a project-wide
    read. Fail-soft: any store problem yields []."""
    if not (user_id and project_id):
        return []
    try:
        from backend.services.orchestrator import observations_store as obs
        rows = obs.list_observations(
            str(project_id), user_id=str(user_id),
            sources=list(obs.CONNECTOR_SOURCES),
            limit=max(1, min(int(observation_limit or MAX_OBSERVATIONS),
                             MAX_OBSERVATIONS)))
    except Exception as exc:
        logger.debug("project_intelligence.for_project read failed: %s", exc)
        return []
    return project_states(rows, now=now, limit=limit)


def understand(
    observations: Sequence[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    limit: int = MAX_STATES,
) -> Dict[str, Any]:
    """PURE: already-read, already-scoped observations → the full project
    understanding — the interpreted subjects AND what they add up to.

    This is the entry point a SURFACE should use (the workspace read model, the
    chat prompt assembler), because it guarantees the two halves were computed
    from the same rows in the same instant: a page that reported "3 open
    subjects" beside a synthesis derived from a second read could disagree with
    itself, and this makes that impossible.

    Returns `{"subjects": [...], "synthesis": {...}}`. An empty project yields
    an empty subject list and an HONEST empty synthesis (state `no_evidence`),
    never an absent key the caller has to null-check."""
    when = (now or datetime.now(timezone.utc))
    subjects = project_states(observations, now=when, limit=limit)
    try:
        overall = synthesize(subjects, observations=observations, now=when)
    except Exception as exc:      # pragma: no cover — never break a caller
        logger.debug("project_intelligence.understand synthesis failed: %s", exc)
        overall = synthesize([], observations=(), now=when)
    return {"subjects": subjects, "synthesis": overall}


def understand_with_membership(
    observations: Sequence[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
    limit: int = MAX_STATES,
) -> "tuple[List[Dict[str, Any]], Dict[str, Any], Dict[str, Dict[str, Any]]]":
    """`(subjects, synthesis, membership)` — `understand` for a backend
    consumer that must also know which stored rows a subject already speaks
    for. See `correlation.correlate_with_membership` for why the membership
    index is not the states' capped public id list."""
    when = (now or datetime.now(timezone.utc))
    subjects, membership = project_states_with_membership(
        observations, now=when, limit=limit)
    try:
        overall = synthesize(subjects, observations=observations, now=when)
    except Exception as exc:      # pragma: no cover — never break a caller
        logger.debug("project_intelligence.understand_with_membership "
                     "synthesis failed: %s", exc)
        overall = synthesize([], observations=(), now=when)
    return subjects, overall, membership


def open_states(states: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The subset describing a live problem (unresolved / conflicting)."""
    return [s for s in states or [] if str(s.get("state")) in OPEN_STATES]


__all__ = [
    "STATE_UNRESOLVED", "STATE_CONFLICTING", "STATE_IN_PROGRESS",
    "STATE_LIKELY_RESOLVED", "STATE_OBSERVED", "OPEN_STATES",
    "CONFIDENCE_HIGH", "CONFIDENCE_MEDIUM", "CONFIDENCE_LOW",
    "ENTITY_TOPIC", "ENTITY_PULL_REQUEST", "ENTITY_ISSUE", "ENTITY_CHANGE",
    "ENTITY_DEPLOYMENT", "ENTITY_CI", "ENTITY_MEETING",
    "MAX_STATES", "MAX_EVIDENCE", "MAX_EVIDENCE_IDS", "MAX_FACETS",
    "MAX_OBSERVATIONS",
    "CORRELATION_WINDOW_DAYS", "MIN_CORROBORATED_EVIDENCE",
    "MIN_SUBJECT_MEMBERS", "STATE_NO_EVIDENCE",
    "project_states", "project_states_with_membership", "for_project",
    "understand", "understand_with_membership", "synthesize",
    "open_states", "correlate", "correlate_with_membership",
    # GROUNDING — what the evidence does NOT establish. Same rows, no store.
    "CLAIMS", "INFERRED_CLAIMS",
    "CLAIM_DEPLOYMENT", "CLAIM_CODE_CHANGE", "CLAIM_TESTS", "CLAIM_COORDINATION",
    "CLAIM_FUNCTIONALITY", "CLAIM_USERS", "CLAIM_FEEDBACK",
    "CLAIM_GOAL_PROGRESS", "CLAIM_BUSINESS_OUTCOME",
    "SUPPORT_NONE", "SUPPORT_INDIRECT", "SUPPORT_DIRECT",
    "EV_DEPLOY", "EV_CODE", "EV_CI", "EV_COORDINATION", "EV_HUMAN_REPORT",
    "EV_CUSTOMER_KNOWLEDGE", "EV_METRIC_KNOWLEDGE", "EV_GOAL",
    "ground_claims", "missing_evidence", "unsupported",
]
