# coding: utf-8
"""
AnthropicProvider — wraps the anthropic SDK (v0.x async client).

Phase 6a. Registered into the provider registry only when
ANTHROPIC_API_KEY is set. Default model controlled by env var
MODEL_ANTHROPIC (defaults to "claude-sonnet-4-6").

Anthropic API shape differs from OpenAI in three places that matter
for our ProviderRequest adapter:

  1. SYSTEM PROMPT — Anthropic takes it as a top-level `system` param,
     NOT as a message with role="system". The adapter extracts every
     system message from request.messages and concatenates them into
     the system param (multiple system messages happen when the
     orchestration layer composes safety + persona + instruction
     prefixes).

  2. CONTENT BLOCKS — Anthropic responses have a `content: [{type,text}]`
     list. We concatenate the text from every `type="text"` block; tool
     blocks (Phase 6c) will use a different path.

  3. USAGE — Anthropic reports `input_tokens` / `output_tokens` (no
     `total`). The adapter computes total locally.

Streaming uses `client.messages.stream(...)` async context manager.
Each `text` event becomes ProviderStreamToken; the terminal
`message_stop` becomes ProviderStreamDone with the final usage.

ALL exceptions are translated to the ProviderError hierarchy — the
orchestration layer never sees anthropic.* exceptions leak out.

This provider does NOT receive traffic from any current route. It
exists so `/v2/health.providers` reports it as `registered=true,
available=true` and so future routes (Phase 6b agent orchestration)
can route opt-in traffic to it via the registry.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from backend.core.config import settings
from backend.services.providers.base import BaseAIProvider
from backend.services.providers.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderInvalidRequestError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from backend.services.providers.streaming import (
    ProviderStreamDone,
    ProviderStreamError,
    ProviderStreamEvent,
    ProviderStreamStart,
    ProviderStreamToken,
)
from backend.services.providers.types import (
    ProviderRequest,
    ProviderResult,
    ProviderUsage,
)

logger = logging.getLogger(__name__)


def _split_messages(
    request: ProviderRequest,
) -> Tuple[Optional[str], List[Dict[str, str]]]:
    """Anthropic-style split: extract system prompts, return them
    concatenated (or None) AND the remaining user/assistant messages.
    A trailing assistant message is allowed (Anthropic supports
    "prefill") but we don't generate one here."""
    system_parts: List[str] = []
    convo: List[Dict[str, str]] = []
    for m in request.messages:
        if m.role == "system":
            if m.content:
                system_parts.append(m.content)
        else:
            convo.append({"role": m.role, "content": m.content})
    system_text = "\n\n".join(system_parts) if system_parts else None
    return system_text, convo


class AnthropicProvider(BaseAIProvider):
    name = "anthropic"
    default_model = settings.MODEL_ANTHROPIC
    supports_streaming = True

    def is_available(self) -> bool:
        # No network call. Runtime auth errors translate to
        # ProviderAuthError on the first request.
        return bool(settings.ANTHROPIC_API_KEY)

    def describe(self) -> Dict[str, Any]:
        base = super().describe()
        # Surface the model id so operators can confirm via /v2/health
        # which Claude family is configured without inspecting env vars.
        base["model_family"] = "claude"
        return base

    def _client(self):
        """Lazy SDK construction so importing the module never requires
        the anthropic package to be installed (matters for smoke tests
        that exercise the registry without ever calling chat_completion)."""
        try:
            from anthropic import AsyncAnthropic  # type: ignore
        except ImportError as exc:
            raise ProviderUnavailableError(
                "anthropic SDK not installed in this environment.",
                provider=self.name,
                details={"reason": str(exc)},
            )
        return AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # ── Non-streaming ──────────────────────────────────────────────────

    async def chat_completion(self, request: ProviderRequest) -> ProviderResult:
        if not self.is_available():
            raise ProviderUnavailableError(
                "Anthropic is not configured (missing ANTHROPIC_API_KEY).",
                provider=self.name,
            )

        model = request.model or self.default_model
        system_text, messages = _split_messages(request)

        create_kwargs: Dict[str, Any] = {
            "model":       model,
            "messages":    messages,
            "max_tokens":  request.max_tokens if request.max_tokens is not None else 1024,
            "temperature": request.temperature,
        }
        if system_text:
            create_kwargs["system"] = system_text
        # Pass through whitelisted extras the Anthropic SDK accepts.
        for k in ("top_p", "stop_sequences", "metadata", "tools"):
            if k in request.extra:
                create_kwargs[k] = request.extra[k]

        try:
            client = self._client()
            response = await asyncio.wait_for(
                client.messages.create(**create_kwargs),
                timeout=request.timeout_s,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                f"Anthropic timed out after {request.timeout_s:.1f}s.",
                provider=self.name,
            )
        except ProviderError:
            raise
        except Exception as exc:
            raise self._translate_sdk_exception(exc)

        # Anthropic's content is a list of typed blocks. Concatenate
        # text blocks; ignore tool_use blocks here (Phase 6c handles
        # tool calling separately).
        try:
            text_parts = [
                getattr(block, "text", "") for block in (response.content or [])
                if getattr(block, "type", "") == "text"
            ]
            content = "".join(text_parts)
            u = getattr(response, "usage", None)
            in_t  = getattr(u, "input_tokens",  0) or 0 if u else 0
            out_t = getattr(u, "output_tokens", 0) or 0 if u else 0
            usage = ProviderUsage(
                prompt_tokens=     in_t,
                completion_tokens= out_t,
                total_tokens=      in_t + out_t,
            )
            return ProviderResult(
                content=       content,
                model=         getattr(response, "model", model) or model,
                provider=      self.name,
                usage=         usage,
                finish_reason= getattr(response, "stop_reason", None),
                raw=           None,
            )
        except (AttributeError, TypeError) as exc:
            raise ProviderError(
                "Anthropic returned an unexpected response shape.",
                provider=self.name,
                details={"reason": str(exc)},
            )

    # ── Streaming ──────────────────────────────────────────────────────

    async def stream_chat_completion(
        self, request: ProviderRequest,
    ) -> AsyncIterator[ProviderStreamEvent]:
        if not self.is_available():
            yield ProviderStreamError(
                code="PROVIDER_UNAVAILABLE",
                message="Anthropic is not configured (missing ANTHROPIC_API_KEY).",
                provider=self.name,
            )
            return

        model = request.model or self.default_model
        system_text, messages = _split_messages(request)

        create_kwargs: Dict[str, Any] = {
            "model":       model,
            "messages":    messages,
            "max_tokens":  request.max_tokens if request.max_tokens is not None else 1024,
            "temperature": request.temperature,
        }
        if system_text:
            create_kwargs["system"] = system_text
        for k in ("top_p", "stop_sequences", "metadata"):
            if k in request.extra:
                create_kwargs[k] = request.extra[k]

        client = None
        try:
            client = self._client()
        except ProviderError as exc:
            yield ProviderStreamError(code=exc.code, message=exc.message, provider=self.name)
            return

        yield ProviderStreamStart(provider=self.name, model=model)

        # SDK's async stream is an async context manager that yields
        # typed events. We map the ones we care about — text deltas and
        # the terminal message_stop with usage.
        usage = ProviderUsage()
        finish_reason: Optional[str] = None
        try:
            stream_ctx = client.messages.stream(**create_kwargs)
            # asyncio.wait_for around the connection setup; once the
            # stream is open, per-chunk latency is governed by Anthropic.
            stream = await asyncio.wait_for(stream_ctx.__aenter__(), timeout=request.timeout_s)
        except asyncio.TimeoutError:
            yield ProviderStreamError(
                code="PROVIDER_TIMEOUT",
                message=f"Anthropic did not start streaming within {request.timeout_s:.1f}s.",
                provider=self.name,
            )
            return
        except Exception as exc:
            translated = self._translate_sdk_exception(exc)
            yield ProviderStreamError(
                code=translated.code if isinstance(translated, ProviderError) else "UPSTREAM_ERROR",
                message=str(translated)[:300],
                provider=self.name,
            )
            return

        try:
            async for event in stream:
                # Anthropic SDK v0.x event types: see anthropic.types.MessageStream*Event.
                # We sniff by attribute so we don't import internal types.
                event_type = getattr(event, "type", "")
                if event_type == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    delta_type = getattr(delta, "type", "")
                    if delta_type == "text_delta":
                        text = getattr(delta, "text", "") or ""
                        if text:
                            yield ProviderStreamToken(delta=text)
                elif event_type == "message_delta":
                    # The terminal-ish event before message_stop;
                    # carries the final stop_reason + cumulative usage.
                    d = getattr(event, "delta", None)
                    if d is not None:
                        sr = getattr(d, "stop_reason", None)
                        if sr:
                            finish_reason = sr
                    u = getattr(event, "usage", None)
                    if u is not None:
                        out_t = getattr(u, "output_tokens", 0) or 0
                        usage = ProviderUsage(
                            prompt_tokens=     usage.prompt_tokens,
                            completion_tokens= out_t,
                            total_tokens=      usage.prompt_tokens + out_t,
                        )
                elif event_type == "message_start":
                    msg = getattr(event, "message", None)
                    u = getattr(msg, "usage", None) if msg else None
                    if u is not None:
                        in_t = getattr(u, "input_tokens", 0) or 0
                        usage = ProviderUsage(
                            prompt_tokens=     in_t,
                            completion_tokens= usage.completion_tokens,
                            total_tokens=      in_t + usage.completion_tokens,
                        )
                # Other events (content_block_start/stop, ping, etc.)
                # are not surfaced to the SSE consumer.
        except Exception as exc:
            translated = self._translate_sdk_exception(exc)
            yield ProviderStreamError(
                code=translated.code if isinstance(translated, ProviderError) else "UPSTREAM_ERROR",
                message=str(translated)[:300],
                provider=self.name,
            )
            return
        finally:
            try:
                await stream_ctx.__aexit__(None, None, None)
            except Exception:
                pass

        yield ProviderStreamDone(
            finish_reason=finish_reason,
            usage=usage,
            model=model,
        )

    # ── Error mapping ──────────────────────────────────────────────────

    def _translate_sdk_exception(self, exc: Exception) -> ProviderError:
        """Map an anthropic SDK exception to the right ProviderError.

        The SDK exposes typed subclasses of AnthropicError. We sniff by
        class name + status_code so we don't have to import the SDK
        exception classes at module top level (keeps the import graph
        clean for environments without the SDK installed).
        """
        cls_name = exc.__class__.__name__
        status   = getattr(exc, "status_code", None)
        msg      = str(exc)[:300] or "Anthropic call failed."

        if cls_name in ("APITimeoutError",) or "timeout" in msg.lower():
            return ProviderTimeoutError(msg, provider=self.name)
        if cls_name in ("APIConnectionError",):
            return ProviderUnavailableError(msg, provider=self.name)
        if cls_name in ("AuthenticationError", "PermissionDeniedError") or status in (401, 403):
            return ProviderAuthError(msg, provider=self.name)
        if cls_name in ("RateLimitError",) or status == 429:
            return ProviderRateLimitError(msg, provider=self.name)
        if cls_name in ("BadRequestError", "UnprocessableEntityError") or (status and 400 <= status < 500):
            return ProviderInvalidRequestError(msg, provider=self.name)
        if status and status >= 500:
            return ProviderUnavailableError(msg, provider=self.name)
        return ProviderError(msg, provider=self.name)


__all__ = ["AnthropicProvider"]
