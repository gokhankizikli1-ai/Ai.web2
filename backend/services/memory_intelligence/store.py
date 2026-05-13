# coding: utf-8
"""
In-process user-scoped memory store.

Designed minimal — `dict[user_id, deque[MemoryRecord]]` behind a
threading.Lock. Each user is capped at MAX_RECORDS_PER_USER; oldest
records evict first. Records survive within a single process (sufficient
for v1 — Memory Intelligence v2 will swap in a SQLite-backed store
behind the same public client API in client.py without touching
callers).

Why not SQLite right now: keeps the v1 PR small and rollback-safe. The
real cost of process-local memory is forgetting on Railway redeploys —
acceptable for v1, the same way short-term memory works today.
"""
from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Deque, Dict, List, Optional


# Hard cap. Beyond this, the OLDEST record per user gets dropped.
# Keep small — these are short snippets, not full transcripts.
MAX_RECORDS_PER_USER = 50

# Valid record kinds. The kind is metadata for filtering / future v2;
# v1 just stores everything and dumps the most-recent N as snippets.
KIND_PROJECT     = "project"
KIND_PREFERENCE  = "preference"
KIND_FACT        = "fact"
KIND_SUMMARY     = "summary"

VALID_KINDS = {KIND_PROJECT, KIND_PREFERENCE, KIND_FACT, KIND_SUMMARY}


@dataclass(frozen=True)
class MemoryRecord:
    """One memory entry. Frozen so external code can't mutate after
    insertion; the store hands out tuples internally."""
    user_id:    str
    kind:       str        # one of VALID_KINDS
    text:       str        # short snippet, ≤200 chars before truncation
    created_at: str        # ISO 8601 UTC
    source:     str = "auto"   # "auto" | "manual"

    def to_dict(self) -> dict:
        return asdict(self)


# ── Store internals ──────────────────────────────────────────────────────

_LOCK: threading.Lock = threading.Lock()
_STORE: Dict[str, Deque[MemoryRecord]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write(user_id: str, kind: str, text: str, source: str = "auto") -> Optional[MemoryRecord]:
    """Persist one record. Returns the record on success, None when the
    input is invalid (empty user_id, empty text, bad kind). Never raises."""
    if not isinstance(user_id, str) or not user_id.strip():
        return None
    if not isinstance(text, str):
        return None
    cleaned = text.strip()
    if not cleaned:
        return None
    if kind not in VALID_KINDS:
        return None

    record = MemoryRecord(
        user_id=user_id,
        kind=kind,
        text=cleaned[:200],
        created_at=_now_iso(),
        source=source,
    )

    with _LOCK:
        bucket = _STORE.setdefault(user_id, deque(maxlen=MAX_RECORDS_PER_USER))
        # Light dedup: same kind + same text in the last 5 entries → skip
        # so a chatty user mentioning "KorvixAI" 10 times doesn't fill
        # their slot with identical rows.
        recent = list(bucket)[-5:]
        for r in recent:
            if r.kind == record.kind and r.text == record.text:
                return r
        bucket.append(record)
    return record


def read(user_id: str, *, limit: int = 3) -> List[MemoryRecord]:
    """Most-recent N records for a user, newest LAST in the returned
    list (so the caller can present them in chronological order or
    reverse via slicing)."""
    if not isinstance(user_id, str) or not user_id.strip():
        return []
    if not isinstance(limit, int) or limit <= 0:
        return []
    with _LOCK:
        bucket = _STORE.get(user_id)
        if not bucket:
            return []
        return list(bucket)[-limit:]


def wipe(user_id: str) -> int:
    """Remove every record for one user. Returns count removed. Used by
    tests + future "forget me" UX. Never raises."""
    if not isinstance(user_id, str) or not user_id.strip():
        return 0
    with _LOCK:
        bucket = _STORE.pop(user_id, None)
        return len(bucket) if bucket else 0


def stats() -> dict:
    """Public-safe snapshot for /tools/health-style probes. Never
    leaks any user text — only counts."""
    with _LOCK:
        per_user = {uid: len(bucket) for uid, bucket in _STORE.items()}
        return {
            "users":             len(per_user),
            "records_total":     sum(per_user.values()),
            "max_per_user":      MAX_RECORDS_PER_USER,
        }


def _reset_for_tests() -> None:
    """Test-only helper. Production code never imports this."""
    with _LOCK:
        _STORE.clear()


__all__ = [
    "MemoryRecord",
    "MAX_RECORDS_PER_USER",
    "KIND_PROJECT", "KIND_PREFERENCE", "KIND_FACT", "KIND_SUMMARY",
    "VALID_KINDS",
    "write", "read", "wipe", "stats",
    "_reset_for_tests",
]
