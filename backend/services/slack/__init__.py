# coding: utf-8
"""Slack connector — a READ-ONLY source of Business Brain observations.

Architecture (reuses the connector-neutral seam and the Gmail/GitHub/Vercel/
Calendar connector shape; it introduces NO second connector framework, auth
system, credential store, project authority, or observation store):

    Slack OAuth v2 (install → code → BOT token)
        │  oauth: code → bot token; token stored ENCRYPTED at rest by the
        │  EXISTING credential authority (gmail.crypto)
        ▼
    setup_state (one-time CSRF state + verified pending channel set)
        │
    store (connection: owner, workspace, encrypted bot token, selected channels)
        │
    client (read-only Slack Web API, stdlib urllib — GET only, four methods)
        │
        └── sync (bounded per-channel history + bounded thread replies)
        │
        ▼
    normalize (pure) → ingest → observations_store.record_observation()
        │
        ▼
    Project Brain / Business Brain (existing authorities decide what matters —
                    this connector never creates a task/decision/run and never
                    calls a model)

READ-ONLY: there is no send, edit, delete, react, invite, join, archive, rename,
file-read, user-profile, admin, incoming-webhook, or revoke path anywhere in
this package — and the four granted bot scopes (`channels:read`,
`channels:history`, `groups:read`, `groups:history`) could not perform one.

EXPLICIT SYNC ONLY: no webhook, no Event Subscription, no poller, no scheduler.

Public submodules are re-exported for callers (routes, tests).
"""
from __future__ import annotations

from backend.services.slack import config  # noqa: F401
from backend.services.slack.errors import (  # noqa: F401
    CredentialEncryptionError, SlackAccessError, SlackAuthError,
    SlackConfigError, SlackError, SlackNotFoundError, SlackOAuthError,
    SlackRateLimitError, SlackServerError,
)

__all__ = [
    "config",
    "SlackError", "SlackConfigError", "CredentialEncryptionError",
    "SlackOAuthError", "SlackAuthError", "SlackAccessError",
    "SlackNotFoundError", "SlackRateLimitError", "SlackServerError",
]
