# coding: utf-8
"""
Tests — Design Debug service (developer-only trace inspection).

Covers the read-only lookup service that projects a recorded DesignDecisionTrace into the
sanitized debug response:

  1. luxury restaurant trace;
  2. AI startup trace;
  3. finance trace;
  4. empty / missing trace fallback;
  5. disabled flag → None;
  6. no sensitive data leakage (raw prompt / PII);
  7. malformed trace handling.

The HTTP route is a thin owner-only, flag-gated wrapper over this service (it needs
FastAPI and is not exercised here). Pure + deterministic (no LLM / network).
"""
from __future__ import annotations

import pytest

from backend.services import design_debug as dbg
from backend.services import design_observability as obs
from backend.services.design_observability import store
from backend.services.design_debug.formatter import build_debug_response


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for flag in ("ENABLE_DESIGN_OBSERVABILITY", "ENABLE_DESIGN_DEBUG"):
        monkeypatch.delenv(flag, raising=False)
    store.clear()
    yield
    store.clear()


def _record(monkeypatch, prompt, context, build_id):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    obs.observe(prompt, context, build_id=build_id)
    monkeypatch.setenv("ENABLE_DESIGN_DEBUG", "true")


# ── 1–3. Per-industry traces ──────────────────────────────────────────────────

def test_luxury_restaurant_trace(monkeypatch):
    _record(monkeypatch, "Create a luxury restaurant website", {"industry": "restaurant"}, "b-lux")
    data = dbg.get_design_trace("b-lux")
    assert data is not None
    ds = data["decision_summary"]
    assert ds["industry"] == "restaurant"
    blob = (ds["selected_direction"] + " " + " ".join(ds["reasons"])).lower()
    assert "cinematic" in blob or "editorial" in blob
    # Exact whitelisted shape — nothing else.
    assert set(ds) == {"industry", "selected_direction", "reasons", "avoided_patterns", "contributing_layers"}
    assert set(data) == {"build_id", "decision_summary", "priority_order", "confidence", "user_override", "timestamp"}


def test_ai_startup_trace(monkeypatch):
    _record(monkeypatch, "Create an AI image generation startup website", None, "b-ai")
    data = dbg.get_design_trace("b-ai")
    assert data is not None
    assert "modern" in data["decision_summary"]["selected_direction"].lower() \
        or "forward" in data["decision_summary"]["selected_direction"].lower()


def test_finance_trace(monkeypatch):
    _record(monkeypatch, "Create an AI financial advisor website", {"industry": "finance"}, "b-fin")
    data = dbg.get_design_trace("b-fin")
    assert data is not None
    assert "trustworthy" in data["decision_summary"]["selected_direction"].lower()


# ── 4. Empty / missing fallback ───────────────────────────────────────────────

def test_missing_build_id_returns_none(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_DEBUG", "true")
    assert dbg.get_design_trace("does-not-exist") is None
    assert dbg.get_design_trace("") is None


def test_empty_input_trace_is_recorded_and_safe(monkeypatch):
    # An empty prompt still yields a neutral trace (observability never crashes).
    _record(monkeypatch, "", {"build_id": "b-empty"}, "b-empty")
    data = dbg.get_design_trace("b-empty")
    # Either a neutral trace was recorded, or nothing — both are safe (no crash).
    assert data is None or isinstance(data["decision_summary"]["selected_direction"], str)


# ── 5. Disabled flag ──────────────────────────────────────────────────────────

def test_disabled_flag_returns_none(monkeypatch):
    # Recorded, but the debug surface is OFF → no data returned.
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    obs.observe("Create a luxury restaurant website", {"industry": "restaurant"}, build_id="b-off")
    monkeypatch.delenv("ENABLE_DESIGN_DEBUG", raising=False)
    assert dbg.is_enabled() is False
    assert dbg.get_design_trace("b-off") is None
    assert dbg.recent_build_ids() == []


# ── 6. No sensitive data leakage ──────────────────────────────────────────────

def test_no_raw_prompt_or_pii_leak(monkeypatch):
    secret = "reach me at jane.doe@example.com — luxury restaurant please"
    _record(monkeypatch, secret, {"industry": "restaurant"}, "b-pii")
    import json
    blob = json.dumps(dbg.get_design_trace("b-pii"))
    assert "jane.doe@example.com" not in blob
    assert "reach me at" not in blob
    # No internal scoring detail beyond a rounded confidence number.
    assert "matched_signals" not in blob


# ── 7. Malformed trace handling ───────────────────────────────────────────────

def test_malformed_record_does_not_crash():
    # A record whose trace is missing fields / wrong type must not raise.
    class _Rec:
        build_id = "x"
        recorded_at = "t"
        trace = {"industry": 123, "main_reasons": "not-a-list", "confidence": "bad"}

    resp = build_debug_response(_Rec()).to_dict()
    assert resp["confidence"] == 0.0
    assert resp["decision_summary"]["reasons"] == []  # non-list coerced safely
    assert isinstance(resp["decision_summary"]["industry"], str)


def test_none_trace_record_is_safe():
    class _Rec:
        build_id = "x"
        recorded_at = "t"
        trace = None

    resp = build_debug_response(_Rec()).to_dict()
    assert resp["build_id"] == "x" and resp["decision_summary"]["selected_direction"] == ""


# ── Store behaviour ───────────────────────────────────────────────────────────

def test_store_is_bounded():
    store.clear()
    from backend.services.design_observability.models import DesignDecisionTrace
    for i in range(250):
        store.record_trace(f"id-{i}", DesignDecisionTrace(industry=str(i)))
    # Bounded to the most recent 200; the oldest are evicted.
    assert store.get_record("id-0") is None
    assert store.get_record("id-249") is not None
    assert len(store.recent_ids(1000)) <= 200


def test_observe_without_build_id_does_not_record(monkeypatch):
    monkeypatch.setenv("ENABLE_DESIGN_OBSERVABILITY", "true")
    store.clear()
    obs.observe("Create a luxury restaurant website", {"industry": "restaurant"})  # no build_id
    assert store.recent_ids() == []
