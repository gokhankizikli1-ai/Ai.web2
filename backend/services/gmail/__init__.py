# coding: utf-8
"""Gmail connector — a READ-ONLY source of Business Brain observations.

Architecture (reuses the connector-neutral seam established by PR #620 and the
GitHub connector shape from PR #621):

    Google OAuth (authorization-code, offline)
        │  oauth: code → tokens; refresh token stored ENCRYPTED at rest
        ▼
    access (central token provider: refresh + persist)
        │
    client (read-only Gmail REST, stdlib urllib — GET only)
        │
        └── sync (bounded, metadata-only read)
        │
        ▼
    normalize (pure) → ingest → observations_store.record_observation()
        │
        ▼
    Business Brain (existing authorities decide what matters — this connector
                    never creates a task/decision/run and never calls a model)

Public submodules are re-exported for callers (routes, tests). Everything stays
importable even where the native crypto backend is unavailable — the crypto
import in `crypto` is lazy, and the OAuth/HTTP layers are stdlib-only.
"""
from __future__ import annotations

from backend.services.gmail import config  # noqa: F401
from backend.services.gmail.errors import (  # noqa: F401
    CredentialEncryptionError, GmailAuthError, GmailConfigError, GmailError,
    GmailNotFoundError, GmailOAuthError, GmailRateLimitError, GmailServerError,
)

__all__ = [
    "config",
    "GmailError", "GmailConfigError", "CredentialEncryptionError",
    "GmailOAuthError", "GmailAuthError", "GmailNotFoundError",
    "GmailRateLimitError", "GmailServerError",
]
