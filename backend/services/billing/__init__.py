# coding: utf-8
"""
Billing — Lemon Squeezy webhook foundation (PR 1).

A production-grade, secure inbox for inbound billing webhooks. This PR builds
ONLY the foundation:

  * a signature-verified, size-capped, idempotent webhook endpoint
    (/v2/billing/webhooks/lemon-squeezy),
  * a durable, dual-backend (SQLite default / Postgres when enabled) webhook
    inbox with explicit event-lifecycle tracking,
  * owner-only diagnostics (/v2/admin/billing/*).

It deliberately does NOT implement subscription management, entitlements,
credits, checkout, frontend billing UI, or any outbound Lemon Squeezy API
call — those belong to later PRs and will consume the events this inbox
stores (the STORED → PROCESSING → PROCESSED/FAILED lifecycle is already
modelled for them).

Public surface:

    from backend.services.billing import (
        config, signature, inbox, store,
        WebhookEvent, is_enabled,
    )

Feature flag:
    ENABLE_BILLING=true   → the webhook route ingests deliveries
    default / unset       → the route returns 503; nothing is ingested

Rollback:
    1. ENABLE_BILLING=false          (instant; no restart)
    2. (optional) rm billing.db      (forgets the inbox; nothing else moves)
"""
import logging

from backend.services.billing.config import is_enabled
from backend.services.billing.types import (
    WebhookEvent, parse_event_fields,
    PROVIDER_LEMON_SQUEEZY, DEFAULT_PROVIDER,
    STATUS_RECEIVED, STATUS_STORED, STATUS_PROCESSING,
    STATUS_PROCESSED, STATUS_FAILED,
)
from backend.services.billing.inbox import IngestResult, ingest, compute_dedup_key

logger = logging.getLogger(__name__)


# PR 3 — register the subscription-state projection handlers on top of the
# PR-2 processor defaults. Importing the subpackage triggers registration as a
# side effect (the projection handlers replace the acknowledgement no-ops for
# the subscription lifecycle events). This is the composition root: it always
# runs because importing ANY billing submodule imports this package first, so
# the projection handlers are registered before the processor can run. Guarded
# so a projection wiring failure never breaks ingestion.
try:
    from backend.services.billing import subscriptions as _subscriptions  # noqa: F401
except Exception as _e:  # pragma: no cover
    logger.warning("billing: subscription projection wiring failed (non-fatal): %s", _e)


def processor_is_enabled() -> bool:
    """Whether the PR-2 consumer engine is enabled (ENABLE_BILLING_PROCESSOR).
    Thin re-export so callers don't reach into the processor subpackage."""
    from backend.services.billing.processor import config as _pc
    return _pc.is_enabled()


__all__ = [
    "is_enabled", "processor_is_enabled",
    "WebhookEvent", "parse_event_fields",
    "PROVIDER_LEMON_SQUEEZY", "DEFAULT_PROVIDER",
    "STATUS_RECEIVED", "STATUS_STORED", "STATUS_PROCESSING",
    "STATUS_PROCESSED", "STATUS_FAILED",
    "IngestResult", "ingest", "compute_dedup_key",
]
