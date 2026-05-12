# coding: utf-8
"""
Auth exception hierarchy.

All errors subclass `backend.core.errors.UnauthorizedError` (which itself
extends ApiError). When the v2 envelope handler is installed they route
straight to a 401 + envelope response with a stable machine-readable
`code` in metadata.

Codes the frontend can branch on:
  - missing_token   no Authorization header on a protected route
  - invalid_token   header present but token couldn't be verified
  - expired_token   signature valid but exp claim in the past — the
                    frontend should try POST /v2/auth/refresh first,
                    only fall back to re-login on a second failure
  - revoked_token   refresh token previously seen but explicitly revoked
                    (logout, theft response)
  - guest_required  endpoint accepts guests but the request had no usable
                    identity at all (rare; mostly defensive)
"""
from __future__ import annotations

from backend.core.errors import UnauthorizedError


class AuthError(UnauthorizedError):
    code = "auth_error"


class MissingTokenError(AuthError):
    code = "missing_token"


class InvalidTokenError(AuthError):
    code = "invalid_token"


class ExpiredTokenError(AuthError):
    code = "expired_token"


class RevokedTokenError(AuthError):
    code = "revoked_token"


__all__ = [
    "AuthError",
    "MissingTokenError",
    "InvalidTokenError",
    "ExpiredTokenError",
    "RevokedTokenError",
]
