# coding: utf-8
"""
Billing Polar — webhook signature verification (PR #524).

Polar signs webhooks with the **Standard Webhooks** scheme (base64 HMAC-SHA256),
NOT Lemon Squeezy's hex `X-Signature`. Verifier strategies are kept provider-
specific — this module NEVER touches the Lemon verifier and vice-versa.

Standard Webhooks contract:
  * headers `webhook-id`, `webhook-timestamp`, `webhook-signature`
  * signed content = `{id}.{timestamp}.{raw_body}`
  * signature = base64( HMAC-SHA256(key, signed_content) )
  * the `webhook-signature` header may carry multiple space-separated
    `v1,<base64sig>` entries; any valid one authenticates.

HMAC key — Polar's specific behavior (verified against the official SDKs):
  Polar's `validate_event` base64-ENCODES the raw dashboard secret and hands that
  to the Standard-Webhooks verifier, which base64-DECODES it again — so the net
  HMAC key is the **raw secret string's UTF-8 bytes, exactly as configured in the
  dashboard** (e.g. `polar_whs_…`, prefix included). Polar does NOT base64-decode
  the dashboard secret. We therefore use the raw trimmed secret bytes as the key
  and NEVER base64-decode it (decoding a `polar_whs_…`/raw secret silently
  produced the wrong key → every delivery 401'd).
    * polarsource/polar-js validateEvent: Buffer.from(secret,"utf-8").toString("base64")
    * standard-webhooks Webhook.__init__: strips optional `whsec_`, then b64decode
    * compose: b64decode(b64encode(secret.utf8)) == secret.utf8  → key = raw bytes

Security: constant-time comparison; a bounded timestamp tolerance rejects
replays; the raw body bytes are signed as-received (verified BEFORE JSON parse).
The secret is NEVER logged.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from typing import Mapping, Optional


# Reject a delivery whose timestamp is outside this window (seconds) — replay guard.
DEFAULT_TOLERANCE_SECONDS = 300

_WEBHOOK_ID = "webhook-id"
_WEBHOOK_TIMESTAMP = "webhook-timestamp"
_WEBHOOK_SIGNATURE = "webhook-signature"


def _secret_bytes(secret: str) -> Optional[bytes]:
    """Polar webhook secret → HMAC key: the RAW trimmed dashboard secret's UTF-8
    bytes, used exactly as configured (prefix and all). This matches Polar's
    official SDK (which base64-encodes the raw secret and lets the Standard-
    Webhooks verifier base64-decode it back — net identity → raw bytes).

    We deliberately do NOT strip any prefix and NEVER base64-decode: decoding a
    modern `polar_whs_…` (or any raw) secret silently dropped its non-base64
    characters and produced the WRONG key, rejecting every valid delivery as 401.
    Returns None only for an empty secret (fail closed)."""
    s = (secret or "").strip()
    if not s:
        return None
    return s.encode("utf-8")


def _lower_headers(headers: Mapping[str, str]) -> dict:
    out = {}
    try:
        for k, v in headers.items():
            out[str(k).lower()] = v
    except Exception:
        return {}
    return out


def verify(
    *,
    raw_body: bytes,
    headers: Mapping[str, str],
    secret: str,
    now: Optional[int] = None,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> bool:
    """Verify a Polar Standard-Webhooks delivery. Returns True only when the
    signature matches AND the timestamp is within tolerance. FAILS CLOSED on a
    missing secret / header, a bad timestamp, or any error. Never raises, never
    logs the secret."""
    try:
        key = _secret_bytes(secret)
        if key is None:
            return False
        h = _lower_headers(headers)
        wid = (h.get(_WEBHOOK_ID) or "").strip()
        wts = (h.get(_WEBHOOK_TIMESTAMP) or "").strip()
        wsig = (h.get(_WEBHOOK_SIGNATURE) or "").strip()
        if not wid or not wts or not wsig:
            return False

        # Replay guard — bounded timestamp tolerance.
        try:
            ts = int(wts)
        except (TypeError, ValueError):
            return False
        now_i = int(now) if now is not None else int(time.time())
        if abs(now_i - ts) > max(0, int(tolerance_seconds)):
            return False

        # signed content = "{id}.{timestamp}.{raw body bytes}"
        to_sign = f"{wid}.{ts}.".encode("utf-8") + (raw_body or b"")
        digest = hmac.new(key, to_sign, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode("ascii")

        # Any space-separated `v1,<sig>` entry may match (constant-time compare).
        for part in wsig.split(" "):
            part = part.strip()
            if not part:
                continue
            _, _, provided = part.partition(",")
            provided = (provided or part).strip()
            if provided and hmac.compare_digest(expected, provided):
                return True
        return False
    except Exception:
        return False


__all__ = ["verify", "DEFAULT_TOLERANCE_SECONDS"]
