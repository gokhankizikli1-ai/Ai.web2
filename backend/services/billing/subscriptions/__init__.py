# coding: utf-8
"""
Billing — subscription-state projection (PR 3).

The reliable, normalized "truth layer" for customer subscriptions, projected
from processed Lemon Squeezy subscription lifecycle webhooks. It exists so a
FUTURE entitlement / credit / usage system has one authoritative, queryable
place to read a subscription's current state from — this PR builds ONLY that
layer and deliberately implements no entitlements, credits, usage limits or
feature gating.

Public surface:

    from backend.services.billing.subscriptions import store, types, config
    store.get(provider, subscription_id)
    store.list_subscriptions(status=..., app_user_id=...)

Handlers for the subscription lifecycle events are registered on import (see
projection.register_handlers), replacing the PR-2 acknowledgement no-ops for
those event names.

Feature flag:
    ENABLE_BILLING_SUBSCRIPTION_PROJECTION=true (default) → project into the
        subscription table when the processor consumes a lifecycle event
    false → the handler degrades to a no-op ack (events still `processed`)

Storage shares the billing database (billing.db / Postgres) with the inbox —
one billing store, a separate `billing_subscriptions` table.
"""
import logging

from backend.services.billing.subscriptions import config, store, types
from backend.services.billing.subscriptions.projection import register_handlers

logger = logging.getLogger(__name__)

# Register the projection handlers on import. Idempotent (replace=True) so a
# reload never raises; non-fatal on failure — the subscription events would
# simply fall back to the PR-2 acknowledgement path.
try:
    _n = register_handlers()
    logger.debug("billing.subscriptions registered %d lifecycle handlers", _n)
except Exception as _e:  # pragma: no cover
    logger.warning("billing.subscriptions handler registration failed: %s", _e)


__all__ = ["config", "store", "types", "register_handlers"]
