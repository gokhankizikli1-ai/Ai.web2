# coding: utf-8
"""
Owner-unlimited Web Build testing — focused ai_guard tests.

Proves that a BACKEND-VERIFIED owner gets unlimited personal Founder-Beta
quota while every company-wide safety control (kill switch, global spend cap,
operation-enabled toggles, concurrency, idempotency, cost tracking) stays
enforced — and that spoofed client-side owner indicators never bypass quota.

No network, no model calls. Direct ai_guard preflight/store + a TestClient for
the usage endpoint's owner resolution.
"""
from __future__ import annotations

import importlib
import os

import pytest


# ── Isolation ────────────────────────────────────────────────────────────────
@pytest.fixture()
def guard(tmp_path, monkeypatch):
    """Isolated ai_guard + cost_tracking DBs with a clean baseline policy."""
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "ai_guard_test.db"))
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost_test.db"))
    # Baseline: admin mode on, owner identity configured, all ops permitted,
    # generous global spend so the default gate never fires unless a test sets it.
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("AI_OPERATIONS_ENABLED", "true")
    monkeypatch.setenv("AI_FOUNDER_BETA_ENABLED", "true")
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_ENABLED", "true")
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_LIMIT_USD", "1000")
    # Clear any override that might disable an op or change a limit.
    for k in ("AI_BETA_FULL_BUILDS_PER_DAY", "AI_BETA_MAJOR_REDESIGNS_ENABLED",
              "AI_BETA_IMAGE_GENERATION_ENABLED"):
        monkeypatch.delenv(k, raising=False)

    from backend.services.ai_guard import store as _store
    importlib.reload(_store)
    _store._INITIALIZED = False
    from backend.services.ai_guard import service as _svc
    importlib.reload(_svc)
    from backend.services.ai_guard import policy as _pol
    return {"service": _svc, "store": _store, "policy": _pol}


def _full_build(svc, uid, *, is_owner=False, msg="[BUILD] a fitness landing page"):
    return svc.preflight(user_id=str(uid), operation_type=svc.P.OP_WEB_BUILD_FULL,
                         message=msg, is_owner=is_owner)


# ── 1. Normal user: one full build/day, blocked on the second ────────────────
def test_normal_user_full_build_then_blocked(guard):
    svc = guard["service"]
    pf1 = _full_build(svc, "u_normal", is_owner=False)
    assert pf1.allowed and pf1.code == "allowed"
    # Finish it so the concurrency lock is free — isolate the daily-quota gate.
    svc.finalize(user_id="u_normal", status="succeeded", operation_id=pf1.operation_id)
    pf2 = _full_build(svc, "u_normal", is_owner=False, msg="[BUILD] another idea")
    assert not pf2.allowed
    assert pf2.code == "daily_limit_reached"
    assert pf2.remaining == 0


# ── 2. Verified owner: multiple sequential full builds all allowed ───────────
def test_owner_multiple_sequential_full_builds(guard):
    svc = guard["service"]
    for i in range(3):
        pf = _full_build(svc, "u_owner", is_owner=True, msg=f"[BUILD] idea {i}")
        assert pf.allowed, f"owner build {i} should be allowed, got {pf.code}"
        assert pf.code == "allowed"
        assert pf.source == "admin-grant"
        assert pf.owner_unlimited is True
        assert pf.remaining is None            # unlimited → no fake remaining
        svc.finalize(user_id="u_owner", status="succeeded", operation_id=pf.operation_id)


# ── 3. Owner builds still create real operation records ──────────────────────
def test_owner_build_creates_operation_record(guard):
    svc, store = guard["service"], guard["store"]
    pf = _full_build(svc, "u_owner", is_owner=True)
    assert pf.allowed and pf.operation_id
    # An operation row exists and is active (holding the lock) before finalize.
    assert store.active_operations_count() >= 1


# ── 4. Owner builds still reserve + reconcile global spend ───────────────────
def test_owner_build_reserves_and_reconciles_spend(guard):
    svc, store, P = guard["service"], guard["store"], guard["policy"]
    window = P.utc_window()
    pf = _full_build(svc, "u_owner", is_owner=True)
    assert pf.allowed
    spend = store.global_spend(window)
    assert spend["reservedUsd"] > 0, "owner build must reserve estimated spend"
    # Reconcile a real provider cost — global actual ledger moves for the owner too.
    svc.record_model_cost(operation_id=pf.operation_id, user_id="u_owner",
                          model="gpt-5.6", provider="openai",
                          input_tokens=10_000, output_tokens=5_000,
                          operation_type=P.OP_WEB_BUILD_FULL)
    spend2 = store.global_spend(window)
    assert spend2["actualUsd"] > 0, "owner build must reconcile actual USD spend"


# ── 5. Owner is blocked by the global kill switch ────────────────────────────
def test_owner_blocked_by_kill_switch(guard, monkeypatch):
    svc = guard["service"]
    monkeypatch.setenv("AI_OPERATIONS_ENABLED", "false")
    pf = _full_build(svc, "u_owner", is_owner=True)
    assert not pf.allowed
    assert pf.code == "ai_temporarily_disabled"


# ── 6. Owner is blocked by the global daily spend cap ────────────────────────
def test_owner_blocked_by_global_spend_cap(guard, monkeypatch):
    svc = guard["service"]
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_LIMIT_USD", "0.01")  # below full-build estimate
    pf = _full_build(svc, "u_owner", is_owner=True)
    assert not pf.allowed
    assert pf.code == "global_spend_limit_reached"


# ── 7. Owner is blocked when the operation itself is disabled ────────────────
def test_owner_blocked_when_operation_disabled(guard, monkeypatch):
    svc, P = guard["service"], guard["policy"]
    # major_redesign is disabled by default (AI_BETA_MAJOR_REDESIGNS_ENABLED unset).
    pf = svc.preflight(user_id="u_owner", operation_type=P.OP_WEB_BUILD_MAJOR_REDESIGN,
                       message="[REDESIGN]", is_owner=True)
    assert not pf.allowed
    assert pf.code == "operation_disabled"


# ── 8. Owner cannot run concurrent duplicate protected operations ────────────
def test_owner_single_concurrency_enforced(guard):
    svc, P = guard["service"], guard["policy"]
    # Two genuinely distinct builds (different client operation keys) launched
    # concurrently: the first holds the single per-user lock, the second is
    # blocked. Owner-unlimited never relaxes the one-concurrent-op guarantee.
    pf1 = svc.preflight(user_id="u_owner", operation_type=P.OP_WEB_BUILD_FULL,
                        message="[BUILD] one", idempotency_key="op-key-1", is_owner=True)
    assert pf1.allowed
    pf2 = svc.preflight(user_id="u_owner", operation_type=P.OP_WEB_BUILD_FULL,
                        message="[BUILD] two", idempotency_key="op-key-2", is_owner=True)
    assert not pf2.allowed
    assert pf2.code == "operation_in_progress"

    # And an exact double-submit of the SAME build (same key + same body) is the
    # duplicate/idempotency guard — also not a second charged run.
    pf_dup = svc.preflight(user_id="u_owner", operation_type=P.OP_WEB_BUILD_FULL,
                           message="[BUILD] one", idempotency_key="op-key-1", is_owner=True)
    assert not pf_dup.allowed
    assert pf_dup.code == "operation_in_progress"


# ── 9. Spoofed frontend owner indicators do NOT bypass quota ─────────────────
def test_spoofed_owner_indicators_do_not_bypass(guard):
    """resolve_owner must ignore client-controlled owner claims and only trust
    the verified identity/token predicate."""
    svc = guard["service"]

    class _FakeHeaders:
        def __init__(self, d): self._d = {k.lower(): v for k, v in d.items()}
        def get(self, k, default=None): return self._d.get(k.lower(), default)

    class _FakeReq:
        # A guest request carrying every spoofable "I am owner" signal but no
        # valid server-issued owner token and no owner identity.
        def __init__(self):
            self.headers = _FakeHeaders({
                "x-korvix-owner": "true",
                "x-owner": "1",
                "x-korvix-owner-token": "not-the-real-token",
            })
            self.query_params = {"owner": "true", "isOwner": "1"}
            self.cookies = {}
            self.state = type("S", (), {})()

    assert svc.resolve_owner(_FakeReq()) is False
    # And a preflight with the (correctly-derived) False stays on normal quota.
    pf1 = _full_build(svc, "u_spoof", is_owner=False)
    svc.finalize(user_id="u_spoof", status="succeeded", operation_id=pf1.operation_id)
    pf2 = _full_build(svc, "u_spoof", is_owner=False, msg="[BUILD] second")
    assert not pf2.allowed and pf2.code == "daily_limit_reached"


# ── 10. Usage response identifies the owner-unlimited state ──────────────────
def test_usage_snapshot_owner_unlimited(guard):
    svc, P = guard["service"], guard["policy"]
    snap = svc.usage_snapshot("u_owner", is_owner=True)
    assert snap.get("isOwnerUnlimited") is True
    assert snap.get("entitlementSource") == "admin-grant"
    full = snap["operations"][P.OP_WEB_BUILD_FULL]
    assert full["limit"] is None
    assert full["remaining"] is None
    assert full["unlimited"] is True
    # No fake huge number anywhere.
    assert 999999 not in (full.get("limit"), full.get("remaining"))


# ── 11. Normal-user usage response is unchanged ──────────────────────────────
def test_usage_snapshot_normal_user_unchanged(guard):
    svc, P = guard["service"], guard["policy"]
    snap = svc.usage_snapshot("u_normal", is_owner=False)
    assert "isOwnerUnlimited" not in snap
    assert "entitlementSource" not in snap
    full = snap["operations"][P.OP_WEB_BUILD_FULL]
    assert full["limit"] == 1          # founder-beta: 1 full build/day
    assert full["remaining"] == 1
    assert full["enabled"] is True
    small = snap["operations"][P.OP_WEB_BUILD_SMALL_EDIT]
    assert small["limit"] == 5         # 5 small edits/day
    assert "unlimited" not in full


# ── 12. Cost tracking still records owner build calls ────────────────────────
def test_cost_tracking_records_owner_build(guard):
    svc, P = guard["service"], guard["policy"]
    from backend.services.cost_tracking import tracker as ct, store as ct_store
    from backend.services.cost_tracking.types import TokenUsage, OP_PLANNING
    ct_store._reset_for_tests()

    pf = _full_build(svc, "u_owner", is_owner=True)
    assert pf.allowed and pf.operation_id
    # The Web Build cost tracker keys on the guard operation id (the build_id).
    ct.record_ai_call(
        build_id=pf.operation_id, user_id="u_owner", provider="openai",
        model="gpt-5.6", operation_type=OP_PLANNING,
        usage=TokenUsage(input_tokens=10_000, output_tokens=5_000, total_tokens=15_000),
    )
    view = ct.get_build(pf.operation_id)
    assert view["total_ai_calls"] == 1
    assert view["total_build_cost_usd"] > 0
    assert view["total_input_tokens"] == 10_000


# ── HTTP boundary: owner-token grants unlimited, spoofed flags do not ────────
_OWNER_TOKEN = "z" * 32   # ≥ 16-char minimum


@pytest.fixture()
def http(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "ai_guard_http.db"))
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("OWNER_TOKEN", _OWNER_TOKEN)
    from backend.services.ai_guard import store as _store
    _store._INITIALIZED = False
    from fastapi.testclient import TestClient
    from backend.api import app
    return TestClient(app, raise_server_exceptions=False)


def test_usage_endpoint_owner_token_unlimited(http):
    r = http.get("/v2/ai/usage", headers={"X-Korvix-Owner-Token": _OWNER_TOKEN})
    assert r.status_code == 200
    body = r.json()
    assert body.get("isOwnerUnlimited") is True
    assert body.get("entitlementSource") == "admin-grant"


def test_usage_endpoint_spoofed_flags_stay_normal(http):
    # Every spoofable client owner signal EXCEPT a valid server-issued token.
    r = http.get(
        "/v2/ai/usage?owner=true&isOwner=1",
        headers={
            "X-Korvix-Owner": "true",
            "X-Owner-Mode": "1",
            "X-Korvix-Owner-Token": "wrong-token-value",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert "isOwnerUnlimited" not in body
    # Normal founder-beta full-build limit still shown.
    full = body["operations"]["web_build_full"]
    assert full["limit"] == 1
