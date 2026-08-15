# coding: utf-8
"""Google Calendar connector — typed error taxonomy.

Mirrors `backend.services.gmail.errors` / `backend.services.vercel.errors`: a
connector must translate provider failure into a STABLE typed signal, never into
a silent empty-success (a "0 events" that is really "auth is broken" would let
the Business Brain conclude nothing is scheduled when the pipe is severed).

CREDENTIAL ENCRYPTION IS SHARED, NOT REDECLARED
-----------------------------------------------
`CredentialEncryptionError` is RE-EXPORTED from the existing credential
authority (`gmail.errors`) rather than redefined, exactly as the Vercel
connector does. The Calendar connector encrypts its refresh/access tokens with
the SAME `gmail.crypto` cipher (one `KORVIX_CREDENTIAL_ENCRYPTION_KEY`), so a
caller that catches `CredentialEncryptionError` catches it for every connector.

None of these carry secret material — messages are provider-status summaries,
never the client secret / refresh token / access token / authorization code.
"""
from __future__ import annotations

from typing import Optional

# The ONE credential-encryption failure type in the codebase (defined next to
# the cipher that raises it). Re-exported so Calendar callers never import a
# second, parallel error type for the same condition.
from backend.services.gmail.errors import CredentialEncryptionError  # noqa: F401


class CalendarError(Exception):
    """Base class for every Calendar connector failure."""

    def __init__(self, message: str, *, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class CalendarConfigError(CalendarError):
    """The connector is not configured (missing client id / secret / redirect
    URI / encryption key). Distinct from an auth *rejection* — this is "we never
    had the configuration", so the caller fails closed rather than retrying."""


class CalendarOAuthError(CalendarError):
    """The OAuth exchange/refresh was rejected by Google (bad code, redirect
    mismatch, invalid_grant, revoked/expired refresh token). The credentials
    existed but Google refused them — not retryable without user re-consent."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 reason: Optional[str] = None):
        super().__init__(message, status=status)
        # Google's machine-readable `error` field (e.g. "invalid_grant"),
        # never the token itself.
        self.reason = reason


class CalendarAuthError(CalendarError):
    """401/403 from a Calendar API read — the access token is missing/expired
    and could not be refreshed, or the grant was revoked at Google."""


class CalendarNotFoundError(CalendarError):
    """404 — the requested calendar/event does not exist or is not visible.
    Fails safe (never a false success)."""


class CalendarRateLimitError(CalendarError):
    """403 (rateLimitExceeded / userRateLimitExceeded) or 429. Retryable, but
    only after a backoff — never hammered."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 retry_after: Optional[int] = None):
        super().__init__(message, status=status)
        self.retry_after = retry_after


class CalendarServerError(CalendarError):
    """5xx / network timeout / transport failure. Transient; a bounded retry is
    legitimate, an infinite one is not."""


__all__ = [
    "CalendarError", "CalendarConfigError", "CredentialEncryptionError",
    "CalendarOAuthError", "CalendarAuthError", "CalendarNotFoundError",
    "CalendarRateLimitError", "CalendarServerError",
]
