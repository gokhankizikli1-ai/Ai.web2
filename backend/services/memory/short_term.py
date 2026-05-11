# coding: utf-8
# Phase M1 — Short-term conversation window.
#
# Per-thread rolling buffer of the last N messages. In-process only; per
# Railway replica. Phase A1 (agent runtime) and Phase M2 (server-side
# sessions) will both rely on this interface — A1 to read the scratchpad,
# M2 to flush durable messages to the new `threads`/`messages` tables.
#
# We introduce this now (M1) so the public shape is fixed before any caller
# starts using it. The implementation is intentionally tiny.
#
# Public API:
#   append(thread_id, message: WindowMessage) -> None
#   recent(thread_id, max_messages=10)          -> list[WindowMessage]
#   clear(thread_id)                            -> int   (count removed)
#   stats()                                     -> dict
import time
import threading
from collections import OrderedDict
from typing import Optional

from backend.services.memory.types import WindowMessage

# Cap total threads tracked to keep memory bounded under load.
_MAX_THREADS         = 2000
_DEFAULT_MAX_PER_KEY = 40             # messages kept per thread by default
_EVICT_OLDER_THAN_S  = 60 * 60 * 6    # 6h idle → window drops

_LOCK: threading.Lock = threading.Lock()
_STORE: "OrderedDict[str, dict]" = OrderedDict()
# value shape: {"messages": deque[WindowMessage], "touched_at": float}

_STATS = {
    "appends":      0,
    "recalls":      0,
    "clears":       0,
    "evictions":    0,
}


def append(thread_id: str, message: WindowMessage, *, max_per_thread: int = _DEFAULT_MAX_PER_KEY) -> None:
    if not thread_id:
        return
    now = time.time()
    with _LOCK:
        bucket = _STORE.get(thread_id)
        if bucket is None:
            bucket = {"messages": [], "touched_at": now}
            _STORE[thread_id] = bucket
        else:
            _STORE.move_to_end(thread_id)
        msgs = bucket["messages"]
        msgs.append(message)
        if len(msgs) > max_per_thread:
            del msgs[: len(msgs) - max_per_thread]
        bucket["touched_at"] = now
        _STATS["appends"] += 1
        _enforce_caps(now)


def recent(thread_id: str, *, max_messages: int = 10) -> list[WindowMessage]:
    if not thread_id:
        return []
    with _LOCK:
        bucket = _STORE.get(thread_id)
        if bucket is None:
            return []
        _STORE.move_to_end(thread_id)
        bucket["touched_at"] = time.time()
        _STATS["recalls"] += 1
        msgs = bucket["messages"]
        return list(msgs[-max_messages:])


def clear(thread_id: str) -> int:
    if not thread_id:
        return 0
    with _LOCK:
        bucket = _STORE.pop(thread_id, None)
        if bucket is None:
            return 0
        _STATS["clears"] += 1
        return len(bucket["messages"])


def stats() -> dict:
    with _LOCK:
        return {
            **_STATS,
            "threads":   len(_STORE),
            "max_threads": _MAX_THREADS,
        }


def _enforce_caps(now: float) -> None:
    """Drop oldest idle threads + enforce hard cap. Caller holds the lock."""
    # 1) idle eviction
    cutoff = now - _EVICT_OLDER_THAN_S
    stale_keys: list[str] = []
    for k, v in _STORE.items():
        if v["touched_at"] < cutoff:
            stale_keys.append(k)
        else:
            break   # OrderedDict order is insertion + move_to_end → oldest first
    for k in stale_keys:
        del _STORE[k]
        _STATS["evictions"] += 1
    # 2) hard cap
    while len(_STORE) > _MAX_THREADS:
        _STORE.popitem(last=False)
        _STATS["evictions"] += 1


__all__ = ["append", "recent", "clear", "stats"]
