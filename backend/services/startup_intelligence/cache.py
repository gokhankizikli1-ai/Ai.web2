# coding: utf-8
# Startup Market Intelligence — TTL cache.
#
# Thin wrapper over the shared in-process TTL cache
# (backend.services.cache) — same store market_data/macro_data use, so
# we don't duplicate cache logic. Public providers (HN, GDELT) must not
# be hammered on every keystroke; a 10-minute default TTL keeps the
# radar responsive without overclaiming freshness (the report carries
# `cached: true` so the UI can say so).
#
#   STARTUP_INTEL_CACHE_TTL_SEC — TTL for full reports (default 600).
#   Thin/empty reports are cached for only 60s so a transient provider
#   hiccup doesn't pin an "unavailable" answer for 10 minutes.
from __future__ import annotations

import hashlib
import os

from backend.services.cache import cache_get, cache_set

_KEY_PREFIX = "startup_intel:"
_EMPTY_RESULT_TTL_SEC = 60.0


def report_ttl_sec() -> float:
    try:
        return float(os.getenv("STARTUP_INTEL_CACHE_TTL_SEC", "600"))
    except ValueError:
        return 600.0


def build_key(query: str, timeframe_days: int, region: str, sources: list[str]) -> str:
    normalized = "|".join([
        " ".join(query.lower().split()),
        str(int(timeframe_days)),
        region.strip().lower() or "global",
        ",".join(sorted(s.lower() for s in sources)),
    ])
    return _KEY_PREFIX + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def get_report(key: str) -> dict | None:
    return cache_get(key)


def set_report(key: str, report_dict: dict, *, has_data: bool) -> None:
    ttl = report_ttl_sec() if has_data else _EMPTY_RESULT_TTL_SEC
    cache_set(key, report_dict, ttl)


__all__ = ["build_key", "get_report", "set_report", "report_ttl_sec"]
