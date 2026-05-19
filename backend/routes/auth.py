# coding: utf-8
"""
Auth routes.

  GET  /auth/status   legacy liveness (unchanged — backward compatible)
  POST /auth/signup    email + password registration → access token
  POST /auth/login     email + password → access token
  GET  /auth/me        current user (protected; Bearer access token)
  POST /auth/logout    stateless logout (client discards token)

Additive & Railway-safe:
  - New paths only; no existing route/response shape changed.
  - Reuses the existing stdlib JWT (backend.services.auth.tokens) and
    JWT_SECRET_KEY — no new env var, no new pip dependency.
  - Credentials live in a new table in the existing auth.db
    (backend.services.auth.passwords).
  - Service/token imports are lazy inside handlers so a problem here can
    never break app boot or other routers.
  - Guest / anonymous /chat is untouched and keeps working — these
    endpoints are opt-in. `get_optional_user` is provided so chat history
    can be linked to a user_id in a LATER change without new infra.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

# 24h access token. Stateless: no server-side access-token store, so
# logout is client-side discard. Refresh-token issuance is intentionally
# out of scope for this minimal, backward-safe slice.
ACCESS_TTL_SECONDS = 24 * 3600


# ── Request models (no pydantic.EmailStr — email-validator isn't a dep) ──

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


# ── Helpers ───────────────────────────────────────────────────────────────

def _err(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": code, "code": code, "message": message},
    )


def _issue_access(user: Dict[str, Any]) -> Dict[str, Any]:
    """Issue an access token for a user dict. Maps a missing
    JWT_SECRET_KEY to a clean 503 instead of a 500/crash."""
    from backend.services.auth import tokens
    try:
        token, _claims = tokens.issue(
            sub=user["id"],
            token_type="access",
            ttl_seconds=ACCESS_TTL_SECONDS,
            extra_claims={"kind": "email", "email": user["email"]},
        )
    except tokens.TokenSecretMissingError:
        raise _err(503, "auth_not_configured",
                   "Authentication is not configured (JWT_SECRET_KEY missing).")
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": ACCESS_TTL_SECONDS,
        "user": user,
    }


def _decode_bearer(authorization: Optional[str]) -> Dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _err(401, "missing_token", "Authorization: Bearer <token> required.")
    raw = authorization.split(" ", 1)[1].strip()
    from backend.services.auth import tokens
    try:
        return tokens.verify(raw, expected_type="access")
    except tokens.TokenExpiredError:
        raise _err(401, "expired_token", "Access token expired. Please log in again.")
    except tokens.TokenSecretMissingError:
        raise _err(503, "auth_not_configured",
                   "Authentication is not configured (JWT_SECRET_KEY missing).")
    except tokens.TokenError:
        raise _err(401, "invalid_token", "Invalid authentication token.")


def get_current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Protected-user dependency. Use as `Depends(get_current_user)` on
    any route that must have an authenticated email user."""
    claims = _decode_bearer(authorization)
    from backend.services.auth import passwords
    user = passwords.get_by_id(str(claims.get("sub", "")))
    if user is None:
        raise _err(401, "invalid_token", "Account no longer exists.")
    return user


def get_optional_user(
    authorization: Optional[str] = Header(default=None),
) -> Optional[Dict[str, Any]]:
    """Non-enforcing variant — returns the user or None, never raises.
    Reserved so a later change can link chat history to a user_id
    WITHOUT changing existing anonymous/guest behaviour. Not wired into
    /chat in this change."""
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("/status")
async def auth_status():
    # Unchanged — pre-existing contract.
    return {"authenticated": False}


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest):
    from backend.services.auth import passwords
    try:
        user = passwords.create_user(body.email, body.password, body.display_name)
    except passwords.EmailExistsError as e:
        raise _err(409, "email_exists", str(e))
    except passwords.InvalidInputError as e:
        raise _err(400, "validation_error", str(e))
    logger.info("auth.signup ok | user=%s", user["id"])
    return _issue_access(user)


@router.post("/login")
async def login(body: LoginRequest):
    from backend.services.auth import passwords
    user = passwords.verify_credentials(body.email, body.password)
    if user is None:
        # Generic — never reveal whether the email exists.
        raise _err(401, "invalid_credentials", "Invalid email or password.")
    try:
        passwords.touch_login(user["id"])
    except Exception as exc:  # best-effort; never fail login on this
        logger.warning("auth.login touch failed (non-fatal): %s", exc)
    logger.info("auth.login ok | user=%s", user["id"])
    return _issue_access(user)


@router.get("/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    return {"user": user}


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    """Stateless logout. Access tokens are short-lived and not stored
    server-side, so logout = the client discards the token. Idempotent
    and forgiving (always 200, even without a valid token)."""
    return {
        "ok": True,
        "detail": "Logged out. Discard the access token client-side; "
                  "it expires automatically.",
    }
