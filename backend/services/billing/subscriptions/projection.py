# coding: utf-8
"""
Billing subscriptions — projection handlers (PR 3).

Registers REAL handlers (via replace=True) for the Lemon Squeezy subscription
lifecycle events, replacing the PR-2 acknowledgement no-ops for those names.
Each handler maps the verified webhook payload to a normalized Subscription and
upserts it into the projection table.

This is the "subscription truth layer" and NOTHING more — no entitlements,
credits, usage limits or feature gating (a later PR reads this table for that).

Idempotency & ordering:
  * The store upserts by (provider, subscription_id) with a monotonic guard on
    `lemon_updated_at`, so replaying the same event is a no-op and a reordered
    (stale) event never regresses newer state. Combined with the processor's
    at-least-once delivery, this handler is safely idempotent.

Failure semantics:
  * A subscription event that is missing its id raises — the processor marks it
    `failed` and retries (a malformed delivery is worth surfacing).
  * A transient store error propagates — same retry path.
  * When projection is disabled (ENABLE_BILLING_SUBSCRIPTION_PROJECTION=false)
    the handler is a clean no-op ack, so events still progress to `processed`.
"""
from __future__ import annotations

import logging

from backend.services.billing.types import WebhookEvent
from backend.services.billing.processor.registry import register
from backend.services.billing.subscriptions import config as sub_config
from backend.services.billing.subscriptions import store as sub_store
from backend.services.billing.subscriptions import types as sub_types


logger = logging.getLogger(__name__)


def project_subscription_event(event: WebhookEvent, payload: dict) -> None:
    """Handler for every subscription lifecycle event. Idempotent."""
    if not sub_config.is_enabled():
        # Escape hatch: projection paused. Acknowledge without writing.
        logger.debug("billing.subscriptions projection disabled — ack %s", event.event_name)
        return

    data = payload.get("data") if isinstance(payload, dict) else None
    meta = payload.get("meta") if isinstance(payload, dict) else None
    data = data if isinstance(data, dict) else {}
    meta = meta if isinstance(meta, dict) else {}

    sub = sub_types.from_lemon_event(
        provider=event.provider,
        event_name=event.event_name,
        event_id=event.id,
        event_at=event.received_at,
        data=data,
        meta=meta,
    )

    if sub is None:
        # A subscription lifecycle event that isn't a subscriptions object (or
        # is missing its id) is malformed → fail + retry so it's visible.
        raise ValueError(
            f"subscription event {event.event_name!r} missing a valid "
            f"subscriptions object (id={event.id})"
        )

    applied, current = sub_store.upsert(sub)
    if applied:
        logger.info(
            "billing.subscriptions projected | event=%s sub=%s status=%s app_user=%s",
            event.event_name, sub.subscription_id, sub.status or "-",
            sub.app_user_id or "-",
        )
    else:
        # Ordering guard skipped a stale/reordered delivery — expected, not an
        # error. The current (newer) state is retained.
        logger.info(
            "billing.subscriptions skipped stale event=%s sub=%s (kept newer state)",
            event.event_name, sub.subscription_id,
        )


def register_handlers() -> int:
    """Register the projection handler for every subscription lifecycle event,
    replacing the PR-2 acknowledgement default. Idempotent (replace=True).
    Returns the number of event names wired."""
    for name in sub_types.SUBSCRIPTION_LIFECYCLE_EVENTS:
        register(name, project_subscription_event, replace=True)
    return len(sub_types.SUBSCRIPTION_LIFECYCLE_EVENTS)


__all__ = ["project_subscription_event", "register_handlers"]
