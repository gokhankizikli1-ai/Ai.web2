# coding: utf-8
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from memory import (
    init_memory_db, load_user_memory, remember_with_category,
    forget_fact, get_memory_summary, get_user_style, update_user_style,
    detect_style_preference, auto_learn,
)


def get_user_memory(user_id: int) -> dict:
    rows  = load_user_memory(user_id, 20)
    style = get_user_style(user_id)
    items = [
        {"category": cat, "content": content, "created_at": ts}
        for cat, content, ts in rows
    ]
    return {
        "user_id": str(user_id),
        "items":   items,
        "style":   style,
        "total":   len(items),
    }


def save_memory(user_id: int, content: str, category: str = "general") -> bool:
    return remember_with_category(user_id, content, category=category)


def delete_memory(user_id: int, keyword: str) -> int:
    return forget_fact(user_id, keyword)


def get_summary(user_id: int) -> str:
    return get_memory_summary(user_id)


def get_style(user_id: int) -> dict:
    return get_user_style(user_id)


def maybe_auto_learn(user_id: int, text: str):
    auto_learn(user_id, text)


def detect_style(text: str):
    return detect_style_preference(text)


def apply_style(user_id: int, text: str):
    return update_user_style(user_id, text)
