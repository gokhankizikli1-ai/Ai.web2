# coding: utf-8
"""
Billing entitlements — resolver (PR 4).

Resolves a user id to their effective `Entitlements` by reading the PR-3
subscription truth layer (billing_subscriptions), linked via `app_user_id`
(set from meta.custom_data.user_id at checkout). This module READS ONLY — it
never writes subscriptions or entitlements and performs no metering.

Effective-plan algorithm:
  1. If the layer is disabled → default plan (dormant; no subscription read).
  2. Load the user's subscriptions (by app_user_id).
  3. Keep the ones whose status entitles (config `entitling_statuses`, plus a
     `cancelled` subscription still inside its paid period when
     `cancelled_grace` is on).
  4. Map each to a plan via the catalog; discard unmapped / unknown-plan ones.
  5. Pick the HIGHEST-RANK plan (tie → keep the first / most-recently-updated,
     since the store already returns newest-first).
  6. No winner → default plan.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from backend.services.billing.entitlements import config as ent_config
from backend.services.billing.entitlements import catalog as ent_catalog
from backend.services.billing.entitlements.types import (
    Entitlements, Plan, SOURCE_DEFAULT, SOURCE_SUBSCRIPTION,
)
from backend.services.billing.subscriptions import store as sub_store
from backend.services.billing.subscriptions.types import (
    STATUS_CANCELLED, Subscription,
)


logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp (tolerating a trailing 'Z'). Returns None on
    anything unparseable. Naive results are assumed UTC."""
    if not value:
        return None
    s = str(value).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def is_entitling(sub: Subscription, *, now: Optional[datetime] = None) -> bool:
    """Whether a subscription currently grants entitlement."""
    now = now or _now()
    status = (sub.status or "").strip().lower()
    if status in ent_config.entitling_statuses():
        return True
    # A cancelled subscription remains active until its period ends (Lemon sets
    # ends_at at cancellation). Grant access until then when grace is enabled.
    if status == STATUS_CANCELLED and ent_config.cancelled_grace():
        ends = _parse_iso(sub.ends_at)
        return ends is not None and ends > now
    return False


def _default_entitlements(user_id: str) -> Entitlements:
    plan = ent_catalog.get_catalog().default_plan()
    return Entitlements(
        user_id=user_id,
        plan_key=plan.key,
        plan_name=plan.name or plan.key,
        rank=plan.rank,
        features=plan.features,
        limits=dict(plan.limits),
        source=SOURCE_DEFAULT,
    )


def _entitlements_from(user_id: str, plan: Plan, sub: Subscription) -> Entitlements:
    return Entitlements(
        user_id=user_id,
        plan_key=plan.key,
        plan_name=plan.name or plan.key,
        rank=plan.rank,
        features=plan.features,
        limits=dict(plan.limits),
        source=SOURCE_SUBSCRIPTION,
        subscription_id=sub.subscription_id,
        subscription_status=sub.status,
        provider=sub.provider,
    )


def resolve(user_id: str, *, now: Optional[datetime] = None) -> Entitlements:
    """Resolve the effective entitlements for `user_id`. Never raises — on any
    store error it fails closed to the default plan (logged)."""
    uid = (user_id or "").strip()
    if not uid:
        return _default_entitlements(uid)

    # Dormant when disabled: everyone is the default plan, no subscription read.
    if not ent_config.is_enabled():
        return _default_entitlements(uid)

    now = now or _now()
    catalog = ent_catalog.get_catalog()

    try:
        subs: List[Subscription] = sub_store.list_subscriptions(app_user_id=uid, limit=200)
    except Exception as exc:  # pragma: no cover — fail closed, never 500 a caller
        logger.warning("entitlements: subscription lookup failed for user=%s: %s", uid, exc)
        return _default_entitlements(uid)

    best: Optional[Tuple[Plan, Subscription]] = None
    for sub in subs:
        if not is_entitling(sub, now=now):
            continue
        plan_key = catalog.plan_key_for_subscription(sub)
        if not plan_key:
            logger.debug("entitlements: subscription %s not mapped to a plan", sub.subscription_id)
            continue
        plan = catalog.get_plan(plan_key)
        if plan is None:
            logger.warning("entitlements: subscription %s maps to unknown plan %r", sub.subscription_id, plan_key)
            continue
        if best is None or plan.rank > best[0].rank:
            best = (plan, sub)

    if best is None:
        return _default_entitlements(uid)
    return _entitlements_from(uid, best[0], best[1])


__all__ = ["resolve", "is_entitling"]
