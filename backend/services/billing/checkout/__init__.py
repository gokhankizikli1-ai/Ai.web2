# coding: utf-8
"""
Billing — Lemon Squeezy checkout creation & user linking (PR 7).

An authenticated backend endpoint that creates a hosted Lemon Squeezy checkout,
attaches the authoritative Korvix user id to the checkout's custom data, and
returns only the safe checkout URL. This is the link that finally populates
`app_user_id` on subscriptions (via webhook meta.custom_data → PR-3 projection),
which the PR-4/5/6 entitlement, gating and usage layers already consume.

Scope (strict): checkout creation + user linking only. NO credit ledger, credit
grants, AI-Guard credit enforcement, customer portal, plan prices / credit
quantities, subscription-projection or webhook redesign, or billing frontend UI
beyond this backend contract.

Public surface:

    from backend.services.billing.checkout import service as checkout
    result = await checkout.create_checkout(user_id=uid, requested_variant="pro_monthly")
    # result.url  → the only value the frontend needs

Feature flag:
    ENABLE_BILLING_CHECKOUT=true → endpoint creates checkouts
    default / unset              → endpoint returns 503 (dormant)

Storage shares the billing database (billing.db / Postgres) — a separate
`billing_checkouts` table for idempotency + bounded owner diagnostics. No
secret is ever stored or logged.
"""
from backend.services.billing.checkout import config, catalog, service, store
from backend.services.billing.checkout.types import (
    CheckoutVariant, CheckoutResult, CheckoutRecord,
)
from backend.services.billing.checkout.errors import (
    CheckoutError, CheckoutDisabled, CheckoutConfigError,
    CheckoutValidationError, CheckoutUpstreamError,
)

__all__ = [
    "config", "catalog", "service", "store",
    "CheckoutVariant", "CheckoutResult", "CheckoutRecord",
    "CheckoutError", "CheckoutDisabled", "CheckoutConfigError",
    "CheckoutValidationError", "CheckoutUpstreamError",
]
