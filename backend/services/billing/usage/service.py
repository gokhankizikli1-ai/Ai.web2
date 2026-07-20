# coding: utf-8
"""
Billing usage — service / query API (PR 6).

Ties the atomic counters to entitlement LIMITS. The limit for a metric is the
entitlement limit of the same key (PR 4 `get_limit`) — so the source of truth
for "how much" stays the plan, while the counters stay independent of billing
state.

    from backend.services.billing.usage import service as usage

    st = usage.check(user_id, usage.METRIC_WORKFLOW_RUNS)     # preview, no write
    res = usage.consume(user_id, usage.METRIC_WORKFLOW_RUNS)  # atomic reserve
    if not res.allowed: ...                                   # over quota
    usage.refund(user_id, usage.METRIC_WORKFLOW_RUNS)         # release on failure

Dormant by default: when ENABLE_BILLING_USAGE is off, check/consume are no-op
ALLOWs (tracked=False) and nothing is written. `limit=None` (unlimited /
undefined in the plan) always allows but still records the count for
observability.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.billing.usage import config as usage_config
from backend.services.billing.usage import store as usage_store
from backend.services.billing.usage.config import (
    METRIC_WEB_BUILD_GENERATIONS, METRIC_WEBSITE_RECREATIONS,
    METRIC_VISION_ANALYSES, METRIC_WORKFLOW_RUNS, METERED_METRICS,
)
from backend.services.billing.usage.types import QuotaCheck, UsageResult
from backend.services.billing.entitlements import service as entitlement_service


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    return usage_config.is_enabled()


def _limit_for(user_id: str, metric: str) -> Optional[int]:
    """The current ceiling for a metric = the entitlement limit of the same
    key. None (unlimited/undefined) when the plan sets no numeric cap."""
    try:
        return entitlement_service.get_limit(user_id, metric)
    except Exception as exc:  # pragma: no cover — fail open (no cap)
        logger.warning("usage: limit lookup failed for %s/%s: %s", user_id, metric, exc)
        return None


def check(user_id: str, metric: str, amount: int = 1) -> QuotaCheck:
    """Non-mutating preview of whether `amount` more units are permitted."""
    uid = (user_id or "").strip()
    amount = max(1, int(amount))
    period = usage_config.period_key(metric)
    if not is_enabled():
        # Dormant: unlimited/allow, nothing recorded.
        return QuotaCheck(uid, metric, period, None, 0, amount, True)
    limit = _limit_for(uid, metric)
    used = usage_store.get_used(uid, metric, period) if uid else 0
    allowed = limit is None or (used + amount) <= limit
    return QuotaCheck(uid, metric, period, limit, used, amount, allowed)


def consume(user_id: str, metric: str, amount: int = 1) -> UsageResult:
    """Atomically reserve `amount` units of `metric` for the user's current
    period. Allowed iff within the entitlement limit (or unlimited). No-op
    ALLOW when metering is dormant."""
    uid = (user_id or "").strip()
    amount = max(1, int(amount))
    period = usage_config.period_key(metric)
    if not is_enabled():
        return UsageResult(uid, metric, period, None, 0, amount, True, tracked=False)
    limit = _limit_for(uid, metric)
    allowed, used = usage_store.consume(uid, metric, period, amount, limit)
    return UsageResult(uid, metric, period, limit, used, amount, allowed, tracked=True)


def refund(user_id: str, metric: str, amount: int = 1) -> UsageResult:
    """Release a previously-consumed reservation (e.g. the metered operation
    failed). No-op when dormant."""
    uid = (user_id or "").strip()
    amount = max(1, int(amount))
    period = usage_config.period_key(metric)
    if not is_enabled():
        return UsageResult(uid, metric, period, None, 0, amount, True, tracked=False)
    used = usage_store.refund(uid, metric, period, amount)
    limit = _limit_for(uid, metric)
    return UsageResult(uid, metric, period, limit, used, amount, True, tracked=True)


def get_usage(user_id: str, metric: str) -> int:
    """Current counter for the user's active period for `metric`."""
    return usage_store.get_used((user_id or "").strip(), metric, usage_config.period_key(metric))


def snapshot(user_id: str) -> dict:
    """Per-metric usage-vs-limit snapshot for the metered metrics, for the
    user's current periods. Owner diagnostics."""
    uid = (user_id or "").strip()
    out = {"user_id": uid, "enabled": is_enabled(), "metrics": []}
    for metric in METERED_METRICS:
        period = usage_config.period_key(metric)
        used = usage_store.get_used(uid, metric, period) if uid else 0
        limit = _limit_for(uid, metric)
        out["metrics"].append({
            "metric": metric,
            "period": period,
            "period_type": usage_config.period_type_for(metric),
            "used": used,
            "limit": limit,
            "unlimited": limit is None,
            "remaining": None if limit is None else max(0, limit - used),
        })
    return out


def reset(user_id: str, metric: str, period: Optional[str] = None) -> int:
    """Clear a user's counter for a metric (owner/maintenance)."""
    return usage_store.reset((user_id or "").strip(), metric, period)


def stats() -> dict:
    return {
        "enabled": is_enabled(),
        "default_period": usage_config.default_period(),
        "metered_metrics": list(METERED_METRICS),
        "store": usage_store.store_stats(),
    }


__all__ = [
    "METRIC_WEB_BUILD_GENERATIONS", "METRIC_WEBSITE_RECREATIONS",
    "METRIC_VISION_ANALYSES", "METRIC_WORKFLOW_RUNS", "METERED_METRICS",
    "is_enabled", "check", "consume", "refund", "get_usage",
    "snapshot", "reset", "stats",
]
