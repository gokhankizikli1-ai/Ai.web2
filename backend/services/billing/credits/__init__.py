# coding: utf-8
"""
Billing — immutable credit ledger foundation (PR 8).

An append-only, auditable credit ledger: per-user accounts + immutable
transaction records (grants / consumption / adjustments). The balance is the
running sum of transaction deltas, cached on the account and independently
verifiable by re-summing the ledger. Credits are INDEPENDENT of subscription
state (keyed by user_id only).

Public surface:

    from backend.services.billing.credits import service as credits
    credits.grant(user_id, 100, reason="promo", reference="promo-2026")
    credits.can_consume(user_id, 5)          # AI-Guard integration seam
    credits.consume(user_id, 5, reference=op_id)
    credits.get_balance(user_id)
    credits.verify_balance(user_id)          # audit cross-check

Scope (strict): ledger foundation + records + reliable/auditable balance +
prepared integration points ONLY. This PR does NOT implement automatic monthly
grants, plan pricing, AI provider cost calculation, usage-enforcement changes,
customer portal, or billing frontend UI. The `consume`/`can_consume` API is the
seam a later PR wires into AI Guard and expensive operations.

Feature flag:
    ENABLE_BILLING_CREDITS=true → ledger is active
    default / unset             → dormant: mutations are no-ops, reads empty

Storage shares the billing database (billing.db / Postgres) — the
`billing_credit_accounts` + `billing_credit_transactions` tables.
"""
from backend.services.billing.credits import config, store, service
from backend.services.billing.credits.types import (
    CreditAccount, CreditTransaction, TxnResult,
    TYPE_GRANT, TYPE_CONSUME, TYPE_ADJUST, TYPE_REVOKE,
)

__all__ = [
    "config", "store", "service",
    "CreditAccount", "CreditTransaction", "TxnResult",
    "TYPE_GRANT", "TYPE_CONSUME", "TYPE_ADJUST", "TYPE_REVOKE",
]
