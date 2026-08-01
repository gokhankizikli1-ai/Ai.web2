# coding: utf-8
"""
Tests — email-verification hardening deltas (on top of the base system):
  * resend supersedes prior active tokens; superseded token cannot verify/grant
  * registration per-IP rate limiting (+ abuse extension seam)
  * typed cooldown / rate-limited responses on POST /send
No network; auth.db + credit ledger isolated per test.
"""
from __future__ import annotations

import pytest

from backend.core.config import settings
from backend.services.auth import verification as ver
from backend.services.auth import abuse
from backend.services.billing.credits import service as credits
from backend.services.billing.credits import store as credits_store


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "true")
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    credits_store._reset_for_tests()
    ver._INITIALIZED = False
    ver.init()
    abuse._reset_for_tests()
    yield
    credits_store._reset_for_tests()
    ver._INITIALIZED = False
    abuse._reset_for_tests()


# ── Supersession ───────────────────────────────────────────────────────────────

def test_resend_supersedes_prior_token_only_newest_verifies():
    uid = "u_sup"
    ver.record_pending(uid, "a@example.com")
    old = ver.issue_token(uid, "a@example.com")
    new = ver.issue_token(uid, "a@example.com")     # supersedes `old`

    # The OLD link no longer works and grants nothing.
    r_old = ver.consume_token(old)
    assert r_old.status == "superseded"
    assert ver.is_verified(uid) is False
    assert credits.get_balance(uid) == 0

    # The NEW link verifies and grants exactly once.
    r_new = ver.consume_token(new)
    assert r_new.status == "verified"
    assert ver.is_verified(uid) is True
    assert credits.get_balance(uid) == 20


def test_superseded_token_after_verification_is_safe():
    uid = "u_sup2"
    ver.record_pending(uid, "b@example.com")
    old = ver.issue_token(uid, "b@example.com")
    new = ver.issue_token(uid, "b@example.com")
    assert ver.consume_token(new).status == "verified"
    # Old (superseded) token still cannot re-trigger anything.
    assert ver.consume_token(old).status == "superseded"
    assert credits.get_balance(uid) == 20


# ── Registration rate limiting + abuse seam ────────────────────────────────────

def test_registration_per_ip_cap(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REGISTER_MAX_PER_IP_HOUR", 2, raising=False)
    ip = "203.0.113.7"
    assert abuse.evaluate_registration(email="a@x.com", ip=ip).allowed is True
    assert abuse.evaluate_registration(email="b@x.com", ip=ip).allowed is True
    blocked = abuse.evaluate_registration(email="c@x.com", ip=ip)
    assert blocked.allowed is False
    assert blocked.reason == "ip_rate_limited"
    assert blocked.retry_after > 0
    # A different IP is unaffected.
    assert abuse.evaluate_registration(email="d@x.com", ip="203.0.113.8").allowed is True


def test_registration_no_ip_is_allowed():
    assert abuse.evaluate_registration(email="a@x.com", ip=None).allowed is True


# ── Typed send responses via the route ─────────────────────────────────────────

def _client():
    from fastapi import FastAPI
    from starlette.testclient import TestClient
    from backend.core.errors import install_api_error_handlers
    from backend.routes.v2_email_verification import router
    app = FastAPI()
    app.include_router(router)
    install_api_error_handlers(app)
    return TestClient(app)


class _FakePrincipal:
    def __init__(self, uid):
        self.user_id = uid
        self.email = "z@example.com"
    is_authenticated = True
    is_owner = False


def test_send_route_returns_429_on_cooldown(monkeypatch):
    uid = "u_cd_route"
    ver.record_pending(uid, "z@example.com")
    ver.issue_token(uid, "z@example.com")           # sets an active cooldown
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SEC", 60, raising=False)

    import backend.core.principal as pr
    monkeypatch.setattr(pr, "resolve_principal", lambda request: _FakePrincipal(uid))

    r = _client().post("/v2/auth/email-verification/send")
    assert r.status_code == 429
    body = r.json()
    assert body["metadata"]["code"] == "verification_cooldown"
    assert int(r.headers.get("Retry-After", "0")) > 0
    assert r.headers.get("Cache-Control", "").startswith("no-store")
