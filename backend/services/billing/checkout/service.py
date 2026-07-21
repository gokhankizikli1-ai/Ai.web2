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
    CheckoutDisabled, CheckoutValidationError,
)
from backend.services.billing.checkout.types import CheckoutRecord, CheckoutResult


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
) -> CheckoutResult:
    """Create (or idempotently return) a checkout for `user_id`.

    Raises: CheckoutDisabled (surface off), CheckoutValidationError (bad
    variant / return_url), CheckoutConfigError (server misconfig),
    CheckoutUpstreamError (provider failure). `user_id` MUST already be the
    authoritative, backend-derived id — this layer never reads identity from a
    request payload.
    """
    if not is_enabled():
        raise CheckoutDisabled("checkout is disabled")

    uid = (user_id or "").strip()
    if not uid:
        # Defence in depth — the route enforces auth; never mint a checkout for
        # an empty/anonymous identity.
        raise CheckoutValidationError("an authenticated user is required")

    variant = checkout_catalog.resolve(requested_variant)
    if variant is None:
        raise CheckoutValidationError("unknown or unavailable variant")

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

    # The user-id linkage: attached to Lemon custom data, echoed back on webhooks.
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
    return {
        "enabled": is_enabled(),
        "configured": bool(checkout_config.api_key() and checkout_config.store_id()),
        "variant_count": len(checkout_catalog.all_variants()),
        "variants": [v.selector for v in checkout_catalog.all_variants()],
        "store": checkout_store.store_stats(),
    }


__all__ = ["is_enabled", "create_checkout", "list_variants", "list_recent", "stats"]
