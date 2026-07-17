# coding: utf-8
"""
Web Build same-operation continuation through ai_guard — focused tests.

Reproduces the production failure (a builder sub-call arriving with NO operation
key is blocked as operation_in_progress) and proves the continuation contract:
same user + same protected family + same operation key reuses the ONE operation
(no second quota / reservation / lock), while a different key / user / terminal
op is correctly rejected — concurrency is never disabled.

No model calls, no Web Build generation.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def guard(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "guard.db"))
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_LIMIT_USD", "25")
    monkeypatch.setenv("AI_RATE_FULL_BUILD_PER_MIN", "100")   # isolate lock/quota from burst limit
    monkeypatch.setenv("AI_BETA_FULL_BUILDS_PER_DAY", "100")  # isolate lock/continuation from daily cap
    from backend.services.ai_guard import store as gstore
    importlib.reload(gstore)
    gstore.init()
    from backend.services.ai_guard import service as svc
    importlib.reload(svc)
    from backend.services.ai_guard import policy as P
    return {"svc": svc, "store": gstore, "P": P}


def _pf(guard, uid, key, *, op_type=None, msg="[WEB BUILD REQUEST]\nIdea: x", is_owner=False):
    P = guard["P"]
    return guard["svc"].preflight(user_id=uid, operation_type=(op_type or P.OP_WEB_BUILD_FULL),
                                  message=msg, idempotency_key=key, is_owner=is_owner)


def _reserved(guard):
    return guard["store"].global_spend(guard["P"].utc_window())["reservedUsd"]


def _daily(guard, uid):
    return guard["store"].daily_count(uid, guard["P"].utc_window(), guard["P"].OP_WEB_BUILD_FULL)


# ── PRODUCTION REPRO: missing key on a sub-call → wrongly blocked ────────────
def test_repro_missing_key_is_blocked(guard):
    start = _pf(guard, "42", "K1")
    assert start.allowed and start.role == "start"
    # The bug: the frontend generation call arrived with NO operation key.
    nokey = _pf(guard, "42", None, msg="[FRONTEND BUILDER REQUEST] spec")
    assert not nokey.allowed and nokey.code == "operation_in_progress"
    # The fix (frontend now sends the same key) → continuation, not a block:
    cont = _pf(guard, "42", "K1", msg="[FRONTEND BUILDER REQUEST] spec")
    assert cont.allowed and cont.role == "continuation"


# ── 1. first call creates one operation ──────────────────────────────────────
def test_first_call_creates_one_operation(guard):
    p = _pf(guard, "42", "K1")
    assert p.allowed and p.role == "start" and p.operation_id
    assert guard["store"].active_operations_count() == 1


# ── 2/3/4/5/6. same-key continuation reuses op; no 2nd reservation/quota/lock ─
def test_continuation_reuses_op_no_double_charge(guard):
    start = _pf(guard, "42", "K1")
    reserved0, daily0 = _reserved(guard), _daily(guard, "42")

    cont = _pf(guard, "42", "K1", msg="[FRONTEND BUILDER REQUEST] spec")
    assert cont.allowed
    assert cont.role == "continuation"
    assert cont.operation_id == start.operation_id          # (3) existing op id
    assert _reserved(guard) == reserved0                    # (4) no second reservation
    assert _daily(guard, "42") == daily0                    # (5) no second quota charge
    assert guard["store"].active_operations_count() == 1    # (6) no second lock


# ── 7. same user + different key → operation_in_progress ─────────────────────
def test_different_key_blocked(guard):
    _pf(guard, "42", "K1")
    other = _pf(guard, "42", "K2", msg="[WEB BUILD REQUEST]\nIdea: another")
    assert not other.allowed and other.code == "operation_in_progress"


# ── 8. different user cannot reuse the key ───────────────────────────────────
def test_other_user_cannot_reuse_key(guard):
    a = _pf(guard, "42", "K1")
    b = _pf(guard, "99", "K1", msg="[FRONTEND BUILDER REQUEST] spec")
    # b is a fresh build for user 99 (its own op), NOT a continuation of 42's op.
    assert b.role == "start"
    assert b.operation_id != a.operation_id


# ── 10. terminal operation cannot be continued ───────────────────────────────
def test_terminal_operation_not_continued(guard):
    start = _pf(guard, "42", "K1")
    guard["svc"].finalize_operation(start.operation_id, "42", status="failed")
    # Same key after terminal → a NEW build starts (the terminal op is not revived).
    again = _pf(guard, "42", "K1", msg="[FRONTEND BUILDER REQUEST] spec")
    assert again.allowed and again.role == "start"
    assert again.operation_id != start.operation_id
    assert guard["store"].get_operation(start.operation_id)["status"] == "failed"


# ── 11. duplicate continuation is idempotent (one op, one reservation) ───────
def test_duplicate_continuation_idempotent(guard):
    _pf(guard, "42", "K1")
    reserved0 = _reserved(guard)
    for _ in range(4):
        c = _pf(guard, "42", "K1", msg="[FRONTEND BUILDER REQUEST] spec")
        assert c.allowed and c.role == "continuation"
    assert _reserved(guard) == reserved0
    assert guard["store"].active_operations_count() == 1


# ── 12. planning → visual → frontend generation reuse ONE operation ──────────
def test_full_flow_one_operation(guard):
    P = guard["P"]
    plan = _pf(guard, "42", "K1", op_type=P.OP_WEB_BUILD_FULL, msg="[WEB BUILD REQUEST]\nIdea: NexaNote")
    op = plan.operation_id
    for msg in ("[WEB BUILD REQUEST]\nIdea: NexaNote\nvisual",
                "[FRONTEND BUILDER REQUEST] spec",
                "[FRONTEND BUILDER REQUEST] repair"):
        c = _pf(guard, "42", "K1", op_type=P.OP_WEB_BUILD_FULL, msg=msg)
        assert c.allowed and c.role == "continuation" and c.operation_id == op
    assert _daily(guard, "42") == 1                          # charged once for the build
    assert guard["store"].active_operations_count() == 1


# ── 13. revision (small_edit) reuses the same build op via the same key ──────
def test_revision_reuses_operation(guard):
    P = guard["P"]
    start = _pf(guard, "42", "K1", op_type=P.OP_WEB_BUILD_FULL)
    rev = _pf(guard, "42", "K1", op_type=P.OP_WEB_BUILD_SMALL_EDIT,
              msg="[FRONTEND REVISION REQUEST] change")
    assert rev.allowed and rev.role == "continuation" and rev.operation_id == start.operation_id


# ── 14. genuinely active concurrent build still blocks ───────────────────────
def test_active_concurrency_still_blocks(guard):
    _pf(guard, "42", "K1")
    assert _pf(guard, "42", "K2", msg="[WEB BUILD REQUEST]\nIdea: two").code == "operation_in_progress"


# ── 15/16/17. global spend cap / kill switch / operation-disabled enforced ───
def test_global_spend_cap_enforced(guard, monkeypatch):
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_LIMIT_USD", "0.01")   # below full-build estimate
    p = _pf(guard, "42", "K1")
    assert not p.allowed and p.code == "global_spend_limit_reached"


def test_kill_switch_enforced(guard, monkeypatch):
    monkeypatch.setenv("AI_OPERATIONS_ENABLED", "false")
    p = _pf(guard, "42", "K1")
    assert not p.allowed and p.code == "ai_temporarily_disabled"


def test_operation_disabled_enforced(guard):
    P = guard["P"]
    # major_redesign is disabled by default.
    p = _pf(guard, "42", "K1", op_type=P.OP_WEB_BUILD_MAJOR_REDESIGN, msg="[REDESIGN]")
    assert not p.allowed and p.code == "operation_disabled"


# ── 18. normal-user daily build quota charged once per build ─────────────────
def test_normal_user_charged_once_per_build(guard):
    _pf(guard, "42", "K1")            # start (charges 1)
    _pf(guard, "42", "K1", msg="[FRONTEND BUILDER REQUEST] spec")   # continuation (0)
    assert _daily(guard, "42") == 1


# ── 19. owner continuation works + unlimited behaviour unchanged ─────────────
def test_owner_continuation(guard):
    start = _pf(guard, "owner1", "K1", is_owner=True)
    cont = _pf(guard, "owner1", "K1", is_owner=True, msg="[FRONTEND BUILDER REQUEST] spec")
    assert start.allowed and cont.allowed and cont.role == "continuation"
    assert cont.operation_id == start.operation_id


# ── 20. lock release (#482 canonical finalizer) still works after continuation ─
def test_finalize_after_continuation_releases_lock(guard):
    start = _pf(guard, "42", "K1")
    _pf(guard, "42", "K1", msg="[FRONTEND BUILDER REQUEST] spec")   # continuation
    res = guard["svc"].finalize_operation(start.operation_id, "42", status="failed")
    assert res["operation_finalized"] is True and res["lock_released"] is True
    # a fresh build can start immediately (raised rate limit in fixture)
    assert _pf(guard, "42", "K9", msg="[WEB BUILD REQUEST]\nIdea: fresh").role == "start"
