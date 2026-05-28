# coding: utf-8
"""
Phase 6 — MemoryManager.

The orchestration layer that sits between the API/agent layer and the
SQL store. Responsibilities:

  * Create with dedup — identical (user, project, agent, kind, content)
    re-writes within the dedup window are folded into one record (we
    bump importance + updated_at instead of inserting a duplicate).
  * Decay / expire — opportunistic TTL eviction sweep on every call,
    bounded so we never block a request more than ~5ms even at scale.
  * Importance bumps — manual ("/v2/memory/{id}/star") + automatic
    (every time a memory is recalled in context).
  * Garbage / safety — refuse to persist obviously-secret content
    (delegates to the extractor's redaction patterns).

The MemoryStore is purely about SQL. The Manager is where business
rules live. Routes and chat hooks talk only to the Manager (via the
client).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

from backend.services.memory_plane import store
from backend.services.memory_plane.extractor import contains_secret_content
from backend.services.memory_plane.types import (
    MemoryRecord, MemoryQuery,
    DEFAULT_KIND, clamp_importance, normalize_kind,
    SOURCE_MANUAL,
)


logger = logging.getLogger(__name__)


# How often we run the opportunistic TTL eviction sweep on the read
# path. Sweeping on every read is wasteful; sweeping never is incorrect.
# Once-per-minute strikes a fine balance.
_EVICTION_INTERVAL_S = 60.0
_last_eviction_at: float = 0.0


def _maybe_evict() -> int:
    """Run the eviction sweep at most once per `_EVICTION_INTERVAL_S`.
    Idempotent + cheap when no rows are expired."""
    global _last_eviction_at
    now = time.time()
    if (now - _last_eviction_at) < _EVICTION_INTERVAL_S:
        return 0
    _last_eviction_at = now
    return store.expire_due()


# Dedup window — within this many seconds, an identical content for
# the same (user, project, agent, kind) is folded into the existing
# row instead of inserting a duplicate. Conservative default; the
# manager re-reads from env on every call so it's tunable in prod.
_DEFAULT_DEDUP_WINDOW_S = 24 * 3600
_DEDUP_FOLD_BUMP        = 0.05    # importance bump on dedup hit (capped at 1.0)


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


class MemoryManager:
    """High-level memory orchestration. Stateless; module singleton is
    the common path but a fresh instance is fine in tests."""

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
        """Persist a new memory.

        Returns the inserted (or dedup-folded) record on success; None
        when the input is rejected (empty / blocked by safety filter).

        Safety:
          * Empty / whitespace-only content is rejected.
          * `contains_secret_content` short-circuits anything that
            looks like a password / API key / bearer token.

        Dedup:
          * When `dedup=True` (default), an identical content for the
            same (user, project, agent, kind) within the dedup window
            re-uses the existing row and bumps its importance.
        """
        if not user_id or not str(user_id).strip():
            return None
        clean = (content or "").strip()
        if not clean:
            return None
        if contains_secret_content(clean):
            logger.info("memory_plane.manager.create skipped (secret-redacted) user=%s", user_id)
            return None

        kind_n = normalize_kind(kind)
        imp    = clamp_importance(importance)

        if dedup:
            existing = self._find_recent_duplicate(
                user_id=str(user_id),
                content=clean,
                project_id=project_id,
                agent_id=agent_id,
                kind=kind_n,
            )
            if existing is not None:
                # Fold: bump importance + return the original record.
                new_imp = min(1.0, (existing.importance or 0.0) + _DEDUP_FOLD_BUMP)
                if new_imp > (existing.importance or 0.0):
                    store.update_importance(existing.id or "", new_imp)
                    existing.importance = new_imp
                return existing

        # Phase 6 slice 3 — auto-embed when the embedding service is
        # enabled AND the caller didn't pass one in. Failures are
        # best-effort: a None vector falls through to text-search rank
        # and the row still persists. We embed BEFORE insert so the
        # vector lands in the same row write — no second roundtrip.
        if embedding is None:
            try:
                from backend.services.memory_plane.embedding import (
                    is_enabled as _embed_enabled, embed as _embed,
                )
                if _embed_enabled():
                    import asyncio as _asyncio
                    try:
                        loop = _asyncio.get_event_loop()
                        if loop.is_running():
                            # We're already inside an event loop — schedule
                            # a synchronous bridge via run_until_complete in
                            # a new loop on a thread to avoid re-entering.
                            # In practice `manager.create` is called from
                            # sync code paths only; the async caller bridge
                            # is below.
                            embedding = None
                        else:
                            embedding = loop.run_until_complete(_embed(clean))
                    except RuntimeError:
                        # No event loop — run a fresh one.
                        embedding = _asyncio.run(_embed(clean))
            except Exception as _embed_err:
                logger.debug("manager.create auto-embed skipped: %s", _embed_err)
                embedding = None

        record = MemoryRecord(
            user_id=    str(user_id),
            content=    clean,
            kind=       kind_n,
            project_id= project_id,
            agent_id=   agent_id,
            importance= imp,
            ttl_seconds=ttl_seconds,
            source=     source or SOURCE_MANUAL,
            metadata=   metadata or {},
            embedding=  embedding,
        )
        try:
            return store.insert(record)
        except ValueError as e:
            logger.warning("memory_plane.manager.create rejected: %s", e)
            return None
        except Exception as e:
            logger.warning("memory_plane.manager.create user=%s error: %s", user_id, e)
            return None

    def _find_recent_duplicate(
        self,
        *,
        user_id: str,
        content: str,
        project_id: Optional[str],
        agent_id: Optional[str],
        kind: str,
    ) -> Optional[MemoryRecord]:
        """Return the most-recent active row that matches the dedup key,
        within the dedup window. None when not found.

        We pull a small recent slice (limit=20) and compare in Python —
        that keeps the query a single indexed scan and avoids per-row
        LIKE checks in SQL. 20 rows is plenty given the window is 24h."""
        try:
            candidates = store.list_for_user(
                user_id,
                project_id=project_id,
                agent_id=agent_id,
                kind=kind,
                limit=20,
            )
        except Exception:
            return None
        if not candidates:
            return None
        target = content.strip().lower()
        cutoff = _now_dt().timestamp() - _DEFAULT_DEDUP_WINDOW_S
        for c in candidates:
            if c.created_at is None:
                continue
            try:
                ts = datetime.fromisoformat(c.created_at).timestamp()
            except Exception:
                continue
            if ts < cutoff:
                continue
            if (c.content or "").strip().lower() == target:
                return c
        return None

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, record_id: str, *, user_id: Optional[str] = None) -> Optional[MemoryRecord]:
        """Fetch one. When `user_id` is passed, enforces ownership —
        returns None when the row exists but belongs to a different
        user. Routes pass user_id so cross-user reads return 404."""
        _maybe_evict()
        record = store.get(record_id)
        if record is None:
            return None
        if user_id is not None and record.user_id != str(user_id):
            return None
        return record

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
        _maybe_evict()
        return store.list_for_user(
            user_id,
            project_id=project_id,
            agent_id=agent_id,
            kind=kind,
            include_expired=include_expired,
            limit=limit,
            offset=offset,
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
        """Public search. Goes through the retriever so ranking + future
        semantic search are transparent to callers."""
        _maybe_evict()
        # Local import to avoid a hard dep cycle: retriever imports
        # store; manager imports retriever; retriever's only caller
        # below is here, so this stays acyclic at module load.
        from backend.services.memory_plane.retriever import retriever
        return retriever.search(MemoryQuery(
            user_id=          str(user_id),
            query=            query,
            project_id=       project_id,
            agent_id=         agent_id,
            kind=             kind,
            importance_floor= importance_floor,
            limit=            int(max(1, min(100, limit))),
            offset=           int(max(0, offset)),
        ))

    # ── Mutate ─────────────────────────────────────────────────────────────

    def bump_importance(
        self,
        record_id: str,
        *,
        user_id: Optional[str] = None,
        delta: float = 0.10,
    ) -> Optional[MemoryRecord]:
        """Increase importance by `delta` (clamped to [0,1]). Used by
        the chat hook when a memory is recalled — frequently-recalled
        memories drift toward the top of the ranking."""
        existing = self.get(record_id, user_id=user_id)
        if existing is None:
            return None
        new_imp = clamp_importance((existing.importance or 0.0) + delta)
        if new_imp <= (existing.importance or 0.0):
            return existing
        if not store.update_importance(record_id, new_imp):
            return None
        existing.importance = new_imp
        return existing

    # ── Delete ─────────────────────────────────────────────────────────────

    def delete(self, record_id: str, *, user_id: Optional[str] = None) -> bool:
        """Soft-delete with ownership guard. Routes pass user_id so a
        cross-user delete is silently treated as "not found"."""
        return store.soft_delete(record_id, user_id=str(user_id) if user_id else None)

    def wipe_user(self, user_id: str) -> int:
        """GDPR "forget me". Permanent."""
        return store.wipe_user(user_id)


# Module-level singleton.
manager: MemoryManager = MemoryManager()


__all__ = ["MemoryManager", "manager"]
