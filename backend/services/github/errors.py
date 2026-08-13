# coding: utf-8
"""GitHub connector — typed error taxonomy.

A connector must translate provider failure into a STABLE typed signal, never
into a silent empty-success (a "0 results" that is really "auth is broken"
would let the Business Brain conclude nothing is happening when in fact the
pipe is severed). Callers (initial sync, webhook) map these to their own
truthful outcomes; nothing here is swallowed into a bare `[]`.

None of these carry secret material — messages are provider-status summaries,
never the private key / JWT / installation token.
"""
from __future__ import annotations

from typing import Optional


class GitHubError(Exception):
    """Base class for every connector failure."""

    def __init__(self, message: str, *, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class GitHubConfigError(GitHubError):
    """The connector is not configured (missing App id / private key /
    webhook secret). Distinct from an auth *rejection* — this is "we never
    had credentials", so the caller fails closed rather than retrying."""


class GitHubAuthError(GitHubError):
    """401/invalid JWT / invalid or revoked installation — the credentials
    exist but GitHub rejected them. Not retryable without operator action."""


class GitHubNotFoundError(GitHubError):
    """404 — repository/installation/resource does not exist or the
    installation cannot see it. Fails safe (never a false success)."""


class GitHubRateLimitError(GitHubError):
    """403/429 secondary or primary rate limit. Carries the epoch second the
    limit resets (when GitHub told us) so a caller can back off intelligently
    instead of hammering. Retryable, but only after `reset_at`."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 reset_at: Optional[int] = None):
        super().__init__(message, status=status)
        self.reset_at = reset_at


class GitHubUnprocessableError(GitHubError):
    """422 — GitHub understood the request but rejected the parameters.
    A bug in our query, not a transient fault; never retried blindly."""


class GitHubServerError(GitHubError):
    """5xx / network timeout / transport failure. Transient; a bounded retry
    is legitimate, an infinite one is not."""


__all__ = [
    "GitHubError", "GitHubConfigError", "GitHubAuthError",
    "GitHubNotFoundError", "GitHubRateLimitError",
    "GitHubUnprocessableError", "GitHubServerError",
]
