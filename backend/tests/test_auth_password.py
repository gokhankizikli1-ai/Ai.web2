# coding: utf-8
"""
Phase 3b — email + password auth (additive, self-contained).

Exercises /auth/signup, /auth/login, /auth/me, /auth/logout via the real
app, and regression-guards that the new router did NOT break /auth/status
or /health. No network / OpenAI key needed.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def pw_db(tmp_auth_db, monkeypatch):
    """tmp_auth_db points AUTH_DB_PATH at a temp file + sets a test
    JWT_SECRET_KEY and resets storage._INITIALIZED. The new passwords
    module has its own lazy-init flag — reset it too so the table is
    created in the temp db."""
    from backend.services.auth import passwords
    monkeypatch.setattr(passwords, "_INITIALIZED", False, raising=False)
    yield tmp_auth_db


def _signup(client, email="user@example.com", pw="supersecret1"):
    return client.post("/auth/signup", json={"email": email, "password": pw})


def test_signup_returns_token_and_user(client, pw_db):
    r = _signup(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 24 * 3600
    assert body["access_token"]
    assert body["user"]["email"] == "user@example.com"
    assert body["user"]["kind"] == "email"
    assert "password" not in r.text and "password_hash" not in r.text


def test_signup_duplicate_email_409(client, pw_db):
    assert _signup(client).status_code == 201
    r = _signup(client)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "email_exists"


@pytest.mark.parametrize("email,pw,code", [
    ("not-an-email", "supersecret1", "validation_error"),
    ("a@b.co", "short", "validation_error"),
])
def test_signup_validation(client, pw_db, email, pw, code):
    r = client.post("/auth/signup", json={"email": email, "password": pw})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == code


def test_login_ok_and_wrong_password(client, pw_db):
    _signup(client)
    ok = client.post("/auth/login", json={"email": "user@example.com", "password": "supersecret1"})
    assert ok.status_code == 200
    ok_body = ok.json()
    assert ok_body["access_token"]
    # login response must reflect the just-written last_login_at and be
    # consistent with GET /auth/me (same source).
    assert ok_body["user"]["last_login_at"] is not None
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {ok_body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["last_login_at"] == ok_body["user"]["last_login_at"]

    bad = client.post("/auth/login", json={"email": "user@example.com", "password": "wrongpass1"})
    assert bad.status_code == 401
    assert bad.json()["detail"]["code"] == "invalid_credentials"

    unknown = client.post("/auth/login", json={"email": "nope@example.com", "password": "whatever1"})
    assert unknown.status_code == 401
    assert unknown.json()["detail"]["code"] == "invalid_credentials"


def test_me_requires_valid_bearer(client, pw_db):
    token = _signup(client).json()["access_token"]

    ok = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200
    assert ok.json()["user"]["email"] == "user@example.com"

    missing = client.get("/auth/me")
    assert missing.status_code == 401
    assert missing.json()["detail"]["code"] == "missing_token"

    bad = client.get("/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert bad.status_code == 401
    assert bad.json()["detail"]["code"] == "invalid_token"


def test_logout_is_forgiving_200(client, pw_db):
    assert client.post("/auth/logout").json()["ok"] is True
    token = _signup(client).json()["access_token"]
    r = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_no_regression_status_and_health(client, pw_db):
    s = client.get("/auth/status")
    assert s.status_code == 200 and s.json() == {"authenticated": False}
    h = client.get("/health")
    assert h.status_code == 200 and h.json().get("status") == "ok"
