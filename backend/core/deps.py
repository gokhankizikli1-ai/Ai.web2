# coding: utf-8
"""
FastAPI dependencies for auth.

  current_user(request)   ALWAYS returns a User. Resolution order:
                           1. request.state.user (populated by
                              AuthMiddleware when ENABLE_AUTH_V2=true)
                           2. Authorization: Bearer <jwt> header,
                              decoded directly here (works whether or
                              not AuthMiddleware is enabled)
                           3. Synthetic guest fallback
                          This is the fix for "Owner Mode invisible
                          after login on a deploy without ENABLE_AUTH_V2"
                          — without step 2, the JWT issued by /auth/login
                          and /auth/google was being ignored by every
                          /v2/admin/* route.

  require_auth(request)   Returns a User. Raises UnauthorizedError when
                          the request is a guest.

  require_owner(request)  Returns the authenticated owner. Identity
                          path OR OWNER_TOKEN header path.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request

from backend.services.auth.errors import MissingTokenError
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)


_FALLBACK_GUEST = User(
    id="guest:no-middleware",
    kind="guest",
    external_id="guest:no-middleware",
    display_name="",
)


# ── Bearer-token fallback ────────────────────────────────────────────────
#
# When AuthMiddleware is OFF, /v2/admin/* routes still need to recognise
# a freshly-logged-in user — otherwise Owner Mode never activates after
# Google login on a deploy where ENABLE_AUTH_V2 wasn't flipped. This
# helper decodes the JWT directly and tries both identity backends
# (auth_users for Google/Apple/guest, auth_password_users for email
# signup). Returns None on any failure; callers fall back to guest.

def _extract_bearer(request: Request) -> str:
    try:
        raw = request.headers.get("Authorization", "") or ""
    except Exception:
        return ""
    raw = raw.strip()
    if not raw.lower().startswith("bearer "):
        return ""
    return raw[7:].strip()


def _user_from_bearer(token: str) -> Optional[User]:
    """Verify a Bearer JWT and resolve it to a User dataclass.

    Returns None when:
      - token can't be verified (bad signature, expired, missing secret)
      - sub claim is empty
      - user no longer exists in either identity backend
    Never raises — callers depend on a clean None.
    """
    if not token:
        return None
    try:
        from backend.services.auth import tokens
        claims = tokens.verify(token, expected_type="access")
    except Exception as exc:
        logger.debug("current_user bearer decode failed: %s", exc)
        return None

    sub = str(claims.get("sub", "") or "").strip()
    if not sub:
        return None

    # 1) Identity store — Google / Apple / guest (matches the kind values
    #    in auth_users.kind). This is where Google logins land.
    try:
        from backend.services.auth.storage import get_user_by_id
        u = get_user_by_id(sub)
        if u is not None:
            return u
    except Exception as exc:
        logger.debug("current_user identity lookup failed: %s", exc)

    # 2) Password store — email/password signup. Synthesize a User
    #    dataclass with the same external_id convention the identity
    #    store would use, so downstream owner-email matching works
    #    consistently across both auth paths.
    try:
        from backend.services.auth import passwords
        pwu = passwords.get_by_id(sub)
        if pwu is not None:
            email = str(pwu.get("email", "") or "").strip().lower()
            return User(
                id=sub,
                kind="email",
                external_id=f"email:{email}" if email else f"password:{sub}",
                display_name=str(pwu.get("display_name") or ""),
            )
    except Exception as exc:
        logger.debug("current_user password lookup failed: %s", exc)

    return None


def current_user(request: Request) -> User:
    """Best-effort identity. Always returns a User, never raises.

    Resolution order:
      1. request.state.user (AuthMiddleware path) — preferred when set
         and non-guest, since the middleware already validated the token.
      2. Authorization: Bearer header — decoded inline so admin routes
         work whether or not ENABLE_AUTH_V2 is on. Required for the
         common "Google login on prod" path.
      3. Whatever the middleware did set (incl. a guest user) — keeps
         the original guest-id flow intact.
      4. Synthetic guest fallback when nothing else worked.
    """
    state_user = getattr(request.state, "user", None)
    if isinstance(state_user, User) and not state_user.is_guest:
        return state_user

    # Try the bearer header directly. Cheap when no header is present
    # (returns "" → None) so this isn't a per-request DB cost for
    # anonymous traffic.
    bearer = _extract_bearer(request)
    if bearer:
        bearer_user = _user_from_bearer(bearer)
        if bearer_user is not None:
            return bearer_user

    if isinstance(state_user, User):
        return state_user
    return _FALLBACK_GUEST


def require_auth(request: Request) -> User:
    """Returns the request's authenticated user. Raises if guest."""
    user = current_user(request)
    if user.is_guest:
        raise MissingTokenError(
            "This route requires authentication. Pass an Authorization: Bearer header."
        )
    return user


_OWNER_TOKEN_HEADER = "X-Korvix-Owner-Token"


def _extract_owner_token(request: Request) -> str:
    """Pull the owner-token header (if any) off a request. Truncates
    aggressively so a hostile client can't blow the request size budget."""
    try:
        raw = request.headers.get(_OWNER_TOKEN_HEADER, "") or ""
    except Exception:
        return ""
    return raw.strip()[:512]


def require_owner(request: Request) -> User:
    """Returns the authenticated owner identity. Raises when neither
    unlock path matches.

    Two paths, evaluated in order:
      1. Identity match — user from request.state.user OR Bearer token
         satisfies `is_owner()` (i.e. email matches OWNER_EMAIL etc.).
      2. Token match — request header `X-Korvix-Owner-Token` matches
         the OWNER_TOKEN env var (constant-time).
    """
    from backend.core.errors import UnauthorizedError
    from backend.services.admin.owner import (
        is_owner, match_owner_token,
    )

    user = current_user(request)
    token = _extract_owner_token(request)

    if not user.is_guest and is_owner(user):
        return user

    if token and match_owner_token(token):
        return user

    if user.is_guest and not token:
        raise MissingTokenError(
            "This route requires owner privileges. Provide a Bearer auth "
            "token or X-Korvix-Owner-Token header.",
        )
    raise UnauthorizedError(
        "This route requires owner privileges.",
        code="owner_required",
    )


__all__ = ["current_user", "require_auth", "require_owner"]
