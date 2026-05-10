# coding: utf-8
"""
Standardized response builders for KorvixAI v3.

All chat responses include both:
  - Legacy fields  (reply, intent, model, …) — keeps current frontend working
  - v3 fields      (success, message, mode, conversation_id, usage, metadata)

Error responses are always safe and never expose internal state.
"""
from typing import Any, Dict, List, Optional


def chat_success(
    reply: str,
    intent: str = "normal_chat",
    model: str = "gpt-4o-mini",
    provider: str = "openai",
    mode: str = "chat",
    memory_used: bool = False,
    remaining_messages: int = -1,
    premium: bool = False,
    response_time_ms: int = 0,
    request_id: str = "",
    suggested_followups: Optional[List[str]] = None,
    usage: Optional[Dict[str, int]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> dict:
    """Build a fully backward-compatible + v3-forward chat success payload."""
    return {
        # ── Legacy fields (frontend currently reads these) ────────────────
        "reply":             reply,
        "intent":            intent,
        "model":             model,
        "provider":          provider,
        "mode":              mode,
        "memory_used":       memory_used,
        "remaining_messages": remaining_messages,
        "premium":           premium,
        "response_time_ms":  response_time_ms,
        "request_id":        request_id,
        "suggested_followups": suggested_followups,
        # ── v3 fields ─────────────────────────────────────────────────────
        "success":           True,
        "message":           reply,
        "conversation_id":   request_id,
        "usage":             usage or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "metadata":          metadata or {},
    }


def chat_error(
    message: str,
    code: str = "INTERNAL_ERROR",
    request_id: str = "err",
) -> dict:
    """Build a safe error payload that the frontend can still render."""
    return {
        # Legacy fields — frontend must not crash when these are present
        "reply":             message,
        "intent":            "error",
        "model":             "none",
        "provider":          "none",
        "mode":              "error",
        "memory_used":       False,
        "remaining_messages": -1,
        "premium":           False,
        "response_time_ms":  0,
        "request_id":        request_id,
        "suggested_followups": None,
        # v3 fields
        "success":           False,
        "error":             message,
        "code":              code,
        "message":           message,
        "conversation_id":   request_id,
        "usage":             {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "metadata":          {},
    }
