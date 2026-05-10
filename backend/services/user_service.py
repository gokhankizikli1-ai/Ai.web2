# coding: utf-8
import sys
import os
import logging

logger = logging.getLogger(__name__)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from usage_limits import (
    init_usage_db,
    can_user_send_message,
    get_daily_usage,
    increment_daily_usage,
    get_remaining_messages,
    is_premium,
    FREE_DAILY_LIMIT,
)
from db import (
    init_db,
    get_user_profile,
    get_chat_history,
    save_chat,
)

try:
    init_usage_db()
    init_db()
except Exception as _e:
    logger.warning("user_service: db init failed: %s", _e)


def check_and_count(user_id: int):
    """
    Returns (can_send: bool, daily_count: int).
    Fails open on error so a DB hiccup never blocks all messages.
    """
    try:
        can_send = can_user_send_message(user_id)
        count = get_daily_usage(user_id)
        return can_send, count
    except Exception as e:
        logger.warning("check_and_count uid=%s error: %s", user_id, e)
        return True, 0


def get_text_profile() -> str:
    try:
        return get_user_profile()
    except Exception as e:
        logger.warning("get_text_profile error: %s", e)
        return ""


def get_history(user_id: int, limit: int = 10) -> list:
    """Returns list of (role, content) tuples, most recent last."""
    try:
        return get_chat_history(limit)
    except Exception as e:
        logger.warning("get_history uid=%s error: %s", user_id, e)
        return []


def record_usage(user_id: int) -> None:
    try:
        increment_daily_usage(user_id)
    except Exception as e:
        logger.warning("record_usage uid=%s error: %s", user_id, e)


def save_message(role: str, content: str) -> None:
    try:
        save_chat(role, content)
    except Exception as e:
        logger.warning("save_message error: %s", e)


def get_profile(user_id: int) -> dict:
    """Returns {'remaining_messages': int, 'premium': bool}."""
    try:
        remaining = get_remaining_messages(user_id)
        premium_flag = is_premium(user_id)
        return {"remaining_messages": remaining, "premium": premium_flag}
    except Exception as e:
        logger.warning("get_profile uid=%s error: %s", user_id, e)
        return {"remaining_messages": -1, "premium": False}


def get_limit_info(user_id: int) -> dict:
    """Returns current usage details for the rate-limit message."""
    try:
        used = get_daily_usage(user_id)
        return {"used": used, "limit": FREE_DAILY_LIMIT}
    except Exception as e:
        logger.warning("get_limit_info uid=%s error: %s", user_id, e)
        return {"used": 0, "limit": FREE_DAILY_LIMIT}
