# coding: utf-8
"""Phase 7 — Redis metrics (counters only).

Lightweight counters for command count + failures. Bucketed latency
isn't added here — Redis commands are typically sub-millisecond and
not the bottleneck. If we need latency later, copy the buckets pattern
from services/db/metrics.
"""
from __future__ import annotations

import threading


_LOCK = threading.Lock()
_STATE: dict = {
    "commands_total":   0,
    "commands_failed":  0,
    "pings_total":      0,
    "pings_failed":     0,
    "publishes":        0,
    "subscribes":       0,
    "last_error":       "",
}


def command_recorded(*, ok: bool, error: str = "") -> None:
    with _LOCK:
        _STATE["commands_total"] += 1
        if not ok:
            _STATE["commands_failed"] += 1
            if error:
                _STATE["last_error"] = error[:140]


def ping_recorded(*, ok: bool) -> None:
    with _LOCK:
        _STATE["pings_total"] += 1
        if not ok:
            _STATE["pings_failed"] += 1


def publish_recorded() -> None:
    with _LOCK:
        _STATE["publishes"] += 1


def subscribe_recorded() -> None:
    with _LOCK:
        _STATE["subscribes"] += 1


def snapshot() -> dict:
    with _LOCK:
        return dict(_STATE)


def reset() -> None:
    """Test helper."""
    with _LOCK:
        for k in list(_STATE.keys()):
            _STATE[k] = "" if isinstance(_STATE[k], str) else 0


__all__ = [
    "command_recorded", "ping_recorded", "publish_recorded",
    "subscribe_recorded", "snapshot", "reset",
]
