# coding: utf-8
"""
Billing checkout — orchestration (PR 7).

Ties validation + idempotency + the Lemon API client together and returns only
the safe checkout URL. The authoritative Korvix user id is passed in by the
route (derived from backend auth) and attached to Lemon `checkout_data.custom`
so the resulting subscription webhooks carry it back as `meta.custom_data`
(the PR-3 → PR-6 link). No secrets or raw API responses are returned or logged.
"""
from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import urlparse

from backend.services.billing.checkout import config as checkout_config
from backend.services.billing.checkout import catalog as checkout_catalog
from backend.services.billing.checkout import client as checkout_client
from backend.services.billing.checkout import store as checkout_store
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, CheckoutDisabled, CheckoutValidationError,
)
from backend.services.billing.checkout.types import CheckoutRecord, CheckoutResult
from backend.services.billing.provider import (
    resolve_provider, resolve_provider_strict, UnknownProviderError,
)
from backend.services.billing.polar import checkout as polar_checkout
from backend.services.billing.types import PROVIDER_POLAR


logger = logging.getLogger(__name__)

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def is_enabled() -> bool:
    return checkout_config.is_enabled()


def _validate_return_url(raw: Optional[str]) -> Optional[str]:
    """Return a validated redirect URL, or None to fall back to the configured
    default. Guards against open redirects: https only (http allowed only for
    localhost), and the host must be in the allowlist."""
    if raw is None or not str(raw).strip():
        return None
    u = str(raw).strip()
    parsed = urlparse(u)
    host = (parsed.hostname or "").lower()
    if not host:
        raise CheckoutValidationError("return_url is not a valid absolute URL")
    is_local = host in _LOCAL_HOSTS
    if parsed.scheme not in ("https", "http") or (parsed.scheme == "http" and not is_local):
        raise CheckoutValidationError("return_url must use https")
    if not is_local and host not in checkout_config.allowed_return_hosts():
        raise CheckoutValidationError("return_url host is not allowed")
    return u


async def create_checkout(
    *,
    user_id: str,
    requested_variant: str,
    return_url: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    customer_email: Optional[str] = None,
    customer_ip: Optional[str] = None,
) -> CheckoutResult:
    """Create (or idempotently return) a checkout for `user_id`.

    Raises: CheckoutDisabled (surface off), CheckoutValidationError (bad
    variant / return_url / provider mismatch), CheckoutConfigError (server
    misconfig / unknown provider), CheckoutUpstreamError (provider failure),
    CheckoutProviderUnavailable (selected provider has no live checkout).
    `user_id` MUST already be the authoritative, backend-derived id — this layer
    never reads identity from a request payload. `customer_email` MUST come only
    from the authenticated account (Polar only); `customer_ip` from a trusted
    proxy header.
    """
    if not is_enabled():
        raise CheckoutDisabled("checkout is disabled")

    uid = (user_id or "").strip()
    if not uid:
        # Defence in depth — the route enforces auth; never mint a checkout for
        # an empty/anonymous identity.
        raise CheckoutValidationError("an authenticated user is required")

    # PR #524 — FAIL CLOSED on an explicitly-unknown BILLING_PROVIDER (never
    # silently charge through the default). Empty/unset stays lemon_squeezy.
    try:
        provider = resolve_provider_strict()
    except UnknownProviderError as exc:
        raise CheckoutConfigError(str(exc)) from exc

    variant = checkout_catalog.resolve(requested_variant)
    if variant is None:
        raise CheckoutValidationError("unknown or unavailable variant")
    # A variant configured for a DIFFERENT provider is not purchasable under the
    # active provider (never map across providers).
    if (variant.provider or "lemon_squeezy") != provider:
        raise CheckoutValidationError("variant is not available for the active billing provider")

    redirect_url = _validate_return_url(return_url)
    if redirect_url is None:
        # Operator-configured default (trusted); may be empty → Lemon store default.
        redirect_url = checkout_config.default_return_url() or None

    key = (idempotency_key or "").strip() or None

    # Idempotent replay: a prior attempt with the same key returns the same URL
    # without creating a second checkout (double-click / retry safety).
    if key:
        prior = checkout_store.get_by_idempotency(uid, key)
        if prior is not None and prior.checkout_url:
            logger.info("checkout: idempotent replay for user=%s variant=%s", uid, variant.selector)
            return CheckoutResult(
                url=prior.checkout_url, selector=prior.selector, variant_id=prior.variant_id,
                plan=prior.plan, checkout_id=prior.checkout_id, idempotent=True,
            )

    # PR #522/#524 — provider dispatch (provider was resolved strictly above).
    # Default lemon = byte-for-byte the PR-7 Lemon path. Polar creates a real
    # checkout (external_customer_id + bounded metadata carry the Korvix identity).
    # NEVER a silent fallback from Polar to Lemon.
    if provider == PROVIDER_POLAR:
        created = await polar_checkout.create_checkout(
            variant=variant,
            custom={"user_id": uid},
            redirect_url=redirect_url,
            customer_email=customer_email,
            customer_ip=customer_ip,
        )
    else:
        created = await checkout_client.create_checkout(
            variant_id=variant.variant_id,
            custom={"user_id": uid},
            redirect_url=redirect_url,
        )

    record = CheckoutRecord(
        user_id=uid, selector=variant.selector, variant_id=variant.variant_id,
        plan=variant.plan, checkout_id=created.get("checkout_id"),
        checkout_url=created.get("url") or "", idempotency_key=key,
    )
    inserted, stored = checkout_store.insert(record)
    # On a concurrent idempotency-key conflict, prefer the already-stored URL so
    # both callers converge on one checkout.
    final_url = stored.checkout_url or created.get("url") or ""
    return CheckoutResult(
        url=final_url, selector=variant.selector, variant_id=variant.variant_id,
        plan=variant.plan, checkout_id=stored.checkout_id or created.get("checkout_id"),
        idempotent=not inserted,
    )


def list_variants() -> dict:
    """Public variant catalog (safe: selectors + plans + labels, no prices)."""
    return checkout_catalog.to_public_dict()


def list_recent(**kwargs):
    return checkout_store.list_recent(**kwargs)


def stats() -> dict:
    from backend.services.billing.polar import config as polar_config
    return {
        "enabled": is_enabled(),
        "configured": bool(checkout_config.api_key() and checkout_config.store_id()),
        # PR #522 — non-secret provider observability. `provider` is the active
        # selection (default lemon_squeezy); `polar` reports config presence only.
        "provider": resolve_provider(),
        "polar": polar_config.config_status(),
        "variant_count": len(checkout_catalog.all_variants()),
        "variants": [v.selector for v in checkout_catalog.all_variants()],
        "store": checkout_store.store_stats(),
    }


__all__ = ["is_enabled", "create_checkout", "list_variants", "list_recent", "stats"]
