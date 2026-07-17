# coding: utf-8
"""
Coordinator-plan 503 fix + early Web Build finalization — focused tests.

Covers the exact misclassified branch (disabled feature was 503, now 409),
correct status semantics for malformed / internal-error cases, and the early
terminal finalization that closes a cost build as failed (with a bounded
web_build_coordinator_plan diagnostic) instead of leaving it running.

No model calls, no Web Build generation.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def cost(tmp_path, monkeypatch):
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    from backend.services.cost_tracking import store as _store
    importlib.reload(_store)
    from backend.services.cost_tracking import tracker as _tracker
    importlib.reload(_tracker)
    _store._reset_for_tests()
    return {"store": _store, "tracker": _tracker}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "t" * 40)
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost_http.db"))
    # The FastAPI app is a process-level singleton built on first import; set the
    # route-mounting flags a sibling suite also relies on so import order between
    # focused test files can't drop admin routes.
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    from fastapi.testclient import TestClient
    from backend.api import app
    return TestClient(app, raise_server_exceptions=False)


# ── Coordinator status semantics ─────────────────────────────────────────────
def test_disabled_returns_409_not_503(client, monkeypatch):
    monkeypatch.delenv("ENABLE_COORDINATOR", raising=False)
    r = client.post("/v2/coordinator/plan", json={"message": "build me a notes app now"})
    assert r.status_code == 409                       # canonical disabled — NEVER 503
    assert r.json()["detail"]["code"] == "COORDINATOR_DISABLED"


def test_enabled_success_returns_200(client, monkeypatch):
    monkeypatch.setenv("ENABLE_COORDINATOR", "true")
    r = client.post("/v2/coordinator/plan", json={"message": "build me a fitness landing page"})
    assert r.status_code == 200
    assert "plan" in r.json()["data"]


def test_malformed_request_not_503(client, monkeypatch):
    monkeypatch.setenv("ENABLE_COORDINATOR", "true")
    r = client.post("/v2/coordinator/plan", json={})   # missing required `message`
    assert r.status_code == 422                          # validation, not 503


def test_internal_error_maps_to_bounded_500(client, monkeypatch):
    monkeypatch.setenv("ENABLE_COORDINATOR", "true")
    from backend.routes import v2_coordinator as _route
    def _boom(**kw):
        raise RuntimeError("planner bug")
    monkeypatch.setattr(_route.coordinator, "analyze", _boom)
    r = client.post("/v2/coordinator/plan", json={"message": "build me a store front"})
    assert r.status_code == 500                          # bounded 500, NOT fake 503 busy
    assert r.json()["detail"]["code"] == "COORDINATOR_ERROR"
    # No prompt / trace leaked.
    assert "planner bug" not in r.text
    assert "build me a store front" not in r.text


def test_coordinator_needs_no_redis(client, monkeypatch):
    """The plan path is pure rule-based; it must succeed with no Redis at all."""
    monkeypatch.setenv("ENABLE_COORDINATOR", "true")
    monkeypatch.delenv("REDIS_URL", raising=False)
    r = client.post("/v2/coordinator/plan", json={"message": "make me a saas dashboard page"})
    assert r.status_code == 200


# ── Early terminal finalization ──────────────────────────────────────────────
def test_operation_link_roundtrip_validates_user(cost):
    tr = cost["tracker"]
    tr.start_build(user_id="42", build_id="op_build")
    tr.link_operation(op_key="ck_abc", build_id="op_build", user_id="42")
    assert tr.build_id_for_operation("ck_abc", "42") == "op_build"
    # A different user (spoofed key) can never resolve another user's build.
    assert tr.build_id_for_operation("ck_abc", "99") is None
    assert tr.build_id_for_operation("ck_missing", "42") is None


def test_early_terminal_failure_marks_build_failed(cost):
    tr = cost["tracker"]
    tr.start_build(user_id="42", build_id="op_ef")
    # planning already recorded a call; build is running
    from backend.services.cost_tracking.types import TokenUsage, OP_PLANNING, OP_COORDINATOR
    tr.record_ai_call(build_id="op_ef", user_id="42", provider="openai", model="gpt-5.6",
                      operation_type=OP_PLANNING,
                      usage=TokenUsage(input_tokens=1000, output_tokens=1000))
    ok = tr.early_terminal_failure(
        build_id="op_ef", user_id="42", operation_type=OP_COORDINATOR,
        error_kind="ai_guard_block", error_code="global_spend_limit_reached",
        request_id="req_123",
    )
    assert ok is True
    b = tr.get_build("op_ef")
    assert b["status"] == "failed"
    cp = [c for c in b["calls"] if c["operation_type"] == OP_COORDINATOR]
    assert len(cp) == 1
    assert bool(cp[0]["success"]) is False
    assert cp[0]["error_code"] == "global_spend_limit_reached"
    assert cp[0]["request_id"] == "req_123"


def test_early_terminal_usage_missing_not_zero(cost):
    tr = cost["tracker"]
    tr.start_build(user_id="42", build_id="op_um")
    from backend.services.cost_tracking.types import OP_COORDINATOR
    tr.early_terminal_failure(build_id="op_um", user_id="42", operation_type=OP_COORDINATOR,
                              error_code="credit_unavailable")
    c = [x for x in tr.get_build("op_um")["calls"] if x["operation_type"] == OP_COORDINATOR][0]
    assert bool(c["usage_missing"]) is True    # no provider call → missing, not zero
    assert c["total_call_cost_usd"] == 0.0


def test_early_terminal_is_idempotent(cost):
    """Repeated blocks for the SAME build finalize + record exactly once."""
    tr = cost["tracker"]
    tr.start_build(user_id="42", build_id="op_dup")
    from backend.services.cost_tracking.types import OP_COORDINATOR
    results = [
        tr.early_terminal_failure(build_id="op_dup", user_id="42",
                                  operation_type=OP_COORDINATOR, error_code="credit_unavailable")
        for _ in range(4)
    ]
    assert results == [True, False, False, False]     # only the first transitions
    b = tr.get_build("op_dup")
    assert b["status"] == "failed"
    assert len([c for c in b["calls"] if c["operation_type"] == OP_COORDINATOR]) == 1


def test_early_terminal_missing_build_no_crash(cost):
    tr = cost["tracker"]
    # No build started for this id → finalize_if_running finds nothing, returns False.
    from backend.services.cost_tracking.types import OP_COORDINATOR
    assert tr.early_terminal_failure(build_id="op_ghost", user_id="42",
                                     operation_type=OP_COORDINATOR) is False


def test_separate_retries_make_separate_builds(cost):
    """A retry with a NEW client op key targets a NEW build — no shared row."""
    tr = cost["tracker"]
    from backend.services.cost_tracking.types import OP_COORDINATOR
    for i, (bid, key) in enumerate([("op_a", "ck_a"), ("op_b", "ck_b")]):
        tr.start_build(user_id="42", build_id=bid)
        tr.link_operation(op_key=key, build_id=bid, user_id="42")
        tr.early_terminal_failure(build_id=bid, user_id="42",
                                  operation_type=OP_COORDINATOR, error_code="credit_unavailable")
    assert tr.get_build("op_a")["status"] == "failed"
    assert tr.get_build("op_b")["status"] == "failed"
    assert tr.get_build("op_a")["total_ai_calls"] == 1
    assert tr.get_build("op_b")["total_ai_calls"] == 1


def test_no_sensitive_fields_in_early_terminal(cost):
    tr = cost["tracker"]
    tr.start_build(user_id="42", build_id="op_priv")
    from backend.services.cost_tracking.types import OP_COORDINATOR
    tr.early_terminal_failure(build_id="op_priv", user_id="42", operation_type=OP_COORDINATOR,
                              error_kind="ai_guard_block", error_code="credit_unavailable",
                              error_message="capacity reached")
    c = tr.get_build("op_priv")["calls"][0]
    for forbidden in ("prompt", "output_text", "source", "authorization", "api_key", "cookie"):
        assert forbidden not in set(c.keys())
