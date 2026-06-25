# coding: utf-8
"""
Phase 6 — MemoryRetriever.

Semantic-ready abstraction over the SQL store. Today: text-LIKE
search + importance/recency ranking. Tomorrow (once embeddings are
populated): cosine similarity over `embedding` joined with the same
ranking.

The retriever's only job is to take a `MemoryQuery` and return a
ranked `list[MemoryRecord]`. It does not write, delete, or expire.
That separation matters — the manager / API can stub the retriever
out for tests without rewriting any business logic.

Ranking model (current):
  score = w_text * text_overlap_norm
        + w_importance * importance
        + w_recency * recency_decay
  where text_overlap_norm in [0,1], importance in [0,1],
  recency_decay = 1.0 for now, halves every 30 days.

The weights are exposed as class attributes so a future ML scorer can
subclass the retriever and override `score_record()` without touching
the SQL layer.
"""
from __future__ import annotations

import logging
import math
import re
from datetime import datetime, timezone
from typing import Iterable, Optional

from backend.services.memory_plane import store
from backend.services.memory_plane.types import MemoryQuery, MemoryRecord


logger = logging.getLogger(__name__)


# Ranking weights — exposed for override. They sum loosely to 1.0 but
# the absolute scale doesn't matter because we only sort.
DEFAULT_WEIGHT_TEXT       = 0.55
DEFAULT_WEIGHT_IMPORTANCE = 0.30
DEFAULT_WEIGHT_RECENCY    = 0.15

# 30-day half-life on recency decay.
RECENCY_HALF_LIFE_S = 30 * 24 * 3600

# Tokenizer: lowercase ascii word boundaries. Good enough for Turkish/
# English signals; a future BM25 layer can replace this without
# touching callers.
_WORD_RE = re.compile(r"[a-z0-9]+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    if not text:
        return []
    return _WORD_RE.findall(text.lower())


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        # SQLite stores ISO with explicit +00:00; Python's fromisoformat
        # handles that natively from 3.11. Older runtimes are not a
        # target here (backend is 3.11+).
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def _recency_decay(created_at: Optional[str]) -> float:
    """Exponential decay; 1.0 fresh, ~0.5 at 30 days, ~0.25 at 60."""
    dt = _parse_iso(created_at)
    if dt is None:
        return 0.5
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    age_s = max(0.0, (_now_dt() - dt).total_seconds())
    return math.pow(0.5, age_s / RECENCY_HALF_LIFE_S)


def _text_overlap(query_tokens: list[str], content: str) -> float:
    """Crude overlap score in [0,1]. Higher = more shared tokens.

    Replaceable with embedding cosine when MemoryRecord.embedding is
    populated. We keep the same return contract ([0,1]) so the rest of
    the ranking math is invariant.
    """
    if not query_tokens:
        return 0.0
    content_tokens = set(_tokenize(content))
    if not content_tokens:
        return 0.0
    hits = sum(1 for t in query_tokens if t in content_tokens)
    return hits / float(len(query_tokens))


class MemoryRetriever:
    """Stateless retriever. Cheap to instantiate; the module-level
    `retriever` singleton is the common path."""

    weight_text:       float = DEFAULT_WEIGHT_TEXT
    weight_importance: float = DEFAULT_WEIGHT_IMPORTANCE
    weight_recency:    float = DEFAULT_WEIGHT_RECENCY

    def score_record(
        self,
        record: MemoryRecord,
        *,
        query_tokens: list[str],
    ) -> float:
        """Composite score used to rank the SQL results. Override to
        plug in a different scoring model (ML / embedding cosine /
        agent-specific boost)."""
        text_score      = _text_overlap(query_tokens, record.content)
        importance      = float(record.importance or 0.0)
        recency         = _recency_decay(record.created_at)
        return (
            self.weight_text       * text_score
            + self.weight_importance * importance
            + self.weight_recency  * recency
        )

    def search(self, query: MemoryQuery) -> list[MemoryRecord]:
        """Run the search and return ranked results.

        Algorithm:
          1. Ask the SQL store for a candidate pool. We over-fetch by
             a constant factor to give the ranker headroom.
          2. Score each candidate via `score_record()`.
          3. Sort + truncate back to the requested limit.

        Text-ranking pool selection:
          * When `query.query` is None, we trust the SQL layer's
            importance+recency ordering and return verbatim.
          * When `query.query` is set, we DROP the LIKE filter in the
            candidate fetch so the in-memory ranker can score against
            a broader pool. The SQL LIKE filter is too narrow (substring
            match) for a semantic-style retriever — a memory that
            answers the query may not contain its literal tokens.
            We cap the candidate pool at 200 rows so the retrieval
            stays bounded.
        """
        if not query.user_id:
            return []

        # Over-fetch so the ranker has options. Cap the candidate
        # pool so retrieval stays bounded even for users with thousands
        # of memories.
        safe_limit = int(max(1, query.limit))
        safe_offset = int(max(0, query.offset))
        if query.query:
            candidate_limit = min(
                200,
                max((safe_limit + safe_offset) * 4, safe_limit),
            )
            candidate_offset = 0
        else:
            candidate_limit = safe_limit
            candidate_offset = safe_offset
        candidate_query = MemoryQuery(
            user_id=          query.user_id,
            # IMPORTANT: when we plan to rank in-memory we deliberately
            # SKIP the SQL LIKE filter so the candidate pool isn't
            # collapsed before the ranker sees it. Only honor it when
            # the caller wants the raw SQL ordering (query is None).
            query=            None,
            project_id=       query.project_id,
            agent_id=         query.agent_id,
            kind=             query.kind,
            importance_floor= query.importance_floor,
            include_expired=  query.include_expired,
            limit=            candidate_limit,
            offset=           candidate_offset,
        )
        candidates: Iterable[MemoryRecord] = store.search_text(candidate_query)

        # No free-text → SQL ordering is fine. Importance + recency
        # are already factored in at the SQL layer.
        if not query.query:
            return list(candidates)[:safe_limit]

        tokens = _tokenize(query.query)
        ranked = sorted(
            candidates,
            key=lambda r: self.score_record(r, query_tokens=tokens),
            reverse=True,
        )
        return ranked[safe_offset : safe_offset + safe_limit]

    # ── Convenience adapters used by the manager / hooks ───────────────────

    def top_for_context(
        self,
        user_id: str,
        *,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        query: Optional[str] = None,
        kind: Optional[str] = None,
        importance_floor: Optional[float] = None,
        limit: int = 5,
    ) -> list[MemoryRecord]:
        """High-level helper for chat/agent context injection. Returns
        the top-N most relevant memories for a user (+ optional
        project/agent narrowing). Empty list on any failure."""
        try:
            return self.search(MemoryQuery(
                user_id=         str(user_id),
                query=           query,
                project_id=      project_id,
                agent_id=        agent_id,
                kind=            kind,
                importance_floor=importance_floor,
                limit=           int(max(1, min(50, limit))),
            ))
        except Exception as e:
            logger.warning("memory_plane.retriever.top_for_context user=%s error: %s",
                           user_id, e)
            return []


# Module-level singleton.
retriever: MemoryRetriever = MemoryRetriever()


__all__ = ["MemoryRetriever", "retriever"]
