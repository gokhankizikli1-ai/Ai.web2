# coding: utf-8
"""Phase 6 closure — Memory consolidation.

Two real maintenance operations the operator can run from the CLI or
schedule as a periodic job:

  consolidate_duplicates(user_id, similarity_threshold=0.92)
      Finds groups of near-identical memories by cosine similarity over
      stored embeddings. Within each group the highest-importance row
      survives, gets a small importance bump (capped at 1.0), and the
      others are soft-deleted. Idempotent — re-running on an
      already-deduped corpus is a no-op.

  decay_importance(user_id, decay_days=30, factor=0.95)
      Multiplies importance of rows older than `decay_days` by `factor`
      so the TTL/eviction sweep eventually picks them off. The decay
      compounds across runs only when the row continues to age — once
      a row's importance ratchets low enough that it expires, it's
      gone (no negative-loop risk).

Safety:
  * Cross-user isolation — every query carries the caller's user_id.
  * Soft-delete only — hard deletes still require the GDPR `wipe_user`
    path, by design.
  * No LLM calls — pure SQL + cosine math. Cheap to run hourly on a
    real corpus; safe to run on cold rows in the background.
"""
from __future__ import annotations

import json
import logging
import math
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

from backend.services.db import engine
from backend.services.memory_plane import store
from backend.services.memory_plane.types import MemoryRecord, clamp_importance


logger = logging.getLogger(__name__)


# Default dedup-survivor importance bump — small enough to be safe to
# run repeatedly, large enough to surface deduped clusters above
# uncontested rows.
_DEDUP_BUMP = 0.05


@dataclass
class ConsolidationResult:
    deduped:        int = 0     # number of rows soft-deleted by dedup
    survivors:      int = 0     # number of cluster survivors bumped
    decayed:        int = 0     # number of rows whose importance was decayed
    scanned:        int = 0
    user_id:        str = ""
    reason:         str = ""

    def to_dict(self) -> dict:
        return {
            "user_id":   self.user_id,
            "deduped":   self.deduped,
            "survivors": self.survivors,
            "decayed":   self.decayed,
            "scanned":   self.scanned,
            "reason":    self.reason,
        }


# ── Helpers ────────────────────────────────────────────────────────────────

def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _iter_user_memories(
    user_id: str, *, only_embedded: bool = True, batch_size: int = 500,
) -> Iterator[MemoryRecord]:
    """Yield active rows for a user, optionally requiring an embedding.

    Works in pages so a user with thousands of rows doesn't load them
    all into memory at once. Uses the dispatcher so it works for both
    backends.
    """
    offset = 0
    while True:
        page = store.list_for_user(
            user_id,
            limit=batch_size, offset=offset,
            include_expired=False,
        )
        if not page:
            return
        for rec in page:
            if only_embedded and not rec.embedding:
                continue
            yield rec
        if len(page) < batch_size:
            return
        offset += batch_size


# ── Operations ─────────────────────────────────────────────────────────────

def consolidate_duplicates(
    user_id: str,
    *,
    similarity_threshold: float = 0.92,
    same_kind_only: bool = True,
    same_project_only: bool = True,
) -> ConsolidationResult:
    """Dedup near-identical embeddings for one user.

    Groups eligible rows by (kind, project_id) when those constraints
    are on, then within each group does an O(N²) cosine scan. For real
    corpora (≤ a few thousand per user-kind-project) this is fine; if a
    cohort needs more, we add ivfflat-backed batching in a follow-up.

    Returns counts; per-row decisions are logged.
    """
    out = ConsolidationResult(user_id=user_id)
    if not user_id:
        out.reason = "missing user_id"
        return out

    # Bucket eligible rows.
    buckets: dict[tuple, list[MemoryRecord]] = {}
    for rec in _iter_user_memories(user_id, only_embedded=True):
        out.scanned += 1
        key = (
            rec.kind         if same_kind_only    else "",
            rec.project_id   if same_project_only else "",
        )
        buckets.setdefault(key, []).append(rec)

    for bucket_key, rows in buckets.items():
        if len(rows) < 2:
            continue
        deleted: set[str] = set()
        for i in range(len(rows)):
            if (rows[i].id or "") in deleted:
                continue
            cluster: list[MemoryRecord] = [rows[i]]
            for j in range(i + 1, len(rows)):
                if (rows[j].id or "") in deleted:
                    continue
                sim = _cosine(rows[i].embedding or [], rows[j].embedding or [])
                if sim >= similarity_threshold:
                    cluster.append(rows[j])
            if len(cluster) < 2:
                continue

            # Pick survivor: highest importance, ties broken by oldest
            # (the row that's been around longest is most "settled").
            cluster.sort(
                key=lambda r: (-(r.importance or 0.0), r.created_at or ""),
            )
            survivor = cluster[0]
            losers   = cluster[1:]
            bumped   = clamp_importance(
                (survivor.importance or 0.0) + _DEDUP_BUMP
            )
            store.update_importance(survivor.id or "", bumped)
            out.survivors += 1

            for loser in losers:
                lid = loser.id or ""
                if not lid:
                    continue
                store.soft_delete(lid, user_id=user_id)
                deleted.add(lid)
                out.deduped += 1
                logger.info(
                    "[consolidation] user=%s deduped id=%s into=%s kind=%s",
                    user_id, lid, survivor.id, bucket_key[0],
                )

    return out


def decay_importance(
    user_id: str,
    *,
    decay_days: int = 30,
    factor: float = 0.95,
    floor: float = 0.05,
) -> ConsolidationResult:
    """Multiply importance of rows older than `decay_days` by `factor`.

    `factor` should be < 1.0 (0.95 = 5% decay per run). `floor` is a
    safety cap — rows already at or below `floor` are not decayed
    further so we don't oscillate around zero. The TTL evictor handles
    removal once a row's importance has decayed low enough that the
    caller doesn't pin it.
    """
    out = ConsolidationResult(user_id=user_id)
    if not user_id:
        out.reason = "missing user_id"
        return out
    if factor >= 1.0 or factor <= 0.0:
        out.reason = "factor must be in (0,1)"
        return out

    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, decay_days))).isoformat()
    for rec in _iter_user_memories(user_id, only_embedded=False):
        out.scanned += 1
        if not rec.created_at or rec.created_at > cutoff:
            continue
        cur_imp = float(rec.importance or 0.0)
        if cur_imp <= floor:
            continue
        new_imp = max(floor, cur_imp * factor)
        if abs(new_imp - cur_imp) < 0.001:
            continue
        if store.update_importance(rec.id or "", new_imp):
            out.decayed += 1
    return out


def consolidate_user(
    user_id: str,
    *,
    similarity_threshold: float = 0.92,
    decay_days: int = 30,
    decay_factor: float = 0.95,
) -> dict:
    """One-shot: run both passes for a user. Returns the combined
    report. The CLI uses this; an operator can also call it ad-hoc
    from a Python shell."""
    dedup = consolidate_duplicates(
        user_id, similarity_threshold=similarity_threshold,
    )
    decay = decay_importance(
        user_id, decay_days=decay_days, factor=decay_factor,
    )
    return {
        "user_id":   user_id,
        "dedup":     dedup.to_dict(),
        "decay":     decay.to_dict(),
    }


__all__ = [
    "ConsolidationResult",
    "consolidate_duplicates", "decay_importance", "consolidate_user",
]
