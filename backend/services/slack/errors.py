# coding: utf-8
"""Slack connector — typed error taxonomy.

Mirrors `backend.services.vercel.errors` / `backend.services.gmail.errors`: a
connector must translate provider failure into a STABLE typed signal, never into
a silent empty-success (a "0 messages" that is really "the bot was removed from
the channel" would let the Business Brain conclude the team went quiet when the
pipe is actually severed).

CREDENTIAL ENCRYPTION IS NOT REDEFINED HERE
-------------------------------------------
`CredentialEncryptionError` is RE-EXPORTED from the existing credential
authority (`gmail.errors`), not redeclared. The Slack connector encrypts its bot
token with the SAME `gmail.crypto` authority (one Fernet key,
`KORVIX_CREDENTIAL_ENCRYPTION_KEY`), so a caller that catches
`CredentialEncryptionError` catches the identical class for every connector —
there is one credential-at-rest failure type in the system, not four.

SLACK ANSWERS 200 EVEN WHEN IT FAILS
------------------------------------
Unlike Google/Vercel, the Slack Web API returns HTTP 200 with
`{"ok": false, "error": "<code>"}` for most failures. The client therefore maps
that envelope onto this taxonomy explicitly (see `slack.client._raise_for_slack_error`),
so a logical failure can never be mistaken for an empty success.

None of these carry secret material — messages are provider-status summaries,
never the client secret / authorization code / bot token.
"""
from __future__ import annotations

from typing import Optional

# The single credential-at-rest failure type (see module docstring). Imported,
# never redefined, so `except CredentialEncryptionError` behaves identically
# whichever connector raised it.
from backend.services.gmail.errors import CredentialEncryptionError  # noqa: F401


class SlackError(Exception):
    """Base class for every Slack connector failure."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 slack_error: Optional[str] = None):
        super().__init__(message)
        self.status = status
        # Slack's machine-readable `error` code (e.g. "not_in_channel"), never
        # token or secret material.
        self.slack_error = slack_error


class SlackConfigError(SlackError):
    """The connector is not configured (missing client id / secret / redirect
    URI / encryption key). Distinct from an auth *rejection* — this is "we never
    had the configuration", so the caller fails closed rather than retrying."""


class SlackOAuthError(SlackError):
    """`oauth.v2.access` rejected the code (bad/expired/reused code, redirect
    mismatch, unknown client). The credentials existed but Slack refused them —
    not retryable without the user re-authorizing."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 reason: Optional[str] = None):
        super().__init__(message, status=status, slack_error=reason)
        self.reason = reason


class SlackAuthError(SlackError):
    """The stored bot token is no longer usable — Slack answered
    `invalid_auth` / `account_inactive` / `token_revoked` (or HTTP 401). The app
    was uninstalled or the token was revoked at Slack; a reconnect is required.
    NEVER an empty read."""


class SlackAccessError(SlackError):
    """Slack refused this specific RESOURCE while the token itself is fine —
    `not_in_channel`, `channel_not_found`, `missing_scope`, `is_archived`.

    This is deliberately DISTINCT from `SlackAuthError`: a bot that was removed
    from ONE channel must not look like a dead installation, and the connector
    must report the channel as unreadable rather than pretend it is empty."""


class SlackNotFoundError(SlackError):
    """The requested Slack resource does not exist / is not visible under this
    token. Fails safe (never a false success)."""


class SlackRateLimitError(SlackError):
    """HTTP 429 (or `ratelimited`). Slack sends `Retry-After` in seconds.

    Retryable, but only after the backoff Slack asked for — the sync stops the
    whole read on the first one rather than hammering an already-limited
    workspace (see `slack.sync`)."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 retry_after: Optional[int] = None,
                 slack_error: Optional[str] = None):
        super().__init__(message, status=status, slack_error=slack_error)
        self.retry_after = retry_after


class SlackServerError(SlackError):
    """5xx / network timeout / transport failure / malformed response.
    Transient; a bounded retry is legitimate, an infinite one is not."""


__all__ = [
    "SlackError", "SlackConfigError", "CredentialEncryptionError",
    "SlackOAuthError", "SlackAuthError", "SlackAccessError",
    "SlackNotFoundError", "SlackRateLimitError", "SlackServerError",
]
