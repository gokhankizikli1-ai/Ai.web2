# coding: utf-8
"""
Memory Intelligence public client.

Every caller (current and future) speaks this module — never imports
store / extractor directly. That lets v2 swap the storage layer
(SQLite, Redis, …) without touching the chat orchestrator.

All functions are no-ops when ENABLE_MEMORY_INTELLIGENCE is off — the
chat orchestrator can call them unconditionally and the flag controls
whether anything actually happens. This is the same dynamic-env
pattern the provider router (Phase 6b) and the tool registry
(Phase 7b) use, so flag flips on Railway take effect on the very
next request with no restart.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from backend.services.memory_intelligence import extractor as _extractor
from backend.services.memory_intelligence import store as _store
from backend.services.memory_intelligence.store import MemoryRecord

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Read the feature flag dynamically. Default off → all other
    functions in this module become no-ops."""
    return os.getenv("ENABLE_MEMORY_INTELLIGENCE", "false").strip().lower() == "true"


def record(
    user_id: str,
    kind: str,
    text: str,
    *,
    source: str = "manual",
) -> Optional[MemoryRecord]:
    """Manually persist one record. Returns the record on success,
    None when the flag is off or the input is invalid. Never raises.
    Use this for operator-seeded facts (e.g. "this user is a
    KorvixAI builder") that aren't extractable from a single message."""
    if not is_enabled():
        return None
    return _store.write(user_id, kind, text, source=source)


def extract_and_record(user_id: str, user_message: str) -> List[MemoryRecord]:
    """Run the heuristic extractor against the user's latest message
    and persist whatever it returns. Returns the list of new records
    (may be empty). No-op when the flag is off."""
    if not is_enabled():
        return []
    matches = _extractor.extract(user_message)
    out: List[MemoryRecord] = []
    for kind, text in matches:
        r = _store.write(user_id, kind, text, source="auto")
        if r is not None:
            out.append(r)
    if out:
        logger.info(
            "memory_intelligence.recorded | user=%s | n=%d | kinds=%s",
            user_id, len(out), ",".join(sorted({r.kind for r in out})),
        )
    return out


def fetch_snippets(user_id: str, *, limit: int = 3) -> List[str]:
    """Return up to `limit` recent snippet strings for the user.

    The caller passes the result straight into
    `build_short_context_block(memory_snippets=...)`. Empty list when
    the flag is off, the user has no records, or limit is invalid.
    Never raises."""
    if not is_enabled():
        return []
    records = _store.read(user_id, limit=limit)
    return [r.text for r in records]


def clear(user_id: str) -> int:
    """Wipe every record for one user. Returns count removed. Used by
    a future "forget me" UX and by tests. Honours the flag — when off,
    returns 0 without inspecting anything (consistent with the rest of
    the API: feature off → no observable behaviour)."""
    if not is_enabled():
        return 0
    return _store.wipe(user_id)


__all__ = [
    "is_enabled",
    "record",
    "extract_and_record",
    "fetch_snippets",
    "clear",
]
