# coding: utf-8
"""
Auth service — high-level operations that compose tokens.py + storage.py.

The routes in `backend/routes/v2_auth.py` call these functions and turn
their return values into HTTP responses. Everything here is sync (matches
the storage layer); the route handler stays async via FastAPI's normal
sync-in-async ergonomics.

Operations:
  create_guest(stable_nonce)        → (user, access_token, refresh_token)
                                       Idempotent for the same nonce.
  rotate_refresh(refresh_token)     → (user, new_access, new_refresh)
                                       Detects reuse of an already-revoked
                                       token and revokes the whole family
                                       (theft response).
  logout(refresh_token)             → None
                                       Revokes the family the token
                                       belongs to. Always safe to call,
                                       even with a never-seen jti.
  identity_for_access_token(token)  → User | None
                                       Used by the auth middleware and
                                       the /v2/auth/me route.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple

from backend.core.config import settings
from backend.services.auth import tokens
from backend.services.auth import storage
from backend.services.auth.errors import (
    ExpiredTokenError as AuthExpiredTokenError,
    InvalidTokenError,
    RevokedTokenError,
)
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────

def _access_ttl() -> int:
    return max(60, settings.ACCESS_TOKEN_TTL_MIN) * 60


def _refresh_ttl() -> int:
    return max(1, settings.REFRESH_TOKEN_TTL_DAYS) * 24 * 60 * 60


def _normalize_nonce(raw: str) -> str:
    """Trim + length-cap the client-supplied guest nonce so a hostile
    client can't fill the DB with arbitrarily-long external_ids."""
    cleaned = (raw or "").strip()
    if not cleaned:
        return secrets.token_hex(12)
    # Hash-style nonces are typically 12-64 chars. Anything longer is
    # almost certainly malicious or accidental — truncate.
    return cleaned[:64]


def _expires_at_iso(seconds: int) -> str:
    return datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + seconds,
        tz=timezone.utc,
    ).isoformat()


# ── Guest creation ────────────────────────────────────────────────────────

def create_guest(stable_nonce: str = "") -> Tuple[User, str, str]:
    """Create or return a guest user, issue fresh access+refresh tokens.

    The nonce is the stable browser identifier the frontend persists in
    localStorage (`korvix_user_id` today). Passing the same nonce twice
    returns the same User row but fresh tokens — that's the intended
    behaviour for "first-load on a returning browser".
    """
    nonce = _normalize_nonce(stable_nonce)
    external_id = f"guest:{nonce}"
    user = storage.get_or_create_user("guest", external_id)
    storage.touch_user(user.id)

    access_token, _ = tokens.issue(
        user.id, token_type="access", ttl_seconds=_access_ttl(),
        extra_claims={"kind": "guest"},
    )
    refresh_family = secrets.token_hex(16)
    refresh_token, refresh_claims = tokens.issue(
        user.id, token_type="refresh", ttl_seconds=_refresh_ttl(),
        extra_claims={"kind": "guest", "family": refresh_family},
    )
    storage.record_refresh_token(
        jti=refresh_claims["jti"],
        user_id=user.id,
        expires_at=_expires_at_iso(_refresh_ttl()),
        family_id=refresh_family,
    )
    logger.info("auth.create_guest | user_id=%s | external=%s", user.id, external_id)
    return user, access_token, refresh_token


# ── Refresh rotation ──────────────────────────────────────────────────────

def rotate_refresh(refresh_token: str) -> Tuple[User, str, str]:
    """Exchange a refresh token for a NEW access + a NEW refresh token.

    Rotation rule:
      - The presented refresh token's jti is revoked.
      - A new refresh token is issued under the SAME family id.
      - If the presented token's jti was already revoked at the time of
        the call → that's reuse of a stolen token. The entire family is
        revoked and the caller gets RevokedTokenError. The user must
        re-authenticate (which for a guest just means another
        create_guest).
    """
    try:
        claims = tokens.verify(refresh_token, expected_type="refresh")
    except tokens.TokenExpiredError as exc:
        raise AuthExpiredTokenError(str(exc))
    except tokens.TokenError as exc:
        raise InvalidTokenError(str(exc))

    jti = claims.get("jti")
    family = claims.get("family")
    user_id = claims.get("sub")
    if not (jti and family and user_id):
        raise InvalidTokenError("refresh token missing required claims")

    # Reuse detection — revoked-and-presented = theft.
    if storage.refresh_token_is_revoked(jti):
        revoked = storage.revoke_family(family)
        logger.warning(
            "auth.rotate_refresh | THEFT_RESPONSE | family=%s | revoked=%d rows",
            family, revoked,
        )
        raise RevokedTokenError("refresh token previously revoked")

    user = storage.get_user_by_id(user_id)
    if user is None:
        raise InvalidTokenError("refresh token's user no longer exists")
    storage.touch_user(user.id)

    # Issue new tokens — same family, fresh jtis.
    storage.revoke_refresh_token(jti)
    new_access, _ = tokens.issue(
        user.id, token_type="access", ttl_seconds=_access_ttl(),
        extra_claims={"kind": user.kind},
    )
    new_refresh, refresh_claims = tokens.issue(
        user.id, token_type="refresh", ttl_seconds=_refresh_ttl(),
        extra_claims={"kind": user.kind, "family": family},
    )
    storage.record_refresh_token(
        jti=refresh_claims["jti"],
        user_id=user.id,
        expires_at=_expires_at_iso(_refresh_ttl()),
        family_id=family,
    )
    logger.info("auth.rotate_refresh | user_id=%s | family=%s", user.id, family)
    return user, new_access, new_refresh


# ── Logout ─────────────────────────────────────────────────────────────────

def logout(refresh_token: str) -> bool:
    """Revoke the refresh token family. Returns True if any rows were
    revoked, False if the token was unrecognisable or already revoked."""
    try:
        claims = tokens.verify(refresh_token, expected_type="refresh")
    except tokens.TokenError:
        # Can't verify the token → can't revoke anything meaningfully.
        # Don't raise — logout should always feel like "it worked".
        return False
    family = claims.get("family")
    if not family:
        return False
    revoked = storage.revoke_family(family)
    logger.info("auth.logout | family=%s | revoked=%d rows", family, revoked)
    return revoked > 0


# ── Access-token verification ─────────────────────────────────────────────

def identity_for_access_token(access_token: str) -> Optional[User]:
    """Decode an access token and return the associated User, or None if
    the token is invalid / expired / the user no longer exists.

    NEVER raises — used by the auth middleware which falls back to guest
    state on any failure. The /v2/auth/me route uses require_auth() to
    re-verify and surface a 401 envelope when needed.
    """
    try:
        claims = tokens.verify(access_token, expected_type="access")
    except tokens.TokenError:
        return None
    user_id = claims.get("sub")
    if not user_id:
        return None
    return storage.get_user_by_id(user_id)


__all__ = [
    "create_guest", "rotate_refresh", "logout",
    "identity_for_access_token",
]
