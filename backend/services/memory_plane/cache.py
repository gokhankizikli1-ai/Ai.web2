# coding: utf-8
"""
Phase 6.x — Memory snapshot cache.

A tiny TTL-bounded in-process cache that sits between the chat route
and the SQLite store. Goal: cut the per-turn cost of "what should I
inject into the system prompt for this user" from N SQLite reads to
one in-memory dict lookup, and provide a consistent snapshot across
the save → retrieve → recall trio.

Design rules:
  * Per-process (no Redis). Fine for single-instance Railway; a
    Redis-backed swap is one class change in Phase 14.
  * Keyed by (user_id, project_id). project_id=None is its own key.
  * TTL is short (30s default) so a save in another tab still shows
    up quickly; aggressive invalidation on every `memory_plane.client.create`
    means stale snapshots almost never reach a user.
  * Thread-safe via a single Lock around dict access; payloads are
    immutable lists/tuples so consumers can read without holding the
    lock.
  * Bounded — capped at MAX_ENTRIES to keep memory predictable
    under burst load; LRU eviction.

Public API (small on purpose):
  get(user_id, project_id)         → SnapshotPayload | None
  set(user_id, project_id, payload, ttl_s=None)
  invalidate_user(user_id)         (called on every save/delete)
  stats()                          for diagnostics
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Optional


logger = logging.getLogger(__name__)


# ── Tunables ─────────────────────────────────────────────────────────────────

def _ttl_s() -> float:
    try:
        return float(os.getenv("MEMORY_CACHE_TTL_S", "30"))
    except Exception:
        return 30.0


def _max_entries() -> int:
    try:
        return int(os.getenv("MEMORY_CACHE_MAX_ENTRIES", "2000"))
    except Exception:
        return 2000


# ── Payload ──────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SnapshotPayload:
    """Immutable snapshot of the memories injected for one
    (user_id, project_id) tuple. Hydration produces it once per
    request; subsequent chat-context lookups within the TTL window
    reuse it without touching SQLite."""
    user_id:           str
    project_id:        Optional[str]
    items:             tuple                                      # tuple[MemoryRecord]
    preferences_text:  str                                        # pre-formatted block
    context_text:      str                                        # full prompt-ready block
    hit_count:         int
    built_at_monotonic: float = field(default_factory=time.monotonic)


# ── Internal state ───────────────────────────────────────────────────────────

_LOCK = threading.Lock()
_STORE: "OrderedDict[tuple[str, Optional[str]], tuple[float, SnapshotPayload]]" = OrderedDict()
_STATS = {
    "hits":   0,
    "misses": 0,
    "sets":   0,
    "invalidations": 0,
    "evictions":     0,
}


def _key(user_id: str, project_id: Optional[str]) -> tuple[str, Optional[str]]:
    return (str(user_id), project_id)


def _evict_if_needed() -> None:
    cap = _max_entries()
    while len(_STORE) > cap:
        _STORE.popitem(last=False)
        _STATS["evictions"] += 1


# ── Public API ───────────────────────────────────────────────────────────────

def get(user_id: str, project_id: Optional[str] = None) -> Optional[SnapshotPayload]:
    """Return the cached snapshot if still fresh. Returns None on
    miss, expiry, or empty cache. Touches LRU order on hit."""
    if not user_id:
        return None
    k = _key(user_id, project_id)
    now = time.monotonic()
    with _LOCK:
        entry = _STORE.get(k)
        if entry is None:
            _STATS["misses"] += 1
            return None
        expires_at, payload = entry
        if expires_at < now:
            # Expired — drop and report miss.
            _STORE.pop(k, None)
            _STATS["misses"] += 1
            return None
        # Fresh — touch LRU order.
        _STORE.move_to_end(k)
        _STATS["hits"] += 1
        return payload


def set(  # noqa: A001  — intentional shadow of builtin to mirror dict API
    user_id: str,
    project_id: Optional[str],
    payload: SnapshotPayload,
    *,
    ttl_s: Optional[float] = None,
) -> None:
    if not user_id or payload is None:
        return
    k = _key(user_id, project_id)
    now = time.monotonic()
    ttl = float(ttl_s) if ttl_s is not None else _ttl_s()
    expires_at = now + ttl
    with _LOCK:
        _STORE[k] = (expires_at, payload)
        _STORE.move_to_end(k)
        _STATS["sets"] += 1
        _evict_if_needed()


def invalidate_user(user_id: str) -> int:
    """Drop EVERY cache entry for this user_id (across all project
    scopes). Returns the count removed. Called from
    `memory_plane.client.create` and `.delete` so a new save shows up
    on the very next chat turn."""
    if not user_id:
        return 0
    uid = str(user_id)
    removed = 0
    with _LOCK:
        to_remove = [k for k in _STORE if k[0] == uid]
        for k in to_remove:
            _STORE.pop(k, None)
            removed += 1
        if removed:
            _STATS["invalidations"] += removed
    return removed


def invalidate_all() -> int:
    """Test helper / admin nuke."""
    with _LOCK:
        n = len(_STORE)
        _STORE.clear()
        _STATS["invalidations"] += n
    return n


def stats() -> dict[str, Any]:
    """Diagnostic snapshot — never leaks payload values."""
    with _LOCK:
        return {
            **dict(_STATS),
            "size":        len(_STORE),
            "max_entries": _max_entries(),
            "ttl_s":       _ttl_s(),
        }


def _reset_for_tests() -> None:
    """Test helper — clear store + zero counters so each test starts fresh."""
    with _LOCK:
        _STORE.clear()
        for k in list(_STATS):
            _STATS[k] = 0


__all__ = [
    "SnapshotPayload",
    "get", "set", "invalidate_user", "invalidate_all",
    "stats", "_reset_for_tests",
]
