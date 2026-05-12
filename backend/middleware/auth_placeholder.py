# coding: utf-8
"""
Auth-placeholder middleware (Phase B).

This is intentionally NOT a real auth layer — Phase 3 will build that.
The placeholder exists for two reasons:

  1. To establish the request.state.user_id contract that every
     authenticated route handler will read from. Once Phase 3 lands,
     this middleware swaps in JWT verification without route changes.

  2. To document where guest vs authenticated requests diverge, so
     Phase-3 work has a clear seam to fill in.

Today's behaviour:
  - If `Authorization: Bearer <token>` is present, store the raw token
    string on request.state.auth_token (NOT verified — Phase 3 does that).
  - Always set request.state.user_id to either:
      * the token (when present), or
      * "guest:<anonymous-id>" from the X-Korvix-Guest-Id header, or
      * "guest:anonymous" as a final fallback.
  - Never block any request. Never modify the response body.

Wiring is OPT-IN via `ENABLE_AUTH_MIDDLEWARE=true`. Default off so the
existing /chat path (which derives user_id from the request body) keeps
working unchanged.
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


_AUTH_HEADER  = "Authorization"
_GUEST_HEADER = "X-Korvix-Guest-Id"
_BEARER_PREFIX = "Bearer "


class AuthPlaceholderMiddleware(BaseHTTPMiddleware):
    """Reads auth headers and stamps the request scope. NO verification."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        token: str | None = None
        raw_auth = request.headers.get(_AUTH_HEADER, "").strip()
        if raw_auth.startswith(_BEARER_PREFIX):
            token = raw_auth[len(_BEARER_PREFIX):].strip() or None

        if token:
            # Phase 3 will replace this with a verify() call that may
            # raise UnauthorizedError. For now the token is opaque.
            request.state.auth_token = token
            request.state.user_id    = f"token:{token[:8]}..."   # never log the full token
            request.state.is_guest   = False
        else:
            guest_id = (request.headers.get(_GUEST_HEADER) or "").strip() or "anonymous"
            request.state.auth_token = None
            request.state.user_id    = f"guest:{guest_id}"
            request.state.is_guest   = True

        return await call_next(request)


__all__ = ["AuthPlaceholderMiddleware"]
