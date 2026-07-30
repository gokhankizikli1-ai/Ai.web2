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


def resolve_provider() -> str:
    """The active billing provider for checkout/webhook selection.

    Backend-only (`BILLING_PROVIDER`), never a VITE/public var. Default and
    fail-safe is `lemon_squeezy` — an empty or UNKNOWN value resolves to Lemon
    so production is never silently pointed at an unimplemented provider.
    """
    raw = (os.getenv("BILLING_PROVIDER", "") or "").strip().lower()
    if raw in KNOWN_PROVIDERS:
        return raw
    return DEFAULT_PROVIDER


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
    "resolve_provider", "is_known_provider",
    "PROVIDER_LEMON_SQUEEZY", "PROVIDER_POLAR",
    "EVENT_CHECKOUT_COMPLETED", "EVENT_SUBSCRIPTION_CREATED",
    "EVENT_SUBSCRIPTION_UPDATED", "EVENT_SUBSCRIPTION_CANCELED",
    "EVENT_SUBSCRIPTION_REVOKED", "EVENT_PAYMENT_SUCCEEDED",
    "EVENT_PAYMENT_FAILED", "EVENT_REFUND_CREATED",
    "NORMALIZED_EVENTS", "lemon_event_to_normalized",
]
