# coding: utf-8
"""
v2 billing — authenticated checkout creation (PR 7).

  GET  /v2/billing/checkout/variants   Public purchasable variants (selectors +
                                       plans + labels; NO prices). Lets the
                                       frontend render options.
  POST /v2/billing/checkout            Create a Lemon Squeezy checkout for the
                                       AUTHENTICATED caller and return only the
                                       safe checkout URL.

Identity: the Korvix user id is derived from backend authentication ONLY
(resolve_principal), never from the request body — a caller can never create a
checkout linked to another account. Guests are rejected 401.

The endpoint is gated by ENABLE_BILLING_CHECKOUT (503 when off) and fails closed
(503) when the Lemon API key / store id are unset. It returns ONLY the checkout
URL (+ safe echoes); no secrets or raw Lemon responses are ever exposed.

HTTP contract:
  200  { url, plan, selector, idempotent }
  400  unknown variant / disallowed return_url
  401  not authenticated
  429  — (n/a here)
  502  checkout provider error
  503  checkout disabled / not configured
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.billing.checkout import service as checkout_service
from backend.services.billing.checkout.errors import (
    CheckoutConfigError, CheckoutDisabled, CheckoutUpstreamError,
    CheckoutValidationError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/billing/checkout", tags=["billing-checkout"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}

# Bound the idempotency key so a hostile client can't blow the request budget.
_MAX_IDEMPOTENCY_KEY = 200


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


class CheckoutBody(BaseModel):
    # The variant to purchase — a public selector ("pro_monthly") or a
    # configured variant id. Validated server-side against the allowlist.
    variant: str = Field(..., min_length=1, max_length=120)
    # Optional post-purchase redirect; validated against the host allowlist.
    return_url: Optional[str] = Field(default=None, max_length=2048)
    # Optional idempotency key (may also be sent as the Idempotency-Key header).
    idempotency_key: Optional[str] = Field(default=None, max_length=_MAX_IDEMPOTENCY_KEY)


def _authenticated_uid(request: Request) -> Optional[str]:
    """Authoritative Korvix user id from backend auth, or None for guests."""
    try:
        from backend.core.principal import resolve_principal
        principal = resolve_principal(request)
    except Exception as exc:  # pragma: no cover — identity must not 500
        logger.warning("checkout: identity resolution failed: %s", exc)
        return None
    if not principal.is_authenticated:
        return None
    uid = (principal.user_id or "").strip()
    return uid or None


@router.get("/variants")
async def checkout_variants(request: Request) -> JSONResponse:
    """Public purchasable variants (no prices). 503 when checkout is disabled."""
    if not checkout_service.is_enabled():
        return _resp(503, envelope_err("checkout disabled", code="CHECKOUT_DISABLED"))
    return _resp(200, envelope_ok(checkout_service.list_variants()))


@router.post("")
async def create_checkout(body: CheckoutBody, request: Request) -> JSONResponse:
    """Create a checkout for the authenticated caller. See module docstring."""
    if not checkout_service.is_enabled():
        return _resp(503, envelope_err("checkout disabled", code="CHECKOUT_DISABLED"))

    uid = _authenticated_uid(request)
    if not uid:
        return _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))

    # Header takes precedence over body for the idempotency key.
    idem = (request.headers.get("Idempotency-Key") or "").strip()[:_MAX_IDEMPOTENCY_KEY] or body.idempotency_key

    try:
        result = await checkout_service.create_checkout(
            user_id=uid,
            requested_variant=body.variant,
            return_url=body.return_url,
            idempotency_key=idem,
        )
    except CheckoutDisabled:
        return _resp(503, envelope_err("checkout disabled", code="CHECKOUT_DISABLED"))
    except CheckoutConfigError:
        return _resp(503, envelope_err("checkout not configured", code="CHECKOUT_NOT_CONFIGURED"))
    except CheckoutValidationError as exc:
        return _resp(400, envelope_err(str(exc), code="INVALID_CHECKOUT_REQUEST"))
    except CheckoutUpstreamError:
        return _resp(502, envelope_err("checkout provider error", code="CHECKOUT_UPSTREAM_ERROR"))
    except Exception as exc:  # pragma: no cover — never leak internals
        logger.warning("checkout: unexpected error: %s", type(exc).__name__)
        return _resp(502, envelope_err("checkout failed", code="CHECKOUT_FAILED"))

    return _resp(200, envelope_ok(result.to_public_dict()))


__all__ = ["router"]
