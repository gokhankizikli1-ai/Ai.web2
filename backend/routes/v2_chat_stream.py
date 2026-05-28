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

import asyncio
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

    # ── Phase 9 vision — fold uploaded images into the LAST user turn ─────
    # When the model supports vision and the request carries image-typed
    # assets, transform the most-recent user message's content into a
    # provider-shaped multimodal list (text block + image blocks). If
    # the model does NOT support vision, the system prompt's "Attached
    # assets" descriptor (built above) is the only signal, and we
    # surface a one-shot WARNING via an SSE comment so the UI can show
    # "This model does not support image analysis." without breaking
    # the stream contract.
    vision_warning: Optional[str] = None
    if body.asset_ids:
        try:
            from backend.services.memory_plane import chat_integration as _mp_chat
            if provider.model_supports_vision(body.model or provider.default_model):
                # Find the index of the most-recent user message in
                # final_msgs and rewrite its content into a multimodal list.
                target_idx: Optional[int] = None
                for i in range(len(final_msgs) - 1, -1, -1):
                    if final_msgs[i].role == "user":
                        target_idx = i
                        break
                if target_idx is not None:
                    base_text = final_msgs[target_idx].content
                    if isinstance(base_text, list):
                        # Shouldn't happen — body only ever supplies str —
                        # but guard defensively. Coerce by joining text
                        # blocks so the vision builder has a clean string.
                        base_text = " ".join(
                            str(b.get("text", "")) for b in base_text
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    new_content, vision_debug = _mp_chat.build_multimodal_user_content(
                        user_id=       user_id,
                        asset_ids=     body.asset_ids,
                        base_text=     str(base_text or ""),
                        provider_name= provider.name,
                    )
                    final_msgs[target_idx] = ProviderMessage(
                        role="user", content=new_content,
                    )
                    logger.info(
                        "stream_chat.vision | uid=%s | provider=%s | model=%s | "
                        "image_blocks=%d | skipped_mime=%d | skipped_size=%d | "
                        "skipped_bytes=%d",
                        user_id, provider.name,
                        body.model or provider.default_model,
                        vision_debug["image_blocks"],
                        vision_debug["skipped_unsupported_mime"],
                        vision_debug["skipped_too_large"],
                        vision_debug["skipped_no_bytes"],
                    )
                    if vision_debug["image_blocks"] == 0 and any(
                        # User attached images but every single one was
                        # filtered out. Warn instead of pretending.
                        True for _ in body.asset_ids
                    ):
                        # Only warn if filter rejected actual images
                        # (skipped_unsupported_mime counts non-image
                        # assets like PDFs, which are not vision blocks
                        # by design — not an error).
                        if (vision_debug["skipped_too_large"]
                                or vision_debug["skipped_no_bytes"]):
                            vision_warning = (
                                "One or more attached images could not be "
                                "processed (too large or unreadable). The "
                                "assistant will reply based on text only."
                            )
            else:
                # Model has no vision capability. Only surface the warning
                # if at least one attached asset is ACTUALLY an image —
                # PDFs / docs / videos don't need vision and the system
                # prompt descriptor is sufficient for them.
                has_image_asset = False
                try:
                    from backend.services.assets import client as _ac
                    owned = _ac.list_by_ids(user_id, list(body.asset_ids)) or []
                    has_image_asset = any(
                        (a.mime_type or "").lower().startswith("image/")
                        for a in owned
                    )
                except Exception:
                    has_image_asset = False
                if has_image_asset:
                    vision_warning = (
                        "This model does not support image analysis. The "
                        "assistant can see the file name and size, but not "
                        "the image contents."
                    )
                    logger.info(
                        "stream_chat.vision | uid=%s | provider=%s | model=%s | "
                        "image_blocks=0 | reason=model_not_vision_capable",
                        user_id, provider.name,
                        body.model or provider.default_model,
                    )
        except Exception as exc:
            # A vision-pipeline failure must NEVER block the stream.
            # Drop back to the text-only descriptor path and log loudly.
            logger.warning(
                "stream_chat.vision integration error: %s", exc,
                exc_info=True,
            )

    # Debug log of the actual system prompt when explicitly requested
    # via env var (production opt-in — DON'T leak by default).
    if os.getenv("ENABLE_MEMORY_DEBUG_LOGS", "false").strip().lower() == "true":
        if mp_system_prompt:
            logger.info(
                "stream_chat.memory.system_prompt | uid=%s | content=%s",
                user_id, mp_system_prompt[:1200],
            )

    # ── Phase 10 fix — detect GitHub URLs in the last user message ─────────
    #
    # When a github.com URL is present AND ENABLE_GITHUB_TOOL is on, we
    # run the github_repo tool BEFORE the LLM stream opens and fold the
    # result into the system prompt as a "Repository inspection" block.
    # The actual fetch happens INSIDE event_stream() so the FE gets
    # tool.started / tool.completed SSE events while we wait — without
    # those, the user would see a 6-8s blank screen.
    #
    # Detection is synchronous (regex, microseconds); execution is
    # deferred to the generator.
    github_refs: list = []
    web_urls: list = []
    web_search_intent = None  # populated below when the helper signals it
    try:
        from backend.services.tool_extraction import (
            extract_github_refs as _extract_gh,
            extract_web_urls as _extract_web,
            detect_web_search_intent as _detect_search,
        )
        from backend.services.tools.tool_registry import is_enabled as _tool_enabled
        # [ROUTER] visibility — log which auto-call paths are eligible
        # so an ops review can see the live flag state per request
        # without poking around in os.environ on Railway.
        _gh_on  = _tool_enabled("github_repo")
        _br_on  = _tool_enabled("browser_fetch")
        _wr_on  = _tool_enabled("web_research")
        logger.info(
            "[ROUTER] uid=%s | github_repo=%s | browser_fetch=%s | web_research=%s",
            user_id, _gh_on, _br_on, _wr_on,
        )
        if last_user_msg:
            if _gh_on:
                github_refs = _extract_gh(last_user_msg)
            # Phase 11 — non-GitHub URLs go through browser_fetch.
            # The extractor explicitly skips github.com / raw.gh hosts
            # so we never double-fetch.
            if _br_on:
                web_urls = _extract_web(last_user_msg)
            # Phase 11 fix — intent-based web search for prompts that
            # need current information but don't paste a URL ("latest
            # NVIDIA news", "compare universities", "internetten
            # araştır"). Only when the tool is enabled AND no URL was
            # pasted (the URL paths already produce real context, so
            # an extra search would be wasteful).
            if _wr_on and not github_refs and not web_urls:
                intent = _detect_search(last_user_msg)
                if intent.triggered:
                    web_search_intent = intent
                    logger.info(
                        "stream_chat.web_search.intent | uid=%s | "
                        "confidence=%.2f | triggers=%s | reason=%s",
                        user_id, intent.confidence,
                        ",".join(intent.triggers), intent.reason,
                    )
                else:
                    logger.debug(
                        "[INTENT] no fire | uid=%s | confidence=%.2f | "
                        "reason=%s",
                        user_id, intent.confidence, intent.reason,
                    )
    except Exception as _url_exc:
        logger.debug("stream_chat.url detection failed: %s", _url_exc)
        github_refs = []
        web_urls = []
        web_search_intent = None

    # Owner debug — gate the raw payload exposure on a confirmed-owner
    # session. Non-owners never see raw GitHub API payloads or full
    # page bodies in the SSE stream, even when ENABLE_TOOLS_RUNTIME is on.
    owner_debug = False
    if github_refs or web_urls or web_search_intent:
        try:
            from backend.services.admin.owner import is_owner as _is_owner
            owner_user = getattr(request.state, "user", None)
            owner_debug = bool(owner_user is not None and _is_owner(owner_user))
        except Exception:
            owner_debug = False

    pr_request = ProviderRequest(
        messages=    final_msgs,
        model=       body.model or provider.default_model,
        temperature= body.temperature,
        max_tokens=  body.max_tokens,
        timeout_s=   30.0,
    )

    async def event_stream() -> AsyncIterator[str]:
        """Translate ProviderStreamEvent → SSE frames."""
        # Phase 9 vision — surface a one-shot warning BEFORE the
        # provider stream opens so the UI can render a banner without
        # waiting for tokens. The `warning` event is additive (not part
        # of the existing ready/token/done/error contract) — old
        # clients ignore it; the new useChat handler can match on it.
        if vision_warning:
            yield sse_event("warning", {
                "code":    "VISION_UNAVAILABLE",
                "message": vision_warning,
            })

        # Phase 11 final — `effective_pr_request` starts equal to
        # `pr_request`; subsequent steps (github, browser, web_search,
        # capability note) all augment in-place.
        effective_pr_request = pr_request

        # Phase 11 hang-fix — overall pre-LLM orchestration budget.
        # If the combined cost of every tool call exceeds this ceiling
        # we SKIP any remaining flows and stream the LLM response with
        # whatever context we already injected. Prevents the "Bir
        # dakikanızı alacak…" infinite hang the user reported on
        # production: even if every individual tool hits its own
        # timeout, the cumulative pre-stream pause must not exceed
        # this wall clock.
        import time as _time
        _budget_t0 = _time.monotonic()
        _ORCHESTRATION_BUDGET_SECONDS = 25.0
        def _budget_remaining() -> float:
            return _ORCHESTRATION_BUDGET_SECONDS - (_time.monotonic() - _budget_t0)
        def _budget_exhausted() -> bool:
            return _budget_remaining() <= 0.5  # 500 ms safety floor

        # ── Phase 11 final — defense-in-depth tool-capability note ─────
        #
        # Production observation: even with intent-based auto-invocation
        # (PR #137) and honest "search-attempted" framing on failure
        # (PR #138), some prompt phrasings still slip past the
        # classifier AND trigger the LLM's reflex to refuse with
        # "I cannot access the internet" / "İnternetten gerçek zamanlı
        # bilgi arayamıyorum". This block adds an UNCONDITIONAL system
        # note when web_research / browser_fetch / github_repo are
        # enabled — the model is explicitly told NOT to refuse on
        # capability grounds. Costs ~600 chars per request but
        # eliminates the bad-fallback failure mode entirely.
        try:
            from backend.services.tools.tool_registry import is_enabled as _tool_on
            tool_capabilities = []
            if _tool_on("web_research"):  tool_capabilities.append("web_research")
            if _tool_on("browser_fetch"): tool_capabilities.append("browser_fetch")
            if _tool_on("github_repo"):   tool_capabilities.append("github_repo")
        except Exception:
            tool_capabilities = []
        if tool_capabilities:
            cap_note = (
                "═══════════════════════════════════════════════════════════════\n"
                "KORVIX TOOLS — CAPABILITIES YOU HAVE — DO NOT REFUSE THEM\n"
                "═══════════════════════════════════════════════════════════════\n"
                "I (KorvixAI) currently have these tools wired into the chat: "
                + ", ".join(tool_capabilities) + ".\n\n"
                "If the user asks for ANYTHING that needs current information "
                "or external sources (latest news, company / startup / "
                "competitor research, university / product comparison, "
                "pricing, web pages, GitHub repos, AI tools market scan, "
                "industry trends, etc.) the system has ALREADY tried to "
                "auto-invoke the right tool BEFORE this prompt reached you. "
                "If you see a 'KORVIX … TOOL OUTPUT' block above, use it as "
                "ground truth. If you see a 'TOOL ATTEMPTED, NO RESULTS' "
                "block, acknowledge the specific failure reason.\n\n"
                "DO NOT — under any circumstances — answer with phrases like:\n"
                "  • \"I cannot access the internet\"\n"
                "  • \"I don't have access to current information\"\n"
                "  • \"İnternetten gerçek zamanlı bilgi arayamıyorum\"\n"
                "  • \"As of my training cutoff…\" used as a refusal\n"
                "These statements are FACTUALLY WRONG when these tools are "
                "wired in. If you genuinely have no fetched data for this "
                "turn AND no failure block, give your best pre-training "
                "answer with a clear cutoff caveat — but be honest that the "
                "tool COULD have run and offer to re-try.\n\n"
                "Reply in the user's language."
            )
            # Inject as the first system message (above the memory header
            # if present). This ordering matters — putting the capability
            # note BEFORE the memory rules makes the model treat tool
            # availability as a foundational fact, not a follow-up
            # instruction it can override.
            cap_msgs: list = []
            first_role = effective_pr_request.messages[0].role if effective_pr_request.messages else None
            base = list(effective_pr_request.messages)
            if first_role == "system":
                existing = base[0].content
                if isinstance(existing, list):
                    existing = "\n".join(
                        str(b.get("text", "")) for b in existing
                        if isinstance(b, dict) and b.get("type") == "text"
                    )
                merged = f"{cap_note}\n\n{(existing or '').strip()}"
                cap_msgs.append(ProviderMessage(role="system", content=merged))
                cap_msgs.extend(base[1:])
            else:
                cap_msgs.append(ProviderMessage(role="system", content=cap_note))
                cap_msgs.extend(base)
            effective_pr_request = ProviderRequest(
                messages=    cap_msgs,
                model=       effective_pr_request.model,
                temperature= effective_pr_request.temperature,
                max_tokens=  effective_pr_request.max_tokens,
                timeout_s=   effective_pr_request.timeout_s,
                extra=       effective_pr_request.extra,
            )
            logger.debug(
                "[CAPABILITY] uid=%s | tools=%s | cap_note_chars=%d",
                user_id, ",".join(tool_capabilities), len(cap_note),
            )

        # ── Phase 10 fix — auto-invoke GitHub tool when URLs detected ─
        #
        # The user pasted github.com/owner/repo. Run the tool now,
        # streaming progress events to the FE so they see "Analyzing
        # repository …" instead of a blank wait. Rebuild final_msgs +
        # pr_request in-place so the provider gets the augmented
        # system prompt.
        # (`effective_pr_request` was already initialised at the
        # top of event_stream — the capability-note block may have
        # augmented it.)
        if github_refs and not _budget_exhausted():
            # 1) Emit tool.started — one event per ref so the FE can
            #    render a chip per repo.
            for ref in github_refs:
                yield sse_event("tool.started", {
                    "tool_id":     "github_repo",
                    "input_summary": f"repo: {ref.full_name}",
                    "provider":    "github",
                })
            # 2) Run the tool with full execution-log instrumentation.
            try:
                from backend.services.tool_extraction import build_github_context_block
                tool_block, raw_payloads = await build_github_context_block(
                    user_id=        user_id,
                    text=           last_user_msg or "",
                    project_id=     body.project_id,
                    owner_debug=    owner_debug,
                )
            except Exception as exc:
                logger.warning("stream_chat.github_url execution failed: %s", exc)
                tool_block = None
                raw_payloads = []

            # 3) Emit tool.completed with a small summary.
            #
            # `succeeded` reflects whether ANY repo was actually
            # inspected (data returned). A block built from "could
            # not inspect" stubs is still emitted to keep the LLM
            # honest, but `succeeded` stays False so the FE chip
            # can render the rate-limit / failure state.
            inspected_count = sum(1 for p in (raw_payloads or [])
                                  if p.get("inspected") is True)
            yield sse_event("tool.completed", {
                "tool_id":   "github_repo",
                "repos":     [r.full_name for r in github_refs],
                "succeeded": inspected_count > 0,
                "inspected": inspected_count,
                "block_chars": len(tool_block or ""),
            })

            # 4) Owner debug — expose raw payloads only when the
            #    caller is a confirmed project owner.
            if owner_debug and raw_payloads:
                yield sse_event("tool.debug", {
                    "tool_id":  "github_repo",
                    "payloads": raw_payloads,
                })

            # 5) Rebuild final_msgs with the tool block folded in.
            #
            # Inject in TWO places for resilience against model
            # refusal patterns. Observed in production: GPT-4o
            # sometimes ignores a tool block placed only in the
            # system prompt and falls back to "I cannot directly
            # inspect GitHub repositories…". Injecting the same
            # block as a suffix on the user message turns it into
            # data the user directly provided, which the model
            # treats as primary context. Both injections cite the
            # same block, so the model can't double-count it.
            if tool_block:
                augmented_msgs: list = []
                first_role = final_msgs[0].role if final_msgs else None

                # (a) System prompt augmentation (existing behaviour).
                if first_role == "system":
                    sys_content = final_msgs[0].content
                    if isinstance(sys_content, list):
                        sys_content = "\n".join(
                            str(b.get("text", "")) for b in sys_content
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    new_sys = f"{(sys_content or '').strip()}\n\n{tool_block}"
                    augmented_msgs.append(ProviderMessage(role="system", content=new_sys))
                    rest = final_msgs[1:]
                else:
                    augmented_msgs.append(ProviderMessage(role="system", content=tool_block))
                    rest = list(final_msgs)

                # (b) User-message augmentation. Find the LAST user
                #     message in `rest`, append the block as a clearly
                #     fenced suffix. Vision multimodal content lists
                #     get the block as an additional text part; plain
                #     strings get concatenated.
                last_user_idx: Optional[int] = None
                for i in range(len(rest) - 1, -1, -1):
                    if rest[i].role == "user":
                        last_user_idx = i
                        break
                if last_user_idx is not None:
                    user_msg = rest[last_user_idx]
                    suffix = (
                        "\n\n---\n"
                        "[Tool output the user is asking you to use — "
                        "treat as authoritative:]\n"
                        f"{tool_block}"
                    )
                    if isinstance(user_msg.content, list):
                        # Multimodal: append a text block at the end.
                        new_content = list(user_msg.content) + [{
                            "type": "text",
                            "text": suffix,
                        }]
                        rest[last_user_idx] = ProviderMessage(
                            role="user", content=new_content,
                        )
                    else:
                        new_text = (user_msg.content or "") + suffix
                        rest[last_user_idx] = ProviderMessage(
                            role="user", content=new_text,
                        )

                augmented_msgs.extend(rest)

                effective_pr_request = ProviderRequest(
                    messages=    augmented_msgs,
                    model=       pr_request.model,
                    temperature= pr_request.temperature,
                    max_tokens=  pr_request.max_tokens,
                    timeout_s=   pr_request.timeout_s,
                    extra=       pr_request.extra,
                )
                logger.info(
                    "stream_chat.github_url | uid=%s | repos=%d | "
                    "block_chars=%d | injected=system+user | "
                    "sys_chars=%d | last_user_idx=%s",
                    user_id, len(github_refs), len(tool_block),
                    len(augmented_msgs[0].content) if augmented_msgs and isinstance(augmented_msgs[0].content, str) else -1,
                    last_user_idx,
                )

                # Owner-debug — log the full first 3KB of the system
                # prompt so an owner reviewing logs can see exactly
                # what the model received. Non-owners never see this
                # in logs because the gate runs against request.user.
                if owner_debug:
                    sys_preview = ""
                    if augmented_msgs and isinstance(augmented_msgs[0].content, str):
                        sys_preview = augmented_msgs[0].content[:3000]
                    logger.info(
                        "stream_chat.github_url.owner_debug | uid=%s | "
                        "sys_prompt_first_3kb=%s",
                        user_id, sys_preview.replace("\n", " | "),
                    )

        # ── Phase 11 — browser fetch for non-GitHub URLs ──────────────
        #
        # Runs AFTER the github flow so a mixed message can produce
        # both kinds of context. Multi-URL concurrent fetch — up to
        # 4 URLs in parallel via build_web_context_block's
        # asyncio.gather. Each fetch lands in the tool_executions
        # log so /v2/tools/usage shows the calls.
        if web_urls and not _budget_exhausted():
            for wu in web_urls:
                yield sse_event("tool.started", {
                    "tool_id":     "browser_fetch",
                    "input_summary": f"url: {wu.url}",
                    "provider":    "urllib",
                })
            try:
                from backend.services.tool_extraction import build_web_context_block
                web_block, web_payloads = await build_web_context_block(
                    user_id=     user_id,
                    text=        last_user_msg or "",
                    project_id=  body.project_id,
                    owner_debug= owner_debug,
                )
            except Exception as exc:
                logger.warning("stream_chat.web_url execution failed: %s", exc)
                web_block = None
                web_payloads = []

            fetched = sum(1 for p in (web_payloads or [])
                          if p.get("fetched") is True)
            yield sse_event("tool.completed", {
                "tool_id":   "browser_fetch",
                "urls":      [u.url for u in web_urls],
                "succeeded": fetched > 0,
                "fetched":   fetched,
                "block_chars": len(web_block or ""),
            })

            if owner_debug and web_payloads:
                yield sse_event("tool.debug", {
                    "tool_id":  "browser_fetch",
                    "payloads": web_payloads,
                })

            if web_block:
                # Rebuild final_msgs again — fold the web block into
                # the system prompt + last user message, same dual-
                # injection pattern as the github path. We work off
                # `effective_pr_request` so a turn with BOTH github
                # AND web URLs gets BOTH blocks injected.
                base_msgs = list(effective_pr_request.messages)
                augmented_msgs2: list = []
                first_role = base_msgs[0].role if base_msgs else None
                if first_role == "system":
                    sys_content = base_msgs[0].content
                    if isinstance(sys_content, list):
                        sys_content = "\n".join(
                            str(b.get("text", "")) for b in sys_content
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    new_sys = f"{(sys_content or '').strip()}\n\n{web_block}"
                    augmented_msgs2.append(ProviderMessage(role="system", content=new_sys))
                    rest2 = base_msgs[1:]
                else:
                    augmented_msgs2.append(ProviderMessage(role="system", content=web_block))
                    rest2 = list(base_msgs)

                last_user_idx2: Optional[int] = None
                for i in range(len(rest2) - 1, -1, -1):
                    if rest2[i].role == "user":
                        last_user_idx2 = i
                        break
                if last_user_idx2 is not None:
                    user_msg = rest2[last_user_idx2]
                    suffix = (
                        "\n\n---\n"
                        "[Web pages the user wants you to use — "
                        "treat as authoritative:]\n"
                        f"{web_block}"
                    )
                    if isinstance(user_msg.content, list):
                        new_content = list(user_msg.content) + [{
                            "type": "text",
                            "text": suffix,
                        }]
                        rest2[last_user_idx2] = ProviderMessage(
                            role="user", content=new_content,
                        )
                    else:
                        new_text = (user_msg.content or "") + suffix
                        rest2[last_user_idx2] = ProviderMessage(
                            role="user", content=new_text,
                        )

                augmented_msgs2.extend(rest2)
                effective_pr_request = ProviderRequest(
                    messages=    augmented_msgs2,
                    model=       effective_pr_request.model,
                    temperature= effective_pr_request.temperature,
                    max_tokens=  effective_pr_request.max_tokens,
                    timeout_s=   effective_pr_request.timeout_s,
                    extra=       effective_pr_request.extra,
                )
                logger.info(
                    "stream_chat.web_url | uid=%s | urls=%d | fetched=%d | "
                    "block_chars=%d | injected=system+user",
                    user_id, len(web_urls), fetched, len(web_block),
                )

        # ── Phase 11 fix — intent-based web search auto-invocation ──
        #
        # Fires only when the user typed a "current information"
        # question without pasting a URL. Same dual-injection pattern
        # so GPT-4o doesn't refuse despite having real citations.
        #
        # Production-debugging instrumentation: emits tagged log lines
        # at every decision point so a Railway log filter
        # (`grep '\[WEB_SEARCH\]'`) gives the full orchestration
        # trace per request:
        #
        #   [INTENT]          intent classifier verdict
        #   [ROUTER]          flag gate result
        #   [TOOL_EXECUTION]  start / end of the actual tool call
        #   [WEB_SEARCH]      injection state (block in prompt?)
        #   [FALLBACK]        why we reached the no-block branch
        if web_search_intent and web_search_intent.triggered and not _budget_exhausted():
            logger.info(
                "[INTENT] web_search triggered | uid=%s | confidence=%.2f | "
                "triggers=%s | reason=%s | budget_remaining=%.1fs",
                user_id, web_search_intent.confidence,
                ",".join(web_search_intent.triggers),
                web_search_intent.reason, _budget_remaining(),
            )
            yield sse_event("tool.started", {
                "tool_id":     "web_research",
                "input_summary": f"search: {web_search_intent.query[:120]}",
                "provider":    "web",
                "triggers":    list(web_search_intent.triggers),
            })
            logger.info(
                "[TOOL_EXECUTION] web_research starting | uid=%s | query=%s",
                user_id, web_search_intent.query[:80],
            )
            try:
                from backend.services.tool_extraction import build_web_search_context_block
                search_block, search_payload = await build_web_search_context_block(
                    user_id=     user_id,
                    query=       web_search_intent.query,
                    triggers=    web_search_intent.triggers,
                    project_id=  body.project_id,
                    owner_debug= owner_debug,
                )
            except Exception as exc:
                logger.warning(
                    "[TOOL_EXECUTION] web_research raised | uid=%s | err=%s",
                    user_id, exc,
                )
                search_block = None
                search_payload = {"triggered": True, "fetched": False,
                                  "error": str(exc)[:200]}

            fetched_ok = bool((search_payload or {}).get("fetched"))
            citation_count = int((search_payload or {}).get("count") or 0)
            yield sse_event("tool.completed", {
                "tool_id":     "web_research",
                "query":       web_search_intent.query[:200],
                "succeeded":   fetched_ok,
                "citations":   citation_count,
                "block_chars": len(search_block or ""),
            })
            logger.info(
                "[TOOL_EXECUTION] web_research finished | uid=%s | "
                "fetched=%s | citations=%d | block_chars=%d",
                user_id, fetched_ok, citation_count, len(search_block or ""),
            )

            if owner_debug and search_payload:
                yield sse_event("tool.debug", {
                    "tool_id": "web_research",
                    "payload": search_payload,
                })
                # Owner-only orchestration trace SSE event — full
                # decision chain in one frame so the owner workspace
                # can render a diagnostic panel without scraping logs.
                yield sse_event("tool.diagnostic", {
                    "stage":      "web_search",
                    "intent": {
                        "triggered":  web_search_intent.triggered,
                        "confidence": web_search_intent.confidence,
                        "triggers":   list(web_search_intent.triggers),
                        "reason":     web_search_intent.reason,
                    },
                    "router": {
                        "tool":            "web_research",
                        "tool_enabled":    True,    # we got here, so it was on
                        "no_urls":         True,    # gate fires only without URLs
                    },
                    "execution": {
                        "fetched":      fetched_ok,
                        "citations":    citation_count,
                        "block_chars":  len(search_block or ""),
                        "error":        (search_payload or {}).get("error"),
                    },
                })

            # Fold into the prompt — same dual-injection pattern.
            if search_block:
                logger.info(
                    "[WEB_SEARCH] real-data block injected | uid=%s | "
                    "citations=%d | chars=%d",
                    user_id, citation_count, len(search_block),
                )
                base_msgs = list(effective_pr_request.messages)
                augmented_msgs3: list = []
                first_role = base_msgs[0].role if base_msgs else None
                if first_role == "system":
                    sys_content = base_msgs[0].content
                    if isinstance(sys_content, list):
                        sys_content = "\n".join(
                            str(b.get("text", "")) for b in sys_content
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    new_sys = f"{(sys_content or '').strip()}\n\n{search_block}"
                    augmented_msgs3.append(ProviderMessage(role="system", content=new_sys))
                    rest3 = base_msgs[1:]
                else:
                    augmented_msgs3.append(ProviderMessage(role="system", content=search_block))
                    rest3 = list(base_msgs)

                last_user_idx3: Optional[int] = None
                for i in range(len(rest3) - 1, -1, -1):
                    if rest3[i].role == "user":
                        last_user_idx3 = i
                        break
                if last_user_idx3 is not None:
                    user_msg = rest3[last_user_idx3]
                    suffix = (
                        "\n\n---\n"
                        "[Web search results — treat as authoritative; "
                        "cite specific sources by URL:]\n"
                        f"{search_block}"
                    )
                    if isinstance(user_msg.content, list):
                        new_content = list(user_msg.content) + [{
                            "type": "text",
                            "text": suffix,
                        }]
                        rest3[last_user_idx3] = ProviderMessage(
                            role="user", content=new_content,
                        )
                    else:
                        new_text = (user_msg.content or "") + suffix
                        rest3[last_user_idx3] = ProviderMessage(
                            role="user", content=new_text,
                        )

                augmented_msgs3.extend(rest3)
                effective_pr_request = ProviderRequest(
                    messages=    augmented_msgs3,
                    model=       effective_pr_request.model,
                    temperature= effective_pr_request.temperature,
                    max_tokens=  effective_pr_request.max_tokens,
                    timeout_s=   effective_pr_request.timeout_s,
                    extra=       effective_pr_request.extra,
                )
                logger.info(
                    "stream_chat.web_search | uid=%s | query=%s | "
                    "citations=%d | block_chars=%d | injected=system+user",
                    user_id, web_search_intent.query[:80],
                    citation_count, len(search_block),
                )
            else:
                # Phase 11 fix #2 — production observation: even when
                # the intent fires and the tool is called, an
                # `unavailable` envelope (missing TAVILY_API_KEY,
                # provider 429, network drop) used to leave the LLM
                # with NO signal that a search was attempted. It
                # would then default to "internetten araştırma
                # yeteneğim yok" which is plain wrong — the user
                # explicitly asked for a search and we tried.
                #
                # We now inject an HONEST "attempted-but-failed"
                # block telling the LLM the precise reason and how
                # to respond. The model still doesn't get any
                # citations (we don't have any) but it stops
                # claiming it can't access the internet at all.
                err = (search_payload or {}).get("error") or "unknown reason"
                logger.warning(
                    "[FALLBACK] web_search no-block | uid=%s | reason=%s",
                    user_id, err,
                )
                fail_block = (
                    "═══════════════════════════════════════════════════════════════\n"
                    "KORVIX WEB SEARCH — TOOL ATTEMPTED, NO RESULTS\n"
                    "═══════════════════════════════════════════════════════════════\n"
                    "I (KorvixAI) tried to run my web search tool for the user's "
                    "question but it returned no usable results. Specific reason: "
                    f"{err}\n\n"
                    "INSTRUCTIONS for your response:\n"
                    "1. Be HONEST. Acknowledge that you attempted a live web "
                    "search but it failed.\n"
                    "2. State the specific failure reason from above (e.g. "
                    "\"search provider not configured\" / \"rate limit\" / "
                    "\"network error\").\n"
                    "3. DO NOT say \"I cannot access the internet\" or "
                    "\"İnternetten gerçek zamanlı bilgi arayamıyorum\" — "
                    "this is FALSE; the tool exists and was invoked.\n"
                    "4. If you have relevant pre-training knowledge, offer "
                    "it with a clear cutoff caveat.\n"
                    "5. Suggest the user can retry shortly or ask a different "
                    "phrasing.\n"
                    "Reply in the user's language."
                )
                # Inject the fail_block too — same system+user pattern
                # so it can't be ignored by the model.
                base_msgs = list(effective_pr_request.messages)
                augmented_fail: list = []
                first_role = base_msgs[0].role if base_msgs else None
                if first_role == "system":
                    sys_content = base_msgs[0].content
                    if isinstance(sys_content, list):
                        sys_content = "\n".join(
                            str(b.get("text", "")) for b in sys_content
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    new_sys = f"{(sys_content or '').strip()}\n\n{fail_block}"
                    augmented_fail.append(ProviderMessage(role="system", content=new_sys))
                    fail_rest = base_msgs[1:]
                else:
                    augmented_fail.append(ProviderMessage(role="system", content=fail_block))
                    fail_rest = list(base_msgs)
                last_user_idx_f: Optional[int] = None
                for i in range(len(fail_rest) - 1, -1, -1):
                    if fail_rest[i].role == "user":
                        last_user_idx_f = i
                        break
                if last_user_idx_f is not None:
                    um = fail_rest[last_user_idx_f]
                    suffix = (
                        "\n\n---\n"
                        "[Note for the assistant: a web search was attempted "
                        "for this turn but returned no results. See the "
                        "system-prompt block above for handling instructions.]"
                    )
                    if isinstance(um.content, list):
                        new_content = list(um.content) + [{"type": "text", "text": suffix}]
                        fail_rest[last_user_idx_f] = ProviderMessage(
                            role="user", content=new_content,
                        )
                    else:
                        fail_rest[last_user_idx_f] = ProviderMessage(
                            role="user", content=(um.content or "") + suffix,
                        )
                augmented_fail.extend(fail_rest)
                effective_pr_request = ProviderRequest(
                    messages=    augmented_fail,
                    model=       effective_pr_request.model,
                    temperature= effective_pr_request.temperature,
                    max_tokens=  effective_pr_request.max_tokens,
                    timeout_s=   effective_pr_request.timeout_s,
                    extra=       effective_pr_request.extra,
                )
                logger.info(
                    "[WEB_SEARCH] honest-failure block injected | uid=%s | "
                    "err=%s",
                    user_id, err[:200],
                )
        elif web_search_intent is not None:
            # Detection ran but didn't trigger. Log so an ops review
            # can confirm the classifier's decision.
            logger.debug(
                "[INTENT] web_search not triggered | uid=%s | "
                "confidence=%.2f | reason=%s",
                user_id, web_search_intent.confidence,
                web_search_intent.reason,
            )

        # Phase 11 hang-fix — log the orchestration budget consumed
        # before opening the provider stream. Total time from
        # `event_stream` entry to here = sum of tool latencies. If
        # close to the ceiling the FE will already have seen the
        # tool.* events; the LLM stream still gets to run.
        _orch_elapsed = _time.monotonic() - _budget_t0
        logger.info(
            "[ORCHESTRATION] pre-stream done | uid=%s | elapsed=%.2fs | "
            "budget_remaining=%.2fs",
            user_id, _orch_elapsed, _budget_remaining(),
        )

        # Phase 11 hang-fix #2 — production observation: after the
        # pre-stream tool fixes in #140 landed, a NEW hang surfaced
        # MID-STREAM. The model emits the first few tokens
        # ("Bir dakikanızı alacak…") and then the upstream provider
        # (OpenAI / Anthropic) stops sending without ever sending a
        # terminal `done` event. The route's `async for event in
        # provider.stream_chat_completion(...)` then awaits the next
        # event forever and the FE is stuck on a partial answer.
        #
        # Cause: provider.stream_chat_completion's own
        # asyncio.wait_for only protects the INITIAL connect/first-
        # chunk handshake. Once tokens start flowing the iteration
        # has no per-chunk ceiling — a silent stall in the upstream
        # SSE pipe never breaks the await.
        #
        # Watchdog: wrap each iterator advance in asyncio.wait_for
        # so any chunk gap longer than IDLE_TIMEOUT aborts the
        # stream with an honest fallback message. Track the TOTAL
        # wall clock separately so a very-long-but-still-flowing
        # response can't grind past TOTAL_BUDGET either. EITHER
        # ceiling firing flips us to the fallback path which ALWAYS
        # emits `done` before returning, so the FE can never get
        # stuck on a partial token list.
        IDLE_TIMEOUT = 30.0     # seconds since last chunk
        TOTAL_BUDGET = 90.0     # seconds since the LLM stream opened
        _stream_t0 = _time.monotonic()
        _last_event_at = _time.monotonic()
        _token_count = 0

        def _fallback_done(reason: str) -> tuple[str, str]:
            """Return two SSE frames that close the stream cleanly:
            a token frame carrying the polite Turkish-first fallback
            (English mirror so EN users see something useful too),
            and a `done` frame so the FE drops out of `isLoading`.
            """
            note_tr = (
                "\n\n_İşlem zaman aşımına uğradı. Lütfen tekrar deneyin._"
            )
            note_en = (
                " _(The model stopped responding. Please try again.)_"
            )
            return (
                sse_event("token", {"delta": note_tr + note_en}),
                sse_event("done", {
                    "finish_reason": "timeout",
                    "model":         effective_pr_request.model,
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    "stop_reason":   reason,
                }),
            )

        try:
            stream_iter = provider.stream_chat_completion(effective_pr_request).__aiter__()
            while True:
                # Per-chunk watchdog. asyncio.wait_for(anext(...))
                # raises TimeoutError if no new event arrives within
                # IDLE_TIMEOUT — handled below as "stream hung".
                try:
                    event = await asyncio.wait_for(
                        stream_iter.__anext__(),
                        timeout=IDLE_TIMEOUT,
                    )
                except StopAsyncIteration:
                    # Provider exhausted without a Done event. Surface
                    # as a graceful done so the FE closes cleanly.
                    logger.warning(
                        "[STREAM] iterator exhausted without Done | uid=%s | "
                        "tokens=%d | elapsed=%.2fs",
                        user_id, _token_count, _time.monotonic() - _stream_t0,
                    )
                    tok_frame, done_frame = _fallback_done("iterator_exhausted")
                    yield tok_frame
                    yield done_frame
                    return
                except asyncio.TimeoutError:
                    logger.warning(
                        "[STREAM_TIMEOUT] idle | uid=%s | "
                        "idle_for=%.1fs | tokens=%d | elapsed=%.2fs",
                        user_id, IDLE_TIMEOUT, _token_count,
                        _time.monotonic() - _stream_t0,
                    )
                    tok_frame, done_frame = _fallback_done("idle_timeout")
                    yield tok_frame
                    yield done_frame
                    return

                _last_event_at = _time.monotonic()
                # Total-budget guard — fires even when the provider
                # IS still streaming tokens but very slowly. 90 s is
                # generous for a long research response; tune via
                # the constant above if production latencies change.
                if (_time.monotonic() - _stream_t0) > TOTAL_BUDGET:
                    logger.warning(
                        "[STREAM_TIMEOUT] total | uid=%s | "
                        "budget=%.1fs | tokens=%d",
                        user_id, TOTAL_BUDGET, _token_count,
                    )
                    tok_frame, done_frame = _fallback_done("total_budget")
                    yield tok_frame
                    yield done_frame
                    return

                if isinstance(event, ProviderStreamStart):
                    logger.info(
                        "[STREAM] ready | uid=%s | provider=%s | model=%s",
                        user_id, event.provider, event.model,
                    )
                    yield sse_event("ready", {"provider": event.provider, "model": event.model})
                elif isinstance(event, ProviderStreamToken):
                    _token_count += 1
                    yield sse_event("token", {"delta": event.delta})
                elif isinstance(event, ProviderStreamDone):
                    logger.info(
                        "[STREAM] done | uid=%s | finish=%s | tokens=%d | "
                        "elapsed=%.2fs | prompt_tokens=%d | completion_tokens=%d",
                        user_id, event.finish_reason, _token_count,
                        _time.monotonic() - _stream_t0,
                        event.usage.prompt_tokens, event.usage.completion_tokens,
                    )
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
                    logger.warning(
                        "[STREAM_ERROR] uid=%s | code=%s | msg=%s | provider=%s",
                        user_id, event.code, event.message, event.provider,
                    )
                    yield sse_event("error", {
                        "code":     event.code,
                        "message":  event.message,
                        "provider": event.provider,
                    })
                    return
        except Exception as exc:
            logger.exception("[STREAM] unexpected exception | uid=%s", user_id)
            # Always emit BOTH an error AND a done frame so the FE
            # can never be stuck waiting. Some FE handlers stop on
            # error; some need an explicit done — sending both
            # covers every consumer.
            yield sse_event("error", {
                "code":    "INTERNAL_ERROR",
                "message": str(exc)[:300],
                "provider": provider.name,
            })
            tok_frame, done_frame = _fallback_done(f"exception:{type(exc).__name__}")
            yield done_frame

    return sse_response(event_stream())


__all__ = ["router"]
