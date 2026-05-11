# coding: utf-8
# Memory service — stable public surface used by routes/chat.py and routes/memory.py.
#
# Phase M1 (this file) introduces a feature flag:
#
#   ENABLE_NEW_MEMORY=true   → delegate to backend.services.memory.MemoryClient
#                              (the new typed, multi-workspace-ready surface)
#   default / unset / "false" → keep calling legacy memory.py directly
#                              (identical behaviour to prior versions)
#
# Both paths must produce the same observable shape — that is the contract
# that lets us flip the flag back at any time as a one-line rollback.
import sys
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Legacy direct imports (always present so the OFF path works even if the new
# package is broken). These are the M0 behaviour.
from memory import (
    init_memory_db,
    remember_with_category,
    forget_fact,
    load_user_memory,
    get_memory_summary,
    detect_style_preference,
    update_user_style,
    get_user_style,
    auto_learn,
)

try:
    init_memory_db()
except Exception as _e:
    logger.warning("memory_service: init_memory_db failed: %s", _e)


# ── Feature flag (read once at import) ───────────────────────────────────────

_USE_NEW_CLIENT = os.getenv("ENABLE_NEW_MEMORY", "false").strip().lower() == "true"

# Try to load the new client lazily so any defect in the new package never
# breaks the OFF path. If the import fails when the flag is on, we log loudly
# and fall back to the legacy path for safety.
_new_client = None
if _USE_NEW_CLIENT:
    try:
        from backend.services.memory import client as _new_client  # type: ignore
        logger.info("memory_service: ENABLE_NEW_MEMORY=true — using MemoryClient")
    except Exception as _e:
        logger.error(
            "memory_service: ENABLE_NEW_MEMORY=true but client import failed (%s) — "
            "falling back to legacy path", _e,
        )
        _new_client = None


def _backend() -> str:
    """For /tools/health observability."""
    return "new_client" if _new_client is not None else "legacy"


# ── Public API — identical signatures regardless of backend ─────────────────

def get_summary(user_id: int, workspace_id: Optional[str] = None) -> str:
    try:
        if _new_client is not None:
            return _new_client.summarize(str(user_id), workspace_id=workspace_id) or ""
        return get_memory_summary(user_id) or ""
    except Exception as e:
        logger.warning("get_summary uid=%s error: %s", user_id, e)
        return ""


def save_memory(user_id: int, content: str, category: str = "general",
                workspace_id: Optional[str] = None) -> bool:
    try:
        if _new_client is not None:
            return _new_client.remember(
                str(user_id), content, kind=category, workspace_id=workspace_id,
            )
        return remember_with_category(user_id, content, category)
    except Exception as e:
        logger.warning("save_memory uid=%s error: %s", user_id, e)
        return False


def delete_memory(user_id: int, keyword: str, workspace_id: Optional[str] = None) -> int:
    try:
        if _new_client is not None:
            return _new_client.forget(str(user_id), keyword, workspace_id=workspace_id)
        return forget_fact(user_id, keyword)
    except Exception as e:
        logger.warning("delete_memory uid=%s error: %s", user_id, e)
        return 0


def detect_style(message: str):
    """Returns dict if message contains a style trigger, else None.

    Shape preserved: {'key', 'label', 'instruction', 'triggers'} when legacy;
    {'key', 'label', 'instruction'} when new client. Callers in chat.py only
    read 'label', so both shapes are safe.
    """
    try:
        if _new_client is not None:
            sd = _new_client.detect_style(message)
            return sd.to_dict() if sd else None
        return detect_style_preference(message)
    except Exception as e:
        logger.warning("detect_style error: %s", e)
        return None


def apply_style(user_id: int, message: str, workspace_id: Optional[str] = None) -> None:
    try:
        if _new_client is not None:
            _new_client.apply_style(str(user_id), message)
            return
        update_user_style(user_id, message)
    except Exception as e:
        logger.warning("apply_style uid=%s error: %s", user_id, e)


def maybe_auto_learn(user_id: int, message: str, workspace_id: Optional[str] = None) -> None:
    try:
        if _new_client is not None:
            _new_client.maybe_auto_learn(str(user_id), message, workspace_id=workspace_id)
            return
        auto_learn(user_id, message)
    except Exception as e:
        logger.warning("maybe_auto_learn uid=%s error: %s", user_id, e)


def get_style(user_id: int) -> dict:
    """Returns {'key', 'label', 'instruction'} — shape preserved."""
    try:
        if _new_client is not None:
            return _new_client.get_style(str(user_id)).to_dict()
        return get_user_style(user_id)
    except Exception as e:
        logger.warning("get_style uid=%s error: %s", user_id, e)
        return {
            "key": "default",
            "label": "Standard",
            "instruction": "Reply naturally, clearly and helpfully.",
        }


def get_user_memory(user_id: int, workspace_id: Optional[str] = None) -> dict:
    """Shape preserved exactly for the /memory route."""
    try:
        if _new_client is not None:
            return _new_client.list_for_user(
                str(user_id), workspace_id=workspace_id, limit=20,
            )
        rows = load_user_memory(user_id, 20)
        return {
            "user_id": user_id,
            "memory": [
                {"category": cat, "content": content, "created_at": ts}
                for cat, content, ts in rows
            ],
        }
    except Exception as e:
        logger.warning("get_user_memory uid=%s error: %s", user_id, e)
        return {"user_id": user_id, "memory": []}


# ── Observability for /tools/health ──────────────────────────────────────────

def stats() -> dict:
    """Compact snapshot for /tools/health. Never raises."""
    out: dict = {
        "backend": _backend(),
        "flag_enable_new_memory": _USE_NEW_CLIENT,
    }
    if _new_client is not None:
        try:
            out.update(_new_client.stats())
        except Exception as e:
            out["stats_error"] = str(e)
    return out
