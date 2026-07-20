# coding: utf-8
"""
Billing — usage metering types (PR 6).

Pure data for the usage/quota layer. A "metric" is a countable unit of an
expensive operation (e.g. `web_build_generations`) whose ceiling is the
entitlement LIMIT of the same key (PR 4). Usage counters are kept per
(user_id, metric, period) and are INDEPENDENT of billing state — only the
limit is read from entitlements at check time.

Scope guard: metering + quota only. No checkout, payment, frontend, or
subscription changes here.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class QuotaCheck:
    """Non-mutating preview of whether `amount` more units are permitted."""
    user_id: str
    metric: str
    period: str
    limit: Optional[int]      # None = unlimited / no ceiling defined
    used: int
    amount: int
    allowed: bool

    @property
    def unlimited(self) -> bool:
        return self.limit is None

    @property
    def remaining(self) -> Optional[int]:
        if self.limit is None:
            return None
        return max(0, self.limit - self.used)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "metric": self.metric,
            "period": self.period,
            "limit": self.limit,
            "used": self.used,
            "amount": self.amount,
            "allowed": self.allowed,
            "unlimited": self.unlimited,
            "remaining": self.remaining,
        }


@dataclass(frozen=True)
class UsageResult:
    """Result of a consume/refund. `used` is the counter value AFTER the op.

    `tracked` is False when metering is dormant (the call was a no-op allow) so
    callers can tell "allowed because within quota" from "allowed because
    metering is off".
    """
    user_id: str
    metric: str
    period: str
    limit: Optional[int]
    used: int
    amount: int
    allowed: bool
    tracked: bool

    @property
    def unlimited(self) -> bool:
        return self.limit is None

    @property
    def remaining(self) -> Optional[int]:
        if self.limit is None:
            return None
        return max(0, self.limit - self.used)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "metric": self.metric,
            "period": self.period,
            "limit": self.limit,
            "used": self.used,
            "amount": self.amount,
            "allowed": self.allowed,
            "tracked": self.tracked,
            "unlimited": self.unlimited,
            "remaining": self.remaining,
        }


__all__ = ["QuotaCheck", "UsageResult"]
