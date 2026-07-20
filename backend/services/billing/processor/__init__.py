# coding: utf-8
"""
Billing processor — webhook consumption engine (PR 2).

Consumes the durably-stored webhook events from the PR-1 inbox and routes them
to typed, idempotent handlers with concurrency-safe claiming, retry,
dead-lettering and stale reclaim. Scope for PR 2 is "engine + handler
framework only": the machinery plus safe acknowledgement handlers for the
known Lemon Squeezy event types. Entitlement / credit / subscription logic is
deliberately NOT here — a later PR registers real handlers against the same
event names.

Public surface:

    from backend.services.billing.processor import service, registry
    service.process_after_ingest(event_id)   # inline hook (webhook path)
    service.drain(limit=100)                  # batch backlog (owner endpoint)
    service.stats()                           # diagnostics

Feature flag:
    ENABLE_BILLING_PROCESSOR=true → stored events are consumed
    default / unset               → events accumulate as `stored`, untouched

The default acknowledgement handlers are registered at import time so the
registry is populated regardless of whether the processor is currently
enabled (the flag only governs execution, not registration).
"""
import logging

from backend.services.billing.processor import config, registry, service
from backend.services.billing.processor.handlers import register_default_handlers

logger = logging.getLogger(__name__)

# Populate the registry once, on import. Idempotent (replace=True) so a reload
# never raises. A failure here is non-fatal — an unregistered event simply
# gets the "no handler" acknowledgement path.
try:
    _n = register_default_handlers()
    logger.debug("billing.processor registered %d default handlers", _n)
except Exception as _e:  # pragma: no cover
    logger.warning("billing.processor default handler registration failed: %s", _e)


__all__ = ["config", "registry", "service"]
