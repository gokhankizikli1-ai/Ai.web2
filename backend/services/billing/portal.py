# coding: utf-8
"""
Billing — provider-neutral customer portal seam (PR #525).

Returns a validated HTTPS customer-portal URL for the AUTHENTICATED Korvix user.
The frontend supplies NO customer id — identity is the backend-derived user id.

  * Provider selection is strict (`resolve_provider_strict`): an explicitly-unknown
    provider fails closed; empty/unset stays Lemon.
  * Polar: requires Polar configured AND the user to already have a Polar customer
    mapping (a projected `provider=polar` subscription); it then mints an
    AUTHENTICATED Polar customer session via the existing Polar client — never
    Polar's generic public URL, never an arbitrary customer id. Fails SAFE when
    unconfigured or unmapped, and NEVER falls back to Lemon.
  * Lemon: no portal is implemented (there is nothing to "preserve") → a typed
    PortalNotAvailable. This is not a fallback — it is the honest current state.
"""
from __future__ import annotations

from backend.services.billing.provider import resolve_provider_strict, UnknownProviderError
from backend.services.billing.types import PROVIDER_POLAR
from backend.services.billing.polar import config as polar_config
from backend.services.billing.polar import checkout as polar_checkout
from backend.services.billing.subscriptions import store as subscription_store
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, PortalNotAvailable, PortalNoCustomer,
)


def _user_has_polar_customer(user_id: str) -> bool:
    """True when the user already has a projected Polar subscription (i.e. a Polar
    customer mapping exists). Fail-safe: any store error → False."""
    try:
        subs = subscription_store.list_subscriptions(app_user_id=user_id, provider=PROVIDER_POLAR, limit=1)
        return bool(subs)
    except Exception:
        return False


async def create_portal_url(*, user_id: str) -> str:
    """Return a validated HTTPS customer-portal URL for `user_id`. `user_id` MUST
    be the authoritative backend-derived id. Raises UnknownProviderError,
    CheckoutConfigError, PortalNotAvailable, PortalNoCustomer or CheckoutUpstreamError."""
    uid = (user_id or "").strip()
    if not uid:
        raise PortalNoCustomer("an authenticated user is required")

    provider = resolve_provider_strict()   # UnknownProviderError on an explicitly-unknown value
    if provider == PROVIDER_POLAR:
        if not polar_config.is_configured():
            raise CheckoutConfigError("polar is not configured")
        if not _user_has_polar_customer(uid):
            # Fail SAFE — never mint a portal for a user with no Polar customer.
            raise PortalNoCustomer("no polar customer mapping for this user")
        return await polar_checkout.create_customer_session(external_customer_id=uid)

    # Lemon (or default) has no implemented portal — honest, not a fallback.
    raise PortalNotAvailable("customer portal is not available for the active provider")


__all__ = ["create_portal_url", "UnknownProviderError"]
