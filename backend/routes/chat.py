# coding: utf-8
import time
import logging
import uuid
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter(tags=["chat"])
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    user_id: str
    message: str
    chat_id: Optional[str] = None
    platform: Optional[str] = "web"
    session_id: Optional[str] = None
    # Optional AI mode — recognized values: fast, deep_think, startup_advisor,
    # marketing_dropshipping, trading_analyst, coding, study, research.
    # Legacy aliases (e.g. "chat", "finance", "ecommerce") are also accepted.
    # Omit or send null to use automatic intent-based routing (default behaviour).
    mode: Optional[str] = None


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


def _uid(raw: str) -> int:
    """Normalize user_id string to a stable integer."""
    return int(raw) if raw.isdigit() else hash(raw) % 2**31


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    request_id = str(uuid.uuid4())[:8]
    t_start = time.monotonic()
    user_id = _uid(req.user_id)
    message = req.message.strip()
    platform = req.platform or "web"

    logger.info("CHAT | rid=%s | uid=%s | msg_len=%d", request_id, user_id, len(message))

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
        return _quick_response(request_id, user_id, reply, "memory", t_start)

    # ── Memory save shortcut ──────────────────────────────────────────────
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
                return _quick_response(request_id, user_id, "Kaydettim.", "memory", t_start)
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
        return _quick_response(request_id, user_id, "Silindi.", "memory", t_start)

    # ── Style shortcut ────────────────────────────────────────────────────
    try:
        from backend.services.memory_service import detect_style, apply_style
        style_match = detect_style(message)
        if style_match:
            apply_style(user_id, message)
            return _quick_response(
                request_id, user_id,
                "Stil guncellendi: " + style_match["label"], "style", t_start,
            )
    except Exception:
        pass

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
        return _quick_response(
            request_id, user_id, reply, "limit_exceeded", t_start,
            remaining=0, premium=False,
        )

    # ── Auto-learn ────────────────────────────────────────────────────────
    try:
        from backend.services.memory_service import maybe_auto_learn
        maybe_auto_learn(user_id, message)
    except Exception:
        pass

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

    # ── AI call ───────────────────────────────────────────────────────────
    reply = ""
    intent = "normal_chat"
    model = "gpt-4o-mini"
    prov = "openai"
    mode = "chat"
    followups: List[str] = []

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
    except Exception as e:
        logger.error("CHAT | rid=%s | process_chat error: %s", request_id, e, exc_info=True)

    if not reply:
        reply = "Bir hata olustu, lutfen tekrar dene."

    # ── Record usage ──────────────────────────────────────────────────────
    try:
        from backend.services.user_service import record_usage, save_message
        record_usage(user_id)
        save_message("user", message)
        save_message("assistant", reply)
    except Exception:
        pass

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

    elapsed_ms = int((time.monotonic() - t_start) * 1000)
    logger.info(
        "CHAT | rid=%s | intent=%s | model=%s | mode=%s | ms=%d",
        request_id, intent, model, mode, elapsed_ms,
    )

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
    )


def _quick_response(
    request_id: str,
    user_id: int,
    reply: str,
    intent: str,
    t_start: float,
    remaining: int = -1,
    premium: bool = False,
) -> ChatResponse:
    """Build a fast shortcut response without going through AI."""
    elapsed_ms = int((time.monotonic() - t_start) * 1000)
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
