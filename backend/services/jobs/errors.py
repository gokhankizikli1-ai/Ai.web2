# coding: utf-8
"""
Phase 7 — Job Queue error types.

These are thrown by the manager / runner and translated into
structured HTTP responses at the route layer. Each carries a stable
`code` so the frontend can branch without parsing messages.
"""
from __future__ import annotations


class JobError(Exception):
    """Base — every Phase 7 typed error inherits from this."""
    code: str = "JOB_ERROR"
    http_status: int = 500

    def __init__(self, message: str, *, code: str | None = None,
                 http_status: int | None = None, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if http_status is not None:
            self.http_status = http_status
        self.details = details or {}


class JobNotFound(JobError):
    code = "JOB_NOT_FOUND"
    http_status = 404


class JobAccessDenied(JobError):
    """Raised when a non-owner user tries to access another user's job.
    The route layer catches this and surfaces as 404 (NOT 403) to
    avoid leaking the row's existence — same convention as
    /v2/sessions and /v2/memory."""
    code = "JOB_ACCESS_DENIED"
    http_status = 404


class JobInvalidTransition(JobError):
    """Illegal status transition (e.g. cancelling a succeeded job)."""
    code = "JOB_INVALID_TRANSITION"
    http_status = 409


class JobValidationError(JobError):
    """Request body failed validation beyond what Pydantic catches —
    payload too big, unknown kind, etc."""
    code = "JOB_VALIDATION_ERROR"
    http_status = 400


class JobKindUnknown(JobError):
    """Caller asked for a kind that isn't registered."""
    code = "JOB_KIND_UNKNOWN"
    http_status = 400


class JobQueueDisabled(JobError):
    """ENABLE_JOB_QUEUE=false. Routes surface this as a structured 503."""
    code = "JOB_QUEUE_DISABLED"
    http_status = 503


__all__ = [
    "JobError",
    "JobNotFound", "JobAccessDenied",
    "JobInvalidTransition", "JobValidationError",
    "JobKindUnknown", "JobQueueDisabled",
]
