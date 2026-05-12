# coding: utf-8
"""
StageTimer — lightweight per-stage latency instrumentation.

Used by /chat (and any other request path that wants per-stage visibility
in production logs). Records named-stage durations as wall-clock deltas
since `start()`, then emits ONE structured log line at `flush()` with
every stage + the total.

Design notes:
  - No global state. Each request gets its own StageTimer instance.
  - `time.monotonic()` not `time.time()` — monotonic clock is immune to
    NTP step adjustments mid-request.
  - Stage names are free-form. Convention: lowercase with underscores
    (e.g. "safety_done", "ai_end", "response_built").
  - The flush log line uses logger.info with structured `extra={}` so the
    JSON formatter lifts every stage into a top-level field. Operators
    can grep / aggregate per-stage latency without parsing the message.
  - Negligible overhead: time.monotonic() is ~50ns; a 7-stage timer
    adds well under 1µs per request. Safe to leave always-on.

Usage:
    t = StageTimer("CHAT_TIMING", rid=request_id, uid=user_id)
    ... t.mark("safety_done") ...
    ... t.mark("context_built") ...
    ... t.mark("ai_start") ...
    ... t.mark("ai_end") ...
    t.flush()   # emits log line + returns the timeline dict
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict


logger = logging.getLogger(__name__)


class StageTimer:
    """Records named stage durations and emits one structured log line."""

    __slots__ = ("_label", "_start", "_last", "_stages", "_extra", "_flushed", "_final")

    def __init__(self, label: str, **extra: Any) -> None:
        """
        Args:
          label: log-line prefix. Conventionally an UPPERCASE_TAG like
                 "CHAT_TIMING" so operators can grep one path at a time.
          **extra: any number of correlation fields (request_id, user_id,
                   intent, …) that should ride along on the log line.
        """
        self._label  = label
        self._start  = time.monotonic()
        self._last   = self._start
        self._stages: Dict[str, int] = {}
        self._extra  = dict(extra)
        self._flushed = False
        # Cache the post-flush timeline so repeated flush() calls return
        # the exact same dict (including the `total` key). Idempotent.
        self._final: Dict[str, int] = {}

    def mark(self, stage: str) -> int:
        """Record the milliseconds since the previous mark() (or since
        timer start for the first mark). Returns the delta for the
        caller's convenience — e.g. to fold into a branch decision."""
        now = time.monotonic()
        delta_ms = int((now - self._last) * 1000)
        self._last = now
        # Repeated marks of the same name accumulate — handy when a stage
        # appears in two code paths (e.g. retry).
        self._stages[stage] = self._stages.get(stage, 0) + delta_ms
        return delta_ms

    def total_ms(self) -> int:
        """Wall-clock duration since timer construction."""
        return int((time.monotonic() - self._start) * 1000)

    def flush(self, level: int = logging.INFO) -> Dict[str, int]:
        """Emit the structured log line and return the timeline dict.

        Idempotent — calling flush() twice is a no-op (the second call
        returns the same dict but does not re-log). This lets the
        flush sit in a finally block without spamming logs on error
        paths that also flush earlier.
        """
        if self._flushed:
            return dict(self._final)
        self._flushed = True

        total = self.total_ms()
        timeline = dict(self._stages)
        timeline["total"] = total
        self._final = dict(timeline)

        # Build a compact human-readable summary AND a structured payload.
        # The JSON formatter (when LOG_FORMAT=json) lifts `stages` into the
        # top-level fields automatically; the text formatter falls back to
        # the message string.
        summary = " | ".join(f"{k}={v}ms" for k, v in timeline.items())
        message = f"{self._label} | {summary}"
        logger.log(level, message, extra={
            "label":  self._label,
            "total_ms": total,
            "stages": timeline,
            **self._extra,
        })
        return timeline


__all__ = ["StageTimer"]
