# coding: utf-8
# Phase M1 — Memory store adapter.
#
# Wraps the legacy `memory.py` SQLite tables (`user_memory`, `user_style`) with
# the M1 typed API. No schema change. Identical behavior to direct memory.py
# calls — this layer just gives the rest of the codebase a clean, future-proof
# surface to migrate behind.
#
# All methods accept an optional `workspace_id` argument that is accepted but
# IGNORED in M1. M2 will start writing it to a new `workspace_id` column on
# the existing tables (via `ALTER TABLE … ADD COLUMN`) and reading it back —
# the call signatures will not change.
import os
import sys
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Add repo root to import path — needed because legacy `memory.py` lives at the
# project root, not under `backend/`.
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Defer the legacy import inside helpers so a missing memory.py never crashes
# package import (production-safety pattern used elsewhere in the codebase).

from backend.services.memory.types import (
    MemoryItem,
    StyleDef,
    normalize_kind,
    _DEFAULT_STYLE,
)

# Per-store counters surfaced via /tools/health (Phase 5.2 pattern).
_LOCK   = threading.Lock()
_COUNTS = {
    "remembers":     0,
    "forgets":       0,
    "recalls":       0,
    "summarizes":    0,
    "style_writes":  0,
    "style_reads":   0,
    "auto_learns":   0,
    "errors":        0,
    "last_error":    "",
}


def _bump(field: str, error: str = "") -> None:
    with _LOCK:
        _COUNTS[field] = _COUNTS.get(field, 0) + 1
        if error:
            _COUNTS["errors"]     = _COUNTS.get("errors", 0) + 1
            _COUNTS["last_error"] = error[:140]


def store_stats() -> dict:
    with _LOCK:
        return dict(_COUNTS)


# ══════════════════════════════════════════════════════════════════════════════
# Episodic / facts

def remember(
    user_id: str,
    content: str,
    *,
    kind: str = "fact",
    workspace_id: Optional[str] = None,  # ignored in M1; reserved for M2
    source: Optional[str] = None,
) -> bool:
    """
    Persist a single memory item. Returns True if saved, False on duplicate
    or noise. Wraps `memory.remember_with_category` so dedupe + noise filter
    rules stay identical to the legacy path.
    """
    try:
        from memory import remember_with_category   # noqa: PLC0415
        legacy_category = _kind_to_legacy_category(kind)
        ok = bool(remember_with_category(int(user_id), content, legacy_category))
        if ok:
            _bump("remembers")
        return ok
    except Exception as e:
        logger.warning("memory.store.remember(uid=%s) error: %s", user_id, e)
        _bump("remembers", str(e))
        return False


def recall(
    user_id: str,
    *,
    kind: Optional[str] = None,           # post-filter; legacy store is flat
    workspace_id: Optional[str] = None,   # ignored in M1
    limit: int = 15,
) -> list[MemoryItem]:
    """Return at most `limit` items, newest first."""
    try:
        from memory import load_user_memory   # noqa: PLC0415
        rows = load_user_memory(int(user_id), limit)
        items: list[MemoryItem] = []
        wanted = normalize_kind(kind) if kind else None
        for row_category, row_content, row_created in rows:
            item_kind = _legacy_category_to_kind(row_category)
            if wanted and item_kind != wanted:
                continue
            items.append(
                MemoryItem(
                    user_id=str(user_id),
                    content=row_content,
                    kind=item_kind,
                    workspace_id=workspace_id,
                    created_at=row_created,
                )
            )
        _bump("recalls")
        return items
    except Exception as e:
        logger.warning("memory.store.recall(uid=%s) error: %s", user_id, e)
        _bump("recalls", str(e))
        return []


def forget(
    user_id: str,
    keyword: str,
    *,
    workspace_id: Optional[str] = None,   # ignored in M1
) -> int:
    try:
        from memory import forget_fact   # noqa: PLC0415
        n = int(forget_fact(int(user_id), keyword))
        _bump("forgets")
        return n
    except Exception as e:
        logger.warning("memory.store.forget(uid=%s) error: %s", user_id, e)
        _bump("forgets", str(e))
        return 0


def summarize(
    user_id: str,
    *,
    workspace_id: Optional[str] = None,   # ignored in M1
) -> str:
    """Format a memory summary block suitable for system-prompt injection."""
    try:
        from memory import get_memory_summary   # noqa: PLC0415
        s = get_memory_summary(int(user_id)) or ""
        _bump("summarizes")
        return s
    except Exception as e:
        logger.warning("memory.store.summarize(uid=%s) error: %s", user_id, e)
        _bump("summarizes", str(e))
        return ""


# ══════════════════════════════════════════════════════════════════════════════
# Auto-learn (opportunistic fact extraction)

def auto_learn(
    user_id: str,
    message: str,
    *,
    workspace_id: Optional[str] = None,   # ignored in M1
) -> None:
    try:
        from memory import auto_learn as _legacy_auto_learn   # noqa: PLC0415
        _legacy_auto_learn(int(user_id), message)
        _bump("auto_learns")
    except Exception as e:
        logger.warning("memory.store.auto_learn(uid=%s) error: %s", user_id, e)
        _bump("auto_learns", str(e))


# ══════════════════════════════════════════════════════════════════════════════
# Style

def detect_style_def(message: str) -> Optional[StyleDef]:
    """Stateless — returns the StyleDef matched by the message, or None."""
    try:
        from memory import detect_style_preference   # noqa: PLC0415
        raw = detect_style_preference(message)
        if not raw:
            return None
        return StyleDef(
            key=raw.get("key", "default"),
            label=raw.get("label", "Standard"),
            instruction=raw.get("instruction", _DEFAULT_STYLE.instruction),
        )
    except Exception as e:
        logger.warning("memory.store.detect_style error: %s", e)
        _bump("style_reads", str(e))
        return None


def apply_style(user_id: str, message: str) -> Optional[StyleDef]:
    """Persist the style hinted at in `message`. Returns the new style or None."""
    try:
        from memory import update_user_style   # noqa: PLC0415
        raw = update_user_style(int(user_id), message)
        _bump("style_writes")
        if not raw:
            return None
        return StyleDef(
            key=raw.get("key", "default"),
            label=raw.get("label", "Standard"),
            instruction=raw.get("instruction", _DEFAULT_STYLE.instruction),
        )
    except Exception as e:
        logger.warning("memory.store.apply_style(uid=%s) error: %s", user_id, e)
        _bump("style_writes", str(e))
        return None


def get_style(user_id: str) -> StyleDef:
    try:
        from memory import get_user_style   # noqa: PLC0415
        raw = get_user_style(int(user_id))
        _bump("style_reads")
        return StyleDef(
            key=raw.get("key", "default"),
            label=raw.get("label", "Standard"),
            instruction=raw.get("instruction", _DEFAULT_STYLE.instruction),
        )
    except Exception as e:
        logger.warning("memory.store.get_style(uid=%s) error: %s", user_id, e)
        _bump("style_reads", str(e))
        return _DEFAULT_STYLE


# ══════════════════════════════════════════════════════════════════════════════
# Bootstrap

def init() -> None:
    """Create legacy tables if missing. Idempotent; safe to call repeatedly."""
    try:
        from memory import init_memory_db   # noqa: PLC0415
        init_memory_db()
    except Exception as e:
        logger.warning("memory.store.init failed: %s", e)


# ══════════════════════════════════════════════════════════════════════════════
# Internal — kind <-> legacy category mapping
#
# The legacy store uses one freeform `category` column with values like
# "general", "finance", "ecommerce", "personal_goal", "preference", "education",
# "auto". The M1 `kind` taxonomy is richer; we round-trip safely below.

_KIND_TO_LEGACY = {
    "fact":             "general",
    "preference":       "preference",
    "auto":             "auto",
    "summary":          "general",     # not stored in legacy; harmless tag
    "thesis":           "general",     # Phase 5.1 thesis cache still owns these
    "artifact_ref":     "general",
    "behavior_pattern": "general",
    "general":          "general",
    "style":            "general",     # styles live in user_style table, not user_memory
}


def _kind_to_legacy_category(kind: str) -> str:
    return _KIND_TO_LEGACY.get(normalize_kind(kind), "general")


def _legacy_category_to_kind(category: Optional[str]) -> str:
    if not category:
        return "general"
    c = category.lower().strip()
    if c == "preference":
        return "preference"
    if c == "auto":
        return "auto"
    return "fact"   # everything else surfaces as a generic fact in the typed API
