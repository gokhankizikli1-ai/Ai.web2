# coding: utf-8
"""
Billing — Polar provider (PR #522 migration FOUNDATION only).

This subpackage is DORMANT. It exists so the Lemon Squeezy → Polar migration has
typed config accessors + a checkout adapter SEAM to fill in the implementation PR
(#524). It performs NO network calls and is NEVER selected by default:

  * `resolve_provider()` (billing/provider.py) returns `lemon_squeezy` unless the
    operator explicitly sets `BILLING_PROVIDER=polar`.
  * The checkout adapter here FAILS CLOSED — it raises a typed
    `CheckoutProviderUnavailable` (→ 503) and NEVER returns a checkout URL. There
    is no silent fallback from Polar to Lemon.
  * All Polar config accessors default empty, so `is_configured()` is False until
    the operator provisions Polar secrets — which are backend-only, never VITE.

Do not add live Polar API calls, webhook state mutation, or a checkout that
returns a URL in this PR. That is PR #524 (Polar Checkout + Verified Webhook).
"""
from __future__ import annotations

__all__: list = []
