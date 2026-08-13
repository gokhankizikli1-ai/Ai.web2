# coding: utf-8
"""Gmail connector — typed error taxonomy.

Mirrors `backend.services.github.errors`: a connector must translate provider
failure into a STABLE typed signal, never into a silent empty-success (a
"0 messages" that is really "auth is broken" would let the Business Brain
conclude nothing is happening when the pipe is severed).

None of these carry secret material — messages are provider-status summaries,
never the client secret / refresh token / access token.
"""
from __future__ import annotations

from typing import Optional


class GmailError(Exception):
    """Base class for every connector failure."""

    def __init__(self, message: str, *, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class GmailConfigError(GmailError):
    """The connector is not configured (missing client id / secret / redirect
    URI / encryption key). Distinct from an auth *rejection* — this is "we
    never had the configuration", so the caller fails closed rather than
    retrying."""


class CredentialEncryptionError(GmailConfigError):
    """Credential-at-rest encryption is unavailable or misconfigured (no key,
    unparseable key, or the crypto backend is missing). A subclass of
    GmailConfigError because the connector must FAIL CLOSED: a refresh token is
    never stored or read in plaintext, so an absent/broken key blocks connect
    and read rather than silently degrading."""


class GmailOAuthError(GmailError):
    """The OAuth exchange/refresh was rejected by Google (bad code, redirect
    mismatch, invalid_grant, revoked/expired refresh token). The credentials
    existed but Google refused them — not retryable without user re-consent."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 reason: Optional[str] = None):
        super().__init__(message, status=status)
        # Google's machine-readable `error` field (e.g. "invalid_grant"),
        # never the token itself.
        self.reason = reason


class GmailAuthError(GmailError):
    """401/403 from a Gmail API read — the access token is missing/expired and
    could not be refreshed, or the grant was revoked."""


class GmailNotFoundError(GmailError):
    """404 — the requested Gmail resource does not exist / is not visible.
    Fails safe (never a false success)."""


class GmailRateLimitError(GmailError):
    """403 (rateLimitExceeded / userRateLimitExceeded) or 429. Retryable, but
    only after a backoff — never hammered."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 retry_after: Optional[int] = None):
        super().__init__(message, status=status)
        self.retry_after = retry_after


class GmailServerError(GmailError):
    """5xx / network timeout / transport failure. Transient; a bounded retry is
    legitimate, an infinite one is not."""


__all__ = [
    "GmailError", "GmailConfigError", "CredentialEncryptionError",
    "GmailOAuthError", "GmailAuthError", "GmailNotFoundError",
    "GmailRateLimitError", "GmailServerError",
]
