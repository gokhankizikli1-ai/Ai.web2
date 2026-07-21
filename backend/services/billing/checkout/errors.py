# coding: utf-8
"""
Billing checkout — typed errors (PR 7).

The route maps these to HTTP status codes. Messages are safe to surface to the
client; they never contain secrets or raw Lemon API responses.
"""
from __future__ import annotations


class CheckoutError(RuntimeError):
    """Base."""


class CheckoutDisabled(CheckoutError):
    """The checkout surface is disabled (ENABLE_BILLING_CHECKOUT off). → 503."""


class CheckoutConfigError(CheckoutError):
    """Server misconfiguration (missing API key / store id / variants). → 503."""


class CheckoutValidationError(CheckoutError):
    """Bad client input (unknown variant, disallowed return_url). → 400."""


class CheckoutUpstreamError(CheckoutError):
    """Lemon Squeezy API call failed. → 502. Carries only a status code, never
    the response body."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


__all__ = [
    "CheckoutError", "CheckoutDisabled", "CheckoutConfigError",
    "CheckoutValidationError", "CheckoutUpstreamError",
]
