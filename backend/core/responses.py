# coding: utf-8
"""
Standardized response builders for KorvixAI v3.

Two layers live here:

1. The legacy chat helpers (`chat_success`, `chat_error`) — produce the
   exact shape the existing frontend reads (`reply`, `intent`, `model`,
   `request_id`, …). Do not change these without a coordinated frontend
   bump; the prod chat path depends on the field names.

2. The Phase-1 generic envelope (`ApiResponse`, `ok`, `err`,
   `dual_emit`) — the new unified contract for v2 routes and any future
   non-chat endpoint:

       { success, data, error, metadata, timestamp }

   Existing routes return their legacy shape; new routes call `ok()`/
   `err()`. When we want to add envelope fields to a legacy route
   without breaking its consumers, `dual_emit(legacy_payload, ...)`
   merges the envelope keys onto the existing payload — both old
   readers (`response.reply`) and new readers (`response.data.reply`)
   work against the same body.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ── Phase-1 generic envelope ─────────────────────────────────────────────
#
# Every new (v2) endpoint returns this shape. The envelope is dict-based
# (not a Pydantic model) so callers can attach arbitrary `data` payloads
# without import cycles or schema drift. We keep one canonical builder
# (`_envelope`) and two thin wrappers (`ok` / `err`) so the contract is
# enforced in exactly one place.

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _envelope(
    *,
    success: bool,
    data: Any = None,
    error: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "success":   success,
        "data":      data,
        "error":     error,
        "metadata":  metadata or {},
        "timestamp": _now_iso(),
    }


def ok(data: Any = None, **metadata: Any) -> Dict[str, Any]:
    """Success envelope. Any kwargs land in `metadata` for free."""
    return _envelope(success=True, data=data, error=None, metadata=dict(metadata) or None)


def err(message: str, **metadata: Any) -> Dict[str, Any]:
    """Failure envelope. The frontend should treat `success=false` as the
    single source of truth — never sniff `error` for nullness alone."""
    return _envelope(success=False, data=None, error=message, metadata=dict(metadata) or None)


# ── Dual-emit helper ─────────────────────────────────────────────────────
#
# Adds the envelope keys to a legacy payload without breaking existing
# readers. Old client code keeps reading `response.reply`; new client
# code reads `response.data.reply` (the nested copy). Use only when
# transitioning a real route — do not invent a fake one.

_ENVELOPE_KEYS = {"success", "data", "error", "metadata", "timestamp"}


def dual_emit(legacy_payload: Dict[str, Any], **metadata: Any) -> Dict[str, Any]:
    """
    Merge envelope keys onto a legacy response body.

    The legacy fields stay at the top level so old consumers don't notice
    the change. The same dict is referenced by `data` for new consumers.

    NOTE: if `legacy_payload` already uses any of the envelope keys
    (`success`, `data`, `error`, `metadata`, `timestamp`) they will be
    overwritten — log a warning when this happens so the conflict is
    visible during the transition.
    """
    out = dict(legacy_payload)
    overlap = _ENVELOPE_KEYS & out.keys()
    if overlap:
        import logging
        logging.getLogger(__name__).warning(
            "dual_emit: legacy payload had envelope-conflicting keys %s — overwritten",
            sorted(overlap),
        )
    out["success"]   = True
    out["data"]      = legacy_payload
    out["error"]     = None
    out["metadata"]  = dict(metadata)
    out["timestamp"] = _now_iso()
    return out


# ── Legacy chat-specific helpers (DO NOT change shape) ───────────────────
# These produce the exact JSON the existing frontend reads against. The
# v3 fields below (`success`, `message`, `conversation_id`, `usage`,
# `metadata`) are kept for backward compat with earlier client code; new
# code should prefer the dual_emit envelope above.

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


__all__ = [
    "ok", "err", "dual_emit",
    "chat_success", "chat_error",
]
