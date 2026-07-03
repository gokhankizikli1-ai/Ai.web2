# coding: utf-8
import time
import logging
import uuid
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from backend.utils.timing import StageTimer

router = APIRouter(tags=["chat"])
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    user_id: str
    message: str
    chat_id: Optional[str] = None
    platform: Optional[str] = "web"
    session_id: Optional[str] = None
    # Optional AI mode — recognized values: fast, deep_think, startup_advisor,
    # marketing_dropshipping, trading_analyst, coding, study, research,
    # website_builder, game_developer.
    # Legacy aliases (e.g. "chat", "finance", "ecommerce", "roblox", "ue5")
    # are also accepted.
    # Omit or send null to use automatic intent-based routing (default behaviour).
    mode: Optional[str] = None
    # Optional UI language preference (e.g. "en", "tr", "de"). Additive &
    # backward-compatible: omit/null → existing behaviour, byte-identical.
    # Never hard-translates; injected as a soft system-prompt hint only.
    language: Optional[str] = None
    # Optional project namespace (Phase 2). When set AND ENABLE_PROJECTS
    # is on, a "Project Context" block (project description + recent
    # project memory) is injected into the LLM system prompt for shared
    # cross-chat context. Silently ignored when the flag is off or the
    # project_id is unknown — chat behaviour is unchanged.
    project_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    intent: str
    model: str
    provider: str
    mode: str
    memory_used: bool
    remaining_messages: int
    premium: bool
    response_time_ms: int
    request_id: str
    suggested_followups: Optional[List[str]] = None
    # Phase 5 — optional extras (additive, never required by older frontends).
    # `metadata.trading_signal` carries the structured trading signal JSON
    # extracted from the trading_analyst reply. `metadata.tool_summary`
    # carries a compact snapshot of market_data + macro_data.
    metadata: Optional[Dict[str, Any]] = None


def _uid(raw: str) -> int:
    """Normalize user_id string to a stable integer."""
    return int(raw) if raw.isdigit() else hash(raw) % 2**31


def _resolve_authoritative_uid(request: Request, body_user_id: str) -> str:
    """Return the user_id we trust, IGNORING `body.user_id` when a
    stronger auth signal exists.

    SECURITY (Phase-1 P0 fix, 2026-06-28): the original implementation
    trusted `req.user_id` from the request body. A logged-in client
    could send a different account's user_id and be served that
    account's memory + safety context.

    The precedence (verified JWT subject → X-Korvix-Guest-Id → body
    fallback, with a bad/expired token NEVER falling through to the body)
    now lives in backend.core.deps.resolve_authoritative_uid so this
    route and /v2/orchestrate share ONE implementation instead of two
    that can drift. This thin wrapper preserves the "CHAT" log prefix.
    """
    from backend.core.deps import resolve_authoritative_uid
    return resolve_authoritative_uid(request, body_user_id, log_prefix="CHAT")


# Small, safe language map. Unknown / missing → "" (no hint → existing
# behaviour, which already defaults to the user's language / TR-EN).
_LANG_NAMES = {
    "en": "English", "tr": "Turkish", "de": "German", "fr": "French",
    "es": "Spanish", "it": "Italian", "pt": "Portuguese", "ru": "Russian",
    "ar": "Arabic", "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
    "nl": "Dutch", "hi": "Hindi",
    "english": "English", "turkish": "Turkish", "türkçe": "Turkish",
    "deutsch": "German", "français": "French", "español": "Spanish",
}


def _language_directive(language: Optional[str]) -> str:
    """Return a soft system-prompt suffix for the preferred language, or
    "" when unset/unknown (safe fallback — never raises, never forces a
    hard translation)."""
    if not language or not isinstance(language, str):
        return ""
    name = _LANG_NAMES.get(language.strip().lower())
    if not name:
        return ""
    return (
        f"Language preference: reply in {name} unless the user clearly "
        f"writes in another language. If unsure, use the user's language; "
        f"otherwise English or Turkish."
    )


def _with_language(style_prompt: str, language: Optional[str]) -> str:
    """Additively fold the language hint into the existing style_prompt
    (already injected into the system prompt for every mode). No hint →
    style_prompt returned unchanged."""
    directive = _language_directive(language)
    if not directive:
        return style_prompt
    return (f"{style_prompt}\n{directive}" if style_prompt else directive).strip()


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    """Chat completion.

    SECURITY (Phase-1 P0, 2026-06-28): `user_id` is derived from the
    authenticated identity via `_resolve_authoritative_uid()`, NOT from
    `req.user_id`. The body field is preserved for backward
    compatibility but is OVERRIDDEN whenever a Bearer token or
    X-Korvix-Guest-Id header is present. This blocks the cross-account
    leak observed in production where one logged-in user could be
    served another user's memory by sending the wrong body.user_id.
    """
    request_id = str(uuid.uuid4())[:8]
    t_start = time.monotonic()
    user_id = _uid(_resolve_authoritative_uid(request, req.user_id))
    message = req.message.strip()
    platform = req.platform or "web"

    # Per-stage timer — emits one structured log line at flush() with the
    # full per-stage timeline. Read these in production logs to find the
    # actual bottleneck (safety/context/AI/usage). Negligible overhead.
    timer = StageTimer("CHAT_TIMING", rid=request_id, uid=user_id, msg_len=len(message))

    logger.info("CHAT | rid=%s | uid=%s | msg_len=%d", request_id, user_id, len(message))

    # ── Phase 5.2 — safety guard (runs before any quota / AI call) ────────
    # Returns a fast, branded rejection if length / injection / throttle hit.
    # Never crashes the request — failures here log and fall through.
    try:
        from backend.services.safety.guard import check_message
        _safety = check_message(str(user_id), message)
        if not _safety.allowed:
            logger.info(
                "CHAT | rid=%s | uid=%s | safety_reject | code=%s | reason=%s",
                request_id, user_id, _safety.code, _safety.reason,
            )
            timer.mark("safety_reject")
            timer.flush()
            return _quick_response(
                request_id, user_id,
                _safety.message_for_user or "İstek reddedildi.",
                "safety_" + (_safety.code or "blocked"),
                t_start,
                with_profile=False,    # rejections don't need a fresh profile lookup
            )
    except Exception as _serr:
        logger.debug("CHAT | rid=%s | safety guard import/eval error: %s", request_id, _serr)
    timer.mark("safety_done")

    # ── Memory list shortcut ──────────────────────────────────────────────
    _mem_list_kw = [
        "ne hatirliyorsun", "ne hatırlıyorsun", "ne kaydettin",
        "ne biliyorsun", "hafizanda ne var",
    ]
    if any(kw in message.lower() for kw in _mem_list_kw):
        summary = ""
        try:
            from backend.services.memory_service import get_summary
            summary = get_summary(user_id) or ""
        except Exception:
            pass
        reply = ("Hafizamda bunlar var:\n\n" + summary) if summary else "Henuz bir sey kaydetmedim."
        timer.mark("memory_list_shortcut")
        timer.flush()
        return _quick_response(request_id, user_id, reply, "memory", t_start)

    # ── Memory save shortcut ──────────────────────────────────────────────
    # Two layers, in priority order:
    #   1) Phase 6 Memory Plane explicit-save commands (EN + TR, with or
    #      without colon). Persists to memory_plane with HIGH importance
    #      so future chats surface it via the context block. Also
    #      dual-writes to the legacy memory_service so the existing
    #      /memory listing UI keeps showing the same row.
    #   2) Legacy Turkish-only colon-prefixed triggers (kept as a
    #      fallback for any path the new matcher misses — same behaviour
    #      as before).
    try:
        from backend.services.memory_plane import chat_integration as _mp_chat
        _save_cmd = _mp_chat.is_explicit_save_command(message)
    except Exception:
        _save_cmd = None
    if _save_cmd:
        fact = (_save_cmd.get("fact") or "").strip()
        if not fact:
            # Trigger matched but no content — ask the user what to save.
            ack_empty = "Ne kaydetmemi istedigini anlayamadim."
            try:
                ack_empty = _mp_chat.ack_reply_empty(message)
            except Exception:
                pass
            timer.mark("memory_save_shortcut_empty")
            timer.flush()
            return _quick_response(request_id, user_id, ack_empty, "memory", t_start)
        # Persist to Memory Plane (best-effort; no-op when flag is off).
        saved_meta = None
        try:
            saved_meta = _mp_chat.save_explicit(
                user_id=    str(req.user_id),
                content=    fact,
                kind=       _save_cmd.get("kind", "fact"),
                project_id= req.project_id,
            )
        except Exception:
            pass
        # Dual-write to legacy memory_service so existing UIs that read
        # the legacy store still see the save. Best-effort; non-blocking.
        try:
            from backend.services.memory_service import save_memory
            save_memory(user_id, fact, "preference" if _save_cmd.get("kind") == "preference" else "general")
        except Exception:
            pass
        ack = "Kaydettim."
        try:
            ack = _mp_chat.ack_reply(message, fact=fact)
        except Exception:
            pass
        logger.info(
            "CHAT | rid=%s | uid=%s | memory_save_explicit | mp_id=%s | kind=%s",
            request_id, user_id,
            (saved_meta or {}).get("id"),
            (saved_meta or {}).get("kind", _save_cmd.get("kind", "fact")),
        )
        timer.mark("memory_save_shortcut")
        timer.flush()
        return _quick_response(request_id, user_id, ack, "memory", t_start)

    # Legacy Turkish-only triggers — kept as a back-stop for any phrasing
    # the new matcher might miss. Same behaviour as the original chat.py.
    _mem_save = [
        "bunu hatirla:", "bunu hatırla:", "hatirla:",
        "hafizana kaydet:", "aklinda tut:", "not al:",
    ]
    for trigger in _mem_save:
        if message.lower().startswith(trigger):
            fact = message[len(trigger):].strip()
            if fact and len(fact) >= 3:
                try:
                    from backend.services.memory_service import save_memory
                    save_memory(user_id, fact, "general")
                except Exception:
                    pass
                # Also dual-write to memory_plane.
                try:
                    from backend.services.memory_plane import chat_integration as _mp_chat
                    _mp_chat.save_explicit(
                        user_id=str(req.user_id), content=fact,
                        kind="fact", project_id=req.project_id,
                    )
                except Exception:
                    pass
                timer.mark("memory_save_shortcut")
                timer.flush()
                return _quick_response(request_id, user_id, "Kaydettim.", "memory", t_start)
            timer.mark("memory_save_shortcut_empty")
            timer.flush()
            return _quick_response(
                request_id, user_id,
                "Ne kaydetmemi istedigini anlayamadim.", "memory", t_start,
            )

    # ── Memory delete shortcut ────────────────────────────────────────────
    if message.lower().startswith("unut:"):
        keyword = message[5:].strip()
        if keyword:
            try:
                from backend.services.memory_service import delete_memory
                delete_memory(user_id, keyword)
            except Exception:
                pass
        timer.mark("memory_delete_shortcut")
        timer.flush()
        return _quick_response(request_id, user_id, "Silindi.", "memory", t_start)

    # ── Style shortcut ────────────────────────────────────────────────────
    try:
        from backend.services.memory_service import detect_style, apply_style
        style_match = detect_style(message)
        if style_match:
            apply_style(user_id, message)
            timer.mark("style_shortcut")
            timer.flush()
            return _quick_response(
                request_id, user_id,
                "Stil guncellendi: " + style_match["label"], "style", t_start,
            )
    except Exception:
        pass
    timer.mark("shortcuts_done")

    # ── Usage limit check ─────────────────────────────────────────────────
    can_send = True
    try:
        from backend.services.user_service import check_and_count, get_limit_info
        can_send, _ = check_and_count(user_id)
    except Exception:
        pass

    if not can_send:
        info = {"used": 0, "limit": 20}
        try:
            from backend.services.user_service import get_limit_info
            info = get_limit_info(user_id)
        except Exception:
            pass
        reply = (
            "Gunluk ucretsiz limitin doldu. Premium ile sinirsiz kullanabilirsin.\n\n"
            "Bugun kullandin: " + str(info["used"]) + " / " + str(info["limit"]) + " mesaj\n"
            "/premium yazarak detay alabilirsin."
        )
        timer.mark("limit_exceeded")
        timer.flush()
        return _quick_response(
            request_id, user_id, reply, "limit_exceeded", t_start,
            remaining=0, premium=False, with_profile=False,
        )
    timer.mark("limit_check")

    # ── Auto-learn ────────────────────────────────────────────────────────
    try:
        from backend.services.memory_service import maybe_auto_learn
        maybe_auto_learn(user_id, message)
    except Exception:
        pass
    # Phase 6 — Memory Plane auto-extraction. Runs the heuristic
    # extractor on the user message and persists any candidates with
    # importance-scored, project-scoped, dedup-folded semantics.
    # No-op when ENABLE_MEMORY_PLANE is off. Never raises.
    try:
        from backend.services.memory_plane import chat_integration as _mp_chat
        _mp_extracted = _mp_chat.auto_extract(
            user_id=str(req.user_id), message=message, project_id=req.project_id,
        )
        if _mp_extracted:
            logger.info(
                "CHAT | rid=%s | uid=%s | mp_auto_extract | n=%d | kinds=%s",
                request_id, user_id, len(_mp_extracted),
                ",".join(sorted({m["kind"] for m in _mp_extracted})),
            )
    except Exception:
        pass
    timer.mark("auto_learn")

    # ── Build context ─────────────────────────────────────────────────────
    profile_text = ""
    history = []
    mem_summary = ""
    style_prompt = ""
    try:
        from backend.services.user_service import get_text_profile, get_history
        from backend.services.memory_service import get_summary, get_style
        profile_text = get_text_profile()
        history = get_history(user_id, 10)
        mem_summary = get_summary(user_id) or ""
        style_data = get_style(user_id)
        style_prompt = "Cevap stili: " + style_data["label"] + ". Talimat: " + style_data["instruction"]
    except Exception as e:
        logger.warning("CHAT | rid=%s | context build error: %s", request_id, e)
    # Additive: fold an optional language preference into the existing
    # style_prompt seam (no ai_service change; default None → unchanged).
    style_prompt = _with_language(style_prompt, req.language)
    # Phase 6 — fold the Memory Plane context block (top-N relevant
    # memories, importance + recency ranked) into `mem_summary` so it
    # reaches every system-prompt assembly path (`_build_system` AND
    # `build_system_prompt`) without touching any other module.
    # No-op when ENABLE_MEMORY_PLANE is off (empty block prepended →
    # mem_summary returned unchanged). The current user message is
    # used as the query so retrieval prefers memories relevant to
    # what the user just said.
    try:
        from backend.services.memory_plane import chat_integration as _mp_chat
        mem_summary = _mp_chat.fold_into_mem_summary(
            mem_summary,
            user_id=    str(req.user_id),
            project_id= req.project_id,
            query=      message,
            limit=      5,
        )
    except Exception as e:
        logger.warning("CHAT | rid=%s | memory_plane context fold error: %s", request_id, e)
    timer.mark("context_built")

    # ── AI call ───────────────────────────────────────────────────────────
    reply = ""
    intent = "normal_chat"
    model = "gpt-4o-mini"
    prov = "openai"
    mode = "chat"
    followups: List[str] = []
    response_metadata: Optional[Dict[str, Any]] = None

    timer.mark("ai_start")

    # ── Phase 2 — Project Context injection ──────────────────────────────
    # If the request carries a project_id AND ENABLE_PROJECTS is on,
    # push a "Project Context" block into a ContextVar so ask_ai()
    # downstream can prepend it to the system prompt. Wrapped in
    # try/finally so the ContextVar is always reset even if process_chat
    # raises — prevents cross-request leakage.
    _project_ctx_token = None
    _project_id_for_meta: Optional[str] = None
    try:
        if req.project_id:
            try:
                from backend.services.projects.context import (
                    build_project_context_block,
                    set_current_project_context,
                )
                _block = build_project_context_block(req.project_id)
                if _block:
                    _project_ctx_token = set_current_project_context(_block)
                    _project_id_for_meta = req.project_id
                    logger.info(
                        "CHAT | rid=%s | project_context_injected | project_id=%s | block_chars=%d",
                        request_id, req.project_id, len(_block),
                    )
            except Exception as _pe:
                logger.debug(
                    "CHAT | rid=%s | project_context skipped (%s)",
                    request_id, _pe,
                )
    except Exception:
        pass

    try:
        from backend.services.ai_service import process_chat
        ai_result = await process_chat(
            user_id=str(user_id),
            message=message,
            platform=platform,
            profile=profile_text,
            history=history,
            mem_summary=mem_summary,
            style_prompt=style_prompt,
            mode=req.mode,
        )
        reply = ai_result.get("reply", "")
        intent = ai_result.get("intent", "normal_chat")
        model = ai_result.get("model", "gpt-4o-mini")
        prov = ai_result.get("provider", "openai")
        mode = ai_result.get("mode", "chat")
        followups = ai_result.get("followups", [])
        response_metadata = ai_result.get("metadata")
    except Exception as e:
        logger.error("CHAT | rid=%s | process_chat error: %s", request_id, e, exc_info=True)
    finally:
        if _project_ctx_token is not None:
            try:
                from backend.services.projects.context import reset_current_project_context
                reset_current_project_context(_project_ctx_token)
            except Exception:
                pass
    timer.mark("ai_end")

    # Surface the project_id in the response metadata so the frontend
    # can confirm context injection happened (useful for debugging and
    # for a future "context used" indicator in the UI).
    if _project_id_for_meta:
        response_metadata = dict(response_metadata or {})
        response_metadata["project_id"] = _project_id_for_meta

    if not reply:
        reply = "Bir hata olustu, lutfen tekrar dene."

    # ── Record usage ──────────────────────────────────────────────────────
    # Three sync DB writes that don't need to complete before we hand the
    # reply back to the user. When ENABLE_BACKGROUND_TASKS=true, they go
    # through the queue and the route returns ~15-45ms earlier (measure in
    # CHAT_TIMING logs as `usage_recorded` dropping from 10-30ms to <1ms).
    # When the flag is off, they run inline as before — byte-identical to
    # the pre-Phase-4b behaviour.
    try:
        from backend.services.user_service import record_usage, save_message
        from backend.services.tasks import enqueue
        # enqueue() returns False when the queue is disabled — fall back
        # to sync execution so the writes still happen. Each call is
        # independently best-effort; one failure doesn't skip the others.
        if not enqueue(record_usage, user_id, name="record_usage"):
            record_usage(user_id)
        if not enqueue(save_message, "user", message, name="save_message_user"):
            save_message("user", message)
        if not enqueue(save_message, "assistant", reply, name="save_message_assistant"):
            save_message("assistant", reply)
    except Exception:
        pass
    timer.mark("usage_recorded")

    # ── Profile / remaining ───────────────────────────────────────────────
    remaining = -1
    premium = False
    try:
        from backend.services.user_service import get_profile
        prof = get_profile(user_id)
        remaining = prof.get("remaining_messages", -1)
        premium = prof.get("premium", False)
    except Exception:
        pass
    timer.mark("profile_lookup")

    elapsed_ms = int((time.monotonic() - t_start) * 1000)
    logger.info(
        "CHAT | rid=%s | intent=%s | model=%s | mode=%s | ms=%d",
        request_id, intent, model, mode, elapsed_ms,
    )
    # Emit the structured stage timeline as a single log line. Operators
    # grep `CHAT_TIMING` in Railway logs to find the actual bottleneck
    # without parsing the per-line prose summary above.
    timer.flush()

    return ChatResponse(
        reply=reply,
        intent=intent,
        model=model,
        provider=prov,
        mode=mode,
        memory_used=bool(mem_summary),
        remaining_messages=remaining,
        premium=premium,
        response_time_ms=elapsed_ms,
        request_id=request_id,
        suggested_followups=followups if followups else None,
        metadata=response_metadata,
    )


def _quick_response(
    request_id: str,
    user_id: int,
    reply: str,
    intent: str,
    t_start: float,
    remaining: int = -1,
    premium: bool = False,
    *,
    with_profile: bool = True,
) -> ChatResponse:
    """Build a fast shortcut response without going through AI.

    Args:
      with_profile: when False, skip the get_profile() DB lookup. Set
                    this for paths where remaining/premium are already
                    known (safety rejections, limit-exceeded) — saves
                    one DB read per request (5-15ms locally, more under
                    contention).
    """
    elapsed_ms = int((time.monotonic() - t_start) * 1000)
    if with_profile:
        try:
            from backend.services.user_service import get_profile
            prof = get_profile(user_id)
            remaining = prof.get("remaining_messages", remaining)
            premium = prof.get("premium", premium)
        except Exception:
            pass
    return ChatResponse(
        reply=reply,
        intent=intent,
        model="none",
        provider="none",
        mode=intent,
        memory_used=False,
        remaining_messages=remaining,
        premium=premium,
        response_time_ms=elapsed_ms,
        request_id=request_id,
        suggested_followups=None,
    )
