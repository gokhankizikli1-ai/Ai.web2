# coding: utf-8
"""
FastAPI dependencies for auth.

Two flavours:

  current_user(request)   ALWAYS returns a User. Falls back to a synthetic
                          guest if no middleware ran (e.g. the route is
                          mounted on an app without ENABLE_AUTH_V2). Use
                          this when a route accepts both guests and
                          authenticated users.

  require_auth(request)   Returns a User. Raises UnauthorizedError when
                          the request is a guest. Use this for protected
                          routes — Phase-3b will gate things like
                          "save my preferences" with this.

Both read from request.state.user, which AuthMiddleware populates. If
no middleware is installed, current_user returns a placeholder guest;
require_auth raises MissingTokenError.
"""
from __future__ import annotations

from fastapi import Request

from backend.services.auth.errors import MissingTokenError
from backend.services.auth.identity import User


_FALLBACK_GUEST = User(
    id="guest:no-middleware",
    kind="guest",
    external_id="guest:no-middleware",
    display_name="",
)


def current_user(request: Request) -> User:
    """Best-effort identity. Always returns a User, never raises."""
    user = getattr(request.state, "user", None)
    if isinstance(user, User):
        return user
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
      1. Identity match — user from request.state.user satisfies
         `is_owner()` (i.e. real backend session, email/id matches
         OWNER_EMAIL/OWNER_ID).
      2. Token match — request header `X-Korvix-Owner-Token` matches
         the OWNER_TOKEN env var (constant-time). Lets an owner whose
         browser doesn't run the /v2/auth/* flow still unlock admin.

    Routes that should be entirely invisible to non-owners (404 vs 401)
    should NOT use this dependency — they should check the env flag at
    the router-include layer instead. This dependency is for routes
    that are *known to exist* but require ownership.
    """
    # Local import keeps the admin package optional: a deployment that
    # never enables ENABLE_ADMIN_MODE can omit the admin/* tree
    # entirely and `deps.py` still imports cleanly.
    from backend.core.errors import UnauthorizedError
    from backend.services.admin.owner import (
        is_owner, match_owner_token,
    )

    user = current_user(request)
    token = _extract_owner_token(request)

    # Identity path
    if not user.is_guest and is_owner(user):
        return user

    # Token path — promotes the (possibly guest) caller. The downstream
    # audit log records user.id which will be "guest:<...>" — that's
    # the intended forensic signal: "this admin action came in via the
    # shared secret, not a real identity".
    if token and match_owner_token(token):
        return user

    # Neither path matched. If the caller is a guest with no token,
    # surface MissingTokenError (same code the auth middleware does)
    # so the frontend can branch on it. Otherwise surface a generic
    # owner_required.
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
