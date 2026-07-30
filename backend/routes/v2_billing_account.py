# coding: utf-8
"""
v2 billing — authenticated customer account surface (PR #525).

Provider-neutral endpoints the frontend uses AFTER a checkout redirect and from
the account/upgrade UI. Both derive identity from backend authentication ONLY
(resolve_principal) — never from the request body — so a caller can never read or
act on another account.

  GET  /v2/billing/me              The AUTHORITATIVE subscription/account snapshot
                                   the checkout-return page refreshes. Returns a
                                   BOUNDED, provider-neutral view resolved from the
                                   backend entitlement layer (subscription truth):
                                   { plan, status, provider, active, source }.
                                   This is the ONLY thing the return page trusts —
                                   query params / redirect never grant access.

  POST /v2/billing/customer-portal Mint a provider-neutral customer-portal URL for
                                   the authenticated caller. Polar → an AUTHENTICATED
                                   Polar customer session (never a public generic URL,
                                   never an arbitrary customer id). FAILS CLOSED — no
                                   silent cross-provider fallback.

HTTP contract (both gated by ENABLE_BILLING; 503 when off):
  GET  /me                200  { plan, status, provider, active, source }
                          401  not authenticated
  POST /customer-portal   200  { url }
                          401  not authenticated
                          404  no portal for the active provider / user unmapped
                          502  portal provider error
                          503  billing disabled / not configured / unknown provider
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.billing import config as billing_config
from backend.services.billing import portal as portal_service
from backend.services.billing.entitlements import service as entitlement_service
from backend.services.billing.entitlements.types import SOURCE_SUBSCRIPTION
from backend.services.billing.provider import UnknownProviderError
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, CheckoutUpstreamError, PortalNotAvailable, PortalNoCustomer,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/billing", tags=["billing-account"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


def _authenticated_uid(request: Request) -> Optional[str]:
    """Authoritative Korvix user id from backend auth, or None for guests.
    Identity is NEVER read from the request body."""
    try:
        from backend.core.principal import resolve_principal
        principal = resolve_principal(request)
    except Exception as exc:  # pragma: no cover — identity must not 500
        logger.warning("billing-account: identity resolution failed: %s", exc)
        return None
    if not principal.is_authenticated:
        return None
    uid = (principal.user_id or "").strip()
    return uid or None


@router.get("/me")
async def billing_me(request: Request) -> JSONResponse:
    """The authoritative, provider-neutral account snapshot the return page trusts.

    Resolved from the backend entitlement layer (subscription truth) — NOT from
    any redirect/query param. Bounded: plan + normalized status + provider only.
    """
    if not billing_config.is_enabled():
        return _resp(503, envelope_err("billing disabled", code="BILLING_DISABLED"))

    uid = _authenticated_uid(request)
    if not uid:
        return _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))

    # get_entitlements never raises and returns the default (free) plan when the
    # user has no entitling subscription or the layer is disabled — so this is a
    # safe authoritative read with no side effects.
    try:
        ent = entitlement_service.get_entitlements(uid)
    except Exception as exc:  # pragma: no cover — defensive; resolver is fail-open
        logger.warning("billing-account: entitlement resolve failed: %s", type(exc).__name__)
        return _resp(200, envelope_ok({
            "plan": "free", "status": None, "provider": None,
            "active": False, "source": "default",
        }))

    snapshot = {
        "plan": ent.plan_key,
        "status": ent.subscription_status,
        "provider": ent.provider,
        # `active` = the backend granted an entitling (non-default) plan. This is
        # the ONLY signal the frontend may treat as "subscription confirmed".
        "active": ent.source == SOURCE_SUBSCRIPTION and not ent.is_default,
        "source": ent.source,
    }
    return _resp(200, envelope_ok(snapshot))


@router.post("/customer-portal")
async def customer_portal(request: Request) -> JSONResponse:
    """Mint a validated HTTPS customer-portal URL for the authenticated caller.
    FAILS CLOSED — never a silent cross-provider fallback. See module docstring."""
    if not billing_config.is_enabled():
        return _resp(503, envelope_err("billing disabled", code="BILLING_DISABLED"))

    uid = _authenticated_uid(request)
    if not uid:
        return _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))

    try:
        url = await portal_service.create_portal_url(user_id=uid)
    except UnknownProviderError:
        # An explicitly-unknown BILLING_PROVIDER — fail closed, never assume Lemon.
        return _resp(503, envelope_err("billing provider misconfigured", code="BILLING_PROVIDER_UNKNOWN"))
    except CheckoutConfigError:
        return _resp(503, envelope_err("customer portal not configured", code="PORTAL_NOT_CONFIGURED"))
    except PortalNotAvailable:
        # The active provider has no customer portal (e.g. Lemon here). NOT a fallback.
        return _resp(404, envelope_err("customer portal is not available", code="PORTAL_NOT_AVAILABLE"))
    except PortalNoCustomer:
        # The authenticated user has no provider customer mapping yet. Fail safe.
        return _resp(404, envelope_err("no customer record for this account", code="PORTAL_NO_CUSTOMER"))
    except CheckoutUpstreamError:
        return _resp(502, envelope_err("customer portal provider error", code="PORTAL_UPSTREAM_ERROR"))
    except Exception as exc:  # pragma: no cover — never leak internals
        logger.warning("billing-account: portal unexpected error: %s", type(exc).__name__)
        return _resp(502, envelope_err("customer portal failed", code="PORTAL_FAILED"))

    return _resp(200, envelope_ok({"url": url}))


__all__ = ["router"]
