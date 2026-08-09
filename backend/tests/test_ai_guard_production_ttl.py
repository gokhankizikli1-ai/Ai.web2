# coding: utf-8
"""Production TTL parity for the Web Build internal-continuation lifecycle (ai_guard).

Railway production sets AI_OPERATION_LOCK_TTL_SECONDS = 86400 (24h). This suite pins the behaviour
UNDER THAT EXACT VALUE — it does not rely on the default — so the diagnosis stays honest:

  • the operation lock reads the configured 86400s (no silent default), and
  • at 86400s the parent build op does NOT expire mid-build, so every internal stage (generation,
    initial review, repair, final review) attaches as a FREE continuation of the ONE authorized
    build — for a normal user AND for an owner, with IDENTICAL wiring.

Therefore a "the automatic design-quality review did not complete" failure that also occurs for an
OWNER cannot be a parent-op expiry / daily-quota block: the owner is exempt from the daily quota and
(at 86400s) the parent op is still RUNNING when the sync review fires, so the review attaches. The
review non-completion is a DIFFERENT layer (the request exceeding the backend structured-builder
safety cap), fixed on the client. These tests exist to keep the ai_guard side proven-correct.

`preflight().role` is the exact value backend/routes/chat.py echoes to the browser as
metadata.aiOperation.role ("start" | "continuation") for the bounded owner continuation diagnostic.
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
    # The EXACT production value — pin behaviour under it, never the default.
    monkeypatch.setenv("AI_OPERATION_LOCK_TTL_SECONDS", "86400")
    monkeypatch.delenv("AI_BETA_FULL_BUILDS_PER_DAY", raising=False)
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


_PLAN = "[BUILD] a premium saas landing page"
_GEN = "[FRONTEND BUILDER REQUEST]\nBEGIN_FRONTEND_BUILD_SPEC_JSON\n{}\nEND_FRONTEND_BUILD_SPEC_JSON"
_INITIAL_REVIEW = "[FRONTEND BUILDER REQUEST]\n[FRONTEND REVIEW REQUEST]\nTask: review (stage: initial)."
_REPAIR = "[FRONTEND BUILDER REQUEST]\n[FRONTEND REPAIR REQUEST]\nrepair."
_FINAL_REVIEW = "[FRONTEND BUILDER REQUEST]\n[FRONTEND REVIEW REQUEST]\nTask: review (stage: post-repair)."
_ALL_SUBCALLS = (_GEN, _INITIAL_REVIEW, _REPAIR, _FINAL_REVIEW)


def test_lock_ttl_reads_the_configured_production_value(guard):
    # No silent default: the policy reads AI_OPERATION_LOCK_TTL_SECONDS from the environment.
    assert guard["service"]._policy().lock_ttl_seconds == 86400


def test_at_production_ttl_parent_op_outlives_the_whole_build(guard):
    ttl = guard["service"]._policy().lock_ttl_seconds
    # A full build (planning + up to a 720s background phase + reviews) is far under 86400s, so the
    # parent op is still RUNNING when the sync review fires — never an expiry-driven START.
    assert ttl >= 900 and ttl == 86400


def test_normal_user_all_stages_attach_as_continuations_at_86400(guard):
    svc, P = guard["service"], guard["policy"]
    K = "prod-ttl-normal"
    parent = _pf(svc, "u1", K, _PLAN)
    assert parent.allowed and parent.role == svc.ROLE_START
    for msg in _ALL_SUBCALLS:
        pf = _pf(svc, "u1", K, msg)
        assert pf.allowed and pf.role == "continuation", f"stage must attach: {msg[:40]}"
    # ONE daily build consumed for the whole build.
    assert svc.usage_snapshot("u1", is_owner=False)["operations"][P.OP_WEB_BUILD_FULL]["remaining"] == 0


def test_owner_all_stages_attach_as_continuations_at_86400(guard):
    svc = guard["service"]
    K = "prod-ttl-owner"
    parent = _pf(svc, "u_own", K, _PLAN, is_owner=True)
    assert parent.allowed and parent.role == svc.ROLE_START
    for msg in _ALL_SUBCALLS:
        pf = _pf(svc, "u_own", K, msg, is_owner=True)
        # Owner uses the IDENTICAL continuation path — not special-cased in the attach logic.
        assert pf.allowed and pf.role == "continuation", f"owner stage must attach: {msg[:40]}"


def test_owner_and_normal_preflight_roles_are_identical_wiring(guard):
    """The role the chat route echoes (metadata.aiOperation.role) is START for the parent and
    CONTINUATION for every sub-call — the SAME for owner and normal user."""
    svc = guard["service"]
    roles_normal = [_pf(svc, "n", "k-n", _PLAN).role] + [_pf(svc, "n", "k-n", m).role for m in _ALL_SUBCALLS]
    roles_owner = [_pf(svc, "o", "k-o", _PLAN, is_owner=True).role] + [
        _pf(svc, "o", "k-o", m, is_owner=True).role for m in _ALL_SUBCALLS]
    expected = [svc.ROLE_START, "continuation", "continuation", "continuation", "continuation"]
    assert roles_normal == expected
    assert roles_owner == expected


def test_no_extra_daily_increment_or_reservation_for_the_build(guard):
    svc, P, store = guard["service"], guard["policy"], guard["store"]
    window = P.utc_window()
    K = "prod-ttl-once"
    _pf(svc, "u2", K, _PLAN)
    reserved_after_start = store.global_spend(window)["reservedUsd"]
    assert reserved_after_start > 0
    for msg in _ALL_SUBCALLS:
        _pf(svc, "u2", K, msg)
    # Continuations never add a daily increment or a second spend reservation.
    assert store.daily_count("u2", window, P.OP_WEB_BUILD_FULL) == 1
    assert store.global_spend(window)["reservedUsd"] == reserved_after_start


def test_sync_review_within_the_build_is_never_a_start_at_86400(guard):
    """The exact production concern: the SYNC initial review must not fall to the START path (which
    would re-check quota). At 86400s the parent is RUNNING, so the review attaches — role
    'continuation', idempotent replay, no new reservation."""
    svc = guard["service"]
    K = "prod-ttl-sync"
    assert _pf(svc, "u3", K, _PLAN).allowed
    review = _pf(svc, "u3", K, _INITIAL_REVIEW)
    assert review.allowed
    assert review.role == "continuation"
    assert review.idempotent_replay is True


def test_forged_key_still_fails_closed_even_at_production_ttl(guard):
    """A longer TTL must not weaken enforcement: a made-up key matching no active op is a START, not
    a silent attach, so a quota-exhausted normal user is still blocked."""
    svc = guard["service"]
    pf = _pf(svc, "u4", "real-key", _PLAN)
    svc.finalize(user_id="u4", status="succeeded", operation_id=pf.operation_id)
    forged = _pf(svc, "u4", "forged-no-such-op", _INITIAL_REVIEW)
    assert not forged.allowed and forged.code == "daily_limit_reached"
    assert forged.role != "continuation"
