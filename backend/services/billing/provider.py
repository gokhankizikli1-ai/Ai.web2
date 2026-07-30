# coding: utf-8
"""
Billing — provider selection + normalized event vocabulary (PR #522 migration
foundation).

The billing subsystem is ALREADY provider-parameterised: `WebhookEvent.provider`,
`Subscription.provider`, the `UNIQUE(provider, …)` indexes, the normalized
subscription-status taxonomy and the config-driven plan catalog/map all take an
open `provider` string (see `billing/types.py`). This module adds the two small
pieces the Lemon Squeezy → Polar migration needs WITHOUT touching any of that:

  1. `resolve_provider()` — the single, backend-only selector. Default (and the
     only wired provider today) is `lemon_squeezy`. An unknown / empty value
     fails SAFE to `lemon_squeezy` so a typo can never take checkout to an
     unimplemented provider. Read dynamically (Railway flip without restart),
     mirroring every other billing accessor.

  2. A provider-neutral NORMALIZED EVENT vocabulary + a Lemon→normalized mapping.
     This is DORMANT foundation: nothing in the live Lemon pipeline is rewired
     (the processor still dispatches on Lemon's own event-name spellings). It
     documents the contract that a later Polar mapper will target so both
     providers converge on one lifecycle. No I/O beyond `os.getenv`.

SECURITY: this module reads only a NON-secret selector env var. It never reads,
returns or logs any provider API key / webhook secret.
"""
from __future__ import annotations

import os
from typing import Dict, Optional

from backend.services.billing.types import (
    DEFAULT_PROVIDER, KNOWN_PROVIDERS, PROVIDER_LEMON_SQUEEZY, PROVIDER_POLAR,
)


class UnknownProviderError(ValueError):
    """`BILLING_PROVIDER` is set to a non-empty value that is not a known provider.
    Used to FAIL a billing mutation closed rather than silently charging through
    the default provider."""


def _raw_provider() -> str:
    return (os.getenv("BILLING_PROVIDER", "") or "").strip().lower()


def resolve_provider() -> str:
    """Fail-SAFE selector for non-mutating reads / observability.

    Backend-only (`BILLING_PROVIDER`), never a VITE/public var. An empty/unset
    value → `lemon_squeezy` (backward-compatible default). An explicitly UNKNOWN
    non-empty value also resolves to `lemon_squeezy` HERE so a display/read path
    never crashes — but mutating paths must use `resolve_provider_strict()`, which
    rejects it (PR #524 hardening).
    """
    raw = _raw_provider()
    return raw if raw in KNOWN_PROVIDERS else DEFAULT_PROVIDER


def resolve_provider_strict() -> str:
    """Fail-CLOSED selector for BILLING MUTATIONS (checkout).

    * empty / unset       → `lemon_squeezy` (backward compatible)
    * a known provider    → that provider
    * an UNKNOWN non-empty → raises `UnknownProviderError` (never silently charges
                             through another provider).
    """
    raw = _raw_provider()
    if not raw:
        return DEFAULT_PROVIDER
    if raw in KNOWN_PROVIDERS:
        return raw
    raise UnknownProviderError(f"unknown billing provider: {raw!r}")


def provider_selection_error() -> Optional[str]:
    """Bounded, non-secret config-validation message when `BILLING_PROVIDER` is an
    explicitly-unknown value, else None. Never includes secrets."""
    raw = _raw_provider()
    if raw and raw not in KNOWN_PROVIDERS:
        return f"BILLING_PROVIDER is set to an unknown value {raw!r} (allowed: lemon_squeezy, polar)"
    return None


def is_known_provider(provider: Optional[str]) -> bool:
    return (provider or "").strip().lower() in KNOWN_PROVIDERS


# ── Normalized, provider-neutral event vocabulary (dormant foundation) ─────────
# The lifecycle contract BOTH providers map onto. The live Lemon processor still
# dispatches on Lemon's own event names (`subscription_created`, …) — this layer
# is not yet wired into it; it exists so the Polar implementation PR can map
# Polar events → these names → the existing normalized `Subscription` projection.
EVENT_CHECKOUT_COMPLETED = "checkout.completed"
EVENT_SUBSCRIPTION_CREATED = "subscription.created"
EVENT_SUBSCRIPTION_UPDATED = "subscription.updated"
EVENT_SUBSCRIPTION_CANCELED = "subscription.canceled"
EVENT_SUBSCRIPTION_REVOKED = "subscription.revoked"
EVENT_PAYMENT_SUCCEEDED = "payment.succeeded"
EVENT_PAYMENT_FAILED = "payment.failed"
EVENT_REFUND_CREATED = "refund.created"

NORMALIZED_EVENTS = frozenset({
    EVENT_CHECKOUT_COMPLETED,
    EVENT_SUBSCRIPTION_CREATED, EVENT_SUBSCRIPTION_UPDATED,
    EVENT_SUBSCRIPTION_CANCELED, EVENT_SUBSCRIPTION_REVOKED,
    EVENT_PAYMENT_SUCCEEDED, EVENT_PAYMENT_FAILED,
    EVENT_REFUND_CREATED,
})

# Lemon Squeezy event name → normalized name. Documentation-grade: NOT consumed
# by the live processor (which keeps Lemon's spellings). A `None` on the right
# means "no normalized equivalent needed" and is intentionally omitted here.
_LEMON_TO_NORMALIZED: Dict[str, str] = {
    "order_created": EVENT_CHECKOUT_COMPLETED,
    "order_refunded": EVENT_REFUND_CREATED,
    "subscription_created": EVENT_SUBSCRIPTION_CREATED,
    "subscription_updated": EVENT_SUBSCRIPTION_UPDATED,
    "subscription_plan_changed": EVENT_SUBSCRIPTION_UPDATED,
    "subscription_resumed": EVENT_SUBSCRIPTION_UPDATED,
    "subscription_paused": EVENT_SUBSCRIPTION_UPDATED,
    "subscription_unpaused": EVENT_SUBSCRIPTION_UPDATED,
    "subscription_cancelled": EVENT_SUBSCRIPTION_CANCELED,
    "subscription_expired": EVENT_SUBSCRIPTION_REVOKED,
    "subscription_payment_success": EVENT_PAYMENT_SUCCEEDED,
    "subscription_payment_recovered": EVENT_PAYMENT_SUCCEEDED,
    "subscription_payment_failed": EVENT_PAYMENT_FAILED,
    "subscription_payment_refunded": EVENT_REFUND_CREATED,
}


def lemon_event_to_normalized(event_name: Optional[str]) -> Optional[str]:
    """Map a Lemon Squeezy event name to the normalized vocabulary, or None when
    there is no equivalent. Pure lookup — never raises."""
    return _LEMON_TO_NORMALIZED.get((event_name or "").strip().lower())


__all__ = [
    "resolve_provider", "resolve_provider_strict", "provider_selection_error",
    "is_known_provider", "UnknownProviderError",
    "PROVIDER_LEMON_SQUEEZY", "PROVIDER_POLAR",
    "EVENT_CHECKOUT_COMPLETED", "EVENT_SUBSCRIPTION_CREATED",
    "EVENT_SUBSCRIPTION_UPDATED", "EVENT_SUBSCRIPTION_CANCELED",
    "EVENT_SUBSCRIPTION_REVOKED", "EVENT_PAYMENT_SUCCEEDED",
    "EVENT_PAYMENT_FAILED", "EVENT_REFUND_CREATED",
    "NORMALIZED_EVENTS", "lemon_event_to_normalized",
]
