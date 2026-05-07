# coding: utf-8
import logging
from fastapi import APIRouter, Depends, HTTPException, status

from backend.models.schemas import ChatRequest, ChatResponse, ErrorResponse
from backend.core.security import verify_api_key
from backend.core.logging import Timer, new_request_id, log_request, log_response, log_error
from backend.services.ai_service import process_chat
from backend.services.user_service import (
    check_and_count, record_usage, save_message,
    get_history, get_text_profile, get_profile,
)
from backend.services.memory_service import (
    get_summary, get_style, maybe_auto_learn, detect_style, apply_style,
)

router = APIRouter(tags=["chat"])
logger = logging.getLogger(__name__)

_MEM_LIST_KW = [
    "ne hatirliyorsun", "ne hatırlıyorsun", "ne kaydettin",
    "ne biliyorsun", "hafizanda ne var",
]
_MEM_SAVE_TRIGGERS = [
    "bunu hatirla:", "bunu hatırla:", "hatirla:",
    "hafizana kaydet:", "aklinda tut:", "not al:",
]


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    _auth=Depends(verify_api_key),
):
    request_id = new_request_id()
    user_id    = int(req.user_id) if req.user_id.isdigit() else hash(req.user_id) % 2**31
    message    = req.message.strip()
    platform   = req.platform or "web"

    with Timer() as t:
        try:
            # --- Memory list shortcut ---
            if any(kw in message.lower() for kw in _MEM_LIST_KW):
                summary = get_summary(user_id)
                reply   = ("Hafizamda bunlar var:\n\n" + summary) if summary else "Henuz bir sey kaydetmedim."
                return _build_response(request_id, user_id, reply, "memory", "gpt-4o-mini", "openai", "memory", t)

            # --- Memory save shortcut ---
            for trigger in _MEM_SAVE_TRIGGERS:
                if message.lower().startswith(trigger):
                    fact = message[len(trigger):].strip()
                    if fact and len(fact) >= 3:
                        from backend.services.memory_service import save_memory
                        save_memory(user_id, fact, "general")
                        return _build_response(request_id, user_id, "Kaydettim.", "memory", "none", "none", "memory", t)
                    return _build_response(request_id, user_id, "Ne kaydetmemi istedigini anlayamadim.", "memory", "none", "none", "memory", t)

            # --- Style detection shortcut ---
            style_match = detect_style(message)
            if style_match:
                apply_style(user_id, message)
                return _build_response(request_id, user_id, "Anlasıldı, stil guncellendi: " + style_match["label"], "style", "none", "none", "style", t)

            # --- Usage limit check ---
            can_send, remaining = check_and_count(user_id)
            if not can_send:
                from usage_limits import FREE_DAILY_LIMIT as LIM, get_daily_usage
                used = get_daily_usage(user_id)
                return ChatResponse(
                    reply="Gunluk ucretsiz limitin doldu. Premium ile sinirsiz kullanabilirsin.",
                    intent="limit_exceeded",
                    model="none",
                    provider="none",
                    mode="system",
                    memory_used=False,
                    remaining_messages=0,
                    premium=False,
                    response_time_ms=0,
                    request_id=request_id,
                )

            # --- Auto learn ---
            maybe_auto_learn(user_id, message)

            # --- Build context ---
            profile    = get_text_profile()
            history    = get_history(10)
            mem_summary = get_summary(user_id)
            style_data  = get_style(user_id)
            style_prompt = "Cevap stili: " + style_data["label"] + ". Talimat: " + style_data["instruction"]

            # --- AI processing ---
            ai_result = await process_chat(
                user_id=str(user_id),
                message=message,
                platform=platform,
                profile=profile,
                history=history,
                mem_summary=mem_summary,
                style_prompt=style_prompt,
            )

            reply  = ai_result["reply"]
            intent = ai_result["intent"]
            model  = ai_result["model"]
            prov   = ai_result["provider"]
            mode   = ai_result["mode"]

            # --- Record usage and history ---
            record_usage(user_id)
            save_message("user", message)
            save_message("assistant", reply)

            log_request(request_id, user_id, platform, intent, model, mode)
            log_response(request_id, user_id, t.elapsed_ms, len(reply))

            from backend.services.user_service import get_profile as gp
            prof = gp(user_id)

            return ChatResponse(
                reply=reply,
                intent=intent,
                model=model,
                provider=prov,
                mode=mode,
                memory_used=bool(mem_summary),
                remaining_messages=prof["remaining_messages"],
                premium=prof["premium"],
                response_time_ms=t.elapsed_ms,
                request_id=request_id,
            )

        except Exception as e:
            log_error(request_id, user_id, e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error": "ai_error",
                    "message": "Bir hata olustu, lutfen tekrar dene.",
                    "request_id": request_id,
                },
            )


def _build_response(request_id, user_id, reply, intent, model, provider, mode, timer):
    from backend.services.user_service import get_profile as gp
    try:
        prof = gp(user_id)
        remaining = prof["remaining_messages"]
        premium   = prof["premium"]
    except Exception:
        remaining = -1
        premium   = False
    return ChatResponse(
        reply=reply,
        intent=intent,
        model=model,
        provider=provider,
        mode=mode,
        memory_used=False,
        remaining_messages=remaining,
        premium=premium,
        response_time_ms=timer.elapsed_ms,
        request_id=request_id,
    )
