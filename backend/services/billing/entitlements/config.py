# coding: utf-8
"""
Billing entitlements — dynamic configuration (PR 4).

Read on every call so a Railway env flip / catalog change is live without a
restart. Canonical documentation lives on backend.core.config.Config.

The plan catalog and the provider-id → plan mapping are DATA, supplied by the
operator via env (JSON string or a file path), not hardcoded business logic —
so a new plan or price is a config change, never a code change. When nothing is
configured the catalog is just the built-in default plan, i.e. everyone is on
the default (free) tier and NO paid access is granted: fail-closed.
"""
from __future__ import annotations

import os
from typing import List


def is_enabled() -> bool:
    """Master gate. When OFF, the query API resolves every user to the default
    plan without reading subscriptions (the layer ships dormant). Default OFF."""
    return os.getenv("ENABLE_BILLING_ENTITLEMENTS", "false").strip().lower() == "true"


def default_plan_key() -> str:
    """Plan key granted to users with no entitling subscription. Default 'free'."""
    return (os.getenv("BILLING_DEFAULT_PLAN", "free") or "free").strip() or "free"


def catalog_json() -> str:
    """Raw JSON string defining paid plans, or empty. Shape:
    {"pro": {"name":"Pro","rank":10,"features":[...],"limits":{"projects":100}}}"""
    return os.getenv("BILLING_PLAN_CATALOG_JSON", "") or ""


def catalog_path() -> str:
    """Optional path to a JSON file with the same shape as catalog_json.
    Used only when BILLING_PLAN_CATALOG_JSON is empty."""
    return (os.getenv("BILLING_PLAN_CATALOG_PATH", "") or "").strip()


def plan_map_json() -> str:
    """Raw JSON mapping provider identifiers → plan key. Keys are
    "variant:<id>", "product:<id>" or "price:<id>":
    {"variant:123":"pro","product:5":"pro","price:9":"pro"}"""
    return os.getenv("BILLING_PLAN_MAP_JSON", "") or ""


def entitling_statuses() -> List[str]:
    """Normalized subscription statuses that grant entitlement. Default
    active + trialing. `cancelled` is handled separately via the grace check
    (see resolver) so a set-to-cancel subscription keeps access until it ends."""
    raw = os.getenv("BILLING_ENTITLING_STATUSES", "active,trialing") or ""
    out = [s.strip().lower() for s in raw.split(",") if s.strip()]
    return out or ["active", "trialing"]


def cancelled_grace() -> bool:
    """When true (default), a `cancelled` subscription still entitles until its
    ends_at passes (Lemon keeps a cancelled subscription active until period
    end). Set false to revoke access the moment cancellation is recorded."""
    return os.getenv("BILLING_CANCELLED_GRACE", "true").strip().lower() == "true"


__all__ = [
    "is_enabled", "default_plan_key", "catalog_json", "catalog_path",
    "plan_map_json", "entitling_statuses", "cancelled_grace",
]
