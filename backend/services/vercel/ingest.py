# coding: utf-8
"""Vercel connector — the single bridge from normalized resource → Business Brain.

Mirrors `github.ingest` / `gmail.ingest`: this module does exactly ONE thing —
call the canonical `observations_store.record_observation()` seam with the
connection's authoritative (user_id, project_id) scope. It NEVER creates a task,
decision, plan, or run; NEVER calls a model or forces an embedding; NEVER
touches memory / approvals / workflows.

The user_id is taken from the CONNECTION (derived from the Korvix project's
owner at connect time), never from provider content — so a Vercel deployment can
never scope an observation to another user's project.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Iterable

from backend.services.orchestrator import observations_store as obs
from backend.services.vercel.store import VercelConnection

logger = logging.getLogger(__name__)


@dataclass
class IngestResult:
    recorded: int = 0        # new observations written
    deduplicated: int = 0    # already-present (idempotent no-ops)
    rejected: int = 0        # malformed observations the store refused

    @property
    def total(self) -> int:
        return self.recorded + self.deduplicated + self.rejected

    def as_dict(self) -> Dict[str, int]:
        return {
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "rejected": self.rejected,
            "total": self.total,
        }


def ingest_one(connection: VercelConnection, normalized: Dict[str, Any]) -> str:
    """Record a single normalized observation under the connection's scope.
    Returns "recorded" | "deduplicated" | "rejected". Never raises."""
    if not isinstance(normalized, dict) or not normalized.get("kind"):
        return "rejected"
    try:
        res = obs.record_observation(
            user_id=connection.owner_user_id,
            project_id=connection.project_id,
            source=normalized.get("source") or "vercel",
            kind=str(normalized.get("kind")),
            summary=str(normalized.get("summary") or ""),
            payload=normalized.get("payload") if isinstance(normalized.get("payload"), dict) else {},
            external_id=(normalized.get("external_id") or None),
            observed_at=(normalized.get("observed_at") or None),
            importance=str(normalized.get("importance") or obs.IMPORTANCE_NORMAL),
        )
    except Exception as exc:  # pragma: no cover — record_observation is defensive
        logger.warning("vercel.ingest.record failed: %s", type(exc).__name__)
        return "rejected"
    if not res.get("ok"):
        return "rejected"
    return "deduplicated" if res.get("deduplicated") else "recorded"


def ingest_many(connection: VercelConnection,
                normalized_items: Iterable[Dict[str, Any]]) -> IngestResult:
    """Record a batch, tallying outcomes. Each item is independent (one
    malformed item never aborts the rest)."""
    result = IngestResult()
    for item in normalized_items:
        outcome = ingest_one(connection, item)
        if outcome == "recorded":
            result.recorded += 1
        elif outcome == "deduplicated":
            result.deduplicated += 1
        else:
            result.rejected += 1
    return result


__all__ = ["IngestResult", "ingest_one", "ingest_many"]
