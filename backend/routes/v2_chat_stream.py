# coding: utf-8
"""
/v2/chat/stream — Server-Sent Events streaming chat (Phase 4a).

This is the FIRST consumer of the Phase-B provider layer. Legacy /chat
keeps its current shape; this is a parallel endpoint frontends adopt
when they want token-by-token UX.

Wire protocol (SSE):

  event: ready
  data: {"provider":"openai","model":"gpt-4o-mini"}

  event: token
  data: {"delta":"Hel"}

  event: token
  data: {"delta":"lo"}

  event: done
  data: {"finish_reason":"stop","usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12},"model":"gpt-4o-mini"}

On error the stream terminates with an `error` frame INSTEAD of a `done`
frame. The HTTP status is always 200 (the connection succeeded); the
error event carries the code/message:

  event: error
  data: {"code":"PROVIDER_AUTH","message":"OpenAI rejected our credentials.","provider":"openai"}

Request body matches the provider layer's ProviderRequest shape, not
the legacy /chat body. Frontends call /v2/chat/stream with:

  {
    "messages": [{"role":"user","content":"hi"}],
    "model":       "gpt-4o-mini",   // optional, defaults to provider default
    "provider":    "openai",         // optional, defaults to "openai"
    "temperature": 0.7,              // optional
    "max_tokens":  null              // optional
  }

Validation errors return a JSON envelope (not SSE) — by the time we
return SSE we've already committed to the stream contract.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.providers import (
    get_provider,
    ProviderUnavailableError,
    select_provider,
)
from backend.services.providers.streaming import (
    ProviderStreamDone,
    ProviderStreamError,
    ProviderStreamStart,
    ProviderStreamToken,
)
from backend.services.providers.types import ProviderMessage, ProviderRequest
from backend.utils.sse import sse_event, sse_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/chat", tags=["chat-stream"])


# ── Request model ────────────────────────────────────────────────────────

class StreamMessage(BaseModel):
    role:    str = Field(..., pattern="^(system|user|assistant)$")
    content: str = Field(..., min_length=1, max_length=64_000)


class StreamChatRequest(BaseModel):
    messages:    List[StreamMessage] = Field(..., min_length=1, max_length=200)
    model:       Optional[str]   = Field(default=None,    max_length=128)
    # Phase 6b: provider is now optional. When omitted and a `mode` is
    # supplied, the router selects based on the flag table. When neither
    # is supplied, defaults to "openai" — byte-identical to pre-routing.
    provider:    Optional[str]   = Field(default=None, max_length=64)
    mode:        Optional[str]   = Field(default=None, max_length=32)
    temperature: float           = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens:  Optional[int]   = Field(default=None, ge=1, le=32_000)


# ── Route ─────────────────────────────────────────────────────────────────

@router.post("/stream")
async def stream_chat(body: StreamChatRequest):
    """Stream a chat-completion as Server-Sent Events.

    Provider selection precedence:
      1. Explicit `provider` field in the body (e.g. "anthropic"). The
         legacy contract — used by tests and by frontends that want
         deterministic routing.
      2. Router-resolved provider when `mode` is supplied. The router
         consults the routing-flag table; modes whose flags are off
         fall back to the default provider (openai).
      3. Default provider ("openai") when neither is supplied. This is
         the byte-identical-to-pre-routing path.

    Validation errors return 400 with a regular JSON envelope.
    Once the SSE stream begins, every outcome (success or upstream
    failure) is communicated via a terminal `done` or `error` event.
    """
    # Decide which provider name to resolve.
    if body.provider:
        provider_name = body.provider
        routing_reason = "explicit_provider"
        routing_mode   = body.mode or "(none)"
    else:
        selection = select_provider(body.mode)
        provider_name = selection.provider
        routing_reason = selection.reason
        routing_mode   = selection.mode

    logger.info(
        "stream_chat.routing | mode=%s | provider=%s | reason=%s",
        routing_mode, provider_name, routing_reason,
        extra={
            "mode":            routing_mode,
            "routed_to":       provider_name,
            "routing_reason":  routing_reason,
        },
    )

    try:
        provider = get_provider(provider_name)
    except ProviderUnavailableError:
        # Surface as a regular 400 — the user (or the router) picked a
        # provider that isn't registered. Happens for placeholders
        # (google / deepseek) until their SDK lands.
        raise HTTPException(
            status_code=400,
            detail={
                "code":     "PROVIDER_NOT_REGISTERED",
                "provider": provider_name,
                "mode":     routing_mode,
                "reason":   routing_reason,
            },
        )

    if not provider.supports_streaming:
        raise HTTPException(
            status_code=400,
            detail={
                "code":     "PROVIDER_NO_STREAMING",
                "provider": provider.name,
                "message":  f"Provider {provider.name!r} does not implement streaming.",
            },
        )

    request = ProviderRequest(
        messages=    [ProviderMessage(role=m.role, content=m.content) for m in body.messages],
        model=       body.model or provider.default_model,
        temperature= body.temperature,
        max_tokens=  body.max_tokens,
        timeout_s=   30.0,
    )

    async def event_stream() -> AsyncIterator[str]:
        """Translate ProviderStreamEvent → SSE frames."""
        try:
            async for event in provider.stream_chat_completion(request):
                if isinstance(event, ProviderStreamStart):
                    yield sse_event("ready", {"provider": event.provider, "model": event.model})
                elif isinstance(event, ProviderStreamToken):
                    yield sse_event("token", {"delta": event.delta})
                elif isinstance(event, ProviderStreamDone):
                    yield sse_event("done", {
                        "finish_reason": event.finish_reason,
                        "model":         event.model,
                        "usage": {
                            "prompt_tokens":     event.usage.prompt_tokens,
                            "completion_tokens": event.usage.completion_tokens,
                            "total_tokens":      event.usage.total_tokens,
                        },
                    })
                    return
                elif isinstance(event, ProviderStreamError):
                    yield sse_event("error", {
                        "code":     event.code,
                        "message":  event.message,
                        "provider": event.provider,
                    })
                    return
        except Exception as exc:
            # Defensive — provider should never raise across yields, but
            # if it does, surface as a terminal error frame so the
            # client doesn't hang waiting for done/error.
            logger.exception("stream_chat unexpected exception")
            yield sse_event("error", {
                "code":    "INTERNAL_ERROR",
                "message": str(exc)[:300],
                "provider": provider.name,
            })

    return sse_response(event_stream())


__all__ = ["router"]
