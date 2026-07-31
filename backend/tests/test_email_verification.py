# coding: utf-8
"""
Tests — email verification identity gate + starter-credit trigger.

Covers the verification store/service (single-use token, atomic consume,
expiry, concurrency), the grant-on-verify trigger (exactly once, idempotent),
the OAuth verified/unverified/guest paths, and the require_verified_identity
guard. No network. The credit ledger + auth.db are isolated per test.
"""
from __future__ import annotations

import threading

import pytest

from backend.core.config import settings
from backend.services.auth import verification as ver
from backend.services.billing.credits import service as credits
from backend.services.billing.credits import store as credits_store


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    # Credits ON so the grant is observable; verification tables in a temp db.
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "true")
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    credits_store._reset_for_tests()
    ver._INITIALIZED = False
    ver.init()
    yield
    credits_store._reset_for_tests()
    ver._INITIALIZED = False


# ── Unverified on creation, no credits before verification ─────────────────────

def test_new_account_is_unverified_and_ungranted():
    uid = "u_new"
    ver.record_pending(uid, "a@example.com")
    assert ver.is_verified(uid) is False
    assert credits.get_balance(uid) == 0            # NO starter credits yet


# ── Valid token verifies once and grants exactly 20 ────────────────────────────

def test_valid_token_verifies_and_grants_once():
    uid = "u_ok"
    ver.record_pending(uid, "b@example.com")
    raw = ver.issue_token(uid, "b@example.com")
    res = ver.consume_token(raw)
    assert res.status == "verified"
    assert ver.is_verified(uid) is True
    assert credits.get_balance(uid) == 20


# ── Token replay grants no extra credits ───────────────────────────────────────

def test_token_replay_is_single_use_and_no_extra_credit():
    uid = "u_replay"
    ver.record_pending(uid, "c@example.com")
    raw = ver.issue_token(uid, "c@example.com")
    assert ver.consume_token(raw).status == "verified"
    second = ver.consume_token(raw)               # replay
    assert second.status == "already_used"
    assert credits.get_balance(uid) == 20         # still exactly 20


# ── Invalid + expired tokens fail safely ───────────────────────────────────────

def test_invalid_token_is_rejected():
    res = ver.consume_token("not-a-real-token")
    assert res.status == "invalid"


def test_expired_token_is_rejected(monkeypatch):
    uid = "u_exp"
    ver.record_pending(uid, "d@example.com")
    raw = ver.issue_token(uid, "d@example.com")
    # Force the stored token to be already expired.
    with ver._conn() as c:
        c.execute(
            "UPDATE auth_email_verification_tokens SET expires_at = ? WHERE user_id = ?",
            ("2000-01-01T00:00:00+00:00", uid),
        )
    res = ver.consume_token(raw)
    assert res.status == "expired"
    assert ver.is_verified(uid) is False
    assert credits.get_balance(uid) == 0


# ── Concurrent confirmation grants exactly once ────────────────────────────────

def test_concurrent_confirm_grants_once():
    uid = "u_race"
    ver.record_pending(uid, "e@example.com")
    raw = ver.issue_token(uid, "e@example.com")

    results = []
    lock = threading.Lock()
    barrier = threading.Barrier(12)

    def worker():
        barrier.wait()
        r = ver.consume_token(raw)
        with lock:
            results.append(r.status)

    threads = [threading.Thread(target=worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count("verified") == 1          # exactly one winner
    assert all(s in ("verified", "already_used") for s in results)
    assert credits.get_balance(uid) == 20          # granted once, never negative growth


# ── Resend cooldown ────────────────────────────────────────────────────────────

def test_resend_cooldown_after_issue(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SEC", 60, raising=False)
    uid = "u_cd"
    ver.record_pending(uid, "f@example.com")
    assert ver.send_cooldown_remaining(uid) == 0   # nothing issued yet
    ver.issue_token(uid, "f@example.com")
    assert ver.send_cooldown_remaining(uid) > 0    # cooldown active right after


def test_hourly_cap_forces_wait(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR", 3, raising=False)
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SEC", 0, raising=False)
    uid = "u_cap"
    ver.record_pending(uid, "g@example.com")
    for _ in range(3):
        ver.issue_token(uid, "g@example.com")
    assert ver.send_cooldown_remaining(uid) == 3600   # capped


# ── OAuth verified → grant once; already-verified → no double grant ────────────

def test_oauth_verified_marks_and_grants_once():
    uid = "u_oauth"
    # Simulates the /auth/google path after a provider-verified login.
    t1 = ver.mark_verified(uid, "h@example.com", source="oauth_google")
    t2 = ver.mark_verified(uid, "h@example.com", source="oauth_google")  # next login
    assert t1 is True and t2 is False              # transition only once
    assert credits.get_balance(uid) == 20          # granted exactly once


def test_unverified_identity_never_marked_gets_no_grant():
    # An account we never mark verified (e.g. Google email_verified=false is
    # rejected upstream, so mark_verified is never called) stays ungranted.
    uid = "u_unver"
    ver.record_pending(uid, "i@example.com")
    assert credits.get_balance(uid) == 0


# ── Grant gated by the ledger flag (dormant when off) ──────────────────────────

def test_grant_dormant_when_credits_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "false")
    uid = "u_dorm"
    ver.record_pending(uid, "j@example.com")
    raw = ver.issue_token(uid, "j@example.com")
    assert ver.consume_token(raw).status == "verified"   # verification still works
    assert credits.get_balance(uid) == 0                 # but no grant while dormant


# ── require_verified_identity guard ────────────────────────────────────────────

class _FakePrincipal:
    def __init__(self, *, authenticated, owner=False, uid="p1"):
        self._auth = authenticated
        self._owner = owner
        self.user_id = uid
        self.email = "z@example.com"

    @property
    def is_authenticated(self):
        return self._auth

    @property
    def is_owner(self):
        return self._owner


def _patch_principal(monkeypatch, principal):
    import backend.core.principal as pr
    monkeypatch.setattr(pr, "resolve_principal", lambda request: principal)


def test_guard_passthrough_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", False, raising=False)
    _patch_principal(monkeypatch, _FakePrincipal(authenticated=False))
    from backend.core.deps import require_verified_identity
    # Disabled → never raises, even for a guest.
    assert require_verified_identity(object()) is not None


def test_guard_blocks_unverified_and_allows_verified(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    from backend.core.deps import require_verified_identity, VerificationRequiredError
    from backend.services.auth.errors import MissingTokenError

    # Guest → 401.
    _patch_principal(monkeypatch, _FakePrincipal(authenticated=False))
    with pytest.raises(MissingTokenError):
        require_verified_identity(object())

    # Authenticated but unverified → 403 VERIFICATION_REQUIRED.
    _patch_principal(monkeypatch, _FakePrincipal(authenticated=True, uid="u_guard"))
    with pytest.raises(VerificationRequiredError):
        require_verified_identity(object())

    # Owner bypass (never lock the operator out).
    _patch_principal(monkeypatch, _FakePrincipal(authenticated=True, owner=True))
    assert require_verified_identity(object()) is not None

    # Verified user passes.
    ver.mark_verified("u_guard", "z@example.com", source="test")
    _patch_principal(monkeypatch, _FakePrincipal(authenticated=True, uid="u_guard"))
    assert require_verified_identity(object()) is not None


# ── Route contract (envelope, auth gating, enumeration-safety) ─────────────────

def _client():
    from fastapi import FastAPI
    from starlette.testclient import TestClient
    from backend.core.errors import install_api_error_handlers
    from backend.routes.v2_email_verification import router
    app = FastAPI()
    app.include_router(router)
    install_api_error_handlers(app)
    return TestClient(app)


def test_confirm_route_generic_200_for_invalid_token():
    c = _client()
    r = c.post("/v2/auth/email-verification/confirm", json={"token": "bogus"})
    assert r.status_code == 200                      # never errors/enumerate
    body = r.json()
    assert body["success"] is True
    assert body["data"]["status"] == "invalid"
    assert body["data"]["verified"] is False
    assert r.headers.get("Cache-Control", "").startswith("no-store")


def test_confirm_route_verifies_real_token():
    uid = "u_route"
    ver.record_pending(uid, "k@example.com")
    raw = ver.issue_token(uid, "k@example.com")
    c = _client()
    r = c.post("/v2/auth/email-verification/confirm", json={"token": raw})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "verified"


def test_status_and_send_require_auth():
    c = _client()
    # No bearer → guest → 401 for both (identity never taken from the body).
    assert c.get("/v2/auth/email-verification/status").status_code == 401
    assert c.post("/v2/auth/email-verification/send").status_code == 401
