# coding: utf-8
"""
Billing — Polar provider (PR #524: Polar Checkout + Verified Webhook).

Implements a real Polar integration that reuses the provider-neutral billing
foundation (#523). It is NEVER the active provider by default:

  * `resolve_provider()` (billing/provider.py) returns `lemon_squeezy` unless the
    operator explicitly sets `BILLING_PROVIDER=polar`; an unknown value fails
    closed in mutating paths (`resolve_provider_strict`).
  * `checkout.py` creates a real Polar hosted checkout (`POST /v1/checkouts`),
    setting external_customer_id + bounded metadata to the authoritative Korvix
    user id. It FAILS CLOSED (typed error) when Polar is unconfigured and NEVER
    falls back to Lemon.
  * `signature.py` verifies Polar **Standard Webhooks** (base64 HMAC-SHA256 +
    bounded timestamp tolerance) — kept separate from Lemon's hex verifier.
  * `config.py` accessors default empty / `POLAR_SERVER=sandbox`, so the whole
    integration stays dormant until the operator provisions Polar secrets
    (backend-only, never VITE) and switches `BILLING_PROVIDER`.

Verified Polar subscription webhooks project into the SAME inbox → processor →
`billing_subscriptions` table → entitlement resolver as Lemon. No second table,
ledger or engine. Checkout creation grants NO entitlement.
"""
from __future__ import annotations

__all__: list = []
