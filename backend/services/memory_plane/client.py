# coding: utf-8
"""
Phase 6 — MemoryPlaneClient.

The stable public surface every caller speaks. Routes, agents, the
chat hook, future tools — all go through this client. The internal
modules (store / retriever / manager / extractor) are NOT part of the
public API.

Why one client instead of importing the manager directly?

  * Future swap: when the SQL store migrates to Postgres+pgvector in
    Phase 14, the client signature stays the same.
  * Feature-flag gate: every public method checks `is_enabled()` so
    the whole subsystem is a no-op while ENABLE_MEMORY_PLANE=false.
  * Auditability: a single chokepoint to bolt structured logging /
    metrics / circuit-breakers on later without touching N callsites.

Behaviour when disabled (`ENABLE_MEMORY_PLANE` ≠ "true"):
  * `create`, `update_*`, `delete`, `wipe_user` → no-ops, return None/0/False
  * `get`, `list`, `search`, `top_for_context` → return None/[] respectively
  * `extract`, `extract_and_store` → return []
  * `stats` and `is_enabled` always work (used by /tools/health)
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.memory_plane import store
from backend.services.memory_plane.extractor import (
    ExtractionCandidate, extract as _extract_patterns,
    score_importance,
)
from backend.services.memory_plane.manager import manager as _manager
from backend.services.memory_plane.retriever import retriever as _retriever
from backend.services.memory_plane.types import (
    DEFAULT_KIND, MemoryQuery, MemoryRecord,
    SOURCE_AUTO, SOURCE_MANUAL,
)


logger = logging.getLogger(__name__)


# ── Feature flag (dynamic, read on every call) ───────────────────────────────

def is_enabled() -> bool:
    """Read `ENABLE_MEMORY_PLANE` on every call so Railway flag flips
    take effect on the very next request without a process restart.
    Default OFF so production behaviour is byte-identical until
    explicitly enabled."""
    return os.getenv("ENABLE_MEMORY_PLANE", "false").strip().lower() == "true"


class MemoryPlaneClient:
    """The single public surface. Stateless; cheap to instantiate."""

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def init(self) -> None:
        """Idempotent storage bootstrap. Safe to call at app startup
        whether or not the flag is on — when off the schema is still
        created (zero rows; ~16KB on disk) so a flag flip is instant."""
        store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Create ─────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        user_id: str,
        content: str,
        kind: str = DEFAULT_KIND,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        importance: Optional[float] = None,
        ttl_seconds: Optional[int] = None,
        source: str = SOURCE_MANUAL,
        metadata: Optional[dict] = None,
        embedding: Optional[list[float]] = None,
        dedup: bool = True,
    ) -> Optional[MemoryRecord]:
        if not is_enabled():
            return None
        rec = _manager.create(
            user_id=    user_id,
            content=    content,
            kind=       kind,
            project_id= project_id,
            agent_id=   agent_id,
            importance= importance,
            ttl_seconds=ttl_seconds,
            source=     source,
            metadata=   metadata,
            embedding=  embedding,
            dedup=      dedup,
        )
        # Bust the hydration cache for this user so a freshly-saved
        # memory is visible on the very next chat turn. Best-effort —
        # a failure here never blocks the create path.
        if rec is not None and user_id:
            try:
                from backend.services.memory_plane import cache as _cache
                _cache.invalidate_user(str(user_id))
            except Exception:
                pass
        return rec

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, record_id: str, *, user_id: Optional[str] = None) -> Optional[MemoryRecord]:
        if not is_enabled():
            return None
        return _manager.get(record_id, user_id=user_id)

    def list_user(
        self,
        user_id: str,
        *,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        kind: Optional[str] = None,
        include_expired: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MemoryRecord]:
        if not is_enabled():
            return []
        return _manager.list_user(
            user_id,
            project_id=     project_id,
            agent_id=       agent_id,
            kind=           kind,
            include_expired=include_expired,
            limit=          limit,
            offset=         offset,
        )

    def search(
        self,
        user_id: str,
        *,
        query: Optional[str] = None,
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        kind: Optional[str] = None,
        importance_floor: Optional[float] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[MemoryRecord]:
        if not is_enabled():
            return []
        return _manager.search(
            user_id,
            query=           query,
            project_id=      project_id,
            agent_id=        agent_id,
            kind=            kind,
            importance_floor=importance_floor,
            limit=           limit,
            offset=          offset,
        )

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
        """Top-N memories for chat / agent prompt injection. Used by
        the chat hook to enrich the system prompt with relevant prior
        memories. Empty list when the flag is off."""
        if not is_enabled():
            return []
        return _retriever.top_for_context(
            user_id,
            project_id=      project_id,
            agent_id=        agent_id,
            query=           query,
            kind=            kind,
            importance_floor=importance_floor,
            limit=           limit,
        )

    # ── Mutate ─────────────────────────────────────────────────────────────

    def bump_importance(
        self,
        record_id: str,
        *,
        user_id: Optional[str] = None,
        delta: float = 0.10,
    ) -> Optional[MemoryRecord]:
        if not is_enabled():
            return None
        return _manager.bump_importance(record_id, user_id=user_id, delta=delta)

    def update_embedding(self, record_id: str, embedding: list[float]) -> bool:
        if not is_enabled():
            return False
        return store.update_embedding(record_id, embedding)

    # ── Delete ─────────────────────────────────────────────────────────────

    def delete(self, record_id: str, *, user_id: Optional[str] = None) -> bool:
        if not is_enabled():
            return False
        ok = _manager.delete(record_id, user_id=user_id)
        # Bust the hydration cache so the next chat turn doesn't
        # surface the soft-deleted memory.
        if ok and user_id:
            try:
                from backend.services.memory_plane import cache as _cache
                _cache.invalidate_user(str(user_id))
            except Exception:
                pass
        return ok

    def wipe_user(self, user_id: str) -> int:
        """GDPR "forget me". Hard delete every row for one user.
        Honours the flag — when off, returns 0 without inspecting
        anything (consistent with the rest of the API)."""
        if not is_enabled():
            return 0
        n = _manager.wipe_user(user_id)
        if n and user_id:
            try:
                from backend.services.memory_plane import cache as _cache
                _cache.invalidate_user(str(user_id))
            except Exception:
                pass
        return n

    # ── Extraction ─────────────────────────────────────────────────────────

    def extract(self, message: str, *, role: str = "user") -> list[ExtractionCandidate]:
        """Run the heuristic extractor against a message. Returns
        candidates WITHOUT persisting them — callers can audit /
        filter / re-rank before storing."""
        if not is_enabled():
            return []
        return _extract_patterns(message, role=role)

    def extract_and_store(
        self,
        *,
        user_id: str,
        message: str,
        role: str = "user",
        project_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> list[MemoryRecord]:
        """Extract candidates from a message and persist each one.
        Returns the list of persisted records (may be empty).

        This is the hot path called by the chat hook. It must be
        fast — the extraction is pure regex (no LLM) so the whole
        call is well under 1ms even on a long message.
        """
        if not is_enabled():
            return []
        try:
            cands = _extract_patterns(message, role=role)
        except Exception as e:
            logger.warning("memory_plane.extract_and_store extract failed: %s", e)
            return []
        out: list[MemoryRecord] = []
        for c in cands:
            try:
                rec = _manager.create(
                    user_id=    user_id,
                    content=    c.content,
                    kind=       c.kind,
                    project_id= project_id,
                    agent_id=   agent_id,
                    importance= c.importance,
                    source=     SOURCE_AUTO,
                    metadata=   c.metadata,
                )
                if rec is not None:
                    out.append(rec)
            except Exception as e:
                logger.warning("memory_plane.extract_and_store persist failed: %s", e)
        if out:
            logger.info(
                "memory_plane.extract_and_store user=%s persisted=%d kinds=%s",
                user_id, len(out), ",".join(sorted({r.kind for r in out})),
            )
        return out

    # ── Observability ──────────────────────────────────────────────────────

    def stats(self) -> dict:
        """Health snapshot. Includes the flag state + store counters
        even when disabled so /tools/health can show the subsystem is
        installed but quiet."""
        return {
            "enabled":  is_enabled(),
            "store":    store.store_stats(),
            "tables":   store.table_counts(),
        }


# ── Module-level singleton ───────────────────────────────────────────────────

client: MemoryPlaneClient = MemoryPlaneClient()

# Best-effort bootstrap on import — non-fatal if it fails (the schema
# is also created lazily on first use).
try:
    client.init()
except Exception as _e:
    logger.warning("memory_plane.client: init failed: %s", _e)


__all__ = [
    "MemoryPlaneClient",
    "client",
    "is_enabled",
    "score_importance",
]
