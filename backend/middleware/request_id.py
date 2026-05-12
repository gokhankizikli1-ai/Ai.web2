# coding: utf-8
"""
Request-ID correlation middleware (Phase 1).

Every request gets an `X-Request-Id` — either echoed from the inbound
header (so a frontend retry shares the same id) or freshly generated as
a short uuid4 hex slice. The id is:

  - placed into a ContextVar so any logger.info() in any code reached
    during the request automatically prints with `request_id=<id>` when
    the structured JSON formatter is active (see `core/logging.py`).
  - returned on the response as `X-Request-Id` so the frontend can
    surface it in error toasts / bug reports.

Wiring is OPT-IN — `api.py` only installs this middleware if the
`ENABLE_REQUEST_ID_MIDDLEWARE` env var is set to "true". This keeps the
default Layer-1 build behavior identical to today.
"""
from __future__ import annotations

import logging
import uuid
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.core.logging import request_id_ctx

logger = logging.getLogger(__name__)


_HEADER = "X-Request-Id"


def _new_id() -> str:
    # 12 hex chars is enough to collide-free trace ~100k req/day in the
    # same minute. Keep it short so it's easy to copy out of a toast.
    return uuid.uuid4().hex[:12]


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        incoming = request.headers.get(_HEADER, "").strip()
        rid = incoming if incoming else _new_id()
        token = request_id_ctx.set(rid)
        try:
            response = await call_next(request)
        except Exception:
            # Reset the contextvar before bubbling the exception so a
            # follow-up unhandled-exception handler (if any) sees a clean
            # context. Re-raise so FastAPI's own handler still fires.
            request_id_ctx.reset(token)
            raise
        response.headers[_HEADER] = rid
        request_id_ctx.reset(token)
        return response


__all__ = ["RequestIdMiddleware"]
