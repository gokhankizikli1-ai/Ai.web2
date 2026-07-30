# coding: utf-8
"""
Billing Polar — checkout adapter (PR #522 migration FOUNDATION: fail-closed stub).

This is the SEAM the checkout service selects when `BILLING_PROVIDER=polar`. It is
intentionally NOT implemented: it FAILS CLOSED by raising
`CheckoutProviderUnavailable` (→ 503) and NEVER returns a checkout URL. There is
no silent fallback to Lemon Squeezy — selecting an unimplemented provider is a
hard, safe failure, not a downgrade.

The real implementation (Polar `POST /v1/checkouts`, product/price mapping,
customer identity via metadata, success URL) lands in PR #524. Its signature will
mirror the Lemon client's (`-> {"url", "checkout_id"}`) so the service seam does
not change again.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from backend.services.billing.checkout.errors import CheckoutProviderUnavailable
from backend.services.billing.checkout.types import CheckoutVariant
from backend.services.billing.polar import config as polar_config
from backend.services.billing.types import PROVIDER_POLAR


async def create_checkout(
    *,
    variant: CheckoutVariant,
    custom: Dict[str, Any],
    redirect_url: Optional[str],
) -> Dict[str, Optional[str]]:  # pragma: no cover - unreachable until PR #524
    """FAIL CLOSED. Polar checkout is not implemented in this foundation PR.

    Raises `CheckoutProviderUnavailable` unconditionally — even when Polar is
    fully configured — because no verified Polar checkout/webhook exists yet.
    Never returns a URL; never falls back to Lemon.
    """
    detail = "configured but not yet implemented" if polar_config.is_configured() else "not configured"
    raise CheckoutProviderUnavailable(
        f"the Polar billing provider is {detail}; checkout is unavailable",
        provider=PROVIDER_POLAR,
    )


__all__ = ["create_checkout"]
