# coding: utf-8
"""
Build-task provider routing — real execution (owner_only mode).

This module owns the ONLY real Anthropic execution path added by the mini-phase:
owner-verified Web Build **website planning**. It is deliberately narrow and
reuses the existing provider architecture end-to-end:

  * the existing AnthropicProvider (via the provider registry) — NO new SDK
    client, NO second registry, NO duplicated provider;
  * the existing ProviderRequest / ProviderResult / ProviderError hierarchy;
  * the existing configured MODEL_ANTHROPIC (read from config, never a secret);
  * the existing OpenAI website-planning transport for the fallback — passed in
    as a callable so this module never imports or moves the OpenAI-specific
    transport in `ai_client.py`.

Execution rules (see the mini-phase spec):

  * disabled / shadow  → always call the OpenAI planner (zero Anthropic calls).
  * owner_only + NON-owner → always call the OpenAI planner.
  * owner_only + verified owner → attempt Anthropic exactly once; on success
    (non-empty text) return it and do NOT call OpenAI; on ANY classified
    provider failure (missing config / unavailable / auth / timeout / rate
    limit / invalid request / malformed / empty output) fall back to the OpenAI
    planner exactly once with `fallback_used=True`.

The result is a `StructuredAIResult` (imported from the existing transport) so
the caller's existing consumption path is byte-compatible. Provider/model/
fallback/usage metadata is truthful; empty Anthropic output is a failure, never
fake success. No prompt, plan, system prompt, API key, authorization data or raw
provider response is ever logged or returned.
"""
from __future__ import annotations

import dataclasses
import logging
import time
from typing import Any, Awaitable, Callable, Optional, Tuple

from backend.services.build_routing import policy
from backend.services.build_routing.types import (
    MODE_OWNER_ONLY, TASK_WEB_PLANNING,
    PROVIDER_ANTHROPIC, PROVIDER_OPENAI, POLICY_VERSION,
)

logger = logging.getLogger(__name__)

# Bounded total timeout for the single synchronous Anthropic planning request.
# Equivalent to the existing OpenAI website-planning read budget
# (ai_client.WEBSITE_READ_TIMEOUT_S = 180s); a full plan/design/copy contract
# must be able to complete, but the request can never hang unbounded.
_ANTHROPIC_PLANNING_TIMEOUT_S = 180.0

# Truthful endpoint label for the Anthropic Messages API.
_ANTHROPIC_ENDPOINT = "messages"

# An async callable that runs the existing OpenAI website-planning transport and
# returns a StructuredAIResult. Supplied by the caller so this module never
# imports the OpenAI-specific transport.
OpenAIPlanner = Callable[[], Awaitable[Any]]


def _claude_model() -> str:
    """Configured Claude model id (config-only; never a secret)."""
    return policy._configured_claude_model()


def _routing_meta(
    *, mode: str, attempted_provider: str, executed_provider: str,
    attempted_model: str, executed_model: str, fallback_used: bool,
    error_kind: Optional[str], latency_ms: Optional[int],
) -> dict:
    """Bounded, sanitized routing-truth block for internal execution metadata.
    ONLY the allowed fields — no prompts, plans, ids, secrets or raw errors."""
    return {
        "task_kind": TASK_WEB_PLANNING,
        "routing_mode": mode,
        "owner_eligible": mode == MODE_OWNER_ONLY,
        "attempted_provider": attempted_provider,
        "executed_provider": executed_provider,
        "attempted_model": attempted_model,
        "executed_model": executed_model,
        "fallback_used": bool(fallback_used),
        "error_kind": error_kind,
        "policy_version": POLICY_VERSION,
        "latency_ms": latency_ms,
    }


def _log(meta: dict) -> None:
    """One bounded, sanitized routing log line. Allowed fields only."""
    try:
        logger.info(
            "BUILD_ROUTING exec | task_kind=%s | routing_mode=%s | owner_eligible=%s "
            "| attempted_provider=%s | executed_provider=%s | attempted_model=%s "
            "| executed_model=%s | fallback_used=%s | error_kind=%s | policy_version=%s | latency_ms=%s",
            meta.get("task_kind"), meta.get("routing_mode"), meta.get("owner_eligible"),
            meta.get("attempted_provider"), meta.get("executed_provider"),
            meta.get("attempted_model"), meta.get("executed_model"),
            meta.get("fallback_used"), meta.get("error_kind"),
            meta.get("policy_version"), meta.get("latency_ms"),
        )
    except Exception:  # pragma: no cover — logging must never affect a build
        pass


async def _anthropic_website_plan(
    *, message: str, system: str, max_output_tokens: Optional[int], temperature: float,
):
    """Attempt the website plan on Anthropic EXACTLY ONCE via the existing
    provider. Returns a `StructuredAIResult` (ok True on non-empty output, ok
    False with a bounded `error_kind` on any classified failure), or None when
    the compatibility result type cannot be constructed (treated as a failure by
    the caller). Never raises."""
    try:
        from ai_client import StructuredAIResult  # existing compatibility type
    except Exception:
        logger.warning("BUILD_ROUTING exec | StructuredAIResult unavailable; Anthropic path skipped")
        return None

    started = time.monotonic()

    def _ms() -> int:
        return int((time.monotonic() - started) * 1000)

    def _fail(error_kind: str, execution_status: str = "failed"):
        # Truthful failure — empty text, provider=anthropic, no fake success and
        # no raw provider detail. The caller falls back to OpenAI.
        return StructuredAIResult(
            ok=False, text="", model=_claude_model(), provider=PROVIDER_ANTHROPIC,
            endpoint=_ANTHROPIC_ENDPOINT, request_id=None,
            execution_status=execution_status, latency_ms=_ms(), fallback_used=False,
            error_kind=error_kind, error_code=None, error_message=None,
        )

    # Import the provider layer lazily so an environment without it degrades to
    # the OpenAI fallback instead of failing at import.
    try:
        from backend.services.providers import registry
        from backend.services.providers.types import ProviderRequest, ProviderMessage
        from backend.services.providers.errors import (
            ProviderTimeoutError, ProviderRateLimitError, ProviderAuthError,
            ProviderInvalidRequestError, ProviderUnavailableError, ProviderError,
        )
    except Exception:
        return _fail("provider-layer-unavailable")

    try:
        provider = registry.get_provider(PROVIDER_ANTHROPIC)
    except Exception:
        # Not registered (e.g. ANTHROPIC_API_KEY unset) → unavailable.
        return _fail("provider-unavailable", "failed")

    # Build the request: isolated website-builder system prompt + the structured
    # planning request as the user message. Tools are disabled by omission
    # (no "tools" key in extra). One request only.
    request = ProviderRequest(
        messages=[
            ProviderMessage(role="system", content=system),
            ProviderMessage(role="user", content=message),
        ],
        model=_claude_model(),
        temperature=float(temperature),
        max_tokens=int(max_output_tokens) if max_output_tokens else None,
        timeout_s=_ANTHROPIC_PLANNING_TIMEOUT_S,
        extra={},
    )

    try:
        result = await provider.chat_completion(request)
    except ProviderTimeoutError:
        return _fail("timeout", "timeout")
    except ProviderRateLimitError:
        return _fail("rate-limited")
    except ProviderAuthError:
        return _fail("auth")
    except ProviderInvalidRequestError:
        return _fail("invalid-request")
    except ProviderUnavailableError:
        return _fail("unavailable")
    except ProviderError:
        return _fail("provider-error")
    except Exception:
        return _fail("unexpected")

    text = getattr(result, "content", "") or ""
    if not text.strip():
        # Empty output is a FAILURE (never fake success) → fall back.
        return _fail("empty-output", "incomplete")

    usage = getattr(result, "usage", None)
    in_t = int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0
    out_t = int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0
    tot_t = int(getattr(usage, "total_tokens", 0) or 0) if usage else 0

    return StructuredAIResult(
        ok=True,
        text=text,
        model=(getattr(result, "model", None) or _claude_model()),
        provider=PROVIDER_ANTHROPIC,
        endpoint=_ANTHROPIC_ENDPOINT,
        request_id=None,
        execution_status="succeeded",
        latency_ms=_ms(),
        fallback_used=False,
        error_kind=None,
        error_code=None,
        error_message=None,
        # Preserve actual token usage when supplied; reasoning/cached stay absent
        # (Anthropic does not report them here).
        input_tokens=(in_t or None),
        output_tokens=(out_t or None),
        reasoning_tokens=None,
        cached_tokens=None,
        total_tokens=(tot_t or None),
    )


async def execute_website_planning(
    *,
    message: str,
    system: str,
    model: str,
    max_output_tokens: Optional[int],
    temperature: float,
    owner_eligible: bool,
    openai_planner: OpenAIPlanner,
) -> Tuple[Any, dict]:
    """Execute Web Build website planning under the active routing mode.

    Returns `(result, routing_meta)` where `result` is a `StructuredAIResult`
    from whichever provider actually executed, and `routing_meta` is a bounded,
    sanitized routing-truth block for internal execution metadata.

    Provider-call counts by outcome:
      * disabled / shadow / (owner_only + non-owner): 1 OpenAI call, 0 Anthropic.
      * owner_only + owner, Anthropic OK:             1 Anthropic call, 0 OpenAI.
      * owner_only + owner, Anthropic fails:          1 Anthropic + 1 OpenAI.

    Never raises: both planners are designed not to raise, and every extra step
    (record/replace/log) is guarded, so this returns a valid result in all
    cases.
    """
    try:
        mode = policy.routing_mode()
    except Exception:  # pragma: no cover
        mode = "disabled"

    # Only a verified owner in owner_only mode may execute Anthropic. Every other
    # combination keeps the exact existing OpenAI planning execution.
    if not (mode == MODE_OWNER_ONLY and owner_eligible):
        result = await openai_planner()
        exec_model = getattr(result, "model", model) or model
        meta = _routing_meta(
            mode=mode, attempted_provider=PROVIDER_OPENAI, executed_provider=PROVIDER_OPENAI,
            attempted_model=exec_model, executed_model=exec_model,
            fallback_used=False, error_kind=None,
            latency_ms=getattr(result, "latency_ms", None),
        )
        return result, meta

    # owner_only + verified owner → attempt Anthropic exactly once.
    anthropic_res = await _anthropic_website_plan(
        message=message, system=system,
        max_output_tokens=max_output_tokens, temperature=temperature,
    )
    if anthropic_res is not None and getattr(anthropic_res, "ok", False) \
            and (getattr(anthropic_res, "text", "") or "").strip():
        try:
            policy.record_execution(
                TASK_WEB_PLANNING, attempted_provider=PROVIDER_ANTHROPIC,
                executed_provider=PROVIDER_ANTHROPIC, fallback_used=False,
            )
        except Exception:  # pragma: no cover
            pass
        meta = _routing_meta(
            mode=mode, attempted_provider=PROVIDER_ANTHROPIC, executed_provider=PROVIDER_ANTHROPIC,
            attempted_model=_claude_model(), executed_model=getattr(anthropic_res, "model", _claude_model()),
            fallback_used=False, error_kind=None,
            latency_ms=getattr(anthropic_res, "latency_ms", None),
        )
        _log(meta)
        return anthropic_res, meta

    # Anthropic failed (or its result type was unavailable) → fall back to the
    # existing OpenAI Responses planning transport EXACTLY ONCE.
    primary_error_kind = (
        getattr(anthropic_res, "error_kind", None) if anthropic_res is not None
        else "anthropic-result-unavailable"
    ) or "anthropic-failure"
    result = await openai_planner()
    # Surface the fallback truthfully on the returned result.
    try:
        result = dataclasses.replace(result, fallback_used=True)
    except Exception:  # pragma: no cover — StructuredAIResult is a dataclass
        try:
            result.fallback_used = True
        except Exception:
            pass
    try:
        policy.record_execution(
            TASK_WEB_PLANNING, attempted_provider=PROVIDER_ANTHROPIC,
            executed_provider=PROVIDER_OPENAI, fallback_used=True,
        )
    except Exception:  # pragma: no cover
        pass
    meta = _routing_meta(
        mode=mode, attempted_provider=PROVIDER_ANTHROPIC, executed_provider=PROVIDER_OPENAI,
        attempted_model=_claude_model(), executed_model=getattr(result, "model", model) or model,
        fallback_used=True, error_kind=primary_error_kind,
        latency_ms=getattr(result, "latency_ms", None),
    )
    _log(meta)
    return result, meta


__all__ = ["execute_website_planning"]
