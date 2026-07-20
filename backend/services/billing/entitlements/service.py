# coding: utf-8
"""
Billing entitlements — query API (PR 4).

The stable public surface a future feature-gating / metering system (and, later,
product routes) will call to answer "what may this user do". Read-only, never
raises, no side effects, no usage tracking.

    from backend.services.billing.entitlements import service as entitlements

    ent = entitlements.get_entitlements(user_id)      # full snapshot
    if entitlements.has_feature(user_id, "advanced_export"): ...
    seats = entitlements.get_limit(user_id, "seats")   # None = unlimited/undefined
    decision = entitlements.check_access(user_id, "advanced_export")

Note: this PR provides the QUERY API only. It intentionally does not wire these
checks into any existing product route — no user-facing access changes here.
"""
from __future__ import annotations

from typing import Optional

from backend.services.billing.entitlements import config as ent_config
from backend.services.billing.entitlements import catalog as ent_catalog
from backend.services.billing.entitlements import resolver as ent_resolver
from backend.services.billing.entitlements.types import (
    AccessDecision, Entitlements,
)


def is_enabled() -> bool:
    return ent_config.is_enabled()


def get_entitlements(user_id: str) -> Entitlements:
    """The effective entitlement snapshot for a user (default plan when the
    layer is disabled or the user has no entitling subscription)."""
    return ent_resolver.resolve(user_id)


def has_feature(user_id: str, feature: str) -> bool:
    """True when the user's effective plan includes `feature`."""
    if not feature:
        return False
    return get_entitlements(user_id).has_feature(feature)


def get_limit(user_id: str, key: str) -> Optional[int]:
    """The user's effective ceiling for `key` (None = unlimited or undefined).
    This is the configured plan limit only — it does NOT reflect consumption
    (usage metering is a separate, future PR)."""
    return get_entitlements(user_id).get_limit(key)


def check_access(user_id: str, feature: str) -> AccessDecision:
    """Resolve a single feature-access question into an explainable decision."""
    ent = get_entitlements(user_id)
    if not feature:
        return AccessDecision(
            user_id=ent.user_id, feature=feature, allowed=False,
            plan_key=ent.plan_key, reason="no_feature_specified",
        )
    allowed = ent.has_feature(feature)
    if allowed:
        reason = "granted_by_plan"
    elif ent.is_default:
        reason = "default_plan_lacks_feature"
    else:
        reason = "plan_lacks_feature"
    return AccessDecision(
        user_id=ent.user_id, feature=feature, allowed=allowed,
        plan_key=ent.plan_key, reason=reason,
    )


def list_plans() -> dict:
    """The loaded plan catalog + id-mapping (diagnostics / verification)."""
    return ent_catalog.get_catalog().to_dict()


def stats() -> dict:
    """Compact entitlement-layer diagnostics (config only, content-free)."""
    catalog = ent_catalog.get_catalog()
    return {
        "enabled": ent_config.is_enabled(),
        "default_plan": ent_config.default_plan_key(),
        "plan_count": len(catalog.all_plans()),
        "plans": sorted(catalog.all_plans().keys()),
        "entitling_statuses": ent_config.entitling_statuses(),
        "cancelled_grace": ent_config.cancelled_grace(),
    }


__all__ = [
    "is_enabled", "get_entitlements", "has_feature", "get_limit",
    "check_access", "list_plans", "stats",
]
