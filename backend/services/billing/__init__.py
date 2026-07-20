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
from backend.services.billing.config import is_enabled
from backend.services.billing.types import (
    WebhookEvent, parse_event_fields,
    PROVIDER_LEMON_SQUEEZY, DEFAULT_PROVIDER,
    STATUS_RECEIVED, STATUS_STORED, STATUS_PROCESSING,
    STATUS_PROCESSED, STATUS_FAILED,
)
from backend.services.billing.inbox import IngestResult, ingest, compute_dedup_key


__all__ = [
    "is_enabled",
    "WebhookEvent", "parse_event_fields",
    "PROVIDER_LEMON_SQUEEZY", "DEFAULT_PROVIDER",
    "STATUS_RECEIVED", "STATUS_STORED", "STATUS_PROCESSING",
    "STATUS_PROCESSED", "STATUS_FAILED",
    "IngestResult", "ingest", "compute_dedup_key",
]
