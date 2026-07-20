# coding: utf-8
"""
Billing — Lemon Squeezy webhook signature verification (PR 1).

Lemon Squeezy signs each webhook with HMAC-SHA256 over the RAW request body
using the store's signing secret, and sends the hex digest in the
`X-Signature` header. Verification therefore MUST run against the exact
bytes received — never a re-serialized copy of the parsed JSON, which would
differ in key order / whitespace and fail every time. The route reads
`await request.body()` and passes those bytes straight here.

Security properties:
  * Constant-time comparison (`hmac.compare_digest`) — no timing oracle on
    the signature.
  * Fails closed on a missing/empty secret or header — an unauthenticated
    caller can never be treated as verified.
  * Never raises — returns a bool the route maps to an HTTP status. The
    secret is never logged or echoed.
"""
from __future__ import annotations

import hmac
import hashlib
import logging

logger = logging.getLogger(__name__)


def compute_digest(raw_body: bytes, secret: str) -> str:
    """HMAC-SHA256(secret, raw_body) as a lowercase hex string."""
    return hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()


def verify(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """Return True iff `signature_header` is a valid HMAC-SHA256 signature of
    `raw_body` under `secret`.

    Defensive contract — any of the following yields False (never an
    exception):
      * empty secret (endpoint not configured to authenticate)
      * empty / missing signature header
      * malformed header (non-hex, wrong length)
      * digest mismatch
    """
    if not secret:
        # Caller should have already surfaced 503 for a missing secret; guard
        # here too so verification can never pass without one.
        return False
    if not signature_header:
        return False

    provided = signature_header.strip().lower()
    if not provided:
        return False

    try:
        expected = compute_digest(raw_body, secret)
        # compare_digest is constant-time and refuses to leak length; both
        # operands are ASCII hex of identical length on the happy path.
        return hmac.compare_digest(expected, provided)
    except Exception as exc:  # pragma: no cover — defensive; never leak details
        logger.warning("billing.signature.verify failed: %s", type(exc).__name__)
        return False


__all__ = ["compute_digest", "verify"]
