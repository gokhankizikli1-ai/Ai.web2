# coding: utf-8
"""
Billing — entitlement layer (PR 4).

The read-only "what may this user do" layer, derived from the PR-3 subscription
truth layer (billing_subscriptions). It maps plans → features/limits and
provides a query API for checking user access.

Public surface:

    from backend.services.billing.entitlements import service as entitlements
    entitlements.get_entitlements(user_id)
    entitlements.has_feature(user_id, feature)
    entitlements.get_limit(user_id, key)
    entitlements.check_access(user_id, feature)

Scope (strict): entitlement STATE only. This PR does NOT implement payment
processing, webhook changes, frontend billing UI, usage tracking/metering, or
any user-facing access change — it only answers access questions. A future PR
consumes this to meter usage and gate features.

Feature flag:
    ENABLE_BILLING_ENTITLEMENTS=true → resolve from subscriptions
    default / unset                  → every user resolves to the default
                                       (free) plan; the layer is dormant

Plans + the provider-id→plan mapping are operator config (env JSON / file), so
adding a plan or price is a config change, never a deploy. With nothing
configured the catalog is just the built-in `free` plan (fail-closed).
"""
from backend.services.billing.entitlements import (
    config, catalog, resolver, service,
)
from backend.services.billing.entitlements.types import (
    Plan, Entitlements, AccessDecision, SOURCE_SUBSCRIPTION, SOURCE_DEFAULT,
)

__all__ = [
    "config", "catalog", "resolver", "service",
    "Plan", "Entitlements", "AccessDecision",
    "SOURCE_SUBSCRIPTION", "SOURCE_DEFAULT",
]
