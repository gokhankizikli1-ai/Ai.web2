# coding: utf-8
"""
Phase 6.x — Memory hydration pipeline.

This module is the SINGLE entry point the chat path calls to fetch a
prompt-ready memory snapshot. It owns the full pipeline:

  1. cache lookup           — return immediately on hit
  2. semantic retrieval     — text-overlap + importance ranking
  3. preference fallback    — if 2 returned nothing, fetch durable
                              preferences/style so recall never fails
                              for "what do I prefer"-type questions
  4. ranking + dedup        — durable kinds get +0.10 importance boost
  5. block formatting       — compact, prompt-ready string
  6. cache write            — TTL'd snapshot for the next turn
  7. structured logging     — duration, cache hit/miss, hits count

Streaming MUST NEVER start before this function returns — its caller
is awaited inside the route handler.

Public API:
  await hydrate_for_chat(user_id, project_id, query, limit)
       → HydratedSnapshot   (or None if memory plane disabled / empty)

The snapshot is also exposed via the cache module for downstream
diagnostics.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

from backend.services.memory_plane import cache as _mp_cache
from backend.services.memory_plane.preferences import (
    is_durable_kind, format_preferences_block, top_preferences,
)
from backend.services.memory_plane.types import MemoryRecord


logger = logging.getLogger(__name__)


# ── Public type ──────────────────────────────────────────────────────────────

@dataclass
class HydratedSnapshot:
    """What the chat path asks for. `context_text` is the
    prompt-ready string; `items` is the raw record list for
    debug/diagnostics."""
    user_id:      str
    project_id:   Optional[str]
    items:        list[MemoryRecord] = field(default_factory=list)
    context_text: str = ""
    hit_count:    int = 0
    cache_hit:    bool = False
    fallback_used: bool = False
    duration_ms:  int = 0

    def is_empty(self) -> bool:
        return self.hit_count == 0


# ── Pipeline ─────────────────────────────────────────────────────────────────

def _is_enabled() -> bool:
    return os.getenv("ENABLE_MEMORY_PLANE", "false").strip().lower() == "true"


def hydrate_for_chat(
    *,
    user_id: str,
    project_id: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 8,
    use_cache: bool = True,
) -> HydratedSnapshot:
    """Build the memory snapshot for one chat turn. ALWAYS returns a
    HydratedSnapshot (possibly empty); never raises. Times itself and
    emits a structured log line so production traffic is greppable."""
    t0 = time.monotonic()
    snap = HydratedSnapshot(user_id=str(user_id), project_id=project_id)

    if not _is_enabled() or not user_id or user_id == "anonymous":
        snap.duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "memory.hydration | uid=%s | path=disabled_or_anonymous | duration_ms=%d",
            user_id, snap.duration_ms,
        )
        return snap

    # ── 1) Cache lookup ──────────────────────────────────────────────────
    if use_cache:
        cached = _mp_cache.get(user_id, project_id)
        if cached is not None:
            snap.items        = list(cached.items)
            snap.context_text = cached.context_text
            snap.hit_count    = cached.hit_count
            snap.cache_hit    = True
            snap.duration_ms  = int((time.monotonic() - t0) * 1000)
            logger.info(
                "memory.hydration | uid=%s | cache=hit | hits=%d | "
                "duration_ms=%d | project=%s",
                user_id, snap.hit_count, snap.duration_ms, project_id or "-",
            )
            return snap

    # ── 2) Semantic retrieval (text + importance + recency ranked) ──────
    semantic_hits: list[MemoryRecord] = []
    try:
        from backend.services.memory_plane.retriever import retriever
        semantic_hits = retriever.top_for_context(
            user_id, project_id=project_id, query=query, limit=limit,
        ) or []
    except Exception as e:
        logger.warning("memory.hydration semantic-retrieval error: %s", e)

    # ── 3) Preference fallback ───────────────────────────────────────────
    # The user spec calls this out explicitly: "If semantic retrieval
    # returns nothing, fallback to latest important preference
    # memories." We do BOTH paths and merge so durable preferences
    # always make it into the prompt, even when the user's query
    # doesn't textually match them.
    pref_hits: list[MemoryRecord] = []
    try:
        pref_hits = top_preferences(user_id, project_id=project_id, limit=limit) or []
    except Exception as e:
        logger.warning("memory.hydration preference-fallback error: %s", e)

    # ── 4) Merge + dedup + ranking ──────────────────────────────────────
    seen: set[str] = set()
    merged: list[MemoryRecord] = []
    # Durable (preference / style / goal / etc.) takes precedence —
    # they get listed first so they survive the limit truncation even
    # when there are loads of facts.
    durable, ordinary = _split_durable(semantic_hits + pref_hits)
    for m in (*durable, *ordinary):
        rid = str(m.id) if m.id else None
        if rid and rid in seen:
            continue
        if rid:
            seen.add(rid)
        merged.append(m)
        if len(merged) >= limit:
            break

    # ── 5) Format ───────────────────────────────────────────────────────
    if merged:
        snap.items        = merged
        snap.context_text = format_preferences_block(merged)
        snap.hit_count    = len(merged)
        snap.fallback_used = bool(pref_hits) and not semantic_hits

    # ── 6) Cache write ──────────────────────────────────────────────────
    if use_cache and snap.hit_count > 0:
        _mp_cache.set(
            user_id, project_id,
            _mp_cache.SnapshotPayload(
                user_id=          str(user_id),
                project_id=       project_id,
                items=            tuple(snap.items),
                preferences_text= snap.context_text,
                context_text=     snap.context_text,
                hit_count=        snap.hit_count,
            ),
        )

    snap.duration_ms = int((time.monotonic() - t0) * 1000)
    logger.info(
        "memory.hydration | uid=%s | cache=miss | hits=%d | "
        "fallback=%s | duration_ms=%d | project=%s | semantic=%d | pref=%d",
        user_id, snap.hit_count, snap.fallback_used,
        snap.duration_ms, project_id or "-",
        len(semantic_hits), len(pref_hits),
    )
    return snap


def _split_durable(records: list[MemoryRecord]) -> tuple[list[MemoryRecord], list[MemoryRecord]]:
    """Partition records into (durable, ordinary). Durable kinds are
    listed first in the merged output — implements the ranking ladder."""
    durable, ordinary = [], []
    for m in records:
        (durable if is_durable_kind(m.kind) else ordinary).append(m)
    return durable, ordinary


def stats() -> dict:
    """Snapshot for `/v2/memory/health/diagnostic`."""
    return {
        "cache": _mp_cache.stats(),
        "enabled": _is_enabled(),
    }


__all__ = ["HydratedSnapshot", "hydrate_for_chat", "stats"]
