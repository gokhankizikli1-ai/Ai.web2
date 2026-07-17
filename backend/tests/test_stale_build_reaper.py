# coding: utf-8
"""
Owner stale-build reaper — focused tests.

Covers dry-run (mutation-free), eligibility, exact ai_guard operation/lock
cleanup, conservative spend reconciliation, quota preservation, idempotency,
owner-only auth, bounded/no-secret responses, and the threshold/row-limit
guards.

No model calls, no Web Build generation.
"""
from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

import pytest

_OWNER = "k" * 32


def _iso_ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("OWNER_TOKEN", _OWNER)
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "guard.db"))
    monkeypatch.setenv("ADMIN_AUDIT_DB_PATH", str(tmp_path / "audit.db"))
    monkeypatch.setenv("JWT_SECRET_KEY", "t" * 40)
    from backend.services.cost_tracking import store as cstore
    importlib.reload(cstore)
    from backend.services.cost_tracking import tracker as ctrack
    importlib.reload(ctrack)
    cstore._reset_for_tests()
    from backend.services.ai_guard import store as gstore
    importlib.reload(gstore)
    gstore.init()
    from fastapi.testclient import TestClient
    from backend.api import app
    return {"client": TestClient(app, raise_server_exceptions=False),
            "cstore": cstore, "ctrack": ctrack, "gstore": gstore}


def _seed_guard_op(gstore, op_id, user_id, *, status="running", reserved=0.6,
                   reservation_open=1, window="2026-07-17", ttl_ahead=9999):
    now = gstore._now()
    with gstore._conn() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute(
            "INSERT INTO ai_operations (operation_id,user_id,operation_type,status,quota_window,"
            "idempotency_key,request_fingerprint,reserved_cost,actual_cost,reservation_open,attempt_count,"
            "lock_token,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,0,?,1,?,?,?,?)",
            (op_id, user_id, "web_build_full", status, window, "k", "fp", reserved,
             reservation_open, "lt", now, now, now + ttl_ahead),
        )
        c.execute(
            "INSERT INTO ai_global_spend (quota_window,reserved_usd,actual_usd,updated_at) "
            "VALUES (?,?,0,?) ON CONFLICT(quota_window) DO UPDATE SET reserved_usd=excluded.reserved_usd",
            (window, reserved, now),
        )
        # a daily usage counter that must survive recovery
        c.execute(
            "INSERT INTO ai_op_usage (user_id,quota_window,operation_type,count) VALUES (?,?,?,1) "
            "ON CONFLICT(user_id,quota_window,operation_type) DO UPDATE SET count=1",
            (user_id, window, "web_build_full"),
        )
        c.execute("COMMIT")


def _H():
    return {"X-Korvix-Owner-Token": _OWNER}


def _post(env, **body):
    return env["client"].post("/v2/admin/costs/reap-stale-builds", json=body, headers=_H())


# ── 12/13. auth ──────────────────────────────────────────────────────────────
def test_unauthenticated_401(env):
    assert env["client"].post("/v2/admin/costs/reap-stale-builds", json={}).status_code == 401


def test_non_owner_403(env):
    r = env["client"].post("/v2/admin/costs/reap-stale-builds", json={},
                           headers={"X-Korvix-Owner-Token": "wrong"})
    assert r.status_code == 403


# ── 1/2/3. dry run finds stale, skips recent/completed, mutates nothing ──────
def test_dry_run_finds_stale_and_changes_nothing(env):
    env["cstore"].upsert_build(build_id="b_stale", user_id="42", started_at=_iso_ago(40))
    env["cstore"].upsert_build(build_id="b_fresh", user_id="42", started_at=_iso_ago(2))
    env["cstore"].upsert_build(build_id="b_done", user_id="42", started_at=_iso_ago(40))
    env["ctrack"].complete_build(build_id="b_done", status="completed")

    r = _post(env, dryRun=True)
    d = r.json()["data"]
    assert r.status_code == 200 and d["dryRun"] is True
    ids = {i["buildId"] for i in d["items"]}
    assert ids == {"b_stale"}                       # recent + completed excluded
    # nothing changed
    assert env["cstore"].get_build_row("b_stale")["status"] == "in_progress"
    assert r.headers.get("cache-control", "").startswith("no-store")


# ── 4. stale build without operation link finalizes cost row only ────────────
def test_recover_cost_only_when_no_operation(env):
    env["cstore"].upsert_build(build_id="b_noop", user_id="42", started_at=_iso_ago(40))
    r = _post(env, dryRun=False)
    item = [i for i in r.json()["data"]["items"] if i["buildId"] == "b_noop"][0]
    assert item["costBuildFinalized"] is True
    assert item["aiGuardOperationFinalized"] is False    # no matching op
    assert env["cstore"].get_build_row("b_noop")["status"] == "failed"


# ── 5/6/8. stale build with matching op: finalize op, release lock, reconcile ─
def test_recover_finalizes_exact_operation_and_lock(env):
    _seed_guard_op(env["gstore"], "op_stale", "42", reserved=0.6)
    env["cstore"].upsert_build(build_id="op_stale", user_id="42", started_at=_iso_ago(40))

    r = _post(env, dryRun=False)
    item = [i for i in r.json()["data"]["items"] if i["buildId"] == "op_stale"][0]
    assert item["costBuildFinalized"] is True
    assert item["aiGuardOperationFinalized"] is True
    assert item["lockReleased"] is True
    assert item["spendReservationReconciled"] is True
    assert env["gstore"].get_operation("op_stale")["status"] == "cancelled"
    # spend reservation given back (conservative — floored at 0)
    assert env["gstore"].global_spend("2026-07-17")["reservedUsd"] == 0.0


# ── 7. unrelated active operation remains untouched ──────────────────────────
def test_unrelated_operation_untouched(env):
    _seed_guard_op(env["gstore"], "op_stale", "42", reserved=0.6)
    _seed_guard_op(env["gstore"], "op_other", "99", reserved=0.6, window="2026-07-17")
    env["cstore"].upsert_build(build_id="op_stale", user_id="42", started_at=_iso_ago(40))
    # op_other has NO stale cost build → never scanned/touched.
    _post(env, dryRun=False)
    assert env["gstore"].get_operation("op_other")["status"] == "running"


# ── 9. daily quota counter is preserved ──────────────────────────────────────
def test_daily_quota_not_reset(env):
    _seed_guard_op(env["gstore"], "op_stale", "42", reserved=0.6)
    env["cstore"].upsert_build(build_id="op_stale", user_id="42", started_at=_iso_ago(40))
    _post(env, dryRun=False)
    cnt = env["gstore"].daily_count("42", "2026-07-17", "web_build_full")
    assert cnt == 1              # finalize never refunds quota


# ── 10/11. idempotent — repeated recovery + no duplicate diagnostic ──────────
def test_idempotent_recovery(env):
    _seed_guard_op(env["gstore"], "op_stale", "42", reserved=0.6)
    env["cstore"].upsert_build(build_id="op_stale", user_id="42", started_at=_iso_ago(40))
    _post(env, dryRun=False)
    r2 = _post(env, dryRun=False)
    assert r2.json()["data"]["scanned"] == 0          # already terminal, not re-scanned
    b = env["ctrack"].get_build("op_stale")
    diags = [c for c in b["calls"] if c["operation_type"] == "web_build_stale_recovery"]
    assert len(diags) == 1                             # exactly one recovery diagnostic


# ── 14. response contains no prompts/source/secrets ──────────────────────────
def test_response_has_no_sensitive_content(env):
    _seed_guard_op(env["gstore"], "op_stale", "42", reserved=0.6)
    env["cstore"].upsert_build(build_id="op_stale", user_id="42",
                               started_at=_iso_ago(40), label="build me a private notes app")
    blob = _post(env, dryRun=True).text.lower()
    for forbidden in ("authorization", "bearer ", "sk-", "prompt", "output_text",
                      "generated_source", "api_key", "lock_token", "fingerprint",
                      "reserved_cost", "openai_response_id"):
        assert forbidden not in blob


# ── 15. threshold minimum enforced ───────────────────────────────────────────
def test_threshold_minimum_enforced(env):
    # A build 15m old must NOT be eligible when the caller asks for 5m (clamped to 10).
    env["cstore"].upsert_build(build_id="b15", user_id="42", started_at=_iso_ago(15))
    env["cstore"].upsert_build(build_id="b5", user_id="42", started_at=_iso_ago(5))
    r = _post(env, dryRun=True, olderThanMinutes=5)
    d = r.json()["data"]
    assert d["thresholdMinutes"] == 10                 # clamped up from 5
    ids = {i["buildId"] for i in d["items"]}
    assert "b15" in ids and "b5" not in ids            # 5m-old excluded by the 10m floor


# ── 16. affected-row limit enforced ──────────────────────────────────────────
def test_row_limit_enforced(env):
    for i in range(60):
        env["cstore"].upsert_build(build_id=f"b{i}", user_id="42", started_at=_iso_ago(40))
    d = _post(env, dryRun=True, limit=500).json()["data"]     # request over max
    assert len(d["items"]) <= 50                              # capped at _REAP_MAX_ROWS


# ── 18. global spend / Founder Beta config unchanged (no code path altered) ──
def test_recovery_does_not_change_policy(env):
    from backend.services.ai_guard import policy as P
    pol = P.FounderBetaPolicy({})
    before = (pol.global_spend_limit_usd, pol.limit_for(P.OP_WEB_BUILD_FULL).daily_per_user)
    _seed_guard_op(env["gstore"], "op_stale", "42", reserved=0.6)
    env["cstore"].upsert_build(build_id="op_stale", user_id="42", started_at=_iso_ago(40))
    _post(env, dryRun=False)
    pol2 = P.FounderBetaPolicy({})
    after = (pol2.global_spend_limit_usd, pol2.limit_for(P.OP_WEB_BUILD_FULL).daily_per_user)
    assert before == after
