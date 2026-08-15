# coding: utf-8
"""Vercel connector — a READ-ONLY source of Business Brain observations.

Architecture (reuses the connector-neutral seam and the Gmail/GitHub connector
shape; it introduces NO second connector framework, auth system, credential
store, project authority, or observation store):

    Vercel integration OAuth (install → code → token)
        │  oauth: code → access token; token stored ENCRYPTED at rest by the
        │  EXISTING credential authority (gmail.crypto)
        ▼
    setup_state (one-time CSRF state + verified pending project set)
        │
    store (connection: owner, team scope, bound Vercel project, encrypted token)
        │
    client (read-only Vercel REST, stdlib urllib — GET only, team-scoped)
        │
        └── sync (bounded project + deployments read)
        │
        ▼
    normalize (pure) → ingest → observations_store.record_observation()
        │
        ▼
    Project Brain / Business Brain (existing authorities decide what matters —
                    this connector never creates a task/decision/run and never
                    calls a model)

READ-ONLY: there is no deploy, redeploy, rollback, cancel, env-var, domain, or
project-configuration path anywhere in this package.

Public submodules are re-exported for callers (routes, tests).
"""
from __future__ import annotations

from backend.services.vercel import config  # noqa: F401
from backend.services.vercel.errors import (  # noqa: F401
    CredentialEncryptionError, VercelAuthError, VercelConfigError, VercelError,
    VercelNotFoundError, VercelOAuthError, VercelRateLimitError,
    VercelServerError,
)

__all__ = [
    "config",
    "VercelError", "VercelConfigError", "CredentialEncryptionError",
    "VercelOAuthError", "VercelAuthError", "VercelNotFoundError",
    "VercelRateLimitError", "VercelServerError",
]
