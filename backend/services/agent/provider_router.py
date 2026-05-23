# coding: utf-8
"""Phase 4.3 — multi-provider call router.

Resolves a model id (e.g. "claude-sonnet-4-5", "gemini-2.5-pro",
"gpt-4o") to the right registered provider, then executes the call
through the existing BaseAIProvider.chat_completion interface. Falls
back to a secondary model on provider error (auth / timeout /
unavailable / invalid request) so a single provider outage never
blocks the user.

DESIGN BOUNDARIES (Phase 4.3 — NOT 4.3.B):
  - This router is the call layer for SPECIALISTS only — agents
    whose spec.allowed_tools is empty. The Supervisor's tool-using
    path stays on OpenAI in the agent runtime until 4.3.B adds
    cross-provider tool-call translation.
  - Streaming is NOT routed here. /v2/chat/stream stays on its
    existing provider-aware path.
"""
import logging
from typing import Any, List, Optional, Tuple

from backend.services.providers.errors import (
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from backend.services.providers.registry import get_provider, list_provider_names
from backend.services.providers.types import (
    ProviderMessage,
    ProviderRequest,
    ProviderResult,
)

logger = logging.getLogger(__name__)


# Model-id prefix → provider name. Lookup is case-insensitive and uses
# `startswith` so all current + likely-future variants of each family
# route correctly without an enumeration that drifts.
PROVIDER_PREFIXES: Tuple[Tuple[str, str], ...] = (
    ("gpt-",            "openai"),
    ("o1-",             "openai"),
    ("o3-",             "openai"),
    ("chatgpt-",        "openai"),
    ("claude-",         "anthropic"),
    ("gemini-",         "google"),
    ("models/gemini-",  "google"),   # full SDK-qualified path
)


def resolve_provider_for_model(model_id: str) -> Optional[str]:
    """Return the canonical provider name for `model_id`, or None when
    no prefix matches. Caller decides what to do with an unknown
    model — typically fall through to the registry's default provider
    or raise an InvalidRequest."""
    if not model_id:
        return None
    m = model_id.strip().lower()
    for prefix, provider in PROVIDER_PREFIXES:
        if m.startswith(prefix):
            return provider
    return None


class ProviderRouterError(Exception):
    """Raised when the router has exhausted its fallback chain.
    Wraps the most recent ProviderError so the agent runtime can
    decide whether to swallow + use a static fallback reply or
    surface the failure to the user."""
    def __init__(self, message: str, *, attempts: List[dict] | None = None,
                 last_error: Exception | None = None):
        super().__init__(message)
        self.attempts   = attempts or []
        self.last_error = last_error


# Errors that should trigger a fallback attempt. ProviderInvalidRequestError
# typically means the model id is wrong or the request shape is malformed —
# also worth a fallback attempt because a downstream model may not have
# the same constraint.
_FALLBACK_TRIGGERS = (
    ProviderAuthError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    ProviderInvalidRequestError,
)


async def call_with_fallback_chain(
    messages: List[ProviderMessage],
    *,
    model_chain: List[str],
    temperature: float = 0.4,
    max_tokens: Optional[int] = None,
    timeout_s: float = 30.0,
    extra: Optional[dict] = None,
) -> ProviderResult:
    """Execute the call through each model in `model_chain` until one
    succeeds. Returns the first success; raises ProviderRouterError
    after all attempts fail.

    Each attempt is logged for observability:
        provider_router | attempt=1/2 | model=claude-sonnet-4-5 | provider=anthropic
        provider_router | attempt=1/2 | result=auth_error | error=...
        provider_router | attempt=2/2 | model=gpt-4o | provider=openai
        provider_router | attempt=2/2 | result=success | tokens=...

    Auth/timeout/unavailable/invalid errors trigger fallback to the
    next model. Anything else propagates as-is.
    """
    if not model_chain:
        raise ProviderRouterError(
            "call_with_fallback_chain requires a non-empty model_chain",
        )

    attempts: List[dict] = []
    last_error: Exception | None = None
    extra = extra or {}

    for i, model_id in enumerate(model_chain, start=1):
        provider_name = resolve_provider_for_model(model_id)
        if not provider_name:
            attempts.append({
                "model": model_id, "provider": None,
                "result": "unknown_provider",
            })
            logger.warning(
                "provider_router | attempt=%d/%d | model=%s | result=unknown_provider",
                i, len(model_chain), model_id,
            )
            last_error = ProviderInvalidRequestError(
                f"No provider registered for model id {model_id!r} "
                f"(no prefix match in PROVIDER_PREFIXES)",
                provider="?",
            )
            continue

        try:
            provider = get_provider(provider_name)
        except ProviderUnavailableError as exc:
            attempts.append({
                "model": model_id, "provider": provider_name,
                "result": "provider_not_registered", "error": str(exc),
            })
            logger.warning(
                "provider_router | attempt=%d/%d | model=%s | provider=%s "
                "| result=provider_not_registered | error=%s",
                i, len(model_chain), model_id, provider_name, exc,
            )
            last_error = exc
            continue

        request = ProviderRequest(
            messages=messages,
            model=model_id,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout_s=timeout_s,
            extra=extra,
        )
        logger.info(
            "provider_router | attempt=%d/%d | model=%s | provider=%s",
            i, len(model_chain), model_id, provider_name,
        )
        try:
            result = await provider.chat_completion(request)
            attempts.append({
                "model":    model_id,
                "provider": provider_name,
                "result":   "success",
                "tokens":   result.usage.total_tokens,
            })
            logger.info(
                "provider_router | attempt=%d/%d | result=success | tokens=%d",
                i, len(model_chain), result.usage.total_tokens,
            )
            return result
        except _FALLBACK_TRIGGERS as exc:
            attempts.append({
                "model":    model_id,
                "provider": provider_name,
                "result":   type(exc).__name__,
                "error":    str(exc)[:200],
            })
            logger.warning(
                "provider_router | attempt=%d/%d | model=%s | provider=%s "
                "| result=%s | error=%s",
                i, len(model_chain), model_id, provider_name,
                type(exc).__name__, str(exc)[:200],
            )
            last_error = exc
            continue

    # All attempts exhausted
    raise ProviderRouterError(
        f"All {len(model_chain)} attempts in fallback chain failed",
        attempts=attempts,
        last_error=last_error,
    )


def known_providers() -> List[str]:
    """Snapshot of the registered providers (for /health)."""
    try:
        return sorted(list_provider_names())
    except Exception:
        return []


__all__ = [
    "PROVIDER_PREFIXES",
    "resolve_provider_for_model",
    "call_with_fallback_chain",
    "ProviderRouterError",
    "known_providers",
]
