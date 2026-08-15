# coding: utf-8
"""Vercel connector — typed error taxonomy.

Mirrors `backend.services.gmail.errors` / `backend.services.github.errors`: a
connector must translate provider failure into a STABLE typed signal, never into
a silent empty-success (a "0 deployments" that is really "auth is broken" would
let the Business Brain conclude nothing shipped when the pipe is severed).

CREDENTIAL ENCRYPTION IS NOT REDEFINED HERE
-------------------------------------------
`CredentialEncryptionError` is RE-EXPORTED from the existing credential
authority (`gmail.errors`), not redeclared. The Vercel connector encrypts its
access token with the SAME `gmail.crypto` authority (one Fernet key,
`KORVIX_CREDENTIAL_ENCRYPTION_KEY`), so a caller that catches
`CredentialEncryptionError` catches the identical class for every connector —
there is one credential-at-rest failure type in the system, not three.

None of these carry secret material — messages are provider-status summaries,
never the client secret / authorization code / access token.
"""
from __future__ import annotations

from typing import Optional

# The single credential-at-rest failure type (see module docstring). Imported,
# never redefined, so `except CredentialEncryptionError` behaves identically
# whichever connector raised it.
from backend.services.gmail.errors import CredentialEncryptionError  # noqa: F401


class VercelError(Exception):
    """Base class for every Vercel connector failure."""

    def __init__(self, message: str, *, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class VercelConfigError(VercelError):
    """The connector is not configured (missing client id / secret / redirect
    URI / integration slug / encryption key). Distinct from an auth *rejection* —
    this is "we never had the configuration", so the caller fails closed rather
    than retrying."""


class VercelOAuthError(VercelError):
    """The OAuth code exchange was rejected by Vercel (bad/expired code, redirect
    mismatch, unknown client). The credentials existed but Vercel refused them —
    not retryable without the user re-authorizing."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 reason: Optional[str] = None):
        super().__init__(message, status=status)
        # Vercel's machine-readable `error` / `error.code` field, never the
        # token or the code itself.
        self.reason = reason


class VercelAuthError(VercelError):
    """401/403 from a Vercel REST read — the stored access token was revoked at
    Vercel, or the token's team scope does not cover the resource."""


class VercelNotFoundError(VercelError):
    """404 — the requested Vercel resource does not exist / is not visible under
    this token's scope. Fails safe (never a false success)."""


class VercelRateLimitError(VercelError):
    """429 (or a 403 that is really a rate limit). Retryable, but only after a
    backoff — never hammered."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 retry_after: Optional[int] = None):
        super().__init__(message, status=status)
        self.retry_after = retry_after


class VercelServerError(VercelError):
    """5xx / network timeout / transport failure. Transient; a bounded retry is
    legitimate, an infinite one is not."""


__all__ = [
    "VercelError", "VercelConfigError", "CredentialEncryptionError",
    "VercelOAuthError", "VercelAuthError", "VercelNotFoundError",
    "VercelRateLimitError", "VercelServerError",
]
