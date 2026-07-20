# coding: utf-8
"""
Billing subscriptions — dynamic configuration (PR 3).

Read on every call so a Railway env flip is live without a restart. Canonical
documentation lives on backend.core.config.Config.

The projection shares the billing database file (billing.db / the same
Postgres) with the PR-1 inbox — one billing store, separate tables — so
rollback is still `rm billing.db` (or dropping the billing tables) and nothing
else moves.
"""
from __future__ import annotations

import os


def is_enabled() -> bool:
    """Whether processed subscription lifecycle events are projected into the
    subscription-state table. Default ON — but only reachable when the
    processor itself is enabled (ENABLE_BILLING_PROCESSOR), since projection
    happens inside a processor handler. When OFF, the projection handler
    degrades to a no-op acknowledgement and events are still marked processed.

    Provided as an independent escape hatch so an operator can pause writing to
    the subscription table (e.g. during a backfill) without disabling the whole
    consumer."""
    return os.getenv("ENABLE_BILLING_SUBSCRIPTION_PROJECTION", "true").strip().lower() == "true"


__all__ = ["is_enabled"]
