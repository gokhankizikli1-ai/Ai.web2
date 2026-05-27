# coding: utf-8
"""
OpenAIProvider — real OpenAI chat-completions wrapper.

Wraps the existing `openai` SDK (v1.x async client). Translates SDK
exceptions into our normalised `ProviderError` hierarchy so the
orchestration layer never sees provider-specific exception types.

Honours the per-request timeout. Cancels the in-flight call cleanly on
abort. Returns a `ProviderResult` whose `to_legacy_chat_dict()` projects
to the exact field names the existing /chat frontend already reads,
so an orchestration adopter can drop this in without breaking the
contract.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict

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
    ProviderStreamStart,
    ProviderStreamToken,
)
from backend.services.providers.types import (
    ProviderRequest,
    ProviderResult,
    ProviderUsage,
)

logger = logging.getLogger(__name__)


class OpenAIProvider(BaseAIProvider):
    name = "openai"
    default_model = settings.MODEL_FAST   # "gpt-4o-mini" unless overridden by env
    supports_streaming = True
    supports_vision = True
    # Model id prefixes that accept image content blocks. Matched via
    # str.startswith on the configured model so "gpt-4o-mini-2024-07-18"
    # still hits "gpt-4o". gpt-4-turbo is here for completeness; new
    # GPT-4.1+ generations should be added as they ship.
    vision_models = ("gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision")

    def is_available(self) -> bool:
        # No network call. We trust settings; runtime auth errors get
        # translated to ProviderAuthError on the first request.
        return bool(settings.OPENAI_API_KEY)

    def _client(self):
        """Lazy SDK client construction so importing this module never
        requires the openai package to be installed at module-import
        time (matters for the smoke-test path that exercises the
        registry without ever calling chat_completion)."""
        try:
            from openai import AsyncOpenAI  # type: ignore
        except ImportError as exc:
            raise ProviderUnavailableError(
                "openai SDK not installed in this environment.",
                provider=self.name,
                details={"reason": str(exc)},
            )
        return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def chat_completion(self, request: ProviderRequest) -> ProviderResult:
        if not self.is_available():
            raise ProviderUnavailableError(
                "OpenAI is not configured (missing OPENAI_API_KEY).",
                provider=self.name,
            )

        model = request.model or self.default_model
        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        try:
            client = self._client()
            # asyncio.wait_for is the canonical way to enforce a hard
            # ceiling around an async SDK call — the SDK's own timeout
            # parameter is best-effort and varies by version.
            create_kwargs: Dict[str, Any] = {
                "model":       model,
                "messages":    messages,
                "temperature": request.temperature,
            }
            if request.max_tokens is not None:
                create_kwargs["max_tokens"] = request.max_tokens
            # Pass through whitelisted extras the OpenAI SDK accepts.
            for k in ("response_format", "seed", "tools", "tool_choice", "top_p"):
                if k in request.extra:
                    create_kwargs[k] = request.extra[k]

            completion = await asyncio.wait_for(
                client.chat.completions.create(**create_kwargs),
                timeout=request.timeout_s,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                f"OpenAI timed out after {request.timeout_s:.1f}s.",
                provider=self.name,
            )
        except ProviderError:
            # _client() or anything inside this block may have raised an
            # already-normalised provider error — let it propagate.
            raise
        except Exception as exc:  # pragma: no cover — best-effort SDK mapping
            return await self._handle_sdk_exception(exc)

        # ── Success — normalise the SDK shape to ProviderResult ─────────
        try:
            choice = completion.choices[0]
            content = choice.message.content or ""
            usage_obj = getattr(completion, "usage", None)
            usage = ProviderUsage(
                prompt_tokens=     getattr(usage_obj, "prompt_tokens",     0) or 0,
                completion_tokens= getattr(usage_obj, "completion_tokens", 0) or 0,
                total_tokens=      getattr(usage_obj, "total_tokens",      0) or 0,
            )
            return ProviderResult(
                content=       content,
                model=         getattr(completion, "model", model) or model,
                provider=      self.name,
                usage=         usage,
                finish_reason= getattr(choice, "finish_reason", None),
                raw=           None,   # don't capture by default — PII risk
            )
        except (AttributeError, IndexError, TypeError) as exc:
            raise ProviderError(
                "OpenAI returned an unexpected response shape.",
                provider=self.name,
                details={"reason": str(exc)},
            )

    async def stream_chat_completion(self, request: ProviderRequest):
        """Stream tokens from OpenAI's chat-completions endpoint.

        Yields ProviderStreamStart (once), zero or more ProviderStreamToken,
        and then ProviderStreamDone OR ProviderStreamError. The generator
        never raises across a yield — any exception inside the upstream
        call is converted into a terminal ProviderStreamError event.

        The asyncio.wait_for ceiling is applied AROUND the stream
        iterator: if the client doesn't receive the first chunk within
        the timeout we abandon the call. We don't enforce a separate
        per-chunk timeout in this PR — most stalls happen at TLS or
        first-byte, not mid-stream.
        """
        if not self.is_available():
            yield ProviderStreamError(
                code="PROVIDER_UNAVAILABLE",
                message="OpenAI is not configured (missing OPENAI_API_KEY).",
                provider=self.name,
            )
            return

        model = request.model or self.default_model
        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        try:
            client = self._client()
            create_kwargs: Dict[str, Any] = {
                "model":       model,
                "messages":    messages,
                "temperature": request.temperature,
                "stream":      True,
                # Asking OpenAI for usage on the final chunk; supported
                # on recent API versions, silently ignored on older ones.
                "stream_options": {"include_usage": True},
            }
            if request.max_tokens is not None:
                create_kwargs["max_tokens"] = request.max_tokens
            for k in ("response_format", "seed", "tools", "tool_choice", "top_p"):
                if k in request.extra:
                    create_kwargs[k] = request.extra[k]

            # `client.chat.completions.create(stream=True)` returns an
            # AsyncStream. Wrap the connection setup (not the whole
            # iteration) in wait_for so a TLS / first-byte hang trips
            # the budget — once tokens are flowing, the user-visible
            # latency budget is per-chunk, which OpenAI typically meets
            # in <500ms.
            stream = await asyncio.wait_for(
                client.chat.completions.create(**create_kwargs),
                timeout=request.timeout_s,
            )
        except asyncio.TimeoutError:
            yield ProviderStreamError(
                code="PROVIDER_TIMEOUT",
                message=f"OpenAI did not start streaming within {request.timeout_s:.1f}s.",
                provider=self.name,
            )
            return
        except Exception as exc:
            # Map the SDK exception to one of our error codes. Reusing
            # the non-streaming exception mapper would raise; here we
            # want to translate to a terminal event instead.
            code, msg = self._classify_sdk_exception(exc)
            yield ProviderStreamError(code=code, message=msg, provider=self.name)
            return

        yield ProviderStreamStart(provider=self.name, model=model)

        finish_reason: str | None = None
        usage = ProviderUsage()
        try:
            async for chunk in stream:
                # Final usage-only chunk on supported API versions:
                #   chunk.choices is [] and chunk.usage is populated.
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    u = getattr(chunk, "usage", None)
                    if u is not None:
                        usage = ProviderUsage(
                            prompt_tokens=     getattr(u, "prompt_tokens",     0) or 0,
                            completion_tokens= getattr(u, "completion_tokens", 0) or 0,
                            total_tokens=      getattr(u, "total_tokens",      0) or 0,
                        )
                    continue
                choice = choices[0]
                delta = getattr(choice, "delta", None)
                content = getattr(delta, "content", None) if delta else None
                if content:
                    yield ProviderStreamToken(delta=content)
                fr = getattr(choice, "finish_reason", None)
                if fr:
                    finish_reason = fr
        except Exception as exc:
            code, msg = self._classify_sdk_exception(exc)
            yield ProviderStreamError(code=code, message=msg, provider=self.name)
            return

        yield ProviderStreamDone(
            finish_reason=finish_reason,
            usage=usage,
            model=model,
        )

    def _classify_sdk_exception(self, exc: Exception) -> tuple[str, str]:
        """Same logic as _handle_sdk_exception but returns (code, message)
        instead of raising — used by the streaming path that needs to
        translate into ProviderStreamError events rather than raise."""
        cls_name = exc.__class__.__name__
        status   = getattr(exc, "status_code", None)
        msg      = str(exc)[:300] or "OpenAI call failed."
        if cls_name == "APITimeoutError" or "timeout" in msg.lower():
            return "PROVIDER_TIMEOUT", msg
        if cls_name == "APIConnectionError":
            return "PROVIDER_UNAVAILABLE", msg
        if cls_name in ("AuthenticationError", "PermissionDeniedError") or status in (401, 403):
            return "PROVIDER_AUTH", msg
        if cls_name == "RateLimitError" or status == 429:
            return "PROVIDER_RATE_LIMITED", msg
        if cls_name in ("BadRequestError", "UnprocessableEntityError") or (status and 400 <= status < 500):
            return "PROVIDER_INVALID_REQUEST", msg
        if status and status >= 500:
            return "PROVIDER_UNAVAILABLE", msg
        return "UPSTREAM_ERROR", msg

    async def _handle_sdk_exception(self, exc: Exception) -> ProviderResult:
        """Translate an openai SDK exception into the right ProviderError.

        The OpenAI SDK v1 raises typed subclasses of `OpenAIError` —
        `APIConnectionError`, `APITimeoutError`, `AuthenticationError`,
        `RateLimitError`, `BadRequestError`, `APIStatusError`. We sniff
        them by attribute / class-name so we don't have to import the
        SDK exception classes at module top level (keeps the import
        graph clean for environments without the SDK installed).
        """
        cls_name = exc.__class__.__name__
        status   = getattr(exc, "status_code", None)
        msg      = str(exc)[:300]
        logger.warning("openai sdk error | %s | status=%s | %s", cls_name, status, msg)

        if cls_name in ("APITimeoutError",) or "timeout" in msg.lower():
            raise ProviderTimeoutError(msg or "OpenAI timed out.", provider=self.name)
        if cls_name in ("APIConnectionError",):
            raise ProviderUnavailableError(msg or "Cannot reach OpenAI.", provider=self.name)
        if cls_name in ("AuthenticationError", "PermissionDeniedError") or status in (401, 403):
            raise ProviderAuthError(msg or "OpenAI rejected our credentials.", provider=self.name)
        if cls_name in ("RateLimitError",) or status == 429:
            raise ProviderRateLimitError(msg or "OpenAI rate limit exceeded.", provider=self.name)
        if cls_name in ("BadRequestError", "UnprocessableEntityError") or (status and 400 <= status < 500):
            raise ProviderInvalidRequestError(msg or "OpenAI rejected the request.", provider=self.name)
        if status and status >= 500:
            raise ProviderUnavailableError(msg or "OpenAI server error.", provider=self.name)
        raise ProviderError(msg or "OpenAI call failed.", provider=self.name)


__all__ = ["OpenAIProvider"]
