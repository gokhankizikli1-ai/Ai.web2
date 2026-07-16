# coding: utf-8
import time
import logging
import uuid
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
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
    # i18n — the user's raw language choice ("auto" | "en" | "tr" | …) and,
    # in Auto mode, the front-end's best-effort detection of THIS message's
    # language. Used to enforce the answer-language policy. Additive &
    # backward-compatible: omit/null → existing behaviour.
    language_mode: Optional[str] = None
    message_language: Optional[str] = None
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

    # ── Specialized builder modes bypass ALL chat shortcuts ───────────────
    # Modes like game_developer / website_builder / startup_advisor /
    # frontend_builder carry rich structured prompts (e.g. a "[GAME BUILD
    # REQUEST]" or "[FRONTEND BUILDER REQUEST]" block). The lightweight
    # memory/style shortcuts below exist for NORMAL chat only. If one of them
    # fires on a builder request it HIJACKS the whole request and returns a
    # one-liner instead of the build — the live bug where a Game Build came
    # back as "Stil guncellendi: Short" (the style shortcut matched a word in
    # the idea and short-circuited the AI pipeline). For these modes we skip
    # every shortcut and go straight to the mode pipeline, which resolves to the
    # correct specialized persona.
    normalized_mode = (req.mode or "").strip().lower()
    _SPECIALIZED_BUILDER_MODES = {
        "game_developer", "website_builder", "startup_advisor",
        "marketing_dropshipping", "trading_analyst", "coding",
        "frontend_builder", "visual_intelligence",
    }
    _is_specialized_builder = (
        normalized_mode in _SPECIALIZED_BUILDER_MODES
        or message.startswith("[GAME BUILD REQUEST]")
    )
    # Phase 12B.1 — the dedicated Frontend Builder is fully isolated: a structured
    # safety path, no memory extraction, and no chat-history persistence.
    # Phase 13E.1 — the website_builder mode is ALSO a structured builder: its /chat
    # request is a machine-generated planning envelope, not ordinary chat. Both structured
    # builders take a dedicated structured safety path and skip memory auto-learning; the
    # website path is selected ONLY by the explicit canonical mode (never by content).
    _is_frontend_builder = normalized_mode == "frontend_builder"
    _is_website_builder = normalized_mode == "website_builder"
    # Phase 14K.7 — the Visual Intelligence planner is ALSO a structured builder: its
    # /chat request is a machine-generated envelope with untrusted JSON input, not chat.
    _is_visual_intelligence = normalized_mode == "visual_intelligence"
    _is_structured_builder = _is_frontend_builder or _is_website_builder or _is_visual_intelligence
    if _is_specialized_builder:
        logger.info(
            "CHAT | rid=%s | uid=%s | specialized_builder | mode=%s | shortcuts_bypassed",
            request_id, user_id, (req.mode or "?"),
        )

    # Per-stage timer — emits one structured log line at flush() with the
    # full per-stage timeline. Read these in production logs to find the
    # actual bottleneck (safety/context/AI/usage). Negligible overhead.
    timer = StageTimer("CHAT_TIMING", rid=request_id, uid=user_id, msg_len=len(message))

    logger.info("CHAT | rid=%s | uid=%s | msg_len=%d", request_id, user_id, len(message))

    # ── Phase 5.2 — safety guard (runs before any quota / AI call) ────────
    # Returns a fast, branded rejection if length / injection / throttle hit.
    # Never crashes the request — failures here log and fall through.
    try:
        from backend.services.safety.guard import (
            check_message,
            check_structured_builder_message,
            check_structured_website_builder_message,
            check_visual_intelligence_message,
        )
        if _is_frontend_builder:
            # Structured transport: validate the frontend-files envelope + structured
            # size cap + throttle, and DO NOT run the generic injection regex over the
            # JSON spec (its quoted user/research content is intentionally untrusted data).
            _safety = check_structured_builder_message(str(user_id), message)
        elif _is_visual_intelligence:
            # Phase 14K.7 — the Visual Intelligence envelope is its OWN structured transport
            # (`[VISUAL INTELLIGENCE REQUEST]`, not the frontend-files envelope). It gets a
            # dedicated bounded cap + envelope validation + throttle, and skips the generic
            # injection regex over its sanitized machine-generated website-context payload.
            _safety = check_visual_intelligence_message(str(user_id), message)
        elif _is_website_builder:
            # Phase 13E.1 — the website planning envelope gets its OWN structured safety
            # path (bounded website cap + envelope validation + throttle), never the
            # generic 4k cap that was rejecting every fresh Web Build with `safety_length`.
            _safety = check_structured_website_builder_message(str(user_id), message)
        else:
            _safety = check_message(str(user_id), message)
        if not _safety.allowed:
            logger.info(
                "CHAT | rid=%s | uid=%s | safety_reject | code=%s | reason=%s | req_chars=%s | limit=%s",
                request_id, user_id, _safety.code, _safety.reason,
                _safety.request_char_count, _safety.limit_char_count,
            )
            timer.mark("safety_reject")
            timer.flush()
            # Phase 13E.1 — for a structured builder, attach bounded safety metadata so the
            # frontend classifies the rejection BEFORE its planning parser (never parses the
            # Turkish safety sentence as a site plan, never launches a strict repair). Numbers
            # + codes only: no request body, no idea, no sources, no auth/token, no stack.
            _safety_meta = None
            if _is_structured_builder:
                _safety_meta = {
                    "safety": {
                        "status": "rejected",
                        "code": _safety.code or "blocked",
                        "reason": (_safety.reason or "")[:160],
                        "request_char_count": (
                            _safety.request_char_count
                            if _safety.request_char_count is not None else len(message)
                        ),
                        "limit_char_count": _safety.limit_char_count,
                        "structured_mode": normalized_mode,
                    }
                }
            return _quick_response(
                request_id, user_id,
                _safety.message_for_user or "İstek reddedildi.",
                "safety_" + (_safety.code or "blocked"),
                t_start,
                with_profile=False,    # rejections don't need a fresh profile lookup
                metadata=_safety_meta,
            )
    except Exception as _serr:
        logger.debug("CHAT | rid=%s | safety guard import/eval error: %s", request_id, _serr)
    timer.mark("safety_done")

    # ── Memory list shortcut ──────────────────────────────────────────────
    _mem_list_kw = [
        "ne hatirliyorsun", "ne hatırlıyorsun", "ne kaydettin",
        "ne biliyorsun", "hafizanda ne var",
    ]
    if not _is_specialized_builder and any(kw in message.lower() for kw in _mem_list_kw):
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
        _save_cmd = None if _is_specialized_builder else _mp_chat.is_explicit_save_command(message)
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
        if not _is_specialized_builder and message.lower().startswith(trigger):
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
    if not _is_specialized_builder and message.lower().startswith("unut:"):
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
    # NOTE: guarded by `_is_specialized_builder` — this is the shortcut that
    # hijacked Game Builder (matched a word in the idea → "Stil guncellendi").
    try:
        from backend.services.memory_service import detect_style, apply_style
        style_match = None if _is_specialized_builder else detect_style(message)
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
    # Phase 12B.1 / 13E.1 — skipped for BOTH structured builders: the serialized frontend
    # specification and the generated website planning envelope are implementation
    # transport, not personal facts to memorize. Normal chat memory is unchanged.
    if not _is_structured_builder:
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
            locale=req.language,
            language_mode=req.language_mode,
            message_language=req.message_language,
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
        # Phase 12B.1 / 14K.7 — usage still counts, but the frontend_builder and
        # visual_intelligence structured requests + replies are NOT persisted into
        # ordinary chat history (they are implementation data, not conversation).
        if not _is_frontend_builder and not _is_visual_intelligence:
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
    metadata: Optional[Dict[str, Any]] = None,
) -> ChatResponse:
    """Build a fast shortcut response without going through AI.

    Args:
      with_profile: when False, skip the get_profile() DB lookup. Set
                    this for paths where remaining/premium are already
                    known (safety rejections, limit-exceeded) — saves
                    one DB read per request (5-15ms locally, more under
                    contention).
      metadata:     optional additive response metadata (Phase 13E.1 — bounded
                    structured-builder safety envelope). Default None → older
                    callers are byte-identical.
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
        metadata=metadata,
    )


# ── Phase 13F.1 — authenticated Background Responses poll + cancel ────────────────────
# These endpoints let the browser drive a long-running full-source frontend generation that
# runs as an OpenAI Background Response. They NEVER consume a message/credit, write chat
# history, or run memory/research/planning/safety parsing — they only resolve the
# authoritative user, verify opaque-job ownership, and retrieve/cancel the SAME OpenAI
# Response. The raw OpenAI response id is never returned to the browser. A missing job or an
# ownership mismatch both return 404 so another user's job existence is never revealed.

def _bg_exec_response(reply: str, ai_execution: dict, *, status_code: int = 200) -> JSONResponse:
    """A /chat-shaped JSON body the frontend background poller already understands."""
    return JSONResponse(status_code=status_code, content={
        "reply": reply,
        "intent": "frontend_builder",
        "mode": "frontend_builder",
        "model": ai_execution.get("model") or "none",
        "provider": ai_execution.get("provider") or "none",
        "request_id": None,
        "metadata": {"ai_execution": ai_execution},
    })


@router.get("/v2/ai/background/{job_id}")
async def background_poll(job_id: str, request: Request):
    """Retrieve the status/output of an opaque background frontend job for its owner."""
    uid = str(_uid(_resolve_authoritative_uid(request, "")))
    try:
        from backend.services.ai_background_responses import load_job, owns_job, delete_job
        from ai_client import retrieve_openai_background_structured
    except Exception:
        return _bg_exec_response("", {"status": "failed", "endpoint": "responses",
                                      "background_mode": True, "error_kind": "background-unavailable"}, status_code=503)

    record = await load_job(job_id)
    if not owns_job(record, uid):
        # Missing OR not owned → identical 404 (no existence disclosure); NO OpenAI retrieve.
        logger.info("CHAT | bg_poll | job=%s | uid=%s | not_found_or_forbidden", (job_id or "")[:14], uid)
        return _bg_exec_response("", {"status": "failed", "endpoint": "responses",
                                      "background_mode": True, "background_job_id": job_id,
                                      "error_kind": "background-job-missing"}, status_code=404)

    resp_id = record.get("openai_response_id")
    task_kind = record.get("task_kind")
    configured_max = record.get("configured_max_output_tokens") or 0
    res = await retrieve_openai_background_structured(resp_id, "frontend " + str(task_kind))
    provider_rid_prefix = (res.request_id or "")[:10]
    logger.info(
        "CHAT | bg_poll | job=%s | uid=%s | kind=%s | status=%s | ms=%d | in=%s | out=%s | reason=%s | partial=%s | prid=%s",
        (job_id or "")[:14], uid, task_kind, res.execution_status, res.latency_ms,
        res.input_tokens, res.output_tokens, res.error_code, res.partial_output_char_count, provider_rid_prefix,
    )

    # Non-terminal — keep the job and tell the client to keep polling.
    if (not res.ok) and res.execution_status in ("queued", "in_progress"):
        return _bg_exec_response("", {
            "status": res.execution_status, "endpoint": "responses", "model": res.model,
            "provider": res.provider, "request_id": None, "fallback_used": False,
            "background_mode": True, "background_job_id": job_id, "background_task_kind": task_kind,
            "poll_after_ms": 2500, "store_required": True,
            "background_store_available": True, "background_store_status": "available",
            "configured_max_output_tokens": int(configured_max),
        })

    # Terminal — delete the job record after building the response (idempotent enough: a
    # repeated poll returns 404 → the client already has the terminal result). RAW OpenAI
    # response id is NEVER included (request_id stays null). Bounded numeric usage only.
    await delete_job(job_id)
    _md = {
        "status": "succeeded" if res.ok else res.execution_status,
        "endpoint": res.endpoint, "model": res.model, "provider": res.provider,
        "request_id": None, "latency_ms": res.latency_ms, "fallback_used": res.fallback_used,
        "background_mode": True, "background_task_kind": task_kind,
        "background_terminal_status": ("completed" if res.ok else res.execution_status),
        "store_required": True,
        "background_store_available": True, "background_store_status": "available",
        "configured_max_output_tokens": int(configured_max),
    }
    for _k in ("input_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "partial_output_char_count"):
        _v = getattr(res, _k, None)
        if _v is not None:
            _md[_k] = int(_v)
    if not res.ok:
        _md["error_kind"]    = res.error_kind
        _md["error_code"]    = res.error_code
        _md["error_message"] = res.error_message
    return _bg_exec_response(res.text if res.ok else "", _md)


@router.post("/v2/ai/background/{job_id}/cancel")
async def background_cancel(job_id: str, request: Request):
    """Best-effort, idempotent cancel of an opaque background frontend job for its owner."""
    uid = str(_uid(_resolve_authoritative_uid(request, "")))
    try:
        from backend.services.ai_background_responses import load_job, owns_job, delete_job
        from ai_client import cancel_openai_background_response
    except Exception:
        return JSONResponse(status_code=200, content={"status": "cancelled"})

    record = await load_job(job_id)
    if owns_job(record, uid):
        try:
            await cancel_openai_background_response(record.get("openai_response_id"))
        except Exception:
            pass
        await delete_job(job_id)
        logger.info("CHAT | bg_cancel | job=%s | uid=%s | kind=%s | cancelled", (job_id or "")[:14], uid, record.get("task_kind"))
    else:
        # Idempotent + no disclosure: same response whether missing or not owned; NO OpenAI cancel.
        logger.info("CHAT | bg_cancel | job=%s | uid=%s | not_found_or_forbidden", (job_id or "")[:14], uid)
    return JSONResponse(status_code=200, content={"status": "cancelled"})
