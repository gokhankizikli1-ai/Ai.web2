# coding: utf-8
"""
Billing credits — types (PR 8).

An IMMUTABLE, append-only credit ledger. `CreditTransaction` rows are never
updated or deleted; the balance is the running sum of transaction `amount`
deltas. `CreditAccount.balance` is a cached materialization of that sum, kept
consistent transactionally with each append and independently verifiable by
re-summing the ledger (see service.verify_balance).

Credits are DENOMINATED IN WHOLE UNITS (integers) and are INDEPENDENT of
subscription state — an account is keyed by user_id only, never by a
subscription. This foundation stores grants and consumption RECORDS; it does
NOT implement automatic monthly grants, plan pricing, AI provider cost
calculation, or usage enforcement.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


# ── Transaction types ─────────────────────────────────────────────────────────
# `amount` on a transaction is a SIGNED delta applied to the balance.
TYPE_GRANT = "grant"        # positive delta — credits added (e.g. plan grant, promo)
TYPE_CONSUME = "consume"    # negative delta — credits spent (AI Guard / expensive op)
TYPE_ADJUST = "adjust"      # signed delta — manual owner correction (+/-)
TYPE_REVOKE = "revoke"      # negative delta — clawback of previously granted credits

VALID_TYPES = frozenset({TYPE_GRANT, TYPE_CONSUME, TYPE_ADJUST, TYPE_REVOKE})


# ── Result reason codes ───────────────────────────────────────────────────────
REASON_APPLIED = "applied"                   # transaction appended
REASON_IDEMPOTENT = "idempotent"             # prior transaction with same reference
REASON_INSUFFICIENT = "insufficient_funds"   # consume would overdraw; rejected
REASON_DISABLED = "disabled"                 # ledger dormant (ENABLE_BILLING_CREDITS off)
REASON_INVALID = "invalid"                   # bad input (non-positive amount, etc.)


@dataclass(frozen=True)
class CreditAccount:
    """A user's credit account. `balance` is the cached running total."""
    user_id: str
    balance: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "balance": self.balance,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True)
class CreditTransaction:
    """One immutable ledger entry. `amount` is the signed delta; `balance_after`
    is the running balance immediately after this entry was appended."""
    id: str
    user_id: str
    type: str
    amount: int
    balance_after: int
    reason: str = ""
    reference: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "type": self.type,
            "amount": self.amount,
            "balance_after": self.balance_after,
            "reason": self.reason,
            "reference": self.reference,
            "metadata": self.metadata,
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class TxnResult:
    """Outcome of a ledger operation."""
    applied: bool
    reason_code: str
    balance: int
    idempotent: bool = False
    transaction: Optional[CreditTransaction] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "applied": self.applied,
            "reason_code": self.reason_code,
            "balance": self.balance,
            "idempotent": self.idempotent,
            "transaction": self.transaction.to_dict() if self.transaction else None,
        }


__all__ = [
    "TYPE_GRANT", "TYPE_CONSUME", "TYPE_ADJUST", "TYPE_REVOKE", "VALID_TYPES",
    "REASON_APPLIED", "REASON_IDEMPOTENT", "REASON_INSUFFICIENT",
    "REASON_DISABLED", "REASON_INVALID",
    "CreditAccount", "CreditTransaction", "TxnResult",
]
