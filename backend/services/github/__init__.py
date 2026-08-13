# coding: utf-8
"""GitHub connector — a READ-ONLY source of Business Brain observations.

Architecture (matches the connector-neutral seam established by PR #620):

    GitHub App
        │  auth: private key → App JWT → short-lived installation token
        ▼
    client (read-only REST, stdlib urllib)
        │
        ├── sync    (bounded initial backfill)
        └── webhook (verified incremental events)
        │
        ▼
    normalize (pure) → ingest → observations_store.record_observation()
        │
        ▼
    Business Brain (existing authorities decide what matters — this connector
                    never creates a task/decision/run and never calls a model)

Public entry points are re-exported here for callers (routes, tests). Submodules
stay importable even where the native crypto backend is unavailable — the RS256
signing import in `auth` is lazy.
"""
from __future__ import annotations

from backend.services.github import config  # noqa: F401
from backend.services.github.errors import (  # noqa: F401
    GitHubAuthError, GitHubConfigError, GitHubError, GitHubNotFoundError,
    GitHubRateLimitError, GitHubServerError, GitHubUnprocessableError,
)

__all__ = [
    "config",
    "GitHubError", "GitHubConfigError", "GitHubAuthError",
    "GitHubNotFoundError", "GitHubRateLimitError", "GitHubServerError",
    "GitHubUnprocessableError",
]
