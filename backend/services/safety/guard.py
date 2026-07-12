# coding: utf-8
# Phase 5.2 — Safety Guard.
#
# Lightweight, prompt-only safety stops nothing — this module is the runtime
# enforcement layer that sits BEFORE the AI call:
#
#   1. Length cap                       — reject obviously oversized inputs.
#   2. Prompt-injection pattern blocks  — common jailbreak / instruction-overrides.
#   3. Per-minute throttle              — per-user request rate limit (separate
#                                          from daily quota).
#   4. Audit log                        — every rejection is counted + last
#                                          reason kept for /tools/health.
#
# Public API:
#   check_message(user_id, message) -> SafetyResult
#       result.allowed (bool)
#       result.reason  (str | None)
#       result.code    (str | None)  -- "length" / "injection" / "throttle"
#       result.message_for_user (str | None)
#   stats() -> dict
#
# Defaults:
#   max_length            = 4000 chars  (overridable via SAFETY_MAX_INPUT_CHARS)
#   per_minute_limit      = 30          (overridable via SAFETY_PER_MIN_LIMIT)
#   throttle_window_sec   = 60
#
# All limits + the blocklist are tuned conservatively. They never trigger on
# normal user chats; they catch obvious abuse. Adjust via env if your traffic
# pattern needs different thresholds.
import os
import time
import logging
import threading
import re
from dataclasses import dataclass
from collections import deque
from typing import Optional

logger = logging.getLogger(__name__)

# ── Tunables (env-overridable) ─────────────────────────────────────────────
_MAX_LEN          = int(os.getenv("SAFETY_MAX_INPUT_CHARS", "4000"))
_PER_MIN_LIMIT    = int(os.getenv("SAFETY_PER_MIN_LIMIT", "30"))
_WINDOW_SEC       = 60.0

# ── Prompt injection patterns ──────────────────────────────────────────────
# Conservative — only the most common, clear-intent override attempts.
# False positives here mean blocked legitimate users, so we keep this short.
_INJECTION_PATTERNS = [
    # Allow 0-3 qualifier words between the verb and the target noun.
    r"\bignore (?:\w+\s+){0,3}(?:instructions?|rules?|prompts?|guidelines?|policies)\b",
    r"\bdisregard (?:\w+\s+){0,3}(?:instructions?|rules?|prompts?|guidelines?)\b",
    r"\bforget (?:\w+\s+){0,3}(?:instructions?|rules?|prompts?|context|everything)\b",
    r"\byou are (?:now )?(?:dan|stan|developer mode|jailbroken|unrestricted)\b",
    r"\bact (?:as|like) (?:dan|stan|an? unrestricted ai|an? evil ai|a jailbroken)\b",
    r"\bsystem prompt:.{0,40}you (?:are|must|will|should)\b",
    r"\b(?:override|bypass) (?:\w+\s+){0,2}(?:safety|security|content|guidelines|filters?|policies)\b",
    r"\b(?:pretend|act) (?:that )?you (?:are|have)\s+(?:no|never)\b",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)

# ── Throttle store ─────────────────────────────────────────────────────────
_THROTTLE_LOCK = threading.Lock()
_USER_WINDOWS: dict[str, deque[float]] = {}

# ── Audit counters ─────────────────────────────────────────────────────────
_STATS_LOCK = threading.Lock()
_STATS = {
    "rejections_length":    0,
    "rejections_injection": 0,
    "rejections_throttle":  0,
    "checks":               0,
    "last_reason":          "",
}


@dataclass
class SafetyResult:
    allowed: bool
    reason:  Optional[str] = None
    code:    Optional[str] = None
    message_for_user: Optional[str] = None


def check_message(user_id: str, message: str) -> SafetyResult:
    """
    Run all guards in order. Returns SafetyResult.allowed=False on first hit.
    Always cheap (regex + deque); never raises.
    """
    with _STATS_LOCK:
        _STATS["checks"] += 1

    if not isinstance(message, str):
        message = str(message or "")
    msg_len = len(message)

    # 1. Length
    if msg_len > _MAX_LEN:
        _bump("rejections_length", f"length {msg_len} > {_MAX_LEN}")
        return SafetyResult(
            allowed=False, reason=f"message exceeds {_MAX_LEN} characters",
            code="length",
            message_for_user=(
                "Mesajın çok uzun. Lütfen sorunu kısaltıp tekrar gönder "
                f"(maks {_MAX_LEN} karakter)."
            ),
        )

    # 2. Prompt-injection patterns
    if _INJECTION_RE.search(message):
        _bump("rejections_injection", "prompt_injection_pattern")
        return SafetyResult(
            allowed=False, reason="prompt injection pattern detected",
            code="injection",
            message_for_user=(
                "İsteğin sistem talimatlarını değiştirmeye çalışıyor görünüyor. "
                "Lütfen normal bir soruyla tekrar dene."
            ),
        )

    # 3. Per-minute throttle
    if not _throttle_ok(str(user_id)):
        _bump("rejections_throttle", "per_minute_limit")
        return SafetyResult(
            allowed=False, reason="per-minute rate limit",
            code="throttle",
            message_for_user=(
                "Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekleyip tekrar dene."
            ),
        )

    return SafetyResult(allowed=True)


# ── Structured builder safety path (Phase 12B.1) ───────────────────────────
# The dedicated `frontend_builder` mode transports a serialized Phase 12A
# FrontendBuildSpecification (up to ~120k chars) that INTENTIONALLY carries the
# original user prompt, public copy and research snippets as untrusted JSON DATA.
# The generic guard would (a) reject it on the 4k length cap and (b) mis-fire the
# prompt-injection regex on quoted injection-like content. This dedicated path
# validates the ENVELOPE structure + a hard structured size cap + the per-user
# throttle, and deliberately SKIPS the generic injection regex over the payload —
# the dedicated backend system prompt, not the transported strings, controls
# execution. It applies ONLY to a valid explicit frontend_builder envelope; every
# other mode keeps the generic cap / injection / throttle behavior unchanged.
_STRUCTURED_MAX_LEN = 125_000


def check_structured_builder_message(user_id: str, message: str) -> SafetyResult:
    """
    Safety path for the dedicated `frontend_builder` structured request. Validates
    the frontend-files envelope structure + a 125k hard cap + the throttle. Never
    raises; never runs the generic prompt-injection regex over the JSON payload.
    """
    with _STATS_LOCK:
        _STATS["checks"] += 1

    if not isinstance(message, str):
        message = str(message or "")
    msg_len = len(message)

    # 1. Hard structured length cap.
    if msg_len > _STRUCTURED_MAX_LEN:
        _bump("rejections_length", f"structured length {msg_len} > {_STRUCTURED_MAX_LEN}")
        return SafetyResult(
            allowed=False, reason=f"structured builder message exceeds {_STRUCTURED_MAX_LEN} characters",
            code="length",
            message_for_user=(
                "Yapılandırılmış istek çok büyük. Lütfen tekrar dene "
                f"(maks {_STRUCTURED_MAX_LEN} karakter)."
            ),
        )

    # 2. Envelope structure — must be the exact dedicated request, with exactly one
    #    BEGIN marker preceding exactly one END marker. Malformed → honest reject.
    begin_marker = "BEGIN_FRONTEND_BUILD_SPEC_JSON"
    end_marker = "END_FRONTEND_BUILD_SPEC_JSON"
    begin_count = message.count(begin_marker)
    end_count = message.count(end_marker)
    valid_envelope = (
        message.startswith("[FRONTEND BUILDER REQUEST]")
        and begin_count == 1
        and end_count == 1
        and message.index(begin_marker) < message.index(end_marker)
    )
    if not valid_envelope:
        _bump("rejections_injection", "malformed_structured_builder_envelope")
        return SafetyResult(
            allowed=False, reason="malformed frontend builder envelope",
            code="malformed_envelope",
            message_for_user=(
                "Yapılandırılmış istek biçimi geçersiz. Lütfen tekrar dene."
            ),
        )

    # 3. Per-minute throttle (unchanged). The generic injection regex is
    #    deliberately NOT run over the trusted-transport JSON payload.
    if not _throttle_ok(str(user_id)):
        _bump("rejections_throttle", "per_minute_limit")
        return SafetyResult(
            allowed=False, reason="per-minute rate limit",
            code="throttle",
            message_for_user=(
                "Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekleyip tekrar dene."
            ),
        )

    return SafetyResult(allowed=True)


def _throttle_ok(user_id: str) -> bool:
    """Sliding-window rate limit. Returns True if request can proceed."""
    if _PER_MIN_LIMIT <= 0:
        return True
    now = time.time()
    cutoff = now - _WINDOW_SEC
    with _THROTTLE_LOCK:
        dq = _USER_WINDOWS.setdefault(user_id, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _PER_MIN_LIMIT:
            return False
        dq.append(now)
        # Bounded memory — cap window length.
        if len(dq) > _PER_MIN_LIMIT * 4:
            dq.popleft()
        return True


def _bump(field: str, reason: str) -> None:
    with _STATS_LOCK:
        _STATS[field] = _STATS.get(field, 0) + 1
        _STATS["last_reason"] = reason[:140]
    logger.info("safety_guard | %s | %s", field, reason)


def stats() -> dict:
    with _STATS_LOCK:
        return dict(_STATS) | {
            "max_input_chars":  _MAX_LEN,
            "per_minute_limit": _PER_MIN_LIMIT,
            "tracked_users":    len(_USER_WINDOWS),
        }
