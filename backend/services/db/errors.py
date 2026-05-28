# coding: utf-8
"""Phase 6 — DB foundation typed errors.

Two error classes, both subclasses of `RuntimeError` so callers that
don't care about the distinction can `except RuntimeError`. Routes
that DO care can branch on the type to surface a 503 (unavailable)
vs a 500 (misconfigured) envelope.
"""
from __future__ import annotations


class DBError(RuntimeError):
    """Base class for the foundation."""


class DBUnavailable(DBError):
    """Postgres is configured but unreachable (network / down / auth).
    Surface as 503 — the caller may retry."""


class DBConfigError(DBError):
    """Postgres is requested by the caller but the env is misconfigured
    (DATABASE_URL missing, ENABLE_POSTGRES_BACKEND off, driver not
    installed). Surface as 500 — needs operator action."""


__all__ = ["DBError", "DBUnavailable", "DBConfigError"]
