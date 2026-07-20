# coding: utf-8
"""
Billing — webhook inbox ingestion (PR 1).

The single orchestration entry point the route calls AFTER it has:
  1. confirmed the billing surface is enabled,
  2. enforced the request-body size cap,
  3. verified the HMAC-SHA256 signature over the raw body.

`ingest()` is therefore only ever handed a VERIFIED payload. It:
  * computes the deterministic idempotency key (SHA-256 of the raw body),
  * extracts the routing fields from the JSON:API-shaped payload,
  * persists the event exactly once via the dual-backend store,
  * returns a compact, content-free result the route maps to an HTTP body.

It never raises for a malformed-but-verified payload — a delivery that
passed signature verification is authentic and worth persisting for
diagnostics even if its shape is unexpected. It only propagates DB-layer
errors (in strict-Postgres mode) so the route can answer 503 and let Lemon
Squeezy retry rather than silently dropping the delivery.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.billing import store
from backend.services.billing.types import (
    DEFAULT_PROVIDER, STATUS_STORED, WebhookEvent, parse_event_fields,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IngestResult:
    """Outcome of an ingest call — safe to serialize into the webhook
    response. Carries NO payload content."""
    accepted: bool
    duplicate: bool
    event_id: Optional[str]
    event_name: str
    status: str


def compute_dedup_key(raw_body: bytes) -> str:
    """SHA-256 of the exact received bytes. Deterministic and
    secret-rotation-safe: Lemon Squeezy retries the identical body, so a
    retry collides on the UNIQUE(provider, dedup_key) index and is ingested
    once."""
    return hashlib.sha256(raw_body).hexdigest()


def ingest(
    *,
    raw_body: bytes,
    payload: Dict[str, Any],
    event_name_header: str = "",
    signature: Optional[str] = None,
    provider: str = DEFAULT_PROVIDER,
) -> IngestResult:
    """Persist a verified webhook delivery idempotently.

    `raw_body`         the exact bytes received (used for the dedup key +
                       stored verbatim as the authoritative payload).
    `payload`          the parsed JSON body (already known to be a dict).
    `event_name_header` the X-Event-Name header (fallback when meta.event_name
                       is absent).
    `signature`        the X-Signature header, stored for audit (already
                       verified by the route — not a secret).
    """
    dedup_key = compute_dedup_key(raw_body)
    fields = parse_event_fields(payload)
    event_name = fields["event_name"] or (event_name_header or "").strip()

    # Store the exact received bytes as the authoritative payload copy. Decode
    # defensively — the body verified as a JSON document, so it is UTF-8; fall
    # back to a canonical re-serialization if decoding ever fails.
    try:
        payload_text = raw_body.decode("utf-8")
    except Exception:  # pragma: no cover — verified JSON is UTF-8
        payload_text = json.dumps(payload, ensure_ascii=False, default=str)

    event = WebhookEvent(
        provider=provider,
        event_name=event_name,
        resource_type=fields["resource_type"],
        resource_id=fields["resource_id"],
        dedup_key=dedup_key,
        signature=signature,
        payload_json=payload_text,
        status=STATUS_STORED,
    )

    inserted, stored = store.insert_idempotent(event)

    if inserted:
        logger.info(
            "billing.webhook ingested | provider=%s event=%s resource=%s/%s id=%s",
            provider, event_name or "(unknown)",
            fields["resource_type"] or "-", fields["resource_id"] or "-",
            stored.id,
        )
    else:
        # Idempotent duplicate — Lemon Squeezy retry of an already-stored
        # delivery. Not an error; logged at INFO for visibility.
        logger.info(
            "billing.webhook duplicate ignored | provider=%s event=%s id=%s",
            provider, event_name or "(unknown)", stored.id,
        )

    return IngestResult(
        accepted=True,
        duplicate=not inserted,
        event_id=stored.id,
        event_name=stored.event_name or event_name,
        status=stored.status,
    )


__all__ = ["IngestResult", "compute_dedup_key", "ingest"]
