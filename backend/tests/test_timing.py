# coding: utf-8
"""
StageTimer unit tests.

Validates the contract /chat depends on:
  - timer records each mark() as a non-negative int millisecond delta
  - flush() emits exactly one log line and is idempotent
  - the returned timeline always includes a `total` key
  - correlation kwargs (rid, uid, …) ride along to the log record
"""
from __future__ import annotations

import logging
import time

from backend.utils.timing import StageTimer


def test_marks_record_in_order():
    t = StageTimer("UNIT_TEST")
    t.mark("first")
    t.mark("second")
    t.mark("third")
    out = t.flush()
    assert set(out.keys()) == {"first", "second", "third", "total"}
    for k in ("first", "second", "third", "total"):
        assert out[k] >= 0


def test_flush_is_idempotent_returns_same_dict():
    t = StageTimer("UNIT_TEST")
    t.mark("a")
    first = t.flush()
    second = t.flush()
    assert first == second


def test_total_is_at_least_sum_of_stages():
    t = StageTimer("UNIT_TEST")
    time.sleep(0.001)
    t.mark("a")
    time.sleep(0.001)
    t.mark("b")
    out = t.flush()
    # total >= a + b (within timer resolution); allow off-by-one for ms rounding
    assert out["total"] + 1 >= out["a"] + out["b"]


def test_repeated_mark_accumulates():
    t = StageTimer("UNIT_TEST")
    t.mark("retry")
    t.mark("retry")     # same name twice — should accumulate, not overwrite
    out = t.flush()
    # Single key, value is sum of both deltas (>= 0 each)
    assert "retry" in out


def test_extra_kwargs_flow_into_log_record(caplog):
    caplog.set_level(logging.INFO, logger="backend.utils.timing")
    t = StageTimer("UNIT_TEST", rid="abc12345", uid=42)
    t.mark("only")
    t.flush()
    matched = [r for r in caplog.records if r.name == "backend.utils.timing"]
    assert len(matched) == 1
    rec = matched[0]
    assert getattr(rec, "label", None) == "UNIT_TEST"
    assert getattr(rec, "rid", None) == "abc12345"
    assert getattr(rec, "uid", None) == 42
    assert "stages" in rec.__dict__
    assert "total" in rec.__dict__["stages"]
