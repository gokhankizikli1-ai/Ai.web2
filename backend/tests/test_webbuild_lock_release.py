# coding: utf-8
"""
Terminal Web Build lifecycle → ai_guard lock release — focused tests.

Proves that any terminal Web Build outcome immediately finalizes the exact
matching ai_guard operation (release lock + reconcile reservation) so the user
can retry without waiting for the 600s TTL, while genuine active concurrency,
daily quota, global spend and owner behaviour stay unchanged.

No model calls, no Web Build generation.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "guard.db"))
    monkeypatch.setenv("AI_GLOBAL_DAILY_SPEND_LIMIT_USD", "25")
    monkeypatch.setenv("AI_OPERATION_LOCK_TTL_SECONDS", "600")
    # Isolate the LOCK behaviour under test from the OTHER (legitimate) guards:
    # raise the submission-burst rate limit and the daily quota so a
    # retry-after-failure is blocked ONLY by a still-held lock if the fix is wrong.
    # (daily_limit_reached / rate_limited are separately-tested legitimate blocks.)
    monkeypatch.setenv("AI_RATE_FULL_BUILD_PER_MIN", "100")
    monkeypatch.setenv("AI_BETA_FULL_BUILDS_PER_DAY", "50")
    from backend.services.cost_tracking import store as cstore
    importlib.reload(cstore)
    from backend.services.cost_tracking import tracker as ctrack
    importlib.reload(ctrack)
    cstore._reset_for_tests()
    from backend.services.ai_guard import store as gstore
    importlib.reload(gstore)
    gstore.init()
    from backend.services.ai_guard import service as guard
    importlib.reload(guard)
    from backend.routes import chat as chatmod
    importlib.reload(chatmod)
    from backend.services.ai_guard import policy as P
    return {"cstore": cstore, "ctrack": ctrack, "gstore": gstore,
            "guard": guard, "chat": chatmod, "P": P}


def _start(env, uid, key, msg="[BUILD] app"):
    return env["guard"].preflight(user_id=uid, operation_type=env["P"].OP_WEB_BUILD_FULL,
                                  message=msg, idempotency_key=key)


def _seed_build(env, build_id, uid):
    from datetime import datetime, timezone
    env["cstore"].upsert_build(build_id=build_id, user_id=uid,
                               started_at=datetime.now(timezone.utc).isoformat())


def _terminal(env, build_id, uid, *, ok, status, job_id=None, **kw):
    env["chat"]._record_web_build_frontend_terminal(
        build_id=build_id, user_id=uid, provider="openai", model="gpt-5.6",
        ok=ok, execution_status=status, job_id=job_id, **kw)


# ── 1/2/3. terminal failure finalizes op, releases lock, retry immediately ───
@pytest.mark.parametrize("status", ["failed", "cancelled", "expired", "incomplete", "timed_out"])
def test_terminal_failure_releases_lock_and_allows_retry(env, status):
    pf = _start(env, "42", "k1")
    assert pf.allowed
    bid = pf.operation_id
    _seed_build(env, bid, "42")
    # concurrency still blocks a second build WHILE running
    assert _start(env, "42", "k2").code == "operation_in_progress"

    _terminal(env, bid, "42", ok=False, status=status, error_kind="server_error")
    assert env["gstore"].get_operation(bid)["status"] in ("failed", "cancelled",
                                                           "failed_ambiguous", "expired")
    assert env["cstore"].get_build_row(bid)["status"] == "failed"
    # immediate retry is ALLOWED with a NEW operation id — not operation_in_progress
    pf3 = _start(env, "42", "k3")
    assert pf3.allowed, f"retry after {status} should be allowed"
    assert pf3.operation_id != bid


# ── 4. terminal success finalizes op + releases lock ─────────────────────────
def test_terminal_success_finalizes_and_releases(env):
    pf = _start(env, "42", "k1")
    bid = pf.operation_id
    _seed_build(env, bid, "42")
    _terminal(env, bid, "42", ok=True, status="completed",
              input_tokens=8000, output_tokens=20000, total_tokens=28000)
    op = env["gstore"].get_operation(bid)
    assert op["status"] == "succeeded"
    assert op["reservation_open"] == 0
    assert env["cstore"].get_build_row(bid)["status"] == "completed"
    assert _start(env, "42", "k2").allowed        # lock released → retry allowed


# ── 7. explicit cancel finalizes/cancels operation ──────────────────────────
def test_cancel_terminal_releases_lock(env):
    pf = _start(env, "42", "k1")
    bid = pf.operation_id
    _seed_build(env, bid, "42")
    env["ctrack"].link_background_job(job_id="jc", build_id=bid, user_id="42")
    _terminal(env, bid, "42", ok=False, status="cancelled", job_id="jc",
              error_kind="cancelled")
    assert env["gstore"].get_operation(bid)["status"] in ("cancelled", "failed")
    assert _start(env, "42", "k2").allowed


# ── 9/10/11. idempotent — repeated terminal reconciles spend once ────────────
def test_repeated_terminal_is_idempotent(env):
    pf = _start(env, "42", "k1")
    bid = pf.operation_id
    _seed_build(env, bid, "42")
    env["ctrack"].link_background_job(job_id="jr", build_id=bid, user_id="42")
    win = env["P"].utc_window()
    _terminal(env, bid, "42", ok=False, status="failed", job_id="jr")
    reserved_after_first = env["gstore"].global_spend(win)["reservedUsd"]
    for _ in range(3):
        _terminal(env, bid, "42", ok=False, status="failed", job_id="jr")
    assert env["gstore"].global_spend(win)["reservedUsd"] == reserved_after_first
    # exactly one frontend-generation call recorded (claim gate)
    calls = [c for c in env["ctrack"].get_build(bid)["calls"]
             if c["operation_type"] == "web_build_frontend_generation"]
    assert len(calls) == 1


# ── 11. spend reservation reconciled once (reserved → 0 on failure) ──────────
def test_spend_reconciled_on_failure(env):
    pf = _start(env, "42", "k1")
    bid = pf.operation_id
    win = env["P"].utc_window()
    assert env["gstore"].global_spend(win)["reservedUsd"] > 0   # reserved at start
    _seed_build(env, bid, "42")
    _terminal(env, bid, "42", ok=False, status="failed")
    assert env["gstore"].global_spend(win)["reservedUsd"] == 0.0
    assert env["gstore"].get_operation(bid)["reservation_open"] == 0


# ── 13/14. unrelated op untouched; wrong user rejected ───────────────────────
def test_unrelated_operation_untouched(env):
    a = _start(env, "42", "ka")
    b = _start(env, "99", "kb")
    _seed_build(env, a.operation_id, "42")
    _terminal(env, a.operation_id, "42", ok=False, status="failed")
    assert env["gstore"].get_operation(a.operation_id)["status"] == "failed"
    assert env["gstore"].get_operation(b.operation_id)["status"] == "running"  # untouched


def test_wrong_user_does_not_finalize(env):
    pf = _start(env, "42", "k1")
    bid = pf.operation_id
    # A terminal recorded under the WRONG user must not finalize the real op.
    res = env["guard"].finalize_operation(bid, "999", status="failed")
    assert res["found"] is False
    assert env["gstore"].get_operation(bid)["status"] == "running"


# ── 15. genuinely active concurrent build still blocks ───────────────────────
def test_active_concurrency_still_blocks(env):
    _start(env, "42", "k1")
    assert _start(env, "42", "k2").code == "operation_in_progress"


# ── 5/6. immediate + background-poll failure both finalize (helper is shared) ─
def test_immediate_and_poll_share_one_finalizer(env):
    # immediate (no job_id)
    p1 = _start(env, "42", "k1")
    _seed_build(env, p1.operation_id, "42")
    _terminal(env, p1.operation_id, "42", ok=False, status="failed")   # immediate
    assert env["gstore"].get_operation(p1.operation_id)["status"] == "failed"
    # background poll (with job_id) — new build
    p2 = _start(env, "42", "k2")
    _seed_build(env, p2.operation_id, "42")
    env["ctrack"].link_background_job(job_id="j2", build_id=p2.operation_id, user_id="42")
    _terminal(env, p2.operation_id, "42", ok=False, status="incomplete", job_id="j2")
    assert env["gstore"].get_operation(p2.operation_id)["status"] == "failed"


# ── 16/17/18. global spend + quota + owner policy unchanged ──────────────────
def test_policy_unchanged(env):
    P = env["P"]
    pol = P.FounderBetaPolicy({})
    before = (pol.global_spend_limit_usd, pol.ai_operations_enabled,
              pol.limit_for(P.OP_WEB_BUILD_FULL).daily_per_user,
              pol.limit_for(P.OP_WEB_BUILD_FULL).max_concurrent_per_user)
    pf = _start(env, "42", "k1")
    _seed_build(env, pf.operation_id, "42")
    _terminal(env, pf.operation_id, "42", ok=False, status="failed")
    pol2 = P.FounderBetaPolicy({})
    after = (pol2.global_spend_limit_usd, pol2.ai_operations_enabled,
             pol2.limit_for(P.OP_WEB_BUILD_FULL).daily_per_user,
             pol2.limit_for(P.OP_WEB_BUILD_FULL).max_concurrent_per_user)
    assert before == after


def test_daily_counter_not_refunded(env):
    pf = _start(env, "42", "k1")
    win = env["P"].utc_window()
    used_before = env["gstore"].daily_count("42", win, env["P"].OP_WEB_BUILD_FULL)
    _seed_build(env, pf.operation_id, "42")
    _terminal(env, pf.operation_id, "42", ok=False, status="failed")
    assert env["gstore"].daily_count("42", win, env["P"].OP_WEB_BUILD_FULL) == used_before


# ── 19. stale reaper still delegates to the canonical finalizer ──────────────
def test_reaper_still_functional(env):
    pf = _start(env, "42", "k1")
    res = env["guard"].reap_stale_operation(pf.operation_id, "42")
    assert res["operation_finalized"] is True
    assert env["gstore"].get_operation(pf.operation_id)["status"] == "cancelled"


# ── 20. no prompts/source/secrets persisted by the terminal recorder ─────────
def test_no_sensitive_fields_persisted(env):
    pf = _start(env, "42", "k1")
    bid = pf.operation_id
    _seed_build(env, bid, "42")
    _terminal(env, bid, "42", ok=False, status="failed", error_kind="server_error",
              error_code="500", error_message="upstream error")
    c = [x for x in env["ctrack"].get_build(bid)["calls"]
         if x["operation_type"] == "web_build_frontend_generation"][0]
    allowed = {
        "call_id", "build_id", "user_id", "provider", "model", "operation_type",
        "request_started_at", "request_completed_at", "success", "retry_number",
        "input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_tokens",
        "reasoning_tokens", "total_tokens", "usage_missing",
        "input_cost_usd", "output_cost_usd", "cache_cost_usd",
        "additional_tool_cost_usd", "total_call_cost_usd",
        "error_code", "error_kind", "error_message", "request_id",
        "tool_key", "tool_units", "duration_ms", "created_at",
    }
    assert set(c.keys()).issubset(allowed)
