# coding: utf-8
"""
Billing Polar — checkout client (PR #524).

Creates a Polar hosted checkout (`POST {api_base}/v1/checkouts`) and returns ONLY
the safe checkout URL (+ id for our records), mirroring the Lemon client's
`-> {"url", "checkout_id"}` so the checkout-service seam does not change again.

Identity: the AUTHORITATIVE Korvix user id (backend-derived, passed in `custom`)
is set as `external_customer_id` AND echoed in bounded `metadata` — Polar returns
external_customer_id on the customer object and copies metadata to the resulting
order/subscription, giving the webhook two signed ways to reconcile the user. The
frontend never supplies the product id, price, amount, currency, org id or
metadata (all backend-controlled).

Security / logging discipline (same as the Lemon client):
  * Bearer token is sent as a header and NEVER logged.
  * The raw API response is NEVER logged; only the checkout id on success.
  * Checkout creation grants NO entitlement (that is the verified webhook's job).
  * FAILS CLOSED: missing config → CheckoutConfigError (503); any API/parse/URL
    problem → CheckoutUpstreamError (502). NEVER falls back to Lemon.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

from backend.services.billing.checkout import config as checkout_config
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, CheckoutUpstreamError,
)
from backend.services.billing.checkout.types import CheckoutVariant
from backend.services.billing.polar import config as polar_config


logger = logging.getLogger(__name__)

# Bound how much of a (possibly hostile / huge) response we will read + parse.
_MAX_RESPONSE_BYTES = 256 * 1024
_MAX_META_VALUE = 200

# How many redirects we will follow for a Polar API call. Polar may answer a POST
# with a 307/308 to the canonical (trailing-slash) path; httpx would otherwise
# return the 3xx UNfollowed — a sub-400 response whose empty body then fails JSON
# parsing (the observed sandbox JSONDecodeError → 502). httpx preserves method +
# body on 307/308 and strips the Authorization header on any cross-host hop, so
# following is safe. Kept small so a redirect loop can never hang checkout.
_MAX_REDIRECTS = 3


def _safe_response_diagnostics(resp: "httpx.Response") -> str:
    """A NON-sensitive one-line description of a response for logs: status code,
    Content-Type, response byte length, and redirect hops as host+path ONLY.

    NEVER includes the response body, the Authorization header, any token, the
    query string (which may carry tokens), or PII. Fully defensive so a logging
    call can never itself raise."""
    try:
        ctype = (resp.headers.get("content-type") or "-").split(";")[0].strip() or "-"
    except Exception:
        ctype = "-"
    try:
        blen = len(resp.content or b"")
    except Exception:
        blen = -1
    hops = ""
    try:
        history = getattr(resp, "history", None) or ()
        if history:
            u = getattr(resp, "url", None)
            # host + path only — deliberately DROP the query string.
            loc = f"{getattr(u, 'host', '-')}{getattr(u, 'path', '')}" if u is not None else "-"
            hops = f" redirects={len(history)} final={loc}"
    except Exception:
        hops = ""
    return f"status={resp.status_code} content_type={ctype} bytes={blen}{hops}"


def _final_scheme_ok(resp: "httpx.Response") -> bool:
    """True unless a redirect downgraded the transport off HTTPS. Tolerant of
    response objects without a `.url` (e.g. unit-test fakes) — those are treated
    as OK because the caller controls them."""
    u = getattr(resp, "url", None)
    if u is None:
        return True
    return getattr(u, "scheme", "https") == "https"


def _valid_checkout_url(url: str) -> bool:
    """A returned checkout URL must be an absolute HTTPS URL with a host."""
    try:
        p = urlparse(url)
        return p.scheme == "https" and bool(p.hostname)
    except Exception:
        return False


def _bounded_metadata(*, user_id: str, variant: CheckoutVariant) -> Dict[str, str]:
    """Bounded, non-secret metadata copied to the resulting subscription. Carries
    the Korvix identity + plan selector so the webhook can reconcile the user."""
    md = {
        "user_id": str(user_id)[:_MAX_META_VALUE],
        "plan": str(variant.plan)[:_MAX_META_VALUE],
        "selector": str(variant.selector)[:_MAX_META_VALUE],
    }
    if variant.interval:
        md["interval"] = str(variant.interval)[:_MAX_META_VALUE]
    return md


async def _post(url: str, *, headers: Dict[str, str], body: Dict[str, Any], timeout: float) -> httpx.Response:
    """Isolated HTTP POST — the single network seam (mockable in tests).

    Redirects ARE followed, but bounded (`_MAX_REDIRECTS`): Polar's API may answer
    a POST with a 307/308 to the canonical (trailing-slash) path, and httpx would
    otherwise return that 3xx unfollowed — a sub-400 response whose empty body then
    fails JSON parsing. httpx preserves method + body on 307/308 and strips the
    Authorization header on any cross-host hop, so this stays safe and fail-closed."""
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, max_redirects=_MAX_REDIRECTS,
    ) as http:
        return await http.post(url, json=body, headers=headers)


async def create_checkout(
    *,
    variant: CheckoutVariant,
    custom: Dict[str, Any],
    redirect_url: Optional[str],
    customer_email: Optional[str] = None,
    customer_ip: Optional[str] = None,   # accepted for future use; not sent as an unverified field
) -> Dict[str, Optional[str]]:
    """Create a Polar checkout and return {"url", "checkout_id"}. FAILS CLOSED."""
    token = polar_config.access_token()
    org_id = polar_config.organization_id()
    if not token or not org_id:
        raise CheckoutConfigError("polar checkout is not configured")

    product_id = (variant.product_id or "").strip()
    if not product_id:
        # A Polar-selected variant MUST map to a Polar product id (backend allowlist).
        raise CheckoutConfigError("polar variant has no product_id")

    uid = str((custom or {}).get("user_id") or "").strip()
    if not uid:
        raise CheckoutConfigError("missing authenticated user id for polar checkout")

    body: Dict[str, Any] = {
        "products": [product_id],
        "external_customer_id": uid,                 # AUTHORITATIVE Korvix identity
        "metadata": _bounded_metadata(user_id=uid, variant=variant),
    }
    if redirect_url:
        body["success_url"] = redirect_url           # already allowlist-validated by the service
    if customer_email:
        body["customer_email"] = str(customer_email)[:320]

    url = f"{polar_config.api_base()}/v1/checkouts"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        resp = await _post(url, headers=headers, body=body, timeout=checkout_config.timeout_seconds())
    except httpx.HTTPError as exc:
        logger.warning("checkout: Polar API request failed: %s", type(exc).__name__)
        raise CheckoutUpstreamError("checkout provider unreachable") from exc

    # Fail closed if a followed redirect somehow downgraded off HTTPS.
    if not _final_scheme_ok(resp):
        logger.warning("checkout: Polar API response not over https (%s)", _safe_response_diagnostics(resp))
        raise CheckoutUpstreamError("checkout provider returned an insecure response")

    if resp.status_code >= 400:
        logger.warning("checkout: Polar API returned status %d", resp.status_code)
        raise CheckoutUpstreamError("checkout provider error", status=resp.status_code)

    # Bound the parsed body defensively.
    raw = resp.content or b""
    if len(raw) > _MAX_RESPONSE_BYTES:
        logger.warning("checkout: Polar API response too large (%d bytes)", len(raw))
        raise CheckoutUpstreamError("checkout provider returned an unexpected response")

    # A 204 / empty 2xx body would make resp.json() raise JSONDecodeError — surface
    # it as a precise, safe error instead of an opaque parse failure.
    if resp.status_code == 204 or not raw.strip():
        logger.warning("checkout: Polar API returned an empty response (%s)", _safe_response_diagnostics(resp))
        raise CheckoutUpstreamError("checkout provider returned an empty response", status=resp.status_code)

    try:
        data = resp.json()
        checkout_url = (data.get("url") if isinstance(data, dict) else None)
        checkout_id = (data.get("id") if isinstance(data, dict) else None)
    except Exception as exc:
        # Safe diagnostics ONLY (status / content-type / bytes / redirect host+path).
        logger.warning("checkout: could not parse Polar API response (%s)", _safe_response_diagnostics(resp))
        raise CheckoutUpstreamError("checkout provider returned an unexpected response") from exc

    if not checkout_url or not _valid_checkout_url(str(checkout_url)):
        logger.warning("checkout: Polar API response missing/invalid checkout url")
        raise CheckoutUpstreamError("checkout provider returned no valid url")

    logger.info("checkout: created Polar checkout id=%s", str(checkout_id) if checkout_id else "-")
    return {"url": str(checkout_url), "checkout_id": str(checkout_id) if checkout_id else None}


async def create_customer_session(*, external_customer_id: str) -> str:
    """Create an authenticated Polar customer session and return ONLY the
    validated HTTPS customer-portal URL. Identity is the AUTHORITATIVE Korvix
    user id (external_customer_id) — never an arbitrary id from the frontend.

    FAILS CLOSED: CheckoutConfigError when Polar is unconfigured; CheckoutUpstreamError
    on any API/parse/URL problem (e.g. 404 = no such customer). NEVER logs the token.
    """
    token = polar_config.access_token()
    if not token or not polar_config.organization_id():
        raise CheckoutConfigError("polar is not configured")
    uid = (external_customer_id or "").strip()
    if not uid:
        raise CheckoutConfigError("missing authenticated user id for customer session")

    url = f"{polar_config.api_base()}/v1/customer-sessions"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        resp = await _post(url, headers=headers, body={"external_customer_id": uid},
                           timeout=checkout_config.timeout_seconds())
    except httpx.HTTPError as exc:
        logger.warning("portal: Polar customer-session request failed: %s", type(exc).__name__)
        raise CheckoutUpstreamError("portal provider unreachable") from exc
    if not _final_scheme_ok(resp):
        logger.warning("portal: Polar customer-session not over https (%s)", _safe_response_diagnostics(resp))
        raise CheckoutUpstreamError("portal provider returned an insecure response")
    if resp.status_code >= 400:
        # 404 here typically means the user has no Polar customer yet.
        logger.warning("portal: Polar customer-session returned status %d", resp.status_code)
        raise CheckoutUpstreamError("portal provider error", status=resp.status_code)
    raw = resp.content or b""
    if resp.status_code == 204 or not raw.strip():
        logger.warning("portal: Polar customer-session returned an empty response (%s)", _safe_response_diagnostics(resp))
        raise CheckoutUpstreamError("portal provider returned an empty response", status=resp.status_code)
    try:
        data = resp.json()
        portal_url = (data.get("customer_portal_url") if isinstance(data, dict) else None)
    except Exception as exc:
        logger.warning("portal: could not parse Polar customer-session (%s)", _safe_response_diagnostics(resp))
        raise CheckoutUpstreamError("portal provider returned an unexpected response") from exc
    if not portal_url or not _valid_checkout_url(str(portal_url)):
        logger.warning("portal: Polar customer-session missing/invalid portal url")
        raise CheckoutUpstreamError("portal provider returned no valid url")
    # Never log the URL (it authenticates a session).
    return str(portal_url)


__all__ = ["create_checkout", "create_customer_session"]
