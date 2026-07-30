# coding: utf-8
"""
v2 billing — Polar webhook endpoint (PR #524).

  POST /v2/billing/webhooks/polar

A public, non-JWT provider callback (Polar is the caller) authenticated by the
**Standard Webhooks** signature over the RAW request body — NOT Lemon's hex
`X-Signature`. Verifier strategies are kept provider-specific.

It REUSES the existing webhook inbox, processor and subscription projection with
`provider="polar"` — no second inbox, ledger, table or engine. It is:

  * GATED   — 503 while ENABLE_BILLING is off, so it ships dormant. Independent of
              BILLING_PROVIDER: Polar deliveries may be validated in SANDBOX while
              Lemon remains the active checkout provider (dual-provider migration).
  * BOUNDED — refuses bodies over the configured cap (413) before buffering.
  * VERIFIED— constant-time Standard-Webhooks HMAC + bounded timestamp tolerance,
              BEFORE any JSON parse or persistence. Missing signature → 401;
              missing secret → 503 (fail closed).
  * IDEMPOTENT — identical retries collide on the inbox dedup key (200, duplicate).

Never logs the secret or the complete body. Grants NO entitlement here — it only
authenticates, validates and durably records; the projection + entitlement
resolver run downstream exactly as for Lemon.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.billing import config as billing_config
from backend.services.billing import inbox as billing_inbox
from backend.services.billing.polar import config as polar_config
from backend.services.billing.polar import signature as polar_signature
from backend.services.billing.types import PROVIDER_POLAR
from backend.routes.v2_billing import _read_body_capped   # reuse the streamed size cap
from backend.services.db.errors import DBConfigError, DBUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/billing", tags=["billing"])

_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


@router.post("/webhooks/polar")
async def polar_webhook(request: Request) -> JSONResponse:
    """Ingest one Polar webhook delivery (Standard Webhooks verified)."""
    # 1. Master gate — dormant until billing is enabled.
    if not billing_config.is_enabled():
        return _resp(503, envelope_err("billing webhook disabled", code="BILLING_DISABLED"))

    # 2. Signing secret must be configured, else we cannot authenticate Polar.
    secret = polar_config.webhook_secret()
    if not secret:
        logger.error("polar webhook rejected: POLAR_WEBHOOK_SECRET not configured")
        return _resp(503, envelope_err("polar webhook not configured", code="BILLING_NOT_CONFIGURED"))

    # 3. Bounded body read (413 before buffering an oversized payload).
    raw_body, too_large = await _read_body_capped(request, billing_config.max_body_bytes())
    if too_large:
        return _resp(413, envelope_err("payload too large", code="PAYLOAD_TOO_LARGE"))
    if raw_body is None:
        raw_body = b""

    # 4. Standard-Webhooks signature verification over the RAW bytes, BEFORE parse.
    if not polar_signature.verify(raw_body=raw_body, headers=request.headers, secret=secret):
        logger.warning("polar webhook rejected: invalid signature")
        return _resp(401, envelope_err("invalid signature", code="INVALID_SIGNATURE"))

    # 5. Parse — must be a JSON object (permanent 400 on failure).
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        logger.warning("polar webhook rejected: body is not valid JSON")
        return _resp(400, envelope_err("invalid JSON body", code="INVALID_JSON"))
    if not isinstance(payload, dict):
        logger.warning("polar webhook rejected: JSON body is not an object")
        return _resp(400, envelope_err("expected a JSON object", code="INVALID_JSON"))

    # Polar carries the event name as top-level `type`.
    event_type = str(payload.get("type") or "").strip()

    # 6. Idempotent durable persist into the SHARED inbox with provider="polar".
    try:
        result = billing_inbox.ingest(
            raw_body=raw_body,
            payload=payload,
            event_name_header=event_type,   # top-level type is the event name for Polar
            signature=None,                 # SW signature is a keyed digest; not stored
            provider=PROVIDER_POLAR,
        )
    except (DBConfigError, DBUnavailable) as exc:
        logger.error("polar webhook store unavailable: %s", exc)
        return _resp(503, envelope_err("store temporarily unavailable", code="STORE_UNAVAILABLE"))
    except Exception as exc:  # pragma: no cover — never leak internals to the caller
        logger.exception("polar webhook ingest failed: %s", exc)
        return _resp(503, envelope_err("ingest failed", code="INGEST_FAILED"))

    return _resp(200, envelope_ok(
        {
            "received": True,
            "duplicate": result.duplicate,
            "event_id": result.event_id,
            "event_name": result.event_name,
            "status": result.status,
        },
        duplicate=result.duplicate,
    ))


__all__ = ["router"]
