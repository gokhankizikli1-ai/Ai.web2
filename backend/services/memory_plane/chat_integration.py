# coding: utf-8
"""
Phase 6 — Chat-orchestrator ↔ Memory Plane integration.

This module is the ONE place chat.py talks to the Memory Plane. It
exists for three reasons:

  1. Keep chat.py readable — chat.py is already 449 lines and houses a
     lot of orthogonal concerns (safety, usage limits, mode routing).
     The memory-plane integration is a separate concern and lives here.

  2. Make the integration testable in isolation. The chat route is hard
     to unit test (lots of moving parts); these helpers are pure
     functions over the public Memory Plane client.

  3. Centralise the "explicit save" command surface (English + Turkish
     triggers, with + without colon) so future languages can be added
     in one place.

Every function in this module:
  * Never raises — failures log + return a safe default.
  * Is a no-op when ENABLE_MEMORY_PLANE is off (relies on the client
    gate; no extra flag).
  * Returns a small JSON-serialisable structure so we can echo it back
    in chat response metadata for /v2/admin diagnostics.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from backend.services.memory_plane import client as _mp_client
from backend.services.memory_plane.hooks import (
    on_user_message      as _hook_on_user_message,
    on_assistant_message as _hook_on_assistant_message,
    build_context_block  as _hook_build_context_block,
)
from backend.services.memory_plane.types import (
    IMPORTANCE_HIGH, SOURCE_MANUAL,
)


logger = logging.getLogger(__name__)


# ── Explicit save commands ───────────────────────────────────────────────────
#
# Every entry is matched case-insensitively. The matcher accepts:
#   - "<trigger>: <fact>"    (colon form)
#   - "<trigger> <fact>"     (no-colon form, only when fact >= 3 chars)
# The trigger phrase itself is stripped from the saved content.
#
# Order matters only for the longest-match preference inside _match_save_command.

_SAVE_TRIGGERS_EN: tuple[str, ...] = (
    "remember this preference",
    "save this preference",
    "save this as a preference",
    "remember this",
    "save this",
    "note this",
    "remember that",
    "please remember",
    "remember:",
    "save:",
    "note:",
)

_SAVE_TRIGGERS_TR: tuple[str, ...] = (
    "bunu tercih olarak kaydet",
    "bunu hafızana kaydet",
    "bunu hafizana kaydet",
    "hafızana kaydet",
    "hafizana kaydet",
    "bunu hatırla",
    "bunu hatirla",
    "aklında tut",
    "aklinda tut",
    "not al",
    "şunu kaydet",
    "sunu kaydet",
    "bunu unutma",
    "hatırla:",
    "hatirla:",
    "kaydet:",
)

# Longest first so "remember this preference" beats "remember this".
_SAVE_TRIGGERS_ALL: tuple[str, ...] = tuple(sorted(
    _SAVE_TRIGGERS_EN + _SAVE_TRIGGERS_TR,
    key=len, reverse=True,
))


# Preference-kind detection — if the trigger explicitly mentions "preference"
# (or "tercih") we tag the memory as kind="preference" instead of "fact".
_PREF_HINT_RE = re.compile(r"\b(preference|tercih)\b", re.IGNORECASE)


# ── Reply localisation ───────────────────────────────────────────────────────
#
# We pick the ack reply in the user's language by sniffing for Turkish
# diacritics + common Turkish words. Tiny heuristic, no full lang
# detection — wrong guesses are harmless ("Saved." in a Turkish chat
# is still understandable).

# IMPORTANT: split into two regexes. The diacritic class must NOT use
# IGNORECASE — under Unicode case-folding `[ı]` (U+0131, dotless i)
# folds together with `i` (U+0069), so an IGNORECASE [ı] would match
# any English "i" and false-trigger the Turkish ack reply.
_TR_DIACRITIC_RE = re.compile(r"[çğıöşüÇĞİÖŞÜ]")
_TR_KEYWORD_RE = re.compile(
    r"\b(bunu|kaydet|hatırla|hatirla|hafıza|hafiza|tercih|unut|aklında|aklinda)\b",
    re.IGNORECASE,
)


def _looks_turkish(message: str) -> bool:
    if not message:
        return False
    return bool(_TR_DIACRITIC_RE.search(message) or _TR_KEYWORD_RE.search(message))


# ── Public API ───────────────────────────────────────────────────────────────

def is_explicit_save_command(message: str) -> Optional[dict]:
    """Detect an explicit "remember this / hafızana kaydet" command.

    Returns a dict {trigger, fact, kind} when matched, or None.
    `fact` is the message content with the trigger phrase stripped.
    `kind` is "preference" when the trigger or fact hint at a preference,
    else "fact".

    Matching is whitespace-tolerant and case-insensitive. Both colon
    ("remember this: I prefer X") and no-colon ("remember this I prefer X")
    forms are accepted.
    """
    if not message or not isinstance(message, str):
        return None
    text = message.strip()
    if not text:
        return None
    low = text.lower()

    for trig in _SAVE_TRIGGERS_ALL:
        if not low.startswith(trig):
            continue
        # Strip the trigger, then any leading punctuation/whitespace.
        remainder = text[len(trig):].lstrip(" \t:-.,;")
        if not remainder or len(remainder) < 3:
            # Trigger matched but no content — caller should reply
            # asking what to save. We still return a hit so caller can
            # distinguish "trigger fired but empty" from "no trigger".
            return {"trigger": trig, "fact": "", "kind": "fact"}
        kind = "preference" if (_PREF_HINT_RE.search(trig) or _PREF_HINT_RE.search(remainder)) else "fact"
        return {"trigger": trig, "fact": remainder, "kind": kind}
    return None


def save_explicit(
    *,
    user_id: str,
    content: str,
    kind: str = "fact",
    project_id: Optional[str] = None,
) -> Optional[dict]:
    """Persist a memory triggered by an explicit user command. Returns
    a small dict describing the save (or None on failure / flag off).

    Uses HIGH importance because the user explicitly asked for this —
    these should rank above auto-extracted candidates in retrieval.
    Source is SOURCE_MANUAL so /v2/memory consumers can distinguish
    these from heuristic-auto memories.

    The dedup-fold inside the manager handles "user says the same
    thing twice" gracefully (single row, importance bumped).
    """
    if not user_id or not (content or "").strip():
        return None
    try:
        rec = _mp_client.create(
            user_id=    str(user_id),
            content=    content.strip(),
            kind=       kind,
            project_id= project_id,
            importance= IMPORTANCE_HIGH,
            source=     SOURCE_MANUAL,
            metadata=   {"trigger": "explicit"},
        )
    except Exception as e:
        logger.warning("memory_plane.chat.save_explicit user=%s error: %s", user_id, e)
        return None
    if rec is None:
        return None
    return {
        "id":          rec.id,
        "kind":        rec.kind,
        "importance":  rec.importance,
        "project_id":  rec.project_id,
    }


def auto_extract(
    *,
    user_id: str,
    message: str,
    project_id: Optional[str] = None,
) -> list[dict]:
    """Run the heuristic extractor on a user message. Persists any
    candidates. Returns a list of `{id, kind, content}` summaries.

    Empty list when the flag is off, the message is unremarkable, or
    extraction failed. NEVER raises — chat path must not break on
    memory failures.
    """
    if not user_id or not message:
        return []
    try:
        recs = _hook_on_user_message(
            user_id=    str(user_id),
            message=    message,
            project_id= project_id,
        )
    except Exception as e:
        logger.warning("memory_plane.chat.auto_extract user=%s error: %s", user_id, e)
        return []
    return [
        {"id": r.id, "kind": r.kind, "content": r.content}
        for r in recs
    ]


def context_block(
    *,
    user_id: str,
    project_id: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 5,
) -> Optional[str]:
    """Return a compact memory-context block ready to fold into the
    system prompt. None when there is nothing to inject.

    This is what makes memories visible to the assistant in future
    chats — without this hook, saved memories sit silently in SQLite
    and the model can't see them.
    """
    if not user_id:
        return None
    try:
        return _hook_build_context_block(
            user_id=    str(user_id),
            project_id= project_id,
            query=      query,
            limit=      int(max(1, min(20, limit))),
        )
    except Exception as e:
        logger.warning("memory_plane.chat.context_block user=%s error: %s", user_id, e)
        return None


def fold_into_mem_summary(
    existing_summary: str,
    *,
    user_id: str,
    project_id: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 5,
) -> str:
    """Prepend the Memory Plane context block to the legacy mem_summary
    string. Returns the combined block (or `existing_summary` unchanged
    when there's nothing to inject).

    This is the single seam chat.py uses — by folding into `mem_summary`
    we hit every existing system-prompt assembly path (`_build_system`
    and `build_system_prompt`) without changing any other module.
    """
    block = context_block(
        user_id=    user_id,
        project_id= project_id,
        query=      query,
        limit=      limit,
    )
    if not block:
        return existing_summary or ""
    if not existing_summary or not existing_summary.strip():
        return block
    # Order: Memory Plane block first (more relevant + recency-aware),
    # legacy summary second (broader, may include style + older facts).
    return f"{block}\n\n{existing_summary.strip()}"


def ack_reply(message: str, *, fact: str = "") -> str:
    """Build the short ack we return to the user after an explicit save.
    Language-aware (English / Turkish).
    """
    if _looks_turkish(message):
        return "Kaydettim."
    return "Saved."


def ack_reply_empty(message: str) -> str:
    """Reply when the save trigger fired but no content followed
    (e.g. user typed just "remember this" with nothing after)."""
    if _looks_turkish(message):
        return "Ne kaydetmemi istediğini anlayamadım."
    return "I didn't catch what to remember — please include the fact after 'remember this'."


__all__ = [
    "is_explicit_save_command",
    "save_explicit",
    "auto_extract",
    "context_block",
    "fold_into_mem_summary",
    "ack_reply",
    "ack_reply_empty",
]
