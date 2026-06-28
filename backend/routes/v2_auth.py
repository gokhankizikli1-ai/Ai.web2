# coding: utf-8
"""
v2 auth routes (Phase 3a + Phase-1 PR #3).

Endpoints:
  POST /v2/auth/guest     Creates / returns a guest user; issues fresh
                          access + refresh tokens. Idempotent for the
                          same stable_nonce.

  POST /v2/auth/refresh   Exchanges a refresh token for a new
                          access + refresh pair. Detects reuse of
                          already-revoked tokens (theft response:
                          revoke the whole family, return 401).

  POST /v2/auth/register  Phase-1 PR #3. Email + password registration
                          via Argon2id (PR #2). Issues an ACCESS-ONLY
                          token in v2 envelope. Refresh tokens for
                          email users are deferred to PR #4 (Guest
                          Merge) when cross-table identity unification
                          removes the FK barrier between
                          auth_password_users and auth_refresh_tokens.

  POST /v2/auth/login     Phase-1 PR #3. Email + password login.
                          Same access-only contract as /v2/auth/register.

  GET  /v2/auth/me        Returns the current authenticated user. Uses
                          `require_auth` so guests get a 401 envelope.

  POST /v2/auth/logout    Revokes the refresh-token family the caller
                          supplies. Always returns success — never
                          leaks whether a token existed.

All responses use the v2 envelope (`ok(...)` / `err(...)`). The legacy
/chat contract is untouched; this is a parallel namespace.

Out of scope for PR #3 (deferred to later roadmap PRs):
  - Refresh tokens for email users   → PR #4 (unification)
  - Email verification               → PR #6 (Resend)
  - Password reset                   → PR #6
  - OAuth in v2 envelope (Google)    → PR #5
  - Rate limiting                    → PR #9
  - FE migration to v2 routes        → PR #8
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.config import settings
from backend.core.deps import require_auth
from backend.core.responses import err as envelope_err
from backend.core.responses import ok as envelope_ok
from backend.services.auth import service as auth_service
from backend.services.auth.errors import InvalidTokenError
from backend.services.auth.identity import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/auth", tags=["auth"])


# ── Request models ────────────────────────────────────────────────────────

class GuestRequest(BaseModel):
    # Optional stable browser id. When the frontend has one in
    # localStorage, sending it here makes the guest session idempotent
    # across reloads. Empty → backend generates a fresh nonce.
    stable_nonce: str = Field(default="", max_length=64)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=4096)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(default="", max_length=4096)


# ── Phase-1 PR #3 request models (email + password) ──────────────────────

class RegisterRequest(BaseModel):
    # Length bounds match `services/auth/passwords.py` (EMAIL_MAX=254,
    # PASSWORD_MIN=8, PASSWORD_MAX=128). Pydantic enforces here so
    # malformed payloads 422 before we even touch the store.
    email:        str = Field(..., min_length=3,   max_length=254)
    password:     str = Field(..., min_length=8,   max_length=128)
    display_name: str = Field(default="",          max_length=120)


class LoginRequest(BaseModel):
    # Login password bound is wider on the floor (1) than register's so
    # users with PRE-PR2 short passwords (none exist today; defensive)
    # still get the proper invalid_credentials path rather than 422.
    email:    str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)


# ── /v2/auth/guest ────────────────────────────────────────────────────────

@router.post("/guest")
async def create_guest(body: GuestRequest, request: Request) -> dict:
    """Create or return a guest user; issue access + refresh tokens.

    Idempotent for the same `stable_nonce` — calling twice returns the
    same User row but fresh tokens. The frontend should call this once
    on first load when it has no access token, then store the returned
    tokens (access in memory, refresh in httpOnly cookie or
    localStorage depending on storage policy).
    """
    user, access, refresh = auth_service.create_guest(body.stable_nonce)
    return envelope_ok(
        data={
            "user":          user.public_dict(),
            "access_token":  access,
            "refresh_token": refresh,
            "token_type":    "Bearer",
        },
        endpoint="/v2/auth/guest",
        request_ip=str(request.client.host) if request.client else None,
    )


# ── /v2/auth/refresh ──────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh(body: RefreshRequest) -> dict:
    """Exchange a refresh token for a new access + refresh pair.

    Errors flow through the v2 envelope handler:
      InvalidTokenError  401 invalid_token   (malformed or wrong type)
      ExpiredTokenError  401 expired_token   (signature ok, exp past)
      RevokedTokenError  401 revoked_token   (reuse — family is killed)
    """
    user, access, new_refresh = auth_service.rotate_refresh(body.refresh_token)
    return envelope_ok(
        data={
            "user":          user.public_dict(),
            "access_token":  access,
            "refresh_token": new_refresh,
            "token_type":    "Bearer",
        },
        endpoint="/v2/auth/refresh",
    )


# ── /v2/auth/me ───────────────────────────────────────────────────────────

@router.get("/me")
async def me(user: User = Depends(require_auth)) -> dict:
    """Return the authenticated user. Guests are rejected with 401."""
    return envelope_ok(
        data={"user": user.public_dict()},
        endpoint="/v2/auth/me",
    )


# ── /v2/auth/logout ───────────────────────────────────────────────────────

@router.post("/logout")
async def logout(body: LogoutRequest) -> dict:
    """Revoke the refresh-token family the caller supplies.

    Always returns success — we never reveal whether a token existed.
    Safe to call with an empty body (no-op).
    """
    revoked = False
    if body.refresh_token:
        try:
            revoked = auth_service.logout(body.refresh_token)
        except InvalidTokenError:
            # Token was malformed — silent success.
            revoked = False
    return envelope_ok(
        data={"revoked": revoked},
        endpoint="/v2/auth/logout",
    )


# ── Phase-1 PR #3: email + password ──────────────────────────────────────
#
# Both /v2/auth/register and /v2/auth/login compose `passwords` (the
# Argon2id-by-default store from PR #2) with the existing v2 envelope.
# Access-only tokens for now — refresh tokens for email users wait on
# the cross-table identity unification in PR #4 (Guest Merge), because
# `auth_refresh_tokens.user_id` REFERENCES `auth_users(id)` and email
# users currently live in the separate `auth_password_users` table.

def _access_token_for_password_user(user: dict) -> str:
    """Issue an access token for an email/password user.

    Claims mirror the shape `core/deps.current_user` + `middleware/auth`
    + the legacy `/auth/login` already emit (`kind`, `email`) so the
    same JWT works against every consumer regardless of which login
    route issued it. TTL matches the existing access-token policy
    (settings.ACCESS_TOKEN_TTL_MIN). No refresh — see module comment.
    """
    from backend.services.auth import tokens
    ttl_seconds = max(60, settings.ACCESS_TOKEN_TTL_MIN) * 60
    try:
        token, _claims = tokens.issue(
            sub=user["id"],
            token_type="access",
            ttl_seconds=ttl_seconds,
            extra_claims={"kind": "email", "email": user.get("email", "")},
        )
    except tokens.TokenSecretMissingError:
        # Fail closed — same shape as the rest of /v2/auth/* error envelopes.
        raise HTTPException(
            status_code=503,
            detail={
                "code":    "auth_not_configured",
                "message": "Authentication is not configured (JWT_SECRET_KEY missing).",
            },
        )
    return token


def _envelope_error_response(
    status_code: int,
    code: str,
    message: str,
    endpoint: str,
) -> JSONResponse:
    """Return a v2-envelope-shaped error response with an HTTP status.

    Bypasses HTTPException — FastAPI would wrap `detail` in
    `{"detail": ...}`, which doesn't match the envelope shape the v2
    contract guarantees. JSONResponse with `content=envelope_err(...)`
    gives clients a `{success: false, data: null, error, metadata,
    timestamp}` body at the correct status code.
    """
    return JSONResponse(
        status_code=status_code,
        content=envelope_err(message, code=code, endpoint=endpoint),
    )


@router.post("/register")
async def register(body: RegisterRequest, request: Request):
    """Create an email/password user, return access token + user in
    v2 envelope. Argon2id hash is produced by `passwords.create_user`.

    Errors:
      409 email_exists      — duplicate (normalized) email
      400 validation_error  — bad email shape or password length
      503 auth_not_configured — JWT_SECRET_KEY missing in production
    """
    from backend.services.auth import passwords
    try:
        user = passwords.create_user(body.email, body.password, body.display_name)
    except passwords.EmailExistsError as exc:
        return _envelope_error_response(409, "email_exists", str(exc), "/v2/auth/register")
    except passwords.InvalidInputError as exc:
        return _envelope_error_response(400, "validation_error", str(exc), "/v2/auth/register")

    access_token = _access_token_for_password_user(user)
    logger.info("auth.v2_register ok | user=%s", user["id"])
    return envelope_ok(
        data={
            "user":         user,
            "access_token": access_token,
            "token_type":   "Bearer",
        },
        endpoint="/v2/auth/register",
        request_ip=str(request.client.host) if request.client else None,
    )


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    """Verify email/password, return access token + user in v2 envelope.

    `passwords.verify_credentials` already:
      - Verifies BOTH Argon2id and legacy PBKDF2 hashes (PR #2).
      - Silently re-hashes a legacy PBKDF2 hash to Argon2id on success
        (zero-downtime migration, PR #2).
      - Equalises timing on the not-found-email path so a missing
        account is not detectably faster than a wrong password.

    Errors:
      401 invalid_credentials  — generic; NEVER reveals whether the
                                 email exists (defends against
                                 enumeration via response body too,
                                 not just timing).
      503 auth_not_configured  — JWT_SECRET_KEY missing in production.
    """
    from backend.services.auth import passwords
    user = passwords.verify_credentials(body.email, body.password)
    if user is None:
        return _envelope_error_response(
            401, "invalid_credentials",
            "Invalid email or password.",
            "/v2/auth/login",
        )
    # Best-effort touch + re-read so `last_login_at` in the response
    # matches what a subsequent GET /auth/me returns. Never fails the
    # login on this — matches the legacy /auth/login behaviour.
    try:
        passwords.touch_login(user["id"])
        fresh = passwords.get_by_id(user["id"])
        if fresh is not None:
            user = fresh
    except Exception as exc:
        logger.warning("auth.v2_login touch failed (non-fatal): %s", exc)

    access_token = _access_token_for_password_user(user)
    logger.info("auth.v2_login ok | user=%s", user["id"])
    return envelope_ok(
        data={
            "user":         user,
            "access_token": access_token,
            "token_type":   "Bearer",
        },
        endpoint="/v2/auth/login",
        request_ip=str(request.client.host) if request.client else None,
    )
