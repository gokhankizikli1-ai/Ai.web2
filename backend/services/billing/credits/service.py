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
from backend.services.billing.credits.types import (
    CreditAccount, CreditTransaction, TxnResult,
    TYPE_GRANT, TYPE_CONSUME, TYPE_ADJUST, TYPE_REVOKE,
    REASON_DISABLED, REASON_INVALID,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    return credits_config.is_enabled()


def _dormant(user_id: str) -> TxnResult:
    return TxnResult(applied=False, reason_code=REASON_DISABLED,
                     balance=0, idempotent=False, transaction=None)


def _invalid(user_id: str) -> TxnResult:
    bal = credits_store.get_balance(user_id) if is_enabled() else 0
    return TxnResult(applied=False, reason_code=REASON_INVALID,
                     balance=bal, idempotent=False, transaction=None)


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
            metadata: Optional[dict] = None, allow_negative: Optional[bool] = None) -> TxnResult:
    """Spend `amount` (>0) credits, recording an immutable consume entry.
    Rejected (reason_code=insufficient_funds) when it would overdraw, unless
    overdraft is allowed. Idempotent by (user_id, reference) — a retry with the
    same reference does NOT double-charge. Integration seam for AI Guard."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return _dormant(uid)
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return _invalid(uid)
    if not uid or amount <= 0:
        return _invalid(uid)
    neg = credits_config.allow_negative_default() if allow_negative is None else bool(allow_negative)
    return credits_store.apply(
        user_id=uid, delta=-amount, type=TYPE_CONSUME, reason=reason,
        reference=reference, metadata=metadata, allow_negative=neg,
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
    False here indicates ledger corruption or a bug and should alert."""
    uid = (user_id or "").strip()
    if not is_enabled():
        return {"user_id": uid, "enabled": False, "cached": 0, "computed": 0, "consistent": True}
    cached = credits_store.get_balance(uid)
    computed = credits_store.sum_ledger(uid)
    return {
        "user_id": uid,
        "enabled": True,
        "cached": cached,
        "computed": computed,
        "consistent": cached == computed,
    }


def account_snapshot(user_id: str, *, tx_limit: int = 25) -> dict:
    """Owner diagnostics: account + recent transactions + audit verification."""
    uid = (user_id or "").strip()
    acct = get_account(uid)
    txns = list_transactions(uid, limit=tx_limit)
    return {
        "enabled": is_enabled(),
        "account": acct.to_dict(),
        "verify": verify_balance(uid),
        "transactions": [t.to_dict() for t in txns],
    }


def stats() -> dict:
    return {
        "enabled": is_enabled(),
        "allow_negative_default": credits_config.allow_negative_default(),
        "store": credits_store.store_stats(),
        "tables": credits_store.table_counts(),
    }


__all__ = [
    "is_enabled", "get_account", "get_balance", "can_consume", "list_transactions",
    "grant", "consume", "adjust", "revoke",
    "verify_balance", "account_snapshot", "stats",
]
