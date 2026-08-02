# coding: utf-8
"""
Billing credits — typed store errors + idempotency comparison helpers.

Two concerns live here, both intentionally tiny and dependency-free so every
credit adapter (SQLite + Postgres) and the service layer can share ONE
definition:

1. A credit-specific error hierarchy. The credit ledger is authoritative for
   spend decisions, so an operational/connection/schema failure MUST fail
   closed — never degrade into a valid-looking zero balance or an empty ledger
   that a caller could mistake for "the account really has 0 credits". These
   errors are the fail-closed signal the read API maps to HTTP 503 and expensive
   callers must treat as "do not proceed".

     CreditStoreError            base (subclasses RuntimeError so a caller that
                                 does not care can `except RuntimeError`)
       CreditStoreUnavailable    store unavailable/misconfigured — fail closed
       CreditInvalidRequest      invalid spend request (blank/oversized ref …)
       CreditIdempotencyConflict a reference reused with a DIFFERENT immutable
                                 payload (mirrors the REASON_CONFLICT TxnResult)

   The ledger's normal per-request outcomes (insufficient funds, idempotent
   retry, invalid input, idempotency conflict, dormant) continue to be modelled
   as `TxnResult` reason codes — that is the established control-flow contract.
   The exception hierarchy is reserved for the genuinely exceptional
   fail-closed condition (`CreditStoreUnavailable`) plus the documented
   categories the reason codes mirror, so diagnostics can surface a bounded
   category name without leaking the underlying exception.

2. Deterministic idempotency-payload comparison. When a transaction already
   exists for `(user_id, reference)`, a repeat with the SAME immutable payload
   is an idempotent no-op, but a repeat with a DIFFERENT payload (amount, type,
   reason or metadata) is a conflict that must be rejected — never silently
   accepted as a successful retry and never allowed to overwrite the original.
   The comparison is canonical (sorted metadata keys, normalized reason) so it
   is identical between SQLite and Postgres and dictionary key order can never
   manufacture a false conflict.

No secrets, PII, SQL, DSNs or raw metadata are ever placed in these error
messages — callers log `type(exc).__name__` and a bounded static message only.
"""
from __future__ import annotations

import json
from typing import Any, Optional


# ── Error hierarchy ───────────────────────────────────────────────────────────

class CreditStoreError(RuntimeError):
    """Base class for credit-ledger storage failures. Subclasses RuntimeError so
    a caller that does not distinguish can still `except RuntimeError`."""


class CreditStoreUnavailable(CreditStoreError):
    """The authoritative credit store is unavailable or misconfigured (Postgres
    selected but unreachable/misconfigured, or an operational read/write
    failure). Callers MUST fail closed — never fall back to a second backend and
    never proceed into a paid operation. The read API surfaces this as HTTP 503
    with a stable, non-secret error code."""


class CreditInvalidRequest(CreditStoreError):
    """A spend request is structurally invalid (e.g. a blank or over-length
    idempotency reference). Documented category the REASON_INVALID `TxnResult`
    mirrors; the service returns the reason-code result rather than raising, so
    an invalid client input never looks like a successful deduction."""


class CreditIdempotencyConflict(CreditStoreError):
    """A `(user_id, reference)` pair was reused with a DIFFERENT immutable
    payload. Documented category the REASON_CONFLICT `TxnResult` mirrors; the
    store returns the reason-code result so the caller can map it to a stable
    conflict response without leaking the original transaction."""


# ── Idempotency payload canonicalization + comparison ─────────────────────────

def normalize_reason(reason: Any) -> str:
    """One-shot reason normalization used on BOTH sides of an idempotency
    comparison so trailing/leading whitespace can never manufacture a false
    conflict. Never raises."""
    if reason is None:
        return ""
    try:
        return str(reason).strip()
    except Exception:  # pragma: no cover — defensive
        return ""


def canonical_metadata(metadata: Any) -> str:
    """Deterministic canonical JSON for a metadata dict: sorted keys, compact
    separators. Non-dict / empty → "{}". Non-JSON-native values fall back to
    their string form so comparison stays stable rather than raising. Never
    raises."""
    if not isinstance(metadata, dict) or not metadata:
        return "{}"
    try:
        return json.dumps(
            metadata, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, default=str,
        )
    except Exception:  # pragma: no cover — defensive
        return "{}"


def canonical_metadata_from_raw(raw: Any) -> str:
    """Canonicalize metadata read back from a store row. The row may hold the
    stored JSON text (SQLite / our Postgres TEXT column) or an already-decoded
    dict; both normalize to the same canonical form as `canonical_metadata`."""
    if isinstance(raw, dict):
        return canonical_metadata(raw)
    if not raw:
        return "{}"
    try:
        decoded = json.loads(raw)
    except Exception:
        return "{}"
    return canonical_metadata(decoded if isinstance(decoded, dict) else {})


def payload_conflict(
    *,
    prior_type: Any,
    prior_amount: Any,
    prior_reason: Any,
    prior_metadata_raw: Any,
    new_type: Any,
    new_delta: Any,
    new_reason: Any,
    new_metadata: Any,
) -> bool:
    """True when a same-reference retry carries a DIFFERENT immutable payload
    than the stored original — i.e. an idempotency conflict rather than a
    legitimate identical retry.

    Compares the operation's immutable identity: transaction type, signed
    delta, normalized reason and canonicalized metadata. Deterministic and
    identical across SQLite and Postgres; dictionary key order never matters.
    Never raises — an unparseable side degrades to a stable canonical form so a
    comparison failure cannot crash the append path.
    """
    try:
        if str(prior_type) != str(new_type):
            return True
        if int(prior_amount) != int(new_delta):
            return True
        if normalize_reason(prior_reason) != normalize_reason(new_reason):
            return True
        if canonical_metadata_from_raw(prior_metadata_raw) != canonical_metadata(new_metadata):
            return True
        return False
    except Exception:  # pragma: no cover — a comparison error is treated as a
        # conflict (fail safe: never silently accept a possibly-divergent retry).
        return True


__all__ = [
    "CreditStoreError",
    "CreditStoreUnavailable",
    "CreditInvalidRequest",
    "CreditIdempotencyConflict",
    "normalize_reason",
    "canonical_metadata",
    "canonical_metadata_from_raw",
    "payload_conflict",
]
