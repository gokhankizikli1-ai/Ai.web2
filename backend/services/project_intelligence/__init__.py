# coding: utf-8
"""PROJECT INTELLIGENCE — the correlation layer between observation and action.

    Gmail / GitHub / Slack / Calendar / Vercel
            ↓   (unchanged connectors)
    observations_store                      ← the ONE ingestion authority
            ↓
    PROJECT INTELLIGENCE  ← this package
      entity resolution · event understanding · cross-source correlation
      evidence aggregation · state inference · confidence
            ↓
    Business Brain / candidate / priority authorities   ← unchanged deciders
            ↓
    Project Workspace · Project chat

WHAT IT OWNS
------------
Facts and relationships: whether two observations are about the same real-world
thing, what the accumulated evidence says about that thing's state, and how
much that reading can be trusted. That is all.

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

COST: pure computation over rows another authority already read. ZERO provider
calls, ZERO model tokens, ZERO writes, ZERO new tables.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from backend.services.project_intelligence.correlation import (
    CONFIDENCE_HIGH, CONFIDENCE_LOW, CONFIDENCE_MEDIUM,
    CORRELATION_WINDOW_DAYS, ENTITY_CHANGE, ENTITY_CI, ENTITY_DEPLOYMENT,
    ENTITY_ISSUE, ENTITY_MEETING, ENTITY_PULL_REQUEST, ENTITY_TOPIC,
    MAX_EVIDENCE, MAX_EVIDENCE_IDS, MAX_OBSERVATIONS, MAX_STATES,
    MIN_CORROBORATED_EVIDENCE,
    STATE_CONFLICTING, STATE_IN_PROGRESS, STATE_LIKELY_RESOLVED,
    STATE_OBSERVED, STATE_UNRESOLVED, correlate,
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


def open_states(states: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The subset describing a live problem (unresolved / conflicting)."""
    return [s for s in states or [] if str(s.get("state")) in OPEN_STATES]


__all__ = [
    "STATE_UNRESOLVED", "STATE_CONFLICTING", "STATE_IN_PROGRESS",
    "STATE_LIKELY_RESOLVED", "STATE_OBSERVED", "OPEN_STATES",
    "CONFIDENCE_HIGH", "CONFIDENCE_MEDIUM", "CONFIDENCE_LOW",
    "ENTITY_TOPIC", "ENTITY_PULL_REQUEST", "ENTITY_ISSUE", "ENTITY_CHANGE",
    "ENTITY_DEPLOYMENT", "ENTITY_CI", "ENTITY_MEETING",
    "MAX_STATES", "MAX_EVIDENCE", "MAX_EVIDENCE_IDS", "MAX_OBSERVATIONS",
    "CORRELATION_WINDOW_DAYS", "MIN_CORROBORATED_EVIDENCE",
    "project_states", "for_project", "open_states", "correlate",
]
