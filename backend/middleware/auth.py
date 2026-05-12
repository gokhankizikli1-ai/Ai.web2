# coding: utf-8
"""
Real auth middleware (Phase 3a).

Reads `Authorization: Bearer <access_token>`. If verifiable, stamps the
request scope with the authenticated User and `is_guest=False`. If
absent or unverifiable, falls back to a guest identity derived from the
`X-Korvix-Guest-Id` header (so each browser keeps a stable id across
unauthenticated visits).

NEVER blocks a request. Routes that require authentication use the
`require_auth` dependency in `backend/core/deps.py` — that raises an
UnauthorizedError which routes through the v2 envelope handler (when
enabled) to a 401.

Opt-in via env flag `ENABLE_AUTH_V2=true`. Default off so existing
production keeps behaviour byte-identical. The Phase-B placeholder
middleware (`auth_placeholder.py`) is deprecated by this one — both
can coexist briefly; do not enable both at once.

Request-state contract (what routes can read from `request.state`):
  user        : User dataclass (always set — guest or real)
  is_guest    : bool
  auth_kind   : "guest" | "email" | "google" | "github" | "apple"
  auth_token  : raw bearer string when present, else None
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.services.auth import service as auth_service
from backend.services.auth.identity import User

logger = logging.getLogger(__name__)


_AUTH_HEADER   = "Authorization"
_GUEST_HEADER  = "X-Korvix-Guest-Id"
_BEARER_PREFIX = "Bearer "


def _extract_bearer(request: Request) -> str | None:
    raw = request.headers.get(_AUTH_HEADER, "").strip()
    if not raw.startswith(_BEARER_PREFIX):
        return None
    token = raw[len(_BEARER_PREFIX):].strip()
    return token or None


def _stable_guest_nonce(request: Request) -> str:
    """Return a stable per-browser id. The frontend sends one in
    X-Korvix-Guest-Id (typically the same value it stores as
    `korvix_user_id` in localStorage). Empty → service layer generates
    a fresh one — that user becomes ephemeral; the next request without
    the header gets a different identity."""
    nonce = (request.headers.get(_GUEST_HEADER) or "").strip()
    return nonce[:64]


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        token = _extract_bearer(request)

        user: User | None = None
        if token:
            # Cheap synchronous DB read inside an async middleware is
            # acceptable here — the auth.db is local SQLite and the
            # call returns in microseconds. Promote to a thread pool
            # later if profiling shows it matters.
            user = auth_service.identity_for_access_token(token)

        if user is None:
            # No valid token → mint a guest identity tied to the
            # browser's stable nonce. This is idempotent: the SAME
            # X-Korvix-Guest-Id always resolves to the SAME User row.
            nonce = _stable_guest_nonce(request)
            try:
                guest, _, _ = auth_service.create_guest(nonce)
                user = guest
            except Exception as exc:
                # Storage outage MUST NOT block the request — the
                # /chat path can degrade to its legacy body-derived
                # user_id. Log and continue with a synthetic guest.
                logger.warning("AuthMiddleware: guest creation failed: %s", exc)
                user = User(
                    id="guest:anonymous",
                    kind="guest",
                    external_id="guest:anonymous",
                    display_name="",
                )

        request.state.user       = user
        request.state.is_guest   = user.is_guest
        request.state.auth_kind  = user.kind
        request.state.auth_token = token
        # Back-compat alias for code that read the Phase-B placeholder's
        # `user_id` field — keeps the contract stable.
        request.state.user_id    = user.id

        return await call_next(request)


__all__ = ["AuthMiddleware"]
