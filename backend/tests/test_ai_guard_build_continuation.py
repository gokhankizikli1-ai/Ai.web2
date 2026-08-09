# coding: utf-8
"""Web Build internal-continuation lifecycle (ai_guard).

A single user-initiated Web Build consumes ONE daily-build allowance. Its internal required stages
(planning → full-source generation → initial design review → bounded repair → final review →
acceptance) each reach a model via /chat and must attach as FREE server-verified CONTINUATIONS of
that one authorized operation — never a second billable/quota'd build.

Root cause fixed here: the operation lock TTL (600s) was shorter than one un-heartbeated background
phase (720s), so the parent op auto-expired mid-build; the sync review then fell to the START path
and a normal user (daily counter already spent by planning) was blocked by the per-user daily quota
— the one gate an owner is exempt from (why owner builds worked, normal-user builds fell to Safe
Preview). The fix raises the lock TTL to comfortably outlive one background phase; every quota /
credit / concurrency / spend check is UNCHANGED (still evaluated exactly once, atomically, at
reserve_start).
"""
from __future__ import annotations

import importlib
import time as _time

import pytest


@pytest.fixture()
def guard(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "ai_guard_test.db"))
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost_test.db"))
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("AI_OPERATIONS_ENABLED", "true")
    monkeypatch.setenv("AI_FOUNDER_BETA_ENABLED", "true")
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_ENABLED", "true")
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_LIMIT_USD", "1000")
    # IMPORTANT: do NOT set AI_OPERATION_LOCK_TTL_SECONDS — the default is the value under test.
    for k in ("AI_BETA_FULL_BUILDS_PER_DAY", "AI_OPERATION_LOCK_TTL_SECONDS"):
        monkeypatch.delenv(k, raising=False)
    from backend.services.ai_guard import store as _store
    importlib.reload(_store)
    _store._INITIALIZED = False
    from backend.services.ai_guard import service as _svc
    importlib.reload(_svc)
    from backend.services.ai_guard import policy as _pol
    return {"service": _svc, "store": _store, "policy": _pol}


def _pf(svc, uid, key, msg, is_owner=False):
    return svc.preflight(user_id=str(uid), operation_type=svc.P.OP_WEB_BUILD_FULL,
                         message=msg, idempotency_key=key, is_owner=is_owner)


# The five internal stages of ONE build, in order (distinct message bodies, SAME operation key).
_PLAN = "[BUILD] a premium saas landing page"
_GEN = "[FRONTEND BUILDER REQUEST]\nBEGIN_FRONTEND_BUILD_SPEC_JSON\n{}\nEND_FRONTEND_BUILD_SPEC_JSON"
_INITIAL_REVIEW = "[FRONTEND BUILDER REQUEST]\n[FRONTEND REVIEW REQUEST]\nTask: review (stage: initial)."
_REPAIR = "[FRONTEND BUILDER REQUEST]\n[FRONTEND REPAIR REQUEST]\nrepair."
_FINAL_REVIEW = "[FRONTEND BUILDER REQUEST]\n[FRONTEND REVIEW REQUEST]\nTask: review (stage: post-repair)."


def test_lock_ttl_outlives_one_background_phase(guard):
    # 720s is the frontend long-background budget; the un-heartbeated gap between two build /chat
    # calls is at most one such phase, so the lock TTL must exceed it.
    ttl = guard["service"]._policy().lock_ttl_seconds
    assert ttl >= 900, f"lock TTL {ttl}s must outlive a 720s background phase"
    assert ttl == 1800  # the new default under test


def test_one_build_all_stages_attach_as_continuations(guard):
    svc, P = guard["service"], guard["policy"]
    K = "op-build-1"
    # Planning is the first protected call → a real START (reserve), charged once.
    pf_plan = _pf(svc, "u1", K, _PLAN)
    assert pf_plan.allowed and pf_plan.role == svc.ROLE_START
    # Every internal stage attaches as a FREE continuation (same key), never a new reserve.
    for msg in (_GEN, _INITIAL_REVIEW, _REPAIR, _FINAL_REVIEW):
        pf = _pf(svc, "u1", K, msg)
        assert pf.allowed, f"internal stage must attach, got {pf.code} for {msg[:40]}"
        assert pf.role == "continuation"
        assert pf.idempotent_replay is True
    # Daily allowance consumed EXACTLY once for the whole build.
    snap = svc.usage_snapshot("u1", is_owner=False)
    assert snap["operations"][P.OP_WEB_BUILD_FULL]["remaining"] == 0


def test_daily_counter_increments_exactly_once_for_the_build(guard):
    svc, P = guard["service"], guard["policy"]
    K = "op-build-2"
    for msg in (_PLAN, _GEN, _INITIAL_REVIEW, _REPAIR, _FINAL_REVIEW):
        assert _pf(svc, "u2", K, msg).allowed
    window = P.utc_window()
    assert guard["store"].daily_count("u2", window, P.OP_WEB_BUILD_FULL) == 1


def test_global_spend_reserved_exactly_once(guard):
    svc, P, store = guard["service"], guard["policy"], guard["store"]
    window = P.utc_window()
    K = "op-build-3"
    _pf(svc, "u3", K, _PLAN)
    reserved_after_start = store.global_spend(window)["reservedUsd"]
    assert reserved_after_start > 0
    for msg in (_GEN, _INITIAL_REVIEW, _REPAIR, _FINAL_REVIEW):
        _pf(svc, "u3", K, msg)
    # Continuations never add a second reservation.
    assert store.global_spend(window)["reservedUsd"] == reserved_after_start


def test_second_independent_build_blocked_when_quota_exhausted(guard):
    svc, P = guard["service"], guard["policy"]
    pf1 = _pf(svc, "u4", "build-A", _PLAN)
    assert pf1.allowed
    svc.finalize(user_id="u4", status="succeeded", operation_id=pf1.operation_id)
    # A genuinely NEW build (different operation key) still requires a fresh quota check → blocked.
    pf2 = _pf(svc, "u4", "build-B", "[BUILD] a different site")
    assert not pf2.allowed and pf2.code == "daily_limit_reached"
    assert pf2.role != "continuation"


def test_forged_continuation_does_not_bypass_quota(guard):
    svc = guard["service"]
    pf = _pf(svc, "u5", "real-key", _PLAN)
    svc.finalize(user_id="u5", status="succeeded", operation_id=pf.operation_id)
    # A made-up key matching no active op is NOT a continuation → START path → blocked at quota.
    forged = _pf(svc, "u5", "forged-key-no-such-op", _INITIAL_REVIEW)
    assert not forged.allowed and forged.code == "daily_limit_reached"
    assert forged.role != "continuation"


def test_continuation_from_another_user_is_rejected(guard):
    svc = guard["service"]
    # u_a holds an active build under a shared key.
    assert _pf(svc, "u_a", "shared-key", _PLAN).allowed
    # u_b has already spent their own daily allowance.
    pf_b0 = _pf(svc, "u_b", "b-key", _PLAN)
    svc.finalize(user_id="u_b", status="succeeded", operation_id=pf_b0.operation_id)
    # u_b presenting u_a's key cannot attach (continuation is per-user) → blocked at u_b's quota.
    stolen = _pf(svc, "u_b", "shared-key", _INITIAL_REVIEW)
    assert not stolen.allowed and stolen.code == "daily_limit_reached"
    assert stolen.role != "continuation"


def test_continuation_from_another_build_is_rejected(guard):
    svc = guard["service"]
    # u6 starts build A (active) and separately exhausts quota is impossible (1/day), so use a
    # SECOND user to prove a different-build key never attaches to the active op.
    assert _pf(svc, "u6", "build-A-key", _PLAN).allowed
    # A sub-call for the SAME user carrying a DIFFERENT build key is a new build attempt → the
    # concurrency lock (A is running) blocks it as operation_in_progress, never a silent attach.
    other = _pf(svc, "u6", "build-B-key", "[BUILD] second concurrent build")
    assert not other.allowed and other.code == "operation_in_progress"
    assert other.role != "continuation"


def test_expired_parent_op_does_not_attach(guard):
    svc, store = guard["service"], guard["store"]
    pf = _pf(svc, "u7", "k7", _PLAN)
    assert pf.allowed
    # Simulate the parent op aging past its TTL (the exact pre-fix failure). The fix LENGTHENS the
    # TTL so this does not happen mid-build — it does NOT disable expiry, which this proves.
    with store._conn() as c:
        c.execute("UPDATE ai_operations SET expires_at=? WHERE operation_id=?",
                  (_time.time() - 5, pf.operation_id))
    sub = _pf(svc, "u7", "k7", _INITIAL_REVIEW)
    assert not sub.allowed and sub.code == "daily_limit_reached"
    assert sub.role != "continuation"


def test_owner_and_normal_use_the_same_continuation_path(guard):
    svc, P = guard["service"], guard["policy"]
    # After authorization the pipeline is identical: owner sub-calls also attach as continuations
    # (no per-call re-charge), and the owner is NOT special-cased in the continuation logic.
    K = "op-owner-build"
    assert _pf(svc, "u_own", K, _PLAN, is_owner=True).allowed
    for msg in (_GEN, _INITIAL_REVIEW, _REPAIR, _FINAL_REVIEW):
        pf = _pf(svc, "u_own", K, msg, is_owner=True)
        assert pf.allowed and pf.role == "continuation"
    # Global spend still reserved once for the owner too (owner is exempt only from the daily quota).
    assert store_reserved(guard) > 0


def store_reserved(guard):
    P = guard["policy"]
    return guard["store"].global_spend(P.utc_window())["reservedUsd"]
