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
    """LEGACY / IGNORED for normal consumption.

    Historically this env flag (BILLING_CREDITS_ALLOW_NEGATIVE) let a normal
    consume overdraw the balance. Normal `service.consume()` is now
    UNCONDITIONALLY non-negative and no longer consults this value, so the flag
    can never weaken normal spending. It is retained ONLY so deployments that
    still set it do not break, and it is surfaced in owner diagnostics labelled
    as legacy. Overdraft remains an explicit owner-only capability on
    `adjust` / `revoke`. The env var is intentionally NOT removed here because
    deployment compatibility is unknown."""
    return os.getenv("BILLING_CREDITS_ALLOW_NEGATIVE", "false").strip().lower() == "true"


def strict_postgres() -> bool:
    """LEGACY for the credit ledger.

    Mirrors the shared billing policy flag (BILLING_POSTGRES_REQUIRED). It NO
    LONGER governs credit-store fallback: when Postgres is the selected
    authoritative backend, credit operations ALWAYS fail closed on a Postgres
    failure and NEVER fall back to SQLite, independent of this flag. Retained
    for the other billing subsystems and surfaced in credit diagnostics for
    visibility only."""
    return os.getenv("BILLING_POSTGRES_REQUIRED", "false").strip().lower() == "true"


def db_path() -> str:
    """Shared billing database file (credits live alongside the inbox etc.)."""
    return billing_config.db_path()


__all__ = ["is_enabled", "allow_negative_default", "strict_postgres", "db_path"]
