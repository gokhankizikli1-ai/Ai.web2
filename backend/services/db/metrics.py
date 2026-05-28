# coding: utf-8
"""Phase 6 closure — DB observability primitives.

Lightweight counters + bucketed latency tracking the engine wires into
every connection acquire + every query timing. NO external deps —
Prometheus / OpenTelemetry export wires in later as a thin adapter
when the operator wants it.

Surface:
    from backend.services.db import metrics

    with metrics.time_query("memory_plane.insert"):
        cur.execute(...)

    metrics.acquire_recorded(latency_ms=12)
    metrics.snapshot() → dict for /v2/db/health
"""
from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import contextmanager
from typing import Iterator


logger = logging.getLogger(__name__)


# Slow-query threshold — any query exceeding this is logged at WARNING
# with the [DB][SLOW] tag. Set high enough to filter noise but low
# enough to catch a runaway. 500ms is a reasonable production default;
# operators tune via DB_SLOW_QUERY_MS.
def _slow_threshold_ms() -> int:
    try:
        return max(50, int(os.getenv("DB_SLOW_QUERY_MS", "500") or 500))
    except Exception:
        return 500


# ── Counters + histogram buckets ───────────────────────────────────────────
#
# Latency buckets are explicit (not Prometheus-style) to keep memory
# bounded at a tiny per-bucket count. A real exporter can downconvert
# these to Prometheus histograms in a future PR.
_BUCKETS_MS = (1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000)


_LOCK = threading.Lock()
_STATE: dict = {
    "acquires_total":      0,        # connection acquires (success only)
    "acquires_failed":     0,        # acquires that raised
    "acquire_latency_ms_sum": 0.0,
    "queries_total":       0,
    "queries_failed":      0,
    "query_latency_ms_sum": 0.0,
    "slow_queries":        0,
    "by_label":            {},       # label → {count, latency_ms_sum, fails}
    "latency_buckets":     {b: 0 for b in _BUCKETS_MS},  # acquire latency
    "query_buckets":       {b: 0 for b in _BUCKETS_MS},  # query latency
    "last_slow_query":     "",
}


def _bucket(latency_ms: float, table_key: str) -> None:
    """Increment the bucket whose upper bound is the smallest one >=
    `latency_ms`. Values past the last bucket land in the last bucket
    (we don't track +Inf separately for simplicity)."""
    table = _STATE[table_key]
    for b in _BUCKETS_MS:
        if latency_ms <= b:
            table[b] += 1
            return
    table[_BUCKETS_MS[-1]] += 1


def acquire_recorded(latency_ms: float, *, ok: bool = True) -> None:
    """Record a connection acquire (after the call returns / fails)."""
    with _LOCK:
        if ok:
            _STATE["acquires_total"] += 1
        else:
            _STATE["acquires_failed"] += 1
        _STATE["acquire_latency_ms_sum"] += float(latency_ms)
        _bucket(latency_ms, "latency_buckets")


def _query_recorded(
    label: str, latency_ms: float, *, ok: bool, slow_threshold: int,
) -> None:
    with _LOCK:
        _STATE["queries_total"] += 1
        if not ok:
            _STATE["queries_failed"] += 1
        _STATE["query_latency_ms_sum"] += float(latency_ms)
        _bucket(latency_ms, "query_buckets")

        by = _STATE["by_label"].setdefault(label, {
            "count": 0, "latency_ms_sum": 0.0, "fails": 0,
        })
        by["count"] += 1
        by["latency_ms_sum"] += float(latency_ms)
        if not ok:
            by["fails"] += 1

        if latency_ms >= slow_threshold:
            _STATE["slow_queries"] += 1
            _STATE["last_slow_query"] = f"{label}@{int(latency_ms)}ms"


@contextmanager
def time_query(label: str) -> Iterator[None]:
    """Time a SQL query (or any DB-touching block).

    Usage:
        with metrics.time_query("memory_plane.insert"):
            cur.execute(...)
    """
    t0 = time.monotonic()
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        latency_ms = (time.monotonic() - t0) * 1000.0
        threshold = _slow_threshold_ms()
        _query_recorded(label, latency_ms, ok=ok, slow_threshold=threshold)
        if latency_ms >= threshold:
            logger.warning(
                "[DB][SLOW] label=%s latency=%dms ok=%s",
                label, int(latency_ms), ok,
            )


@contextmanager
def time_acquire() -> Iterator[None]:
    """Time a connection acquire."""
    t0 = time.monotonic()
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        latency_ms = (time.monotonic() - t0) * 1000.0
        acquire_recorded(latency_ms, ok=ok)


def snapshot() -> dict:
    """Public-safe snapshot for /v2/db/health. Bounded size."""
    with _LOCK:
        acquires = _STATE["acquires_total"]
        queries  = _STATE["queries_total"]
        # Top 8 labels by call count, so the response stays small even
        # when many stores are instrumented.
        by_label_top = sorted(
            _STATE["by_label"].items(),
            key=lambda kv: kv[1]["count"], reverse=True,
        )[:8]
        return {
            "acquires_total":         acquires,
            "acquires_failed":        _STATE["acquires_failed"],
            "acquire_avg_ms":         round(
                _STATE["acquire_latency_ms_sum"] / max(1, acquires), 2
            ),
            "queries_total":          queries,
            "queries_failed":         _STATE["queries_failed"],
            "query_avg_ms":           round(
                _STATE["query_latency_ms_sum"] / max(1, queries), 2
            ),
            "slow_queries":           _STATE["slow_queries"],
            "slow_threshold_ms":      _slow_threshold_ms(),
            "last_slow_query":        _STATE["last_slow_query"],
            "latency_buckets":        dict(_STATE["latency_buckets"]),
            "query_buckets":          dict(_STATE["query_buckets"]),
            "by_label_top": [
                {
                    "label":          k,
                    "count":          v["count"],
                    "avg_ms":         round(v["latency_ms_sum"] / max(1, v["count"]), 2),
                    "fails":          v["fails"],
                } for k, v in by_label_top
            ],
        }


def reset() -> None:
    """Test helper — wipe counters."""
    with _LOCK:
        _STATE.update({
            "acquires_total": 0, "acquires_failed": 0,
            "acquire_latency_ms_sum": 0.0,
            "queries_total": 0, "queries_failed": 0,
            "query_latency_ms_sum": 0.0,
            "slow_queries": 0,
            "by_label": {},
            "latency_buckets": {b: 0 for b in _BUCKETS_MS},
            "query_buckets":   {b: 0 for b in _BUCKETS_MS},
            "last_slow_query": "",
        })


__all__ = [
    "time_query", "time_acquire",
    "acquire_recorded",
    "snapshot", "reset",
]
