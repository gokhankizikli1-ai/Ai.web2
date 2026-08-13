# coding: utf-8
"""Business Brain — Phase 5: MEASURE. Generic metrics + deterministic change.

Truthful "what changed?" detection with noise control and observation/
hypothesis/decision separation. No cause is ever recorded on a metric.
"""
from __future__ import annotations

import importlib

import pytest

from backend.services.orchestrator import metrics_store as ms_pure


@pytest.fixture()
def ms(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import metrics_store
    importlib.reload(metrics_store)
    metrics_store.init_metrics_table()
    return metrics_store


# ── Storage ──────────────────────────────────────────────────────────────

def test_record_and_history(ms):
    ms.record_metric(user_id="u1", project_id="p1", metric_key="signup_conversion",
                     value=7.2, unit="%", observed_at="2024-01-01T00:00:00Z")
    ms.record_metric(user_id="u1", project_id="p1", metric_key="signup_conversion",
                     value=4.8, unit="%", observed_at="2024-02-01T00:00:00Z")
    hist = ms.history("p1", "signup_conversion")
    assert [h["value"] for h in hist] == [4.8, 7.2]   # newest first
    assert ms.latest("p1", "signup_conversion")["value"] == 4.8


def test_non_numeric_rejected(ms):
    assert ms.record_metric(user_id="u1", project_id="p1", metric_key="k", value="nope") == ""
    assert ms.record_metric(user_id="u1", project_id="p1", metric_key="", value=1) == ""


def test_absolute_and_percentage_helpers():
    assert ms_pure.absolute_delta(10, 7) == -3
    assert ms_pure.percentage_change(10, 8) == pytest.approx(-0.2)
    assert ms_pure.percentage_change(0, 5) is None   # undefined baseline


def test_threshold_crossing():
    assert ms_pure.crosses_threshold(90, 110, 100, direction="up")
    assert not ms_pure.crosses_threshold(90, 95, 100, direction="up")
    assert ms_pure.crosses_threshold(110, 90, 100, direction="down")
    assert ms_pure.crosses_threshold(110, 90, 100, direction="either")


def test_trend_requires_min_samples():
    assert ms_pure.trend([1.0]) == "insufficient"
    assert ms_pure.trend([1.0, 2.0, 3.0]) == "up"
    assert ms_pure.trend([3.0, 2.0, 1.0]) == "down"
    assert ms_pure.trend([2.0, 2.0, 2.0]) == "flat"


def test_detect_change_significant(ms):
    ms.record_metric(user_id="u1", project_id="p1", metric_key="conv", value=7.2,
                     observed_at="2024-01-01T00:00:00Z")
    ms.record_metric(user_id="u1", project_id="p1", metric_key="conv", value=4.8,
                     observed_at="2024-02-01T00:00:00Z")
    change = ms.detect_change("p1", "conv")
    assert change["direction"] == "down"
    assert change["significant"] is True
    assert change["percentage_change"] == pytest.approx((4.8 - 7.2) / 7.2, abs=1e-5)
    # Cause-free: no "reason"/"hypothesis" field is present on the change.
    assert "hypothesis" not in change and "cause" not in change


def test_detect_change_noise_ignored(ms):
    ms.record_metric(user_id="u1", project_id="p1", metric_key="mrr", value=1000,
                     observed_at="2024-01-01T00:00:00Z")
    ms.record_metric(user_id="u1", project_id="p1", metric_key="mrr", value=1005,
                     observed_at="2024-02-01T00:00:00Z")   # +0.5% — noise
    change = ms.detect_change("p1", "mrr")   # default 10% floor
    assert change["significant"] is False


def test_detect_change_needs_two_points(ms):
    ms.record_metric(user_id="u1", project_id="p1", metric_key="solo", value=1)
    assert ms.detect_change("p1", "solo") is None


def test_old_metric_timestamp_preserved(ms):
    mid = ms.record_metric(user_id="u1", project_id="p1", metric_key="k", value=1,
                           observed_at="2020-01-01T00:00:00Z")
    assert ms.history("p1", "k")[0]["observed_at"] == "2020-01-01T00:00:00Z"
    assert mid


def test_prune_bounds_growth(ms):
    for i in range(10):
        ms.record_metric(user_id="u1", project_id="p1", metric_key="k", value=i,
                         observed_at=f"2024-01-{i+1:02d}T00:00:00Z")
    deleted = ms.prune_metric("p1", "k", keep=3)
    assert deleted == 7
    assert len(ms.history("p1", "k", limit=100)) == 3


def test_cross_project_isolation(ms):
    ms.record_metric(user_id="u1", project_id="pA", metric_key="k", value=1)
    ms.record_metric(user_id="u2", project_id="pB", metric_key="k", value=2)
    assert ms.latest("pA", "k")["value"] == 1
    assert ms.latest("pB", "k")["value"] == 2
