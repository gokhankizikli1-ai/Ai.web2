# coding: utf-8
"""
Design Observability — in-memory trace store.

A tiny, bounded, process-local ring buffer mapping a build id → its
:class:`DesignDecisionTrace` (plus the time it was recorded). It lets a developer debug
tool look a decision up by build id AFTER the build ran, without any database, without
persisting anything to disk, and without touching the generation path.

It holds ONLY the already-sanitized trace (which itself stores no raw prompt or personal
data). It is best-effort: bounded to the most recent N builds and lost on restart — this
is debug metadata, not a system of record. Thread-safe and total (never raises).
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

from backend.services.design_observability.models import DesignDecisionTrace

_MAX_TRACES = 200
_lock = threading.Lock()


@dataclass(frozen=True)
class TraceRecord:
    build_id: str
    trace: DesignDecisionTrace
    recorded_at: str  # ISO-8601 UTC


_traces: "OrderedDict[str, TraceRecord]" = OrderedDict()


def _now_iso() -> str:
    try:
        return datetime.now(timezone.utc).isoformat()
    except Exception:  # noqa: BLE001
        return ""


def record_trace(build_id: object, trace: Optional[DesignDecisionTrace]) -> None:
    """Store a trace under ``build_id`` (evicting the oldest past the cap). No-op on a
    blank id or ``None`` trace. Never raises."""
    try:
        bid = str(build_id or "").strip()[:200]
        if not bid or trace is None:
            return
        record = TraceRecord(build_id=bid, trace=trace, recorded_at=_now_iso())
        with _lock:
            if bid in _traces:
                _traces.move_to_end(bid)
            _traces[bid] = record
            while len(_traces) > _MAX_TRACES:
                _traces.popitem(last=False)
    except Exception:  # noqa: BLE001 — observability must never break anything
        pass


def get_record(build_id: object) -> Optional[TraceRecord]:
    """Return the :class:`TraceRecord` for ``build_id``, or ``None``. Never raises."""
    try:
        bid = str(build_id or "").strip()
        if not bid:
            return None
        with _lock:
            return _traces.get(bid)
    except Exception:  # noqa: BLE001
        return None


def recent_ids(limit: int = 20) -> List[str]:
    """Most-recently-recorded build ids first. Never raises."""
    try:
        with _lock:
            ids = list(_traces.keys())
        return list(reversed(ids))[: max(0, int(limit))]
    except Exception:  # noqa: BLE001
        return []


def clear() -> None:
    """Drop all stored traces (used by tests). Never raises."""
    try:
        with _lock:
            _traces.clear()
    except Exception:  # noqa: BLE001
        pass


__all__ = ["TraceRecord", "record_trace", "get_record", "recent_ids", "clear"]
