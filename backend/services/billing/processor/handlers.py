# coding: utf-8
"""
Billing processor — default handlers (PR 2).

PR 2 is "engine + handler framework only": these handlers ACKNOWLEDGE the
known Lemon Squeezy event types (verify the delivery shape, log it PII-free,
return cleanly) but perform NO entitlement / credit / subscription mutation.
That business logic lands in a later PR, which will register real handlers
against these same event names — typically with `replace=True`, or by
importing this module and overriding specific entries.

Keeping an explicit, named handler per known event type (rather than a single
catch-all) means:
  * the /v2/admin/billing/stats "registered handlers" list documents exactly
    which events the system understands today, and
  * a future PR can replace one event's handler without touching the others.

An event whose name is NOT in this list is still handled by the engine — it
is acknowledged as "no handler" and marked processed (see processor.service).
"""
from __future__ import annotations

import logging

from backend.services.billing.types import WebhookEvent
from backend.services.billing.processor.registry import register


logger = logging.getLogger(__name__)


# The Lemon Squeezy webhook event types this system recognises today. Source:
# Lemon Squeezy webhooks documentation. Adding a name here (or registering a
# handler elsewhere) is all that is needed to "understand" a new event.
KNOWN_EVENT_NAMES = (
    # Orders
    "order_created",
    "order_refunded",
    # Subscriptions — lifecycle
    "subscription_created",
    "subscription_updated",
    "subscription_cancelled",
    "subscription_resumed",
    "subscription_expired",
    "subscription_paused",
    "subscription_unpaused",
    # Subscriptions — payments
    "subscription_payment_success",
    "subscription_payment_failed",
    "subscription_payment_recovered",
    "subscription_payment_refunded",
    # Subscriptions — plan
    "subscription_plan_changed",
    # License keys
    "license_key_created",
    "license_key_updated",
)


def acknowledge(event: WebhookEvent, payload: dict) -> None:
    """Default no-op handler: record that the event was consumed, without
    acting on it. Idempotent by construction (it has no side effects).

    Logs identity/routing fields only — never the payload body, which can
    carry customer PII.
    """
    logger.info(
        "billing.processor acknowledged | event=%s resource=%s/%s id=%s attempts=%d",
        event.event_name or "(unknown)",
        event.resource_type or "-",
        event.resource_id or "-",
        event.id or "-",
        event.attempts,
    )


def register_default_handlers() -> int:
    """Register the acknowledgement handler for every known event type.

    Idempotent: uses replace=True so re-import / re-registration (tests, a
    reload) never raises. Returns the number of handlers registered. A future
    PR registering real logic should run AFTER this (or use replace=True) so
    its handlers win."""
    for name in KNOWN_EVENT_NAMES:
        register(name, acknowledge, replace=True)
    return len(KNOWN_EVENT_NAMES)


__all__ = ["KNOWN_EVENT_NAMES", "acknowledge", "register_default_handlers"]
