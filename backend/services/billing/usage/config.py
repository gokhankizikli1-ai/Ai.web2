# coding: utf-8
"""
Billing usage — dynamic configuration (PR 6).

Read on every call so a Railway env flip is live without a restart. Canonical
docs on backend.core.config.Config.

Usage metering is gated separately from entitlements/gating: it ships dormant
(ENABLE_BILLING_USAGE default OFF), and when off every consume/quota check is a
no-op ALLOW so wiring a quota onto a route changes nothing until enabled.

The period a metric is counted over is configurable (monthly by default), with
optional per-metric overrides — a per-month generation cap resets on the month
boundary simply because the period key changes; no cron / reset job needed.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict


logger = logging.getLogger(__name__)


# ── Canonical usage metric keys ───────────────────────────────────────────────
# Each is also the entitlement LIMIT key that caps it (PR 4 plan `limits`). An
# operator sets e.g. "web_build_generations": 500 in a plan to grant 500/period.
METRIC_WEB_BUILD_GENERATIONS = "web_build_generations"
METRIC_WEBSITE_RECREATIONS = "website_recreations"
METRIC_VISION_ANALYSES = "vision_analyses"
METRIC_WORKFLOW_RUNS = "workflow_runs"

METERED_METRICS = (
    METRIC_WEB_BUILD_GENERATIONS,
    METRIC_WEBSITE_RECREATIONS,
    METRIC_VISION_ANALYSES,
    METRIC_WORKFLOW_RUNS,
)

_VALID_PERIODS = ("month", "day", "total")
_DEFAULT_PERIOD = "month"


def is_enabled() -> bool:
    """Master gate for usage tracking + quota enforcement. Default OFF."""
    return os.getenv("ENABLE_BILLING_USAGE", "false").strip().lower() == "true"


def strict_postgres() -> bool:
    """Mirror the inbox policy: on a Postgres error fall back to SQLite unless
    strict mode is on, so a downed PG never breaks a quota check."""
    return os.getenv("BILLING_POSTGRES_REQUIRED", "false").strip().lower() == "true"


def default_period() -> str:
    p = (os.getenv("BILLING_USAGE_PERIOD", _DEFAULT_PERIOD) or _DEFAULT_PERIOD).strip().lower()
    return p if p in _VALID_PERIODS else _DEFAULT_PERIOD


def _metric_period_overrides() -> Dict[str, str]:
    raw = (os.getenv("BILLING_USAGE_METRIC_PERIODS_JSON", "") or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("usage: BILLING_USAGE_METRIC_PERIODS_JSON invalid: %s — ignored", exc)
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in parsed.items():
        vs = str(v).strip().lower()
        if vs in _VALID_PERIODS:
            out[str(k)] = vs
    return out


def period_type_for(metric: str) -> str:
    """The period type for a metric (per-metric override → global default)."""
    return _metric_period_overrides().get(metric, default_period())


def period_key(metric: str, *, now: datetime | None = None) -> str:
    """Deterministic period bucket key for a metric at time `now`.

      month → "YYYY-MM"   day → "YYYY-MM-DD"   total → "all"

    The key is what makes counters roll over: a new month yields a new key and
    thus a fresh counter, with no reset job."""
    now = now or datetime.now(timezone.utc)
    ptype = period_type_for(metric)
    if ptype == "day":
        return now.strftime("%Y-%m-%d")
    if ptype == "total":
        return "all"
    return now.strftime("%Y-%m")


__all__ = [
    "METRIC_WEB_BUILD_GENERATIONS", "METRIC_WEBSITE_RECREATIONS",
    "METRIC_VISION_ANALYSES", "METRIC_WORKFLOW_RUNS", "METERED_METRICS",
    "is_enabled", "strict_postgres", "default_period",
    "period_type_for", "period_key",
]
