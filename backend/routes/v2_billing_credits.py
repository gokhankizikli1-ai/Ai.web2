# coding: utf-8
"""
v2 billing — authenticated credit balance (Phase 1).

  GET /v2/billing/credits/me   The AUTHORITATIVE credit snapshot for the
                               authenticated caller: current balance + lifetime
                               granted/consumed. Identity comes ONLY from backend
                               authentication (resolve_principal) — never from the
                               request body/query — so a caller can never read
                               another account's balance.

Server-authoritative: the frontend renders exactly what this returns and never
fabricates a balance. When the credit ledger is disabled (ENABLE_BILLING_CREDITS
off) this returns `enabled:false` with balance 0, and the UI shows a neutral
state. No secrets/tokens/PII are logged.

HTTP contract:
  200  { enabled, balance, lifetime_granted, lifetime_consumed, lifetime_capped }
  401  not authenticated
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services import credits_gateway

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/billing/credits", tags=["billing-credits"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


def _authenticated_uid(request: Request) -> Optional[str]:
    """Authoritative Korvix user id from backend auth, or None for guests.
    Identity is NEVER read from the request body/query."""
    try:
        from backend.core.principal import resolve_principal
        principal = resolve_principal(request)
    except Exception as exc:  # pragma: no cover — identity must not 500
        logger.warning("billing-credits: identity resolution failed: %s", exc)
        return None
    if not principal.is_authenticated:
        return None
    uid = (principal.user_id or "").strip()
    return uid or None


@router.get("/me")
async def credits_me(request: Request) -> JSONResponse:
    """The authenticated caller's authoritative credit snapshot."""
    uid = _authenticated_uid(request)
    if not uid:
        return _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))
    return _resp(200, envelope_ok(credits_gateway.credit_summary(uid)))


__all__ = ["router"]
