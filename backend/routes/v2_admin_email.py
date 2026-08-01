# coding: utf-8
"""
v2 admin — email-verification readiness (owner-only diagnostics).

  GET /v2/admin/email-verification/readiness

Surfaces the REDACTED production-readiness of the email-verification system so an
operator can tell at a glance whether enabling ENABLE_EMAIL_VERIFICATION would
actually deliver mail — or is silently on the dev-safe console provider. Returns
only booleans / counts / a non-secret provider name / a route list. NEVER a
secret value, full email, token, API key, or verification link.

Owner-gated with the same identity-first predicate the billing admin routes use
(401 unauthenticated / 403 authenticated-non-owner / 200 owner). Mirrors that
pattern locally so this route does not import or modify any billing file.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.auth import verification_readiness

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/admin/email-verification", tags=["admin"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


def _owner_or_error(request: Request):
    """Return (user, None) for an owner, or (None, JSONResponse) otherwise.
    401 for an unauthenticated caller, 403 for an authenticated non-owner —
    matching the billing admin gate, without importing a billing module."""
    try:
        from backend.core.deps import current_user, _extract_owner_token
        from backend.services.admin.owner import is_owner_request
        user = current_user(request)
        if is_owner_request(user, owner_token=_extract_owner_token(request)):
            return user, None
        if user.is_guest:
            return None, _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))
        return None, _resp(403, envelope_err("owner privileges required", code="FORBIDDEN"))
    except Exception as exc:  # pragma: no cover — never 500 the diagnostic gate
        logger.warning("admin.email-readiness gate error: %s", type(exc).__name__)
        return None, _resp(403, envelope_err("owner privileges required", code="FORBIDDEN"))


@router.get("/readiness")
async def email_verification_readiness(request: Request) -> JSONResponse:
    """Owner-only redacted readiness snapshot for email verification."""
    _user, err = _owner_or_error(request)
    if err is not None:
        return err
    try:
        report = verification_readiness.evaluate()
    except Exception as exc:  # pragma: no cover — report must not 500
        logger.warning("admin.email-readiness evaluate error: %s", type(exc).__name__)
        return _resp(200, envelope_ok({"status": "unavailable"}))
    logger.info("admin.email-readiness viewed | status=%s", report.get("status"))
    return _resp(200, envelope_ok(report))


@router.get("/starter-abuse")
async def starter_abuse_readiness(request: Request) -> JSONResponse:
    """Owner-only redacted diagnostics for the starter-credit abuse layer:
    mode, thresholds, trusted-proxy assumption, and allow/defer/deny counters by
    reason category. No IP, email, id, token, or secret is ever returned."""
    _user, err = _owner_or_error(request)
    if err is not None:
        return err
    try:
        from backend.services.auth import starter_abuse
        report = starter_abuse.readiness()
    except Exception as exc:  # pragma: no cover — report must not 500
        logger.warning("admin.starter-abuse readiness error: %s", type(exc).__name__)
        return _resp(200, envelope_ok({"status": "unavailable"}))
    logger.info("admin.starter-abuse viewed | mode=%s", report.get("mode"))
    return _resp(200, envelope_ok(report))


__all__ = ["router"]
