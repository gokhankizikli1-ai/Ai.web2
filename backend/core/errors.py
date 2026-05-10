# coding: utf-8
"""
Centralized error handling for KorvixAI v3.
Guarantees frontend never receives raw Python tracebacks.
"""
import logging
from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

# ── Safe error codes ──────────────────────────────────────────────────────────

class ErrorCode:
    INTERNAL_ERROR   = "INTERNAL_ERROR"
    RATE_LIMITED     = "RATE_LIMITED"
    INVALID_REQUEST  = "INVALID_REQUEST"
    AI_UNAVAILABLE   = "AI_UNAVAILABLE"
    NOT_FOUND        = "NOT_FOUND"


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


# ── FastAPI global exception handler ─────────────────────────────────────────

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
