# coding: utf-8
import sys
import os
import logging

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

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


def get_summary(user_id: int) -> str:
    try:
        return get_memory_summary(user_id) or ""
    except Exception as e:
        logger.warning("get_summary uid=%s error: %s", user_id, e)
        return ""


def save_memory(user_id: int, content: str, category: str = "general") -> bool:
    try:
        return remember_with_category(user_id, content, category)
    except Exception as e:
        logger.warning("save_memory uid=%s error: %s", user_id, e)
        return False


def delete_memory(user_id: int, keyword: str) -> int:
    try:
        return forget_fact(user_id, keyword)
    except Exception as e:
        logger.warning("delete_memory uid=%s error: %s", user_id, e)
        return 0


def detect_style(message: str):
    """Returns style dict if message contains a style trigger, else None."""
    try:
        return detect_style_preference(message)
    except Exception as e:
        logger.warning("detect_style error: %s", e)
        return None


def apply_style(user_id: int, message: str) -> None:
    try:
        update_user_style(user_id, message)
    except Exception as e:
        logger.warning("apply_style uid=%s error: %s", user_id, e)


def maybe_auto_learn(user_id: int, message: str) -> None:
    try:
        auto_learn(user_id, message)
    except Exception as e:
        logger.warning("maybe_auto_learn uid=%s error: %s", user_id, e)


def get_style(user_id: int) -> dict:
    """Returns {'key', 'label', 'instruction'} for the user's preferred style."""
    try:
        return get_user_style(user_id)
    except Exception as e:
        logger.warning("get_style uid=%s error: %s", user_id, e)
        return {
            "key": "default",
            "label": "Standard",
            "instruction": "Reply naturally, clearly and helpfully.",
        }


def get_user_memory(user_id: int) -> dict:
    """Returns memory dict for the /memory API endpoint."""
    try:
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
