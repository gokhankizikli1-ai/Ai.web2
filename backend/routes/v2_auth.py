# coding: utf-8
"""
v2 auth routes (Phase 3a).

Endpoints:
  POST /v2/auth/guest    Creates / returns a guest user; issues fresh
                         access + refresh tokens. Idempotent for the
                         same stable_nonce.

  POST /v2/auth/refresh  Exchanges a refresh token for a new
                         access + refresh pair. Detects reuse of
                         already-revoked tokens (theft response: revoke
                         the whole family, return 401).

  GET  /v2/auth/me       Returns the current authenticated user. Uses
                         `require_auth` so guests get a 401 envelope.

  POST /v2/auth/logout   Revokes the refresh-token family the caller
                         supplies. Always returns success — never leaks
                         whether a token existed.

All responses use the v2 envelope (`ok(...)` / `err(...)`). The legacy
/chat contract is untouched; this is a parallel namespace.

NOT in this PR (Phase 3b): /v2/auth/register, /v2/auth/login (email +
password), and the OAuth callback routes. The architecture here is
ready for them — they'll add new endpoints, not change existing ones.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from backend.core.deps import require_auth
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
