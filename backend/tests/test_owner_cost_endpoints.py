# coding: utf-8
"""
Owner Cost Analytics endpoints — focused tests.

Covers HTTP auth semantics (401/403/404/400), owner reads (200), bounded
failure diagnostics, usage-missing-vs-zero, the failed-background-call →
build linkage seam, and the privacy guarantee that no prompt/output/secret
leaks into a cost response.

No model calls, no Web Build generation.
"""
from __future__ import annotations

import importlib
import os

import pytest

_OWNER_TOKEN = "k" * 32


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("OWNER_TOKEN", _OWNER_TOKEN)
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    monkeypatch.setenv("ADMIN_AUDIT_DB_PATH", str(tmp_path / "audit.db"))
    monkeypatch.setenv("JWT_SECRET_KEY", "t" * 40)
    from backend.services.cost_tracking import store as _store
    importlib.reload(_store)
    from backend.services.cost_tracking import tracker as _tracker
    importlib.reload(_tracker)
    _store._reset_for_tests()
    from fastapi.testclient import TestClient
    from backend.api import app
    return {"client": TestClient(app, raise_server_exceptions=False),
            "store": _store, "tracker": _tracker, "tmp": tmp_path}


def _owner(env):
    return {"X-Korvix-Owner-Token": _OWNER_TOKEN}


def _seed_build(tracker, store, *, build_id="op_build_a", failed=False):
    from backend.services.cost_tracking.types import TokenUsage, OP_PLANNING, OP_CODEGEN
    tracker.start_build(user_id="42", build_id=build_id, label="a fitness landing page")
    tracker.record_ai_call(
        build_id=build_id, user_id="42", provider="openai", model="gpt-5.6",
        operation_type=OP_PLANNING,
        usage=TokenUsage(input_tokens=12000, output_tokens=6000, cached_input_tokens=4000,
                         reasoning_tokens=1500, total_tokens=18000))
    if failed:
        tracker.record_ai_call(
            build_id=build_id, user_id="42", provider="openai", model="gpt-5.6",
            operation_type=OP_CODEGEN, success=False,
            usage=TokenUsage(usage_missing=True),
            error_code="incomplete", error_kind="max_output_tokens",
            error_message="The build did not finish within the token budget.",
            request_id="resp_abcd12")
    return build_id


# ── 1. unauthenticated → 401 ─────────────────────────────────────────────────
def test_unauth_analytics_401(env):
    r = env["client"].get("/v2/admin/costs/analytics")
    assert r.status_code == 401


# ── 2. credential presented but not owner → 403 ──────────────────────────────
def test_non_owner_403(env):
    r = env["client"].get("/v2/admin/costs/analytics",
                          headers={"X-Korvix-Owner-Token": "wrong-token-value"})
    assert r.status_code == 403


def test_spoofed_owner_email_header_denied(env):
    # The backend never trusts a client-sent owner email header.
    r = env["client"].get("/v2/admin/costs/analytics",
                          headers={"X-Korvix-Owner-Email": "owner@example.com"})
    assert r.status_code in (401, 403)
    assert "data" not in r.json()


# ── 3–5. owner reads → 200 ───────────────────────────────────────────────────
def test_owner_analytics_200(env):
    _seed_build(env["tracker"], env["store"])
    r = env["client"].get("/v2/admin/costs/analytics", headers=_owner(env))
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["build_count"] == 1
    assert d["total_cost_usd"] > 0
    assert r.headers.get("cache-control", "").startswith("no-store")


def test_owner_build_list_200(env):
    _seed_build(env["tracker"], env["store"])
    r = env["client"].get("/v2/admin/costs/builds", headers=_owner(env))
    assert r.status_code == 200
    assert r.json()["data"]["count"] == 1


def test_owner_build_detail_200(env):
    bid = _seed_build(env["tracker"], env["store"])
    r = env["client"].get(f"/v2/admin/costs/builds/{bid}", headers=_owner(env))
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["build_id"] == bid
    assert len(d["calls"]) == 1
    assert d["total_input_tokens"] == 12000


# ── 6. missing build → 404 ; malformed → 400 ─────────────────────────────────
def test_missing_build_404(env):
    r = env["client"].get("/v2/admin/costs/builds/op_does_not_exist", headers=_owner(env))
    assert r.status_code == 404


def test_malformed_build_id_400(env):
    r = env["client"].get("/v2/admin/costs/builds/bad%20id%21", headers=_owner(env))
    assert r.status_code == 400


# ── 7. failed AI call returns safe bounded diagnostics ───────────────────────
def test_failed_call_bounded_diagnostics(env):
    bid = _seed_build(env["tracker"], env["store"], failed=True)
    r = env["client"].get(f"/v2/admin/costs/builds/{bid}", headers=_owner(env))
    assert r.status_code == 200
    d = r.json()["data"]
    failed = [c for c in d["calls"] if not c["success"]]
    assert len(failed) == 1
    fc = failed[0]
    assert fc["error_kind"] == "max_output_tokens"
    assert fc["error_code"] == "incomplete"
    assert "token budget" in (fc["error_message"] or "")
    assert fc["request_id"] == "resp_abcd12"
    assert d["failed_calls"] == 1


# ── 8. usage missing stays distinct from zero ────────────────────────────────
def test_usage_missing_distinct_from_zero(env):
    from backend.services.cost_tracking.types import TokenUsage, OP_CODEGEN
    tr, st = env["tracker"], env["store"]
    tr.start_build(user_id="42", build_id="op_um")
    # A usage-missing call and a genuine zero-token (tool-only) situation differ.
    tr.record_ai_call(build_id="op_um", user_id="42", provider="openai",
                      model="gpt-5.6", operation_type=OP_CODEGEN,
                      usage=TokenUsage(usage_missing=True))
    r = env["client"].get("/v2/admin/costs/builds/op_um", headers=_owner(env))
    d = r.json()["data"]
    assert d["usage_missing_calls"] == 1
    c = d["calls"][0]
    assert c["usage_missing"] is True or c["usage_missing"] == 1
    assert c["total_tokens"] == 0            # missing, NOT a real zero
    assert d["total_build_cost_usd"] == 0.0


# ── 9. failed background frontend call is linked to the correct build ────────
def test_failed_background_call_linked_to_build(env):
    """Simulates the poll-route seam: link job→build, then record the terminal
    failure against the linked build id."""
    from backend.services.cost_tracking.types import TokenUsage, OP_CODEGEN
    tr = env["tracker"]
    bid = tr.start_build(user_id="42", build_id="op_bg_build")
    tr.link_background_job(job_id="job_xyz", build_id=bid, user_id="42")

    link = tr.build_id_for_job("job_xyz")
    assert link["build_id"] == bid
    # Terminal failure arrives on the (separate) poll → recorded against the build.
    tr.record_ai_call(build_id=link["build_id"], user_id="42", provider="openai",
                      model="gpt-5.6", operation_type=OP_CODEGEN, success=False,
                      usage=TokenUsage(usage_missing=True),
                      error_kind="incomplete", error_code="length",
                      error_message="background generation hit the token ceiling")
    r = env["client"].get(f"/v2/admin/costs/builds/{bid}", headers=_owner(env))
    d = r.json()["data"]
    assert d["failed_calls"] == 1
    assert d["calls"][0]["error_kind"] == "incomplete"


# ── 10. no prompt/output/secret leaks into a cost response ───────────────────
def test_no_prompt_or_output_in_response(env):
    bid = _seed_build(env["tracker"], env["store"], failed=True)
    r = env["client"].get(f"/v2/admin/costs/builds/{bid}", headers=_owner(env))
    blob = r.text.lower()
    for forbidden in ("authorization", "bearer ", "sk-", "prompt", "system_prompt",
                      "output_text", "generated_source", "api_key"):
        assert forbidden not in blob, f"leaked field: {forbidden}"
    # The call record exposes only bounded, safe columns.
    call = r.json()["data"]["calls"][0]
    safe_keys = {
        "call_id", "build_id", "user_id", "provider", "model", "operation_type",
        "request_started_at", "request_completed_at", "success", "retry_number",
        "input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_tokens",
        "reasoning_tokens", "total_tokens", "usage_missing",
        "input_cost_usd", "output_cost_usd", "cache_cost_usd",
        "additional_tool_cost_usd", "total_call_cost_usd",
        "error_code", "error_kind", "error_message", "request_id",
        "tool_key", "tool_units", "duration_ms", "created_at",
        # Additive canonical attribution (cost audit) — safe metadata only. The
        # one-way input/output fingerprints are stripped by tracker.get_build and
        # must NOT appear here.
        "stage", "agent", "sequence_index", "parent_call_id", "retry_reason", "context_bytes",
    }
    assert "input_fingerprint" not in call and "output_fingerprint" not in call
    assert set(call.keys()).issubset(safe_keys), f"unexpected keys: {set(call.keys()) - safe_keys}"
