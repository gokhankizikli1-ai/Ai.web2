# coding: utf-8
"""
Tiny in-process TTL cache for market quotes.

Two TTLs: stocks (15s default) and crypto (8s default). Read once per
call so env flips take effect on the next request. Thread-safe via
threading.Lock. No background eviction — entries are checked at
read time; expired entries are simply ignored and overwritten on the
next set.

Behaviour
  - `get(key)` returns the value when present AND fresh, else None.
  - `set(key, value, ttl_seconds)` overwrites unconditionally.
  - `invalidate(key)` removes if present.
  - `stats()` returns hits / misses / entries — for /market/health.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, Optional, Tuple


# Default TTLs — overridable via env so dev can knock them down to 0
# for end-to-end provider testing.
def stock_ttl_seconds() -> int:
    return _clamp_int(os.getenv("MARKET_QUOTE_STOCK_CACHE_TTL", "15"), default=15, lo=0, hi=120)


def crypto_ttl_seconds() -> int:
    return _clamp_int(os.getenv("MARKET_QUOTE_CRYPTO_CACHE_TTL", "8"), default=8, lo=0, hi=60)


def _clamp_int(raw, *, default, lo, hi):
    try:
        v = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


_LOCK = threading.Lock()
_STORE: Dict[str, Tuple[float, Any]] = {}
_HITS = 0
_MISSES = 0


def get(key: str) -> Optional[Any]:
    """Return the cached value if present and not expired; else None."""
    global _HITS, _MISSES
    if not isinstance(key, str) or not key:
        return None
    now = time.monotonic()
    with _LOCK:
        entry = _STORE.get(key)
        if entry is None:
            _MISSES += 1
            return None
        expires_at, value = entry
        if now >= expires_at:
            _MISSES += 1
            return None
        _HITS += 1
        return value


def set(key: str, value: Any, *, ttl_seconds: int) -> None:
    """Cache value with a TTL. ttl_seconds <= 0 → skip caching (so
    operators can run with TTL=0 to disable the cache entirely)."""
    if not isinstance(key, str) or not key:
        return
    if not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
        return
    now = time.monotonic()
    with _LOCK:
        _STORE[key] = (now + ttl_seconds, value)


def invalidate(key: str) -> bool:
    with _LOCK:
        return _STORE.pop(key, None) is not None


def stats() -> dict:
    """Snapshot for health / debugging. Never leaks cached payloads."""
    with _LOCK:
        return {
            "entries":           len(_STORE),
            "hits":              _HITS,
            "misses":            _MISSES,
            "stock_ttl_seconds":  stock_ttl_seconds(),
            "crypto_ttl_seconds": crypto_ttl_seconds(),
        }


def _reset_for_tests() -> None:
    global _HITS, _MISSES
    with _LOCK:
        _STORE.clear()
        _HITS = 0
        _MISSES = 0


__all__ = [
    "stock_ttl_seconds",
    "crypto_ttl_seconds",
    "get",
    "set",
    "invalidate",
    "stats",
    "_reset_for_tests",
]
