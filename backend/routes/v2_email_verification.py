# coding: utf-8
"""
v2 email verification.

  POST /v2/auth/email-verification/send      Authenticated resend of the
                                             verification link for the CURRENT
                                             account (cooldown + rate limited).
  POST /v2/auth/email-verification/confirm   Public. Consumes a single-use token
                                             (from the email link) and, on the
                                             unverified→verified transition,
                                             issues the one-time starter grant.
  GET  /v2/auth/email-verification/status    Authenticated. Verification snapshot
                                             for the account UI (masked email +
                                             resend cooldown).

Design notes:
  * Identity for send/status comes ONLY from backend auth (resolve_principal) —
    never from the body — so a caller can only act on their own account. This
    also means send/status cannot be used to probe whether an arbitrary email
    exists (no email is ever accepted as input).
  * confirm is token-authenticated (the high-entropy token is the proof), so it
    works when the link is opened in a different browser without the session.
  * Responses are generic and carry no secret; no-store headers on every path.
  * The token itself is never logged (it arrives in a POST body, and handlers
    log only the outcome).
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.auth import verification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/auth/email-verification", tags=["auth"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


def _principal(request: Request):
    from backend.core.principal import resolve_principal
    try:
        return resolve_principal(request)
    except Exception as exc:  # pragma: no cover — identity must not 500
        logger.warning("email-verification: identity resolution failed: %s", exc)
        return None


def _mask_email(addr: Optional[str]) -> Optional[str]:
    a = (addr or "").strip()
    if not a or "@" not in a:
        return None
    local, _, domain = a.partition("@")
    return f"{local[:1]}***@{domain}"


def _client_ip(request: Request) -> Optional[str]:
    try:
        return request.client.host if request.client else None
    except Exception:
        return None


class ConfirmRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=512)


@router.get("/status")
async def status(request: Request) -> JSONResponse:
    """Verification snapshot for the authenticated caller."""
    principal = _principal(request)
    if not principal or not principal.is_authenticated:
        return _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))
    uid = (principal.user_id or "").strip()
    snap = verification.get_status(uid)
    # Idempotent self-heal: if verified but a transient failure skipped the
    # grant, re-attempt it (ledger dedupes). Best-effort.
    try:
        verification.reconcile_grant(uid)
    except Exception:
        pass
    try:
        from backend.core.config import settings
        enforced = bool(settings.ENABLE_EMAIL_VERIFICATION)
    except Exception:
        enforced = False
    email = snap.get("email") or principal.email
    return _resp(200, envelope_ok({
        "verified": bool(snap.get("verified")),
        "verification_required": enforced and not bool(snap.get("verified")),
        "email_masked": _mask_email(email),
        "cooldown_remaining": verification.send_cooldown_remaining(uid),
    }))


@router.post("/send")
async def send(request: Request) -> JSONResponse:
    """Resend the verification link for the authenticated caller.

    Generic response (never reveals whether an email exists — identity is the
    caller's own). Honours the per-user cooldown + hourly cap and a per-IP cap."""
    principal = _principal(request)
    if not principal or not principal.is_authenticated:
        return _resp(401, envelope_err("authentication required", code="UNAUTHORIZED"))
    uid = (principal.user_id or "").strip()
    snap = verification.get_status(uid)
    email = snap.get("email") or principal.email

    # Already verified → nothing to do (idempotent, no email, no enumeration).
    if snap.get("verified"):
        return _resp(200, envelope_ok({
            "sent": False, "already_verified": True,
            "cooldown_remaining": 0,
        }))

    if not email:
        # No destination on file — respond generically without erroring.
        return _resp(200, envelope_ok({"sent": False, "cooldown_remaining": 0}))

    from backend.services.auth.verification_email import send_verification_email
    outcome = await send_verification_email(uid, email, request_ip=_client_ip(request))
    return _resp(200, envelope_ok({
        "sent": bool(outcome.sent),
        "cooldown_remaining": int(outcome.cooldown_remaining),
    }))


@router.post("/confirm")
async def confirm(body: ConfirmRequest, request: Request) -> JSONResponse:
    """Consume a single-use verification token. Public (token-authenticated).

    Always returns 200 with a `status` the frontend switches on:
      verified | already_verified | expired | already_used | invalid
    The token is never logged."""
    result = verification.consume_token(body.token)
    logger.info("email-verification.confirm | status=%s", result.status)
    return _resp(200, envelope_ok({
        "status": result.status,
        "verified": result.ok,
    }))


__all__ = ["router"]
