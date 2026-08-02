# coding: utf-8
"""
Billing credits — service / public API (PR 8).

The stable surface for the immutable credit ledger. It exposes grants,
consumption, adjustments, balance reads and an audit verification.

    from backend.services.billing.credits import service as credits
    credits.grant(user_id, 100, reason="promo", reference="promo-2026")
    if credits.can_consume(user_id, 5): ...
    res = credits.consume(user_id, 5, reason="image_gen", reference=op_id)
    bal = credits.get_balance(user_id)

INTEGRATION POINTS (prepared, NOT wired in this PR): `can_consume` and
`consume` are the seam a future AI Guard / expensive-operation layer will call
to charge credits. This PR does NOT wire them into any route, does NOT compute
AI provider costs, and does NOT change usage enforcement — it only provides the
ledger + the API.

Dormant by default: when ENABLE_BILLING_CREDITS is off, mutating calls are
no-ops (applied=False, reason_code="disabled") and reads return an empty
account, so nothing is written until the ledger is explicitly enabled.

Credits are INDEPENDENT of subscription state — keyed by user_id only.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.billing.credits import config as credits_config
from backend.services.billing.credits import store as credits_store
from backend.services.billing.credits.errors import CreditStoreError
from backend.services.db import engine as db_engine
from backend.services.billing.credits.types import (
    CreditAccount, CreditTransaction, TxnResult,
    TYPE_GRANT, TYPE_CONSUME, TYPE_ADJUST, TYPE_REVOKE,
    REASON_DISABLED, REASON_INVALID,
)


logger = logging.getLogger(__name__)

# Conservative upper bound for a spend idempotency reference, matching the
# repository convention (admin billing route reference fields cap at 200). A
# longer reference is REJECTED, never silently truncated.
MAX_REFERENCE_LENGTH = 200


def is_enabled() -> bool:
    return credits_config.is_enabled()


def _dormant(user_id: str) -> TxnResult:
    return TxnResult(applied=False, reason_code=REASON_DISABLED,
                     balance=0, idempotent=False, transaction=None)


def _invalid(user_id: str) -> TxnResult:
    """Typed invalid-input result. The balance is advisory only; a store outage
    while resolving it must NOT be masked as a success, but it also must not
    turn a client input error into a 503 — so the read is best-effort here."""
    bal = 0
    if is_enabled():
        try:
            bal = credits_store.get_balance(user_id)
        except CreditStoreError:
            bal = 0
    return TxnResult(applied=False, reason_code=REASON_INVALID,
                     balance=bal, idempotent=False, transaction=None)


def _normalized_spend_reference(reference: Optional[str]) -> Optional[str]:
    """Validate + normalize a REQUIRED spend idempotency reference.

    Returns the normalized (surrounding whitespace stripped) reference, or None
    when it is missing/blank/over-length — in which case the caller returns a
    typed invalid result. The reference is never generated here and never
    truncated: the route/job layer must supply a stable, server-derived
    operation reference, and a client-provided operation id alone must never
    become the authoritative spend reference."""
    if not isinstance(reference, str):
        return None
    normalized = reference.strip()
    if not normalized or len(normalized) > MAX_REFERENCE_LENGTH:
        return None
    return normalized


# ── Reads ────────────────────────────────────────────────────────────────────

def get_account(user_id: str) -> CreditAccount:
    uid = (user_id or "").strip()
    if not is_enabled() or not uid:
        return CreditAccount(user_id=uid, balance=0)
    return credits_store.get_account(uid)


def get_balance(user_id: str) -> int:
    return get_account(user_id).balance


def can_consume(user_id: str, amount: int) -> bool:
    """Preview whether `amount` credits could be consumed right now. Integration
    seam for AI Guard / expensive ops. Returns True when the ledger is dormant
    (nothing to enforce yet) so callers behave unchanged until credits are on."""
    if not is_enabled():
        return True
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return False
    if amount <= 0:
        return True
    return get_balance(user_id) >= amount


def list_transactions(user_id: str, *, limit: int = 50, offset: int = 0):
    if not is_enabled():
        return []
    return credits_store.list_transactions((user_id or "").strip(), limit=limit, offset=offset)


# ── Mutations ─────────────────────────────────────────────────────────────────

def grant(user_id: str, amount: int, *, reason: str = "", reference: Optional[str] = None,
          metadata: Optional[dict] = None) -> TxnResult:
    """Add `amount` (>0) credits. Idempotent by (user_id, reference)."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return _dormant(uid)
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return _invalid(uid)
    if not uid or amount <= 0:
        return _invalid(uid)
    return credits_store.apply(
        user_id=uid, delta=amount, type=TYPE_GRANT, reason=reason,
        reference=reference, metadata=metadata, allow_negative=False,
    )


def consume(user_id: str, amount: int, *, reason: str = "", reference: Optional[str] = None,
            metadata: Optional[dict] = None) -> TxnResult:
    """Spend `amount` (>0) credits, recording an immutable consume entry.

    Non-negativity is UNCONDITIONAL: a normal consume can never drive the
    balance below zero and is rejected (reason_code=insufficient_funds) when it
    would overdraw — regardless of `BILLING_CREDITS_ALLOW_NEGATIVE` or any
    caller input. Overdraft is an owner-only capability that lives on `adjust`
    / `revoke`, never here.

    A valid, non-empty, bounded server-derived `reference` is REQUIRED — a spend
    with no/blank/over-length reference is rejected (reason_code=invalid) before
    any mutation, so it can never be mistaken for a successful deduction.

    Idempotent by (user_id, reference): an identical retry does NOT
    double-charge and returns the original transaction; the same reference
    reused with a DIFFERENT payload is rejected (reason_code=idempotency_conflict).
    Integration seam for AI Guard / expensive ops (not wired in this PR)."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return _dormant(uid)
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return _invalid(uid)
    if not uid or amount <= 0:
        return _invalid(uid)
    ref = _normalized_spend_reference(reference)
    if ref is None:
        return _invalid(uid)
    # allow_negative is FORCED False: normal consumption is unconditionally
    # non-negative. The parameter is intentionally not exposed to consume
    # callers, so a client can never enable overdraft.
    return credits_store.apply(
        user_id=uid, delta=-amount, type=TYPE_CONSUME, reason=reason,
        reference=ref, metadata=metadata, allow_negative=False,
    )


def adjust(user_id: str, delta: int, *, reason: str = "", reference: Optional[str] = None,
           metadata: Optional[dict] = None, allow_negative: bool = True) -> TxnResult:
    """Manual signed correction (owner tool). Positive or negative. Defaults to
    allowing a negative result so an operator can force a correction; pass
    allow_negative=False to refuse an overdraw."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return _dormant(uid)
    try:
        delta = int(delta)
    except (TypeError, ValueError):
        return _invalid(uid)
    if not uid or delta == 0:
        return _invalid(uid)
    return credits_store.apply(
        user_id=uid, delta=delta, type=TYPE_ADJUST, reason=reason,
        reference=reference, metadata=metadata, allow_negative=allow_negative,
    )


def revoke(user_id: str, amount: int, *, reason: str = "", reference: Optional[str] = None,
           metadata: Optional[dict] = None, allow_negative: bool = True) -> TxnResult:
    """Claw back `amount` (>0) previously-granted credits. Records a revoke
    entry (negative delta)."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return _dormant(uid)
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return _invalid(uid)
    if not uid or amount <= 0:
        return _invalid(uid)
    return credits_store.apply(
        user_id=uid, delta=-amount, type=TYPE_REVOKE, reason=reason,
        reference=reference, metadata=metadata, allow_negative=allow_negative,
    )


# ── Audit ─────────────────────────────────────────────────────────────────────

def verify_balance(user_id: str) -> dict:
    """Cross-check the cached account balance against the independent sum of the
    immutable ledger. `consistent` must always be True in a healthy system — a
    False here indicates ledger corruption or a bug and should alert.

    When the store is UNAVAILABLE this reports `storage_available: False` rather
    than fabricating a consistent zero (which would hide the outage). The cached
    balance therefore remains independently auditable ONLY when storage is
    healthy."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return {"user_id": uid, "enabled": False, "storage_available": True,
                "cached": 0, "computed": 0, "consistent": True}
    try:
        cached = credits_store.get_balance(uid)
        computed = credits_store.sum_ledger(uid)
    except CreditStoreError as exc:
        return {
            "user_id": uid, "enabled": True, "storage_available": False,
            "error": type(exc).__name__, "consistent": None,
        }
    return {
        "user_id": uid,
        "enabled": True,
        "storage_available": True,
        "cached": cached,
        "computed": computed,
        "consistent": cached == computed,
    }


def account_snapshot(user_id: str, *, tx_limit: int = 25) -> dict:
    """Owner diagnostics: account + recent transactions + audit verification.

    Resilient: a store outage is reported as `storage_available: False` with a
    bounded error TYPE rather than raising, so the owner surface stays up. A
    diagnostics read NEVER mutates ledger state."""
    uid = (user_id or "").strip()
    enabled = is_enabled()
    if not enabled:
        return {"enabled": False, "storage_available": True,
                "account": CreditAccount(user_id=uid, balance=0).to_dict(),
                "verify": verify_balance(uid), "transactions": []}
    try:
        acct = get_account(uid)
        txns = list_transactions(uid, limit=tx_limit)
    except CreditStoreError as exc:
        return {
            "enabled": True, "storage_available": False,
            "error": type(exc).__name__,
            "account": None, "verify": verify_balance(uid), "transactions": [],
        }
    return {
        "enabled": True,
        "storage_available": True,
        "account": acct.to_dict(),
        "verify": verify_balance(uid),
        "transactions": [t.to_dict() for t in txns],
    }


def _storage_available() -> bool:
    """Bounded, read-only connectivity probe for owner diagnostics. Performs a
    single account SELECT for a synthetic id (no row is created, no mutation)
    and reports whether the authoritative store answered. Never raises."""
    try:
        credits_store.get_account("__credit_healthprobe__")
        return True
    except CreditStoreError:
        return False
    except Exception:  # pragma: no cover — treat any read failure as unavailable
        return False


def stats() -> dict:
    """Owner diagnostics for the credit ledger. Exposes the hardened invariants
    as booleans — no secrets, DSNs, SQL, user ids, metadata or PII. The cached
    balance stays independently auditable via `account_snapshot` / `verify_balance`.

    `allow_negative_default_legacy` reflects the BILLING_CREDITS_ALLOW_NEGATIVE
    env flag purely for visibility — it is LEGACY and IGNORED for normal
    consumption (which is unconditionally non-negative)."""
    enabled = is_enabled()
    postgres_selected = db_engine.is_enabled()
    out = {
        "enabled": enabled,
        "backend": credits_store.current_backend(),
        "storage_available": _storage_available() if enabled else True,
        "postgres_selected": postgres_selected,
        # Legacy strict flag no longer governs credit fallback — credits ALWAYS
        # fail closed on the authoritative backend. Surfaced for visibility only.
        "postgres_strict_legacy": credits_config.strict_postgres(),
        "sqlite_fallback_permitted": (not postgres_selected),
        "consume_requires_reference": True,
        "consume_allow_negative": False,
        "reference_max_length": MAX_REFERENCE_LENGTH,
        "idempotency_conflict_detection": True,
        # Legacy env flag — IGNORED for normal consume; shown for audit only.
        "allow_negative_default_legacy": credits_config.allow_negative_default(),
    }
    try:
        out["store"] = credits_store.store_stats()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        out["store"] = {"error": type(exc).__name__}
    try:
        out["tables"] = credits_store.table_counts()
    except Exception as exc:  # pragma: no cover — diagnostics must stay up
        out["tables"] = {"error": type(exc).__name__}
    return out


__all__ = [
    "is_enabled", "get_account", "get_balance", "can_consume", "list_transactions",
    "grant", "consume", "adjust", "revoke",
    "verify_balance", "account_snapshot", "stats",
]
