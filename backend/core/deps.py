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


__all__ = ["current_user", "require_auth"]
