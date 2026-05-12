# coding: utf-8
"""
Provider exception hierarchy.

All errors subclass `backend.core.errors.ApiError`, so when the v2
ApiError handler is installed they automatically map to the right
HTTP status + envelope. When the handler isn't installed, the legacy
global handler catches them as 500 — same as any other unhandled
exception, no UX regression.

Normalisation rule for provider implementations:

  - Provider returns a 4xx (other than 401/403/429) → ProviderInvalidRequestError
  - Provider returns 401 / 403                     → ProviderAuthError
  - Provider returns 429                           → ProviderRateLimitError
  - Provider returns 5xx                           → ProviderUnavailableError
  - Network / DNS / SSL                            → ProviderUnavailableError
  - asyncio.TimeoutError / SDK timeout             → ProviderTimeoutError
  - Anything else                                  → ProviderError (HTTP 502)

This keeps the orchestration layer simple — it just `except ProviderError`
once, and the right envelope flows out.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from backend.core.errors import ApiError, ErrorCode


class ProviderError(ApiError):
    """Base class for any provider failure. HTTP 502 by default — a bad
    response from upstream, not the user's fault."""
    status_code = 502
    code = ErrorCode.UPSTREAM_ERROR

    def __init__(
        self,
        message: str,
        *,
        provider: str = "unknown",
        status_code: Optional[int] = None,
        code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        merged: Dict[str, Any] = {"provider": provider}
        if details:
            merged.update(details)
        super().__init__(message, status_code=status_code, code=code, details=merged)
        self.provider = provider


class ProviderTimeoutError(ProviderError):
    """Provider didn't respond within the per-request timeout budget."""
    status_code = 504
    code = "PROVIDER_TIMEOUT"


class ProviderRateLimitError(ProviderError):
    """Provider returned 429 / quota-exceeded."""
    status_code = 429
    code = "PROVIDER_RATE_LIMITED"


class ProviderUnavailableError(ProviderError):
    """Provider unreachable (network / DNS) or returned 5xx."""
    status_code = 503
    code = "PROVIDER_UNAVAILABLE"


class ProviderAuthError(ProviderError):
    """Provider rejected our credentials (401 / 403). Operator action
    required; the user can't recover by retrying."""
    status_code = 502   # upstream auth is OUR problem, not the caller's
    code = "PROVIDER_AUTH"


class ProviderInvalidRequestError(ProviderError):
    """Provider rejected the request shape (400-ish). Usually means an
    orchestration bug — bad model name, too many tokens, malformed
    messages."""
    status_code = 400
    code = "PROVIDER_INVALID_REQUEST"


__all__ = [
    "ProviderError",
    "ProviderTimeoutError",
    "ProviderRateLimitError",
    "ProviderUnavailableError",
    "ProviderAuthError",
    "ProviderInvalidRequestError",
]
