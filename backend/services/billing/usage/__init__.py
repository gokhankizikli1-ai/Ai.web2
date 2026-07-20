# coding: utf-8
"""
Billing — usage metering & quota enforcement (PR 6).

Counts consumption of expensive operations per (user_id, metric, period) and
enforces per-plan quotas, using the PR-4 entitlement LIMITS as the source of
"how much". Counters are concurrency-safe (atomic conditional increment) and
INDEPENDENT of billing state — only the limit is read from entitlements.

Public surface:

    from backend.services.billing.usage import service as usage
    usage.check(user_id, usage.METRIC_WORKFLOW_RUNS)     # preview
    usage.consume(user_id, usage.METRIC_WORKFLOW_RUNS)   # atomic reserve
    usage.refund(user_id, usage.METRIC_WORKFLOW_RUNS)    # release on failure

    from backend.services.billing.usage.enforcement import require_quota
    # Depends(require_quota(usage.METRIC_WORKFLOW_RUNS)) on a route decorator

Scope (strict): usage tracking + quota enforcement only. NO checkout, payment,
frontend billing UI, or subscription changes.

Feature flag:
    ENABLE_BILLING_USAGE=true → track + enforce
    default / unset           → dormant: every check/consume is a no-op allow

Storage shares the billing database (billing.db / Postgres) — a separate
`billing_usage` table.
"""
from backend.services.billing.usage import config, store, service, enforcement
from backend.services.billing.usage.types import QuotaCheck, UsageResult

__all__ = [
    "config", "store", "service", "enforcement",
    "QuotaCheck", "UsageResult",
]
