# coding: utf-8
"""
Centralized error handling for KorvixAI v3.
Guarantees frontend never receives raw Python tracebacks.

Two layers:

1. `global_exception_handler` — the catch-all that returns a
   chat-compatible payload so the existing frontend never sees a 500
   without a `.reply` field. Wired in `api.py` and `core/middleware.py`.

2. `ApiError` hierarchy + `install_api_error_handlers(app)` — Phase-1
   addition. Routes can `raise NotFoundError("workspace 42")` and the
   handler turns it into a proper envelope response with the right
   status code. Opt-in: legacy routes don't need to use it.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.core.responses import err as envelope_err

logger = logging.getLogger(__name__)

# ── Safe error codes ──────────────────────────────────────────────────────────

class ErrorCode:
    INTERNAL_ERROR   = "INTERNAL_ERROR"
    RATE_LIMITED     = "RATE_LIMITED"
    INVALID_REQUEST  = "INVALID_REQUEST"
    AI_UNAVAILABLE   = "AI_UNAVAILABLE"
    NOT_FOUND        = "NOT_FOUND"
    UNAUTHORIZED     = "UNAUTHORIZED"
    UPSTREAM_ERROR   = "UPSTREAM_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"


def error_response(message: str, code: str = ErrorCode.INTERNAL_ERROR, status: int = 500) -> JSONResponse:
    """Return a safe, frontend-friendly error JSON response."""
    return JSONResponse(
        status_code=status,
        content={
            "success": False,
            "error": message,
            "code": code,
        },
    )


# ── Phase-1: typed exception hierarchy ────────────────────────────────────
#
# Routes that opt into the new pattern raise these directly instead of
# returning `error_response(...)`. The handler installed by
# `install_api_error_handlers(app)` catches them and emits a proper
# envelope with the matching HTTP status. Legacy routes don't need to
# change — they keep using `error_response` / `chat_error`.

class ApiError(Exception):
    """Base for any expected, user-facing failure from a route handler.

    Carries a HTTP status, a stable machine-readable `code`, and an
    optional `details` dict that's forwarded into the response metadata.
    """
    status_code: int = 500
    code: str = ErrorCode.INTERNAL_ERROR

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        if code is not None:
            self.code = code
        self.details: Dict[str, Any] = details or {}
        super().__init__(message)


class ValidationError(ApiError):
    status_code = 400
    code = ErrorCode.VALIDATION_ERROR


class UnauthorizedError(ApiError):
    status_code = 401
    code = ErrorCode.UNAUTHORIZED


class NotFoundError(ApiError):
    status_code = 404
    code = ErrorCode.NOT_FOUND


class RateLimitError(ApiError):
    status_code = 429
    code = ErrorCode.RATE_LIMITED


class UpstreamError(ApiError):
    """Failure from an upstream dependency (OpenAI, Railway DB, etc.)."""
    status_code = 502
    code = ErrorCode.UPSTREAM_ERROR


def install_api_error_handlers(app: FastAPI) -> None:
    """Wire ApiError → envelope JSON response.

    Idempotent for the v2/* family of routes only — does NOT replace the
    pre-existing `global_exception_handler` registered in api.py, which
    still serves the chat-compatible 500 shape for legacy callers.
    """

    @app.exception_handler(ApiError)
    async def _api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        logger.info(
            "ApiError | %s %s | %s (HTTP %d): %s",
            request.method, request.url.path, exc.code, exc.status_code, exc.message,
        )
        body = envelope_err(exc.message, code=exc.code, **exc.details)
        return JSONResponse(status_code=exc.status_code, content=body)


# ── FastAPI global exception handler (legacy / chat-compatible) ──────────────
# Already wired in api.py and in core/middleware.py — kept here unchanged so
# both wirings can keep importing the same symbol.

async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catches any unhandled exception and returns a safe error response.
    Never exposes Python tracebacks to the client.
    """
    logger.error(
        "Unhandled exception | %s %s | %s: %s",
        request.method, request.url.path,
        type(exc).__name__, exc,
        exc_info=True,
    )
    # Return a ChatResponse-compatible fallback so the frontend doesn't crash
    # when it tries to access .reply on the response.
    return JSONResponse(
        status_code=500,
        content={
            # Legacy fields — kept so existing frontend code still works
            "reply":             "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
            "intent":            "error",
            "model":             "none",
            "provider":          "none",
            "mode":              "error",
            "memory_used":       False,
            "remaining_messages": -1,
            "premium":           False,
            "response_time_ms":  0,
            "request_id":        "err",
            "suggested_followups": None,
            # v3 fields
            "success": False,
            "error":   "Su anda bir sorun olustu. Lutfen tekrar deneyin.",
            "code":    ErrorCode.INTERNAL_ERROR,
        },
    )


__all__ = [
    "ErrorCode",
    "error_response",
    "global_exception_handler",
    "ApiError",
    "ValidationError",
    "UnauthorizedError",
    "NotFoundError",
    "RateLimitError",
    "UpstreamError",
    "install_api_error_handlers",
]
