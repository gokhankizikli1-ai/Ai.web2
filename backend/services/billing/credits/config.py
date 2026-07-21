# coding: utf-8
"""
Billing credits — dynamic configuration (PR 8).

Read on every call so a Railway env flip is live without a restart. Canonical
docs on backend.core.config.Config.

The credit ledger ships dormant (ENABLE_BILLING_CREDITS default OFF). When off,
mutating operations (grant/consume/adjust) are no-ops and reads return an empty
account — so the foundation can be deployed and turned on with a single flip.
"""
from __future__ import annotations

import os

from backend.services.billing import config as billing_config


def is_enabled() -> bool:
    """Master gate for the credit ledger. Default OFF."""
    return os.getenv("ENABLE_BILLING_CREDITS", "false").strip().lower() == "true"


def allow_negative_default() -> bool:
    """Default overdraft policy for consume(). When false (default) a consume
    that would drive the balance below zero is rejected. Individual calls may
    still override this."""
    return os.getenv("BILLING_CREDITS_ALLOW_NEGATIVE", "false").strip().lower() == "true"


def strict_postgres() -> bool:
    """Mirror the billing policy: on a Postgres error fall back to SQLite unless
    strict mode is on."""
    return os.getenv("BILLING_POSTGRES_REQUIRED", "false").strip().lower() == "true"


def db_path() -> str:
    """Shared billing database file (credits live alongside the inbox etc.)."""
    return billing_config.db_path()


__all__ = ["is_enabled", "allow_negative_default", "strict_postgres", "db_path"]
