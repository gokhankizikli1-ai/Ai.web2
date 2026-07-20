# coding: utf-8
"""
Billing — entitlement types (PR 4).

The read-only "what may this user do" layer, derived from the PR-3
subscription truth layer. This module is pure data: a `Plan` (a named bundle
of features + limits), an `Entitlements` snapshot (the effective plan resolved
for one user), and an `AccessDecision` (the answer to a single access query).

Scope guard: this is entitlement STATE only. There is NO usage tracking /
metering / enforcement here — `limits` expose a plan's configured ceilings for
a future metering PR to enforce; nothing in this package counts or decrements
anything. Payment processing, webhook changes and frontend billing UI are also
explicitly out of scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, FrozenSet, Optional


# Provenance of an Entitlements snapshot.
SOURCE_SUBSCRIPTION = "subscription"  # resolved from an active billing_subscriptions row
SOURCE_DEFAULT = "default"            # no entitling subscription → default (free) plan


@dataclass(frozen=True)
class Plan:
    """A named bundle of features and limits.

    `features` is a set of opaque capability keys (e.g. "advanced_export").
    `limits` maps a limit key to its ceiling; a value of None means "unlimited"
    (or simply "no numeric ceiling"), and an ABSENT key means the plan does not
    define that limit. `rank` orders plans for "highest wins" when a user has
    more than one entitling subscription.
    """
    key: str
    name: str = ""
    rank: int = 0
    features: FrozenSet[str] = frozenset()
    limits: Dict[str, Optional[int]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name or self.key,
            "rank": self.rank,
            "features": sorted(self.features),
            "limits": dict(self.limits),
        }


@dataclass(frozen=True)
class Entitlements:
    """The effective entitlement snapshot for one user at query time."""
    user_id: str
    plan_key: str
    plan_name: str
    rank: int
    features: FrozenSet[str]
    limits: Dict[str, Optional[int]]
    source: str                                   # SOURCE_SUBSCRIPTION | SOURCE_DEFAULT
    subscription_id: Optional[str] = None
    subscription_status: Optional[str] = None
    provider: Optional[str] = None

    @property
    def is_default(self) -> bool:
        return self.source == SOURCE_DEFAULT

    def has_feature(self, feature: str) -> bool:
        return bool(feature) and feature in self.features

    def get_limit(self, key: str) -> Optional[int]:
        """The plan's ceiling for `key`, or None when unlimited OR undefined.
        Use `has_limit` to distinguish the two."""
        return self.limits.get(key)

    def has_limit(self, key: str) -> bool:
        """True when the plan explicitly defines `key` (even if its value is
        None = unlimited)."""
        return key in self.limits

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "plan_key": self.plan_key,
            "plan_name": self.plan_name,
            "rank": self.rank,
            "features": sorted(self.features),
            "limits": dict(self.limits),
            "source": self.source,
            "is_default": self.is_default,
            "subscription_id": self.subscription_id,
            "subscription_status": self.subscription_status,
            "provider": self.provider,
        }


@dataclass(frozen=True)
class AccessDecision:
    """The answer to a single `check_access(user, feature)` query."""
    user_id: str
    feature: str
    allowed: bool
    plan_key: str
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "feature": self.feature,
            "allowed": self.allowed,
            "plan_key": self.plan_key,
            "reason": self.reason,
        }


__all__ = [
    "SOURCE_SUBSCRIPTION", "SOURCE_DEFAULT",
    "Plan", "Entitlements", "AccessDecision",
]
