# coding: utf-8
"""
Billing checkout — Lemon Squeezy API client (PR 7).

Creates a hosted checkout via the Lemon Squeezy API and returns only the safe
checkout URL (+ the checkout id for our records). The authoritative Korvix user
id is attached to `checkout_data.custom`, which Lemon Squeezy echoes back as
`meta.custom_data` on the resulting subscription webhooks — that is the link the
PR-3 projection reads into `app_user_id` and PR-4/5/6 consume.

Security / logging discipline:
  * The API key is sent as a Bearer header and is NEVER logged.
  * The raw API response is NEVER logged (it can contain customer data and the
    checkout token). On failure we log ONLY the HTTP status code.
  * Only the checkout id is logged on success — never the URL (it carries a
    token) or any payload.

httpx uses the process proxy/env by default (trust_env), matching the rest of
the app's outbound calls.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx

from backend.services.billing.checkout import config as checkout_config
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, CheckoutUpstreamError,
)


logger = logging.getLogger(__name__)


_ACCEPT = "application/vnd.api+json"


def _build_body(
    *, store_id: str, variant_id: str, custom: Dict[str, Any], redirect_url: Optional[str],
) -> Dict[str, Any]:
    attributes: Dict[str, Any] = {
        # checkout_data.custom is passed through to webhook meta.custom_data.
        "checkout_data": {"custom": custom},
    }
    if redirect_url:
        # product_options.redirect_url is where Lemon returns the buyer after a
        # successful purchase. Validated against an allowlist by the caller.
        attributes["product_options"] = {"redirect_url": redirect_url}
    return {
        "data": {
            "type": "checkouts",
            "attributes": attributes,
            "relationships": {
                "store": {"data": {"type": "stores", "id": str(store_id)}},
                "variant": {"data": {"type": "variants", "id": str(variant_id)}},
            },
        }
    }


async def _post(url: str, *, headers: Dict[str, str], body: Dict[str, Any], timeout: float) -> httpx.Response:
    """Isolated HTTP POST — the single network seam (mockable in tests)."""
    async with httpx.AsyncClient(timeout=timeout) as http:
        return await http.post(url, json=body, headers=headers)


async def create_checkout(
    *, variant_id: str, custom: Dict[str, Any], redirect_url: Optional[str],
) -> Dict[str, Optional[str]]:
    """Create a checkout and return {"url", "checkout_id"}.

    Raises CheckoutConfigError when the API key / store id are unset, and
    CheckoutUpstreamError on any API failure (carrying only the status code).
    """
    key = checkout_config.api_key()
    store_id = checkout_config.store_id()
    if not key or not store_id:
        # Do not reveal which is missing beyond a generic message; never log key.
        raise CheckoutConfigError("checkout is not configured")

    url = f"{checkout_config.api_base()}/v1/checkouts"
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": _ACCEPT,
        "Content-Type": _ACCEPT,
    }
    body = _build_body(store_id=store_id, variant_id=variant_id, custom=custom, redirect_url=redirect_url)

    try:
        resp = await _post(url, headers=headers, body=body, timeout=checkout_config.timeout_seconds())
    except httpx.HTTPError as exc:
        # Log the exception TYPE only — never the message (could echo the URL).
        logger.warning("checkout: Lemon API request failed: %s", type(exc).__name__)
        raise CheckoutUpstreamError("checkout provider unreachable") from exc

    if resp.status_code >= 400:
        # Status code only — never the response body.
        logger.warning("checkout: Lemon API returned status %d", resp.status_code)
        raise CheckoutUpstreamError("checkout provider error", status=resp.status_code)

    try:
        data = resp.json()
        attrs = (data.get("data") or {}).get("attributes") or {}
        checkout_url = attrs.get("url")
        checkout_id = (data.get("data") or {}).get("id")
    except Exception as exc:  # pragma: no cover — malformed success payload
        logger.warning("checkout: could not parse Lemon API response: %s", type(exc).__name__)
        raise CheckoutUpstreamError("checkout provider returned an unexpected response") from exc

    if not checkout_url:
        logger.warning("checkout: Lemon API response missing checkout url")
        raise CheckoutUpstreamError("checkout provider returned no url")

    # Log the id only — never the URL (carries a token).
    logger.info("checkout: created Lemon checkout id=%s", checkout_id or "-")
    return {"url": str(checkout_url), "checkout_id": str(checkout_id) if checkout_id else None}


__all__ = ["create_checkout"]
