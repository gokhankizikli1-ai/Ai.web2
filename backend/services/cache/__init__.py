# coding: utf-8
# Phase 5.2 — TTL LRU cache + per-provider counters.
#
# Tiny zero-dependency in-process cache. Used by market_data + macro_data tools
# to stop every chat request from hammering external APIs.
#
# Public API:
#   cache_get(key)                 -> value | None  (expired entries auto-evicted)
#   cache_set(key, value, ttl_sec) -> None
#   record_fetch(provider, ok=True | False, reason="")
#   stats()                        -> dict (hits, misses, sets, evictions, providers)
#
# Persistence: per-process only. On Railway restart cache resets — that's fine,
# external APIs will refill it within seconds.
import time
import logging
import threading
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)

_MAX_ENTRIES = 1024
_LOCK = threading.Lock()
_STORE: "OrderedDict[str, tuple[float, Any]]" = OrderedDict()

_COUNTERS: dict[str, dict[str, int]] = {
    # provider name → {"ok": int, "fail": int, "last_reason": str}
}

_STATS = {"hits": 0, "misses": 0, "sets": 0, "evictions": 0, "expirations": 0}


def cache_get(key: str) -> Any | None:
    """Return cached value if present and not expired; else None."""
    if not key:
        return None
    now = time.time()
    with _LOCK:
        entry = _STORE.get(key)
        if entry is None:
            _STATS["misses"] += 1
            return None
        expires_at, value = entry
        if expires_at <= now:
            del _STORE[key]
            _STATS["expirations"] += 1
            _STATS["misses"]     += 1
            return None
        _STORE.move_to_end(key)
        _STATS["hits"] += 1
        return value


def cache_set(key: str, value: Any, ttl_sec: float) -> None:
    """Store with expiry. Evicts oldest when over capacity."""
    if not key or ttl_sec <= 0:
        return
    expires_at = time.time() + ttl_sec
    with _LOCK:
        _STORE[key] = (expires_at, value)
        _STORE.move_to_end(key)
        _STATS["sets"] += 1
        while len(_STORE) > _MAX_ENTRIES:
            _STORE.popitem(last=False)
            _STATS["evictions"] += 1


def cache_clear() -> int:
    """Wipe the cache. Returns the number of entries removed."""
    with _LOCK:
        n = len(_STORE)
        _STORE.clear()
        return n


def record_fetch(provider: str, ok: bool = True, reason: str = "") -> None:
    """Bump per-provider success/failure counters for /tools/health."""
    if not provider:
        return
    with _LOCK:
        c = _COUNTERS.setdefault(provider, {"ok": 0, "fail": 0, "last_reason": ""})
        if ok:
            c["ok"] += 1
        else:
            c["fail"] += 1
            if reason:
                c["last_reason"] = reason[:140]


def provider_stats() -> dict:
    """Snapshot of provider counters (used by /tools/health)."""
    with _LOCK:
        return {p: dict(v) for p, v in _COUNTERS.items()}


def stats() -> dict:
    with _LOCK:
        return {
            **_STATS,
            "size":      len(_STORE),
            "max_size":  _MAX_ENTRIES,
            "providers": {p: dict(v) for p, v in _COUNTERS.items()},
        }
