# coding: utf-8
"""
/v2/chat/stream — Server-Sent Events streaming chat (Phase 4a +
Phase 6 memory integration).

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

Request body matches the provider layer's ProviderRequest shape, with
Phase-6 additions:

  {
    "messages":    [{"role":"user","content":"hi"}],
    "user_id":     "korvix_user_id from localStorage",  // Phase 6
    "project_id":  "optional workspace id",             // Phase 6
    "model":       "gpt-4o-mini",
    "provider":    "openai",
    "mode":        "trading_analyst",
    "temperature": 0.7,
    "max_tokens":  null
  }

Phase 6 Memory Plane integration — happens BEFORE the SSE stream opens:

  1. Identify the caller. Prefer JWT (Authorization: Bearer) so an
     authenticated user always overrides body-supplied user_id. Falls
     back to body user_id (the legacy /chat-compatible id), then to
     a synthetic "anonymous" id that gets no memory.

  2. Explicit save detection on the last user message. If the user
     said "remember this: X", "hafızana kaydet: X" etc., we
     short-circuit the LLM call entirely and emit a 3-frame SSE
     sequence (ready / token / done) carrying the ack reply. Saves
     latency + tokens for a deterministic operation.

  3. Auto-extraction on the last user message — same hook /chat uses.

  4. System-prompt injection. We compose a system message containing
     the Memory Plane context block (top-N relevant memories, ranked
     by importance + recency + query overlap) and prepend it to the
     messages array sent to the provider. If the body already
     contained a `role: system` message at position 0, we MERGE the
     memory context into it instead of duplicating.

Validation errors return a JSON envelope (not SSE) — by the time we
return SSE we've already committed to the stream contract.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import AsyncIterator, List, Optional

from fastapi import APIRouter, HTTPException, Request
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
    # Phase 6 — identity field. Optional so legacy callers still work;
    # when present, used to scope memory reads/writes (same id space as
    # /chat's `user_id`). Authorization: Bearer JWT overrides this when
    # present (Phase 3 identity wins over body claims).
    user_id:     Optional[str]   = Field(default=None, max_length=128)
    # Phase 6 — project (workspace) scope for memory.
    project_id:  Optional[str]   = Field(default=None, max_length=64)
    model:       Optional[str]   = Field(default=None,    max_length=128)
    # Phase 6b: provider is now optional. When omitted and a `mode` is
    # supplied, the router selects based on the flag table. When neither
    # is supplied, defaults to "openai" — byte-identical to pre-routing.
    provider:    Optional[str]   = Field(default=None, max_length=64)
    mode:        Optional[str]   = Field(default=None, max_length=32)
    temperature: float           = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens:  Optional[int]   = Field(default=None, ge=1, le=32_000)
    # Phase 9 — assets attached to this turn. The route fetches each
    # asset (ownership-checked via the user_id namespace), reads the
    # cached vision analysis when present, and folds a compact
    # asset-context block into the system prompt BEFORE the LLM call.
    # When ENABLE_ASSET_SYSTEM is off or the list is empty, this is
    # a zero-cost no-op.
    asset_ids:   Optional[List[str]] = Field(default=None, max_length=20)


# ── Identity resolution ──────────────────────────────────────────────────────

def _resolve_user_id(request: Request, body_user_id: Optional[str]) -> tuple[str, str]:
    """Return (user_id, source) where source ∈ {"jwt","body","anonymous"}.

    Identity-first precedence — JWT-derived `User.id` always wins over
    body-supplied user_id so an authenticated user can't be impersonated
    via a forged body field. This is the SAME contract Phase 6 / 7
    relied on; do NOT widen it to dual-namespace reads (that's a
    cross-user leak vector — see test_jwt_overrides_body_user_id).
    """
    # 1) Try the AuthMiddleware-populated state (Phase 3 — only when
    #    ENABLE_AUTH_V2 is on). request.state.user is a `User` dataclass
    #    or absent.
    try:
        user = getattr(request.state, "user", None)
        if user is not None and getattr(user, "id", None) and not getattr(user, "is_guest", True):
            return str(user.id), "jwt"
    except Exception:
        pass
    # 2) Direct Authorization header parse — covers the case where
    #    AuthMiddleware isn't installed but the frontend still sends a
    #    Bearer token. We don't VERIFY the token here (that's the
    #    middleware's job); we just extract the `sub` claim and use it
    #    as a stable identity. This is intentionally lenient — an
    #    unverified JWT identity is still a stable per-user id and the
    #    blast radius is one user's memory namespace.
    try:
        auth = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth and auth.lower().startswith("bearer "):
            token = auth.split(None, 1)[1].strip()
            import base64
            parts = token.split(".")
            if len(parts) >= 2:
                pad = "=" * (-len(parts[1]) % 4)
                payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
                sub = payload.get("sub")
                if isinstance(sub, str) and sub:
                    return sub, "jwt"
    except Exception:
        pass
    # 3) Body-supplied user_id (matches legacy /chat).
    if body_user_id and body_user_id.strip():
        return body_user_id.strip(), "body"
    # 4) Synthetic — no memory will be retrieved.
    return "anonymous", "anonymous"


# ── Explicit-save SSE short-circuit ──────────────────────────────────────────

def _shortcut_save_stream(ack: str, provider_name: str) -> AsyncIterator[str]:
    """Emit a 3-frame SSE sequence carrying an immediate ack reply.

    Used when the user message is an explicit save command — we want
    the chat UI to show the confirmation INSTANTLY rather than waiting
    for an LLM round-trip. The shape matches the regular stream so
    the frontend's existing SSE handler renders it without changes.
    """
    async def _gen() -> AsyncIterator[str]:
        yield sse_event("ready", {"provider": provider_name, "model": "korvix-memory"})
        yield sse_event("token", {"delta": ack})
        yield sse_event("done", {
            "finish_reason": "stop",
            "model":         "korvix-memory",
            "usage": {"prompt_tokens": 0, "completion_tokens": len(ack),
                      "total_tokens": len(ack)},
        })
    return _gen()


# ── Route ─────────────────────────────────────────────────────────────────

@router.post("/stream")
async def stream_chat(body: StreamChatRequest, request: Request):
    """Stream a chat-completion as Server-Sent Events.

    Phase 6 integration — see module docstring for the full pipeline.
    """
    t_start = time.monotonic()

    # ── Identity resolution ───────────────────────────────────────────────
    user_id, id_source = _resolve_user_id(request, body.user_id)

    # ── Last user message (the one we run save/extract/retrieve against) ──
    last_user_msg: Optional[str] = None
    for m in reversed(body.messages):
        if m.role == "user":
            last_user_msg = (m.content or "").strip()
            break

    # ── Provider selection (unchanged from pre-Phase-6) ───────────────────
    if body.provider is not None:
        provider_name = body.provider
        routing_reason = "explicit_provider"
        routing_mode   = body.mode or "(none)"
    else:
        selection = select_provider(body.mode)
        provider_name = selection.provider
        routing_reason = selection.reason
        routing_mode   = selection.mode

    logger.info(
        "stream_chat.routing | mode=%s | provider=%s | reason=%s | uid=%s | id_src=%s",
        routing_mode, provider_name, routing_reason, user_id, id_source,
        extra={
            "mode":           routing_mode,
            "routed_to":      provider_name,
            "routing_reason": routing_reason,
            "user_id":        user_id,
            "id_source":      id_source,
        },
    )

    # ═══════════════════════════════════════════════════════════════════════
    # Phase 6 Memory Plane — runs BEFORE the SSE stream opens.
    # Wrapped in a broad try/except: a memory failure must NEVER prevent
    # the chat from streaming a reply.
    # ═══════════════════════════════════════════════════════════════════════
    mp_path = "off"           # "off" | "shortcut" | "context_injected" | "no_memory"
    mp_hits = 0
    mp_extracted = 0
    mp_saved_id: Optional[str] = None
    mp_system_prompt: Optional[str] = None

    try:
        from backend.services.memory_plane import chat_integration as mp_chat
        from backend.services.memory_plane import client as _mp_client
        mp_enabled = _mp_client.is_enabled()

        if not mp_enabled:
            mp_path = "off"
        elif user_id == "anonymous" or not last_user_msg:
            mp_path = "no_memory"
        else:
            # 1) Explicit save command — short-circuit ONLY if the save
            #    actually persisted. If save_explicit returns None (memory
            #    plane errored mid-call, validation failed, etc.) we DO
            #    NOT emit a fake "Kaydettim." ack — instead we fall through
            #    to the regular LLM stream so the user sees an honest
            #    response. Matches the spec: "no fake 'saved' responses
            #    if persistence failed".
            save_cmd = mp_chat.is_explicit_save_command(last_user_msg)
            if save_cmd is not None:
                fact = (save_cmd.get("fact") or "").strip()
                if not fact:
                    # Trigger matched but no content — clarification ack
                    # is honest (we're not claiming to save anything).
                    ack = mp_chat.ack_reply_empty(last_user_msg)
                    mp_path = "shortcut_empty"
                    logger.info(
                        "stream_chat.memory | path=%s | uid=%s | id_src=%s | "
                        "elapsed_ms=%d",
                        mp_path, user_id, id_source,
                        int((time.monotonic() - t_start) * 1000),
                    )
                    return sse_response(_shortcut_save_stream(ack, provider_name))
                # Persistence attempt.
                saved = mp_chat.save_explicit(
                    user_id=    user_id,
                    content=    fact,
                    kind=       save_cmd.get("kind", "fact"),
                    project_id= body.project_id,
                )
                mp_saved_id = (saved or {}).get("id") if saved else None
                if mp_saved_id:
                    # SUCCESS — dual-write to legacy memory_service so
                    # existing /memory UI keeps showing the row, then
                    # short-circuit with a HONEST ack (we did save it).
                    try:
                        from backend.services.memory_service import save_memory
                        uid_int = int(user_id) if user_id.isdigit() else hash(user_id) % 2**31
                        save_memory(uid_int, fact,
                                    "preference" if save_cmd.get("kind") == "preference" else "general")
                    except Exception:
                        pass
                    ack = mp_chat.ack_reply(last_user_msg, fact=fact)
                    mp_path = "shortcut_saved"
                    logger.info(
                        "stream_chat.memory | path=%s | uid=%s | id_src=%s | "
                        "mp_id=%s | fact_len=%d | elapsed_ms=%d",
                        mp_path, user_id, id_source, mp_saved_id, len(fact),
                        int((time.monotonic() - t_start) * 1000),
                    )
                    return sse_response(_shortcut_save_stream(ack, provider_name))
                # FAILURE path — save returned None. Log loudly and FALL
                # THROUGH to the regular LLM stream. The user will see
                # the LLM's natural response; we do NOT lie about saving.
                mp_path = "shortcut_save_failed"
                logger.warning(
                    "stream_chat.memory | path=shortcut_save_failed | uid=%s | "
                    "id_src=%s | fact_len=%d | reason=memory_plane_returned_none",
                    user_id, id_source, len(fact),
                )
                # Continue to the auto-extract + retrieval phases below
                # (don't return). The user gets a real LLM response.

            # 2) Auto-extract on the last user message (non-blocking).
            try:
                extracted = mp_chat.auto_extract(
                    user_id= user_id, message= last_user_msg,
                    project_id= body.project_id,
                )
                mp_extracted = len(extracted)
            except Exception:
                mp_extracted = 0

            # 3) Build the system prompt (memory context + mode hint).
            mp_system_prompt = mp_chat.build_stream_system_prompt(
                user_id=    user_id,
                project_id= body.project_id,
                query=      last_user_msg,
                mode=       body.mode,
                limit=      8,
            )
            mp_hits = mp_chat.memory_hit_count(
                user_id=    user_id,
                project_id= body.project_id,
                query=      last_user_msg,
                limit=      8,
            )
            # Phase 9 — fold attached assets into the system prompt.
            # The block is bounded (~1600 chars) and ownership-checked
            # by assets_client.list_by_ids. No-op when ENABLE_ASSET_SYSTEM
            # is off OR none of the ids belong to this user.
            asset_block: Optional[str] = None
            if body.asset_ids:
                asset_block = mp_chat.build_asset_context_block(
                    user_id=   user_id,
                    asset_ids= body.asset_ids,
                )
                if asset_block:
                    if mp_system_prompt:
                        mp_system_prompt = f"{mp_system_prompt}\n\n{asset_block}"
                    else:
                        mp_system_prompt = asset_block
            mp_path = "context_injected" if mp_system_prompt else "no_memory"
    except Exception as e:
        logger.warning("stream_chat.memory_plane integration error: %s", e)
        # Continue — memory failure must not block chat.

    # Always log the memory path even when off so production logs show
    # exactly which mode each request used.
    logger.info(
        "stream_chat.memory | path=%s | uid=%s | id_src=%s | hits=%d | "
        "extracted=%d | sys_prompt_chars=%d",
        mp_path, user_id, id_source, mp_hits, mp_extracted,
        len(mp_system_prompt or ""),
    )

    # ── Provider resolution ───────────────────────────────────────────────
    try:
        provider = get_provider(provider_name)
    except ProviderUnavailableError:
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

    # ── Compose the final messages array ──────────────────────────────────
    # If we have a memory-aware system prompt, fold it in. Two cases:
    #   a) The body already has a `role: system` message at position 0 —
    #      merge by appending the memory block. Caller's intent is
    #      preserved; memory acts as additional context.
    #   b) No system message — prepend a new one. The model sees memory
    #      context BEFORE any user turn, which is the standard pattern.
    final_msgs: List[ProviderMessage] = []
    if mp_system_prompt:
        first = body.messages[0] if body.messages else None
        if first is not None and first.role == "system":
            merged = f"{first.content.strip()}\n\n{mp_system_prompt}"
            final_msgs.append(ProviderMessage(role="system", content=merged))
            final_msgs.extend(
                ProviderMessage(role=m.role, content=m.content)
                for m in body.messages[1:]
            )
        else:
            final_msgs.append(ProviderMessage(role="system", content=mp_system_prompt))
            final_msgs.extend(
                ProviderMessage(role=m.role, content=m.content)
                for m in body.messages
            )
    else:
        final_msgs = [
            ProviderMessage(role=m.role, content=m.content)
            for m in body.messages
        ]

    # Debug log of the actual system prompt when explicitly requested
    # via env var (production opt-in — DON'T leak by default).
    if os.getenv("ENABLE_MEMORY_DEBUG_LOGS", "false").strip().lower() == "true":
        if mp_system_prompt:
            logger.info(
                "stream_chat.memory.system_prompt | uid=%s | content=%s",
                user_id, mp_system_prompt[:1200],
            )

    pr_request = ProviderRequest(
        messages=    final_msgs,
        model=       body.model or provider.default_model,
        temperature= body.temperature,
        max_tokens=  body.max_tokens,
        timeout_s=   30.0,
    )

    async def event_stream() -> AsyncIterator[str]:
        """Translate ProviderStreamEvent → SSE frames."""
        try:
            async for event in provider.stream_chat_completion(pr_request):
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
            logger.exception("stream_chat unexpected exception")
            yield sse_event("error", {
                "code":    "INTERNAL_ERROR",
                "message": str(exc)[:300],
                "provider": provider.name,
            })

    return sse_response(event_stream())


__all__ = ["router"]
