# coding: utf-8
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from usage_limits import (
    init_usage_db, is_premium, set_premium,
    get_daily_usage, increment_daily_usage,
    can_user_send_message, get_remaining_messages,
    ensure_user, FREE_DAILY_LIMIT,
)
from db import save_chat, get_chat_history, get_user_profile
from memory import get_user_style


def get_profile(user_id: int) -> dict:
    ensure_user(user_id)
    prem      = is_premium(user_id)
    used      = get_daily_usage(user_id)
    remaining = get_remaining_messages(user_id)
    style     = get_user_style(user_id)
    from memory import load_user_memory
    mem_count = len(load_user_memory(user_id, 100))
    return {
        "user_id":             str(user_id),
        "premium":             prem,
        "messages_used_today": used,
        "remaining_messages":  -1 if remaining == -1 else max(0, remaining),
        "memory_count":        mem_count,
        "style":               style,
    }


def check_and_count(user_id: int) -> tuple:
    """Returns (can_send: bool, remaining: int)"""
    ensure_user(user_id)
    if not can_user_send_message(user_id):
        return False, 0
    return True, get_remaining_messages(user_id)


def record_usage(user_id: int):
    increment_daily_usage(user_id)


def make_premium(user_id: int, value: bool = True):
    set_premium(user_id, value)


def save_message(role: str, content: str):
    save_chat(role, content)


def get_history(limit: int = 10) -> list:
    return get_chat_history(limit)


def get_text_profile() -> str:
    return get_user_profile()
