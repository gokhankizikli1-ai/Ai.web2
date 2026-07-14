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
    # Phase 13E.1 — additive, bounded telemetry for structured-builder rejections.
    # Numbers only (never message contents). Old callers ignore these safely.
    request_char_count: Optional[int] = None
    limit_char_count:   Optional[int] = None


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


# ── Structured website-builder safety path (Phase 13E.1) ───────────────────
# The dedicated `website_builder` mode transports a MACHINE-GENERATED planning
# envelope, NOT an ordinary chat message: the task marker + the Korvix-generated
# website-language directive + the exact planning-section contract + the Design
# Thinking / Website Experience / Entry Flow / Conversion Journey requirements +
# the original idea (and, on a repair, a bounded slice of the previous reply).
# That request is intentionally FAR larger than a human chat message (well above the
# generic 4k cap that was rejecting every fresh Web Build with `safety_length`), yet
# much smaller than a complete frontend SOURCE project (the 125k frontend cap).
#
# Measured generated request sizes (Phase 13E.1 vitest, buildWebBuild* output; the
# injected website-language directive adds ~180 chars at send time):
#   • normal fresh initial request      ~10.6k chars
#   • very verbose fresh request        ~16k  chars (a ~5.6k-char idea)
#   • strict planning repair request    ~4.5k chars (incl. up to a 2k previous-reply slice)
#   • design-plan repair request        ~6.2k chars (incl. up to a 3.5k previous-reply slice)
# The smallest hard cap that leaves legitimate requests generous headroom while still
# bounding abuse is 50,000 — comfortably above the ~16k realistic maximum and far below
# the 125k frontend-source cap. It is NOT reused from _STRUCTURED_MAX_LEN (which stays
# specific to full frontend projects) and does NOT touch the generic 4k cap.
_WEBSITE_STRUCTURED_MAX_LEN = 50_000

_WEB_BUILD_MARKER            = "[WEB BUILD REQUEST]"
_WEB_PLANNING_REPAIR_MARKER  = "[WEB BUILD PLANNING REPAIR REQUEST]"
_WEB_DESIGN_REPAIR_MARKER    = "[WEB BUILD DESIGN PLAN REPAIR REQUEST]"


def classify_website_builder_task(message: str) -> Optional[str]:
    """Validate + classify a website_builder structured envelope WITHOUT executing or
    parsing the embedded idea. Returns one of:

        "initial"            — a fresh planning request (no repair marker)
        "strict-repair"      — a strict planning repair
        "design-plan-repair" — a design-thinking-plan quality repair
        "revision"           — a section-level revision (carries `Requested change:`)

    or None when the envelope is malformed/ambiguous. Pure; never raises.

    A valid envelope must begin with exactly one `[WEB BUILD REQUEST]` marker and carry
    exactly one primary content anchor line — either `Idea:` (fresh/repair) or
    `Requested change:` (revision). A request may carry at most ONE repair marker KIND,
    each at most once, and never both — a mixed/duplicated repair envelope is rejected.
    """
    if not isinstance(message, str):
        message = str(message or "")
    # Exactly one leading task marker.
    if not message.startswith(_WEB_BUILD_MARKER):
        return None
    if message.count(_WEB_BUILD_MARKER) != 1:
        return None
    # Exactly one primary content anchor line (planning `Idea:` OR revision
    # `Requested change:`). A planning request that DROPPED its `Idea:` line, or a
    # request with two content anchors, is malformed.
    lines = message.split("\n")
    idea_lines   = sum(1 for ln in lines if ln.startswith("Idea:"))
    change_lines = sum(1 for ln in lines if ln.startswith("Requested change:"))
    if idea_lines + change_lines != 1:
        return None
    # Repair markers: at most one KIND, each at most once, never both.
    strict = message.count(_WEB_PLANNING_REPAIR_MARKER)
    design = message.count(_WEB_DESIGN_REPAIR_MARKER)
    if strict > 1 or design > 1:
        return None
    if strict >= 1 and design >= 1:
        return None
    if change_lines == 1:
        return "revision"
    if strict == 1:
        return "strict-repair"
    if design == 1:
        return "design-plan-repair"
    return "initial"


def check_structured_website_builder_message(user_id: str, message: str) -> SafetyResult:
    """
    Safety path for the dedicated `website_builder` structured planning/revision request.
    Validates the website envelope structure + a bounded structured size cap + the
    per-user throttle. Never raises; deliberately does NOT run the generic
    prompt-injection regex over the machine-generated wrapper (the transported idea +
    previous reply are untrusted DATA governed by the website_builder system prompt, not
    executable instructions). Applies ONLY to a valid explicit website_builder envelope.
    """
    with _STATS_LOCK:
        _STATS["checks"] += 1

    if not isinstance(message, str):
        message = str(message or "")
    msg_len = len(message)

    # 1. Website structured length cap (NOT the generic 4k, NOT the 125k frontend cap).
    if msg_len > _WEBSITE_STRUCTURED_MAX_LEN:
        _bump("rejections_length", f"website structured length {msg_len} > {_WEBSITE_STRUCTURED_MAX_LEN}")
        return SafetyResult(
            allowed=False,
            reason=f"website structured message exceeds {_WEBSITE_STRUCTURED_MAX_LEN} characters",
            code="structured_website_length",
            message_for_user=(
                "Web Build planlama isteği güvenli sınırı aştı. Site fikrin korunarak "
                "istek daha küçük hazırlanmalı. — The generated Web Build planning request "
                "exceeded the safe size limit; it must be prepared smaller while keeping your idea."
            ),
            request_char_count=msg_len,
            limit_char_count=_WEBSITE_STRUCTURED_MAX_LEN,
        )

    # 2. Envelope structure — a valid, unambiguous website_builder transport.
    if classify_website_builder_task(message) is None:
        _bump("rejections_injection", "malformed_website_builder_envelope")
        return SafetyResult(
            allowed=False,
            reason="malformed website builder envelope",
            code="malformed_website_envelope",
            message_for_user=(
                "Web Build planlama isteği biçimi geçersiz. İstek modele gönderilmedi. — "
                "The Web Build planning request format was invalid; it was not sent to the model."
            ),
            request_char_count=msg_len,
            limit_char_count=_WEBSITE_STRUCTURED_MAX_LEN,
        )

    # 3. Per-user throttle (unchanged). The generic injection regex is deliberately NOT
    #    run over the machine-generated wrapper.
    if not _throttle_ok(str(user_id)):
        _bump("rejections_throttle", "per_minute_limit")
        return SafetyResult(
            allowed=False, reason="per-minute rate limit",
            code="throttle",
            message_for_user=(
                "Web Build istekleri çok hızlı gönderildi. Birkaç saniye bekleyip tekrar dene. — "
                "Too many Web Build requests; wait a few seconds and try again."
            ),
            request_char_count=msg_len,
            limit_char_count=_WEBSITE_STRUCTURED_MAX_LEN,
        )

    return SafetyResult(allowed=True, request_char_count=msg_len, limit_char_count=_WEBSITE_STRUCTURED_MAX_LEN)


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
            # Phase 13E.1 — additive per-path structured caps (numbers only, backward
            # compatible; existing keys above are unchanged). No message contents.
            "generic_max_input_chars":             _MAX_LEN,
            "website_structured_max_input_chars":  _WEBSITE_STRUCTURED_MAX_LEN,
            "frontend_structured_max_input_chars": _STRUCTURED_MAX_LEN,
        }
