# coding: utf-8
"""
v2 billing — Lemon Squeezy webhook endpoint (PR 1: Webhook Foundation).

  POST /v2/billing/webhooks/lemon-squeezy

A public, unauthenticated-by-JWT endpoint (Lemon Squeezy is the caller) that
is instead authenticated by an HMAC-SHA256 signature over the RAW request
body. The endpoint is:

  * GATED   — returns 503 while ENABLE_BILLING is off, so it ships dormant.
  * BOUNDED — refuses bodies over LEMON_SQUEEZY_WEBHOOK_MAX_BYTES (413) before
              buffering them, so a hostile caller can't exhaust memory.
  * VERIFIED— constant-time HMAC check against X-Signature; a missing/invalid
              signature is 401 and nothing is stored. A missing signing
              secret is 503 (fail closed — we cannot authenticate callers).
  * IDEMPOTENT — identical retries collide on the inbox dedup key and are
              accepted once (200, duplicate=true).

HTTP contract (chosen for correct webhook retry semantics):
  200  accepted (incl. idempotent duplicate) — Lemon Squeezy stops retrying
  400  body is not a JSON object              — permanent; retry won't help
  401  signature missing/invalid              — permanent
  413  body too large                         — permanent
  503  billing disabled / secret unset / durable-store unavailable — TRANSIENT;
       Lemon Squeezy retries, so no delivery is lost.

This route performs NO subscription/entitlement/credit logic and makes NO
outbound Lemon Squeezy API calls — it only authenticates, validates and
durably records the delivery. Downstream processing is a later PR.
"""
from __future__ import annotations

import json
import logging
from typing import Optional, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.core.responses import ok as envelope_ok, err as envelope_err
from backend.services.billing import config as billing_config
from backend.services.billing import signature as billing_signature
from backend.services.billing import inbox as billing_inbox
from backend.services.db.errors import DBConfigError, DBUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/billing", tags=["billing"])

# Lemon Squeezy delivery headers.
_SIGNATURE_HEADER = "X-Signature"
_EVENT_NAME_HEADER = "X-Event-Name"

# Webhook responses must never be cached by an intermediary.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}


def _resp(status: int, body: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=body, headers=_NO_STORE)


async def _read_body_capped(request: Request, max_bytes: int) -> Tuple[Optional[bytes], bool]:
    """Read the request body, refusing to buffer more than `max_bytes`.

    Returns (body, too_large). Honours Content-Length as a fast reject, then
    streams so a chunked body without a declared length is still bounded to
    ~max_bytes + one chunk of memory.
    """
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > max_bytes:
                return None, True
        except (TypeError, ValueError):
            pass  # unparseable header — fall through to the streamed cap

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            return None, True
        chunks.append(chunk)
    return b"".join(chunks), False


@router.post("/webhooks/lemon-squeezy")
async def lemon_squeezy_webhook(request: Request) -> JSONResponse:
    """Ingest one Lemon Squeezy webhook delivery. See module docstring for the
    full HTTP contract."""
    # 1. Feature gate — dormant until explicitly enabled.
    if not billing_config.is_enabled():
        return _resp(503, envelope_err("billing webhook disabled", code="BILLING_DISABLED"))

    # 2. Signing secret must be configured, else we cannot authenticate the
    #    caller. Fail closed with a transient status so Lemon retries once the
    #    operator sets the secret.
    secret = billing_config.webhook_secret()
    if not secret:
        logger.error("billing webhook rejected: LEMON_SQUEEZY_WEBHOOK_SECRET not configured")
        return _resp(503, envelope_err("billing webhook not configured", code="BILLING_NOT_CONFIGURED"))

    # 3. Bounded body read (413 before buffering an oversized payload).
    raw_body, too_large = await _read_body_capped(request, billing_config.max_body_bytes())
    if too_large:
        return _resp(413, envelope_err("payload too large", code="PAYLOAD_TOO_LARGE"))
    if raw_body is None:
        raw_body = b""

    # 4. Signature verification over the RAW bytes (constant-time).
    provided_sig = (request.headers.get(_SIGNATURE_HEADER) or "").strip()
    if not billing_signature.verify(raw_body, provided_sig, secret):
        # Do NOT reveal whether the header was absent vs. mismatched.
        logger.warning("billing webhook rejected: invalid signature")
        return _resp(401, envelope_err("invalid signature", code="INVALID_SIGNATURE"))

    # 5. Parse — must be a JSON object. A verified-but-unparseable body is a
    #    permanent (400) condition; retrying identical bytes won't help.
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        logger.warning("billing webhook rejected: body is not valid JSON")
        return _resp(400, envelope_err("invalid JSON body", code="INVALID_JSON"))
    if not isinstance(payload, dict):
        logger.warning("billing webhook rejected: JSON body is not an object")
        return _resp(400, envelope_err("expected a JSON object", code="INVALID_JSON"))

    event_name_header = (request.headers.get(_EVENT_NAME_HEADER) or "").strip()

    # 6. Idempotent durable persist. A strict-Postgres store outage surfaces
    #    as 503 so the delivery is retried rather than dropped.
    try:
        result = billing_inbox.ingest(
            raw_body=raw_body,
            payload=payload,
            event_name_header=event_name_header,
            signature=provided_sig or None,
        )
    except (DBConfigError, DBUnavailable) as exc:
        logger.error("billing webhook store unavailable: %s", exc)
        return _resp(503, envelope_err("store temporarily unavailable", code="STORE_UNAVAILABLE"))
    except Exception as exc:  # pragma: no cover — never leak internals to the caller
        logger.exception("billing webhook ingest failed: %s", exc)
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
