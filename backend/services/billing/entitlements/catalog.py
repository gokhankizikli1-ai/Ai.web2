# coding: utf-8
"""
Billing entitlements — plan catalog (PR 4).

Loads the operator-supplied plan catalog and the provider-id → plan mapping
from config (JSON string or file), builds typed `Plan` objects, and resolves a
`Subscription` (PR-3 truth layer) to a plan key.

Design:
  * DATA, not code. Plans and the id-mapping are supplied via env so a new plan
    or price never needs a deploy.
  * FAIL-CLOSED. A built-in `free` plan (rank 0, no features, no limits) always
    exists; if no catalog is configured, that is the ONLY plan and no user can
    be granted paid access. Malformed config is logged and ignored (defaults
    stand) rather than crashing or silently over-granting.
  * Cheap + live. The parsed catalog is cached keyed by the exact raw config
    strings, so repeated queries don't re-parse, but a Railway env change is
    picked up on the next call.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Dict, Optional, Tuple

from backend.services.billing.entitlements import config as ent_config
from backend.services.billing.entitlements.types import Plan
from backend.services.billing.subscriptions.types import Subscription


logger = logging.getLogger(__name__)


# Built-in baseline. Always present; overridable by a "free" entry in the
# configured catalog (e.g. to give the free tier some features/limits).
_BUILTIN_FREE = Plan(key="free", name="Free", rank=0, features=frozenset(), limits={})


class PlanCatalog:
    """An immutable snapshot of the plans + id-mapping + default plan key."""

    def __init__(
        self,
        plans: Dict[str, Plan],
        plan_map: Dict[str, str],
        default_key: str,
    ) -> None:
        self._plans = plans
        self._plan_map = plan_map
        self._default_key = default_key

    # ── Lookups ──────────────────────────────────────────────────────────────
    def get_plan(self, key: Optional[str]) -> Optional[Plan]:
        if not key:
            return None
        return self._plans.get(key)

    def default_plan(self) -> Plan:
        """The plan for users with no entitling subscription. Always resolves
        to a real Plan — synthesizes an empty one if the configured default key
        is missing (fail-closed, never raises)."""
        return self._plans.get(self._default_key) or Plan(key=self._default_key, name=self._default_key)

    def plan_key_for_subscription(self, sub: Subscription) -> Optional[str]:
        """Map a subscription to a plan key via the id-mapping. Precedence:
        variant → product → price (most specific first). Returns None when the
        subscription's identifiers aren't mapped to any plan."""
        for prefix, value in (
            ("variant", sub.variant_id),
            ("product", sub.product_id),
            ("price", sub.price_id),
        ):
            if value:
                key = self._plan_map.get(f"{prefix}:{value}")
                if key:
                    return key
        return None

    def all_plans(self) -> Dict[str, Plan]:
        return dict(self._plans)

    def to_dict(self) -> dict:
        return {
            "default_plan": self._default_key,
            "plans": {k: p.to_dict() for k, p in sorted(self._plans.items())},
            "plan_map": dict(self._plan_map),
        }


# ── Parsing ──────────────────────────────────────────────────────────────────

def _parse_plan_entry(key: str, raw: dict) -> Optional[Plan]:
    if not isinstance(raw, dict):
        return None
    try:
        name = str(raw.get("name") or key)
        rank = int(raw.get("rank") or 0)
        feats = raw.get("features") or []
        features = frozenset(str(f).strip() for f in feats if str(f).strip()) if isinstance(feats, (list, tuple)) else frozenset()
        limits_raw = raw.get("limits") or {}
        limits: Dict[str, Optional[int]] = {}
        if isinstance(limits_raw, dict):
            for lk, lv in limits_raw.items():
                if lv is None:
                    limits[str(lk)] = None
                else:
                    try:
                        limits[str(lk)] = int(lv)
                    except (TypeError, ValueError):
                        # Non-numeric, non-null limit is ignored (logged) rather
                        # than corrupting the plan.
                        logger.warning("entitlements: plan %r limit %r has non-int value %r — ignored", key, lk, lv)
        return Plan(key=key, name=name, rank=rank, features=features, limits=limits)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("entitlements: could not parse plan %r: %s", key, exc)
        return None


def _load_catalog_source() -> dict:
    """Return the parsed catalog dict from JSON string or file, or {} on any
    problem (fail-closed)."""
    raw = ent_config.catalog_json().strip()
    if not raw:
        path = ent_config.catalog_path()
        if path:
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    raw = fh.read()
            except OSError as exc:
                logger.warning("entitlements: cannot read BILLING_PLAN_CATALOG_PATH %r: %s", path, exc)
                return {}
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError as exc:
        logger.warning("entitlements: BILLING_PLAN_CATALOG JSON is invalid: %s — using defaults only", exc)
        return {}


def _load_plan_map() -> Dict[str, str]:
    raw = ent_config.plan_map_json().strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("entitlements: BILLING_PLAN_MAP_JSON is invalid: %s — no mappings", exc)
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in parsed.items():
        ks, vs = str(k).strip(), str(v).strip()
        if ks and vs:
            out[ks] = vs
    return out


def _build_catalog() -> PlanCatalog:
    plans: Dict[str, Plan] = {_BUILTIN_FREE.key: _BUILTIN_FREE}
    for key, raw in _load_catalog_source().items():
        plan = _parse_plan_entry(str(key), raw)
        if plan is not None:
            plans[plan.key] = plan   # config overrides the builtin free if it redefines it
    return PlanCatalog(plans=plans, plan_map=_load_plan_map(), default_key=ent_config.default_plan_key())


# ── Cache keyed by the exact raw config (live env flips, no per-call re-parse) ─

_CACHE: dict = {"key": None, "catalog": None}


def _cache_key() -> Tuple[str, str, str, str]:
    # Include catalog file mtime so editing the file (without changing env)
    # still invalidates the cache.
    path = ent_config.catalog_path()
    try:
        mtime = str(os.path.getmtime(path)) if path else ""
    except OSError:
        mtime = ""
    return (ent_config.catalog_json(), path + "|" + mtime, ent_config.plan_map_json(), ent_config.default_plan_key())


def get_catalog() -> PlanCatalog:
    key = _cache_key()
    if _CACHE["key"] == key and _CACHE["catalog"] is not None:
        return _CACHE["catalog"]
    catalog = _build_catalog()
    _CACHE["key"] = key
    _CACHE["catalog"] = catalog
    return catalog


def _reset_for_tests() -> None:
    _CACHE["key"] = None
    _CACHE["catalog"] = None


__all__ = ["PlanCatalog", "get_catalog", "_reset_for_tests"]
