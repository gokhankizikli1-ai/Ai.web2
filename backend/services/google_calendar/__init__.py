# coding: utf-8
"""Google Calendar connector — a READ-ONLY source of Business Brain observations.

Architecture (the SAME connector-neutral seam Gmail / GitHub / Vercel use — no
new auth system, no new state system, no new storage system, no new brain loop):

    Google OAuth (authorization-code, offline)
        │  reuses the EXISTING Google OAuth client (see `config`), with its own
        │  redirect URI, its own one-time state table, and exactly one scope:
        │      https://www.googleapis.com/auth/calendar.events.readonly
        │  refresh token stored ENCRYPTED at rest via the EXISTING credential
        │  authority (`gmail.crypto`, one KORVIX_CREDENTIAL_ENCRYPTION_KEY)
        ▼
    access (central token provider: refresh + persist)
        │
    client (read-only Calendar REST, stdlib urllib — GET only, time-windowed)
        │
        └── sync (bounded, explicit "Sync now" — no poller, no webhook)
        │
        ▼
    normalize (pure) → ingest → observations_store.record_observation()
        │
        ▼
    Business Brain / Project Brain (existing authorities decide what matters —
                    this connector never creates a task/decision/run and never
                    calls a model)

Calendar appears in the ONE canonical connector-source registry
(`observations_store.CONNECTOR_SOURCES`); nothing else in the brain path needed
to change for its signals to flow, exactly as for the Vercel connector.

WRITE SAFETY: this package contains no create/update/delete path toward Google
at any layer, and the requested scope could not perform one.

Public submodules are imported lazily by callers (routes, tests). Only `config`
and the error taxonomy are re-exported here, so importing this package stays
cheap and safe even where the native crypto backend is unavailable.
"""
from __future__ import annotations

from backend.services.google_calendar import config  # noqa: F401
from backend.services.google_calendar.errors import (  # noqa: F401
    CalendarAuthError, CalendarConfigError, CalendarError, CalendarNotFoundError,
    CalendarOAuthError, CalendarRateLimitError, CalendarServerError,
    CredentialEncryptionError,
)

__all__ = [
    "config",
    "CalendarError", "CalendarConfigError", "CredentialEncryptionError",
    "CalendarOAuthError", "CalendarAuthError", "CalendarNotFoundError",
    "CalendarRateLimitError", "CalendarServerError",
]
