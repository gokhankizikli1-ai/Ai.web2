# coding: utf-8
"""
Request timing middleware (Phase B).

Measures wall-clock duration of every request and:

  - Sets `X-Response-Time-ms` on the response so clients can surface it
    in dev tools / bug reports.
  - Emits one structured log line per request:
        "request_complete | method=POST | path=/chat | status=200 | duration_ms=187"
    The structured JSON formatter (when LOG_FORMAT=json) lifts the
    method/path/status/duration into top-level fields automatically.

Wiring is OPT-IN via `ENABLE_TIMING_MIDDLEWARE=true`. Default off so
existing Railway behaviour is byte-identical until we flip the flag.

Plays nicely with RequestIdMiddleware — when both are installed, the
log line includes the request_id automatically (via the ContextVar in
core/logging.py).
"""
from __future__ import annotations

import logging
import time
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            # logger.info with `extra={}` lifts fields into the JSON
            # formatter's top-level payload. The text formatter falls
            # back to the message string.
            logger.info(
                "request_complete | method=%s | path=%s | status=%s | duration_ms=%d",
                request.method, request.url.path, status, duration_ms,
                extra={
                    "method":      request.method,
                    "path":        request.url.path,
                    "status":      status,
                    "duration_ms": duration_ms,
                },
            )
            # Attach the header AFTER the response has been computed.
            # The response is mutable here because BaseHTTPMiddleware
            # yields it back to us before the framework sends it.
            try:
                response.headers["X-Response-Time-ms"] = str(duration_ms)
            except Exception:
                # Streaming responses or background-task responses can
                # occasionally have read-only headers — never fatal.
                pass


__all__ = ["TimingMiddleware"]
