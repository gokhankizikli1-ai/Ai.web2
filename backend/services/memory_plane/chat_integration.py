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
    # Added Phase 6.x — the user's natural phrasings reported in
    # production. None of these were caught before; the LLM was
    # hallucinating save acknowledgments without persistence.
    "bunu kaydet",
    "bunu kayit et",
    "bunu kayıt et",
    "bunu da kaydet",
    "lütfen kaydet",
    "lutfen kaydet",
    "lütfen hatırla",
    "lutfen hatirla",
    "kaydedin",
    "kaydeder misin",
)


# ── Suffix triggers (Phase 6.x) ──────────────────────────────────────────────
#
# Some users put the save command at the END of a declarative
# statement: "Ben kısa cevaplar seviyorum bunu kaydet."
# A pure prefix matcher misses these. We add a small allowlist of
# suffix triggers and accept them when they appear in the LAST 40
# characters of a message <= 300 chars. The fact is everything BEFORE
# the trigger.
#
# We keep this list tight — broader patterns would false-positive on
# innocent mentions of "kaydet" / "save" in normal conversation.

_SAVE_TRIGGERS_SUFFIX: tuple[str, ...] = (
    "bunu kaydet",
    "bunu kayit et",
    "bunu kayıt et",
    "bunu da kaydet",
    "bunu hatırla",
    "bunu hatirla",
    "bunu hatırlat",
    "bunu hatirlat",
    "şunu kaydet",
    "sunu kaydet",
    "lütfen kaydet",
    "lutfen kaydet",
    "save this",
    "save that",
    "save it",
    "remember this",
    "remember that",
    "remember it",
    "please save",
    "please remember",
)
_SUFFIX_WINDOW_CHARS = 40
_SUFFIX_MAX_MESSAGE  = 300

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

    # 1) PREFIX match — the original behaviour. Triggers at the start
    #    of the message; fact = everything after the trigger.
    for trig in _SAVE_TRIGGERS_ALL:
        if not low.startswith(trig):
            continue
        remainder = text[len(trig):].lstrip(" \t:-.,;")
        if not remainder or len(remainder) < 3:
            return {"trigger": trig, "fact": "", "kind": "fact"}
        kind = "preference" if (_PREF_HINT_RE.search(trig) or _PREF_HINT_RE.search(remainder)) else "fact"
        return {"trigger": trig, "fact": remainder, "kind": kind}

    # 2) SUFFIX match (Phase 6.x) — for natural phrasings like
    #    "Ben kısa cevaplar seviyorum bunu kaydet." Only considered
    #    when the message is short enough (avoids false positives in
    #    long conversational replies) AND the trigger sits in the
    #    last 40 chars (so it's CLEARLY a directive, not a passing
    #    mention).
    if len(text) <= _SUFFIX_MAX_MESSAGE:
        tail = low[-_SUFFIX_WINDOW_CHARS:]
        for trig in _SAVE_TRIGGERS_SUFFIX:
            idx = tail.rfind(trig)
            if idx < 0:
                continue
            # Convert tail-relative index to message-absolute.
            abs_idx = len(low) - len(tail) + idx
            # Fact = everything BEFORE the trigger, stripped of
            # trailing punctuation/connectors ("X, Y bunu kaydet" → "X, Y").
            fact = text[:abs_idx].rstrip(" \t:-.,;").strip()
            if not fact or len(fact) < 3:
                # Trigger appeared but no content before it. Treat
                # as an empty-content trigger so the caller can ask
                # the user what to save.
                return {"trigger": trig, "fact": "", "kind": "fact"}
            kind = "preference" if (_PREF_HINT_RE.search(trig) or _PREF_HINT_RE.search(fact)) else "fact"
            return {"trigger": trig, "fact": fact, "kind": kind,
                    "position": "suffix"}

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

    Phase 6.x — routes through the hydration pipeline so the result
    is CACHED for ~30 s (TTL) and falls back to durable preferences
    when text-overlap retrieval finds nothing. This is the seam that
    fixes the "save works but recall is inconsistent" production
    failure — preferences now always make it into the prompt even
    when the user's query doesn't textually match them.
    """
    if not user_id:
        return None
    try:
        # Lazy import — hydration imports cache + preferences which
        # import client; keep this here to avoid an import cycle.
        from backend.services.memory_plane.hydration import hydrate_for_chat
        snap = hydrate_for_chat(
            user_id=    str(user_id),
            project_id= project_id,
            query=      query,
            limit=      int(max(1, min(20, limit))),
        )
        if snap.is_empty():
            return None
        # Wrap the formatted block with the same header the legacy
        # hooks.build_context_block uses, so the LLM sees the same
        # framing it always did.
        return (
            "[Known about the user — use naturally, never as a list]\n"
            + snap.context_text
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


# ── Phase 9 — asset-aware context ───────────────────────────────────────────

def build_asset_context_block(
    *,
    user_id: str,
    asset_ids: Optional[list[str]] = None,
) -> Optional[str]:
    """Compose a system-prompt block describing the assets attached
    to this chat turn. Resolves each id via assets_client (ownership
    enforced), pulls the cached vision analysis when present, and
    returns a bounded compact string.

    Returns None when:
      * asset_ids is empty
      * ENABLE_ASSET_SYSTEM is off (client returns []; we surface no block)
      * none of the ids resolve to an owned asset (all-or-nothing)

    Output shape (capped at ~1600 chars):
        [Attached assets]
        - design.png (image, 240 KB) — Image asset 'design.png' (image/png, 245,768 bytes, 1200×800px).
        - notes.pdf  (pdf,   12 KB) — PDF document 'notes.pdf' (12,288 bytes). Text extracted (1,243 chars).
    """
    if not user_id or not asset_ids:
        return None
    try:
        from backend.services.assets import client as _assets_client
        from backend.services.vision import client as _vision_client
    except Exception as e:
        logger.warning("memory_plane.chat.build_asset_context_block import error: %s", e)
        return None

    # Ownership-checked batch fetch.
    items = _assets_client.list_by_ids(str(user_id), list(asset_ids)) or []
    if not items:
        return None

    char_budget = 1600
    lines: list[str] = ["[Attached assets — describe and reason about them naturally]"]
    char_budget -= len(lines[0]) + 1

    for a in items:
        # Pull the cached analysis if vision ran; falls back to
        # metadata-only summary otherwise. Honest by default — we
        # never invent details.
        summary: str = ""
        analysis = _vision_client.get_cached(a.id or "")
        if analysis and analysis.get("summary"):
            summary = str(analysis["summary"])
        else:
            summary = (
                f"{a.asset_type.title()} {a.filename!r} "
                f"({a.mime_type}, {a.size_bytes:,} bytes)."
            )
            # Append video processing note when applicable so the LLM
            # doesn't pretend to understand the content.
            if (a.metadata or {}).get("processing_not_supported"):
                summary += (
                    " Frame extraction not supported; "
                    "only filename and size are visible."
                )

        # Inline extracted text for PDFs/documents when present and short.
        extracted = (analysis or {}).get("extracted_text") if analysis else None
        line = f"- {a.filename} ({a.asset_type}, {_human_size(a.size_bytes)}) — {summary[:280]}"
        if extracted and len(extracted) < 500:
            line += f"\n  Excerpt: {extracted[:400]}"

        if char_budget - len(line) - 1 < 0:
            break
        lines.append(line)
        char_budget -= len(line) + 1

    if len(lines) == 1:
        return None
    return "\n".join(lines)


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n} B"


# ── Streaming-path system-prompt assembler ──────────────────────────────────
#
# The /v2/chat/stream route was originally a pure passthrough to the
# provider — it does NOT go through ai_service.process_chat, so the
# legacy `_build_system` / `build_system_prompt` machinery never runs.
# This helper produces the system prompt for the stream path, with the
# Memory Plane context block embedded.
#
# Design notes:
#   * STRONG instruction language: the model is told to TREAT SAVED
#     MEMORIES AS GROUND TRUTH and recite them verbatim rather than
#     speculate. Without this, GPT-4o sometimes "interprets" a saved
#     preference into a generic answer.
#   * Returns None when there's nothing to inject so the caller can
#     skip the system message altogether and stay byte-identical to
#     the pre-PR streaming behaviour.
#   * Mode-aware: when a chat mode is supplied (e.g. "trading_analyst"),
#     we append a short mode hint so the streaming path roughly
#     matches the persona the /chat path would have set.

_SYSTEM_PROMPT_HEADER = (
    "You are KorvixAI, the user's persistent AI assistant. "
    "You have access to memories the user has explicitly saved across "
    "previous conversations.\n\n"
    "RULES FOR USING SAVED MEMORIES:\n"
    "1. Saved memories below are GROUND TRUTH — never contradict, "
    "paraphrase, or speculate around them.\n"
    "2. When the user asks about a topic that matches a saved memory, "
    "answer using the EXACT saved content first, then add detail only "
    "if asked.\n"
    "3. If the user asks 'what did I prefer' / 'ne tercih ediyordum' / "
    "similar recall questions, recite the saved memory verbatim — "
    "do NOT generate a generic answer.\n"
    "4. Reply in the same language the user wrote in."
)


def build_stream_system_prompt(
    *,
    user_id: str,
    project_id: Optional[str] = None,
    query: Optional[str] = None,
    mode: Optional[str] = None,
    limit: int = 8,
) -> Optional[str]:
    """Compose the system prompt for the /v2/chat/stream path.

    Returns None when:
      * Memory Plane is disabled, AND
      * No mode-specific hint applies.
    The caller treats None as "don't inject any system message" so the
    streaming path stays byte-identical to pre-PR when there's nothing
    to add.

    When memories exist, the returned string starts with the strong
    "ground truth" header above, followed by the bulleted memory list
    and (optionally) a soft mode hint.
    """
    block = context_block(
        user_id=    user_id,
        project_id= project_id,
        query=      query,
        limit=      limit,
    )
    if not block and not mode:
        return None
    parts: list[str] = [_SYSTEM_PROMPT_HEADER]
    if block:
        parts.append(block)
    if mode:
        # Soft mode hint — full mode persona lives in ai_service and
        # isn't worth duplicating here. The streaming path is best-
        # effort persona; the priority is memory injection.
        parts.append(f"Active mode: {mode}. Adapt your tone accordingly.")
    return "\n\n".join(parts)


def memory_hit_count(
    *,
    user_id: str,
    project_id: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 8,
) -> int:
    """Return the number of memories the retriever found for this
    (user, project, query). Used by the debug log so production logs
    show exactly how many memories were injected."""
    if not user_id:
        return 0
    try:
        from backend.services.memory_plane.retriever import retriever
        from backend.services.memory_plane.types import MemoryQuery
        return len(retriever.search(MemoryQuery(
            user_id=  str(user_id),
            project_id=project_id,
            query=    query,
            limit=    int(max(1, min(50, limit))),
        )))
    except Exception:
        return 0


__all__ = [
    "is_explicit_save_command",
    "save_explicit",
    "auto_extract",
    "context_block",
    "fold_into_mem_summary",
    "build_stream_system_prompt",
    "build_asset_context_block",
    "memory_hit_count",
    "ack_reply",
    "ack_reply_empty",
]
