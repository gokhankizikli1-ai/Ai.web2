# coding: utf-8
"""
Google OAuth integration tests.

Coverage:

  Token verifier
    test_verify_google_id_token_accepts_valid_payload
    test_verify_google_id_token_rejects_audience_mismatch
    test_verify_google_id_token_rejects_unverified_email
    test_verify_google_id_token_rejects_error_payload

  Route /auth/google
    test_auth_google_creates_user_and_issues_jwt
    test_auth_google_is_idempotent_for_same_email
    test_auth_google_annotates_is_owner_when_email_matches
    test_auth_google_does_not_flag_non_owner_emails
    test_auth_google_rejects_invalid_id_token

  End-to-end /auth/me with the issued JWT
    test_auth_me_after_google_login_returns_user
    test_auth_me_after_google_login_carries_owner_flag

The Google tokeninfo HTTP call is monkeypatched at the urllib level so
no network access is needed. That matches the auth.py implementation
which deliberately uses urllib for zero new pip deps.
"""
from __future__ import annotations

import importlib
import io
import json

import pytest
from fastapi.testclient import TestClient


# ──────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────

_OWNER_EMAIL = "owner@example.com"
_CLIENT_ID   = "test-client-id.apps.googleusercontent.com"


@pytest.fixture()
def auth_env(tmp_path, monkeypatch):
    """JWT_SECRET_KEY + AUTH_DB_PATH + OWNER_EMAIL + GOOGLE_CLIENT_ID."""
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-32-chars-minimum-zzz")
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth-google.db"))
    monkeypatch.setenv("OWNER_EMAIL", _OWNER_EMAIL)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", _CLIENT_ID)
    # Reset BOTH lazy-init flags (identity + passwords) so each module
    # creates its tables in the fresh tmp DB instead of the cached path.
    from backend.services.auth import storage as auth_storage
    from backend.services.auth import passwords as auth_passwords
    monkeypatch.setattr(auth_storage,   "_INITIALIZED", False, raising=False)
    monkeypatch.setattr(auth_passwords, "_INITIALIZED", False, raising=False)
    from backend.core import config as _cfg
    importlib.reload(_cfg)
    yield
    importlib.reload(_cfg)


def _fresh_app() -> TestClient:
    import sys
    for m in ("backend.api", "backend.main"):
        if m in sys.modules:
            del sys.modules[m]
    from backend.api import app
    return TestClient(app, raise_server_exceptions=False)


def _fake_tokeninfo(email: str, *, aud: str = _CLIENT_ID, verified: bool = True,
                    name: str = "Test User", sub: str = "google:1234"):
    """Build a fake Google tokeninfo response body."""
    return json.dumps({
        "iss":            "https://accounts.google.com",
        "aud":            aud,
        "sub":            sub,
        "email":          email,
        "email_verified": "true" if verified else "false",
        "name":           name,
    }).encode("utf-8")


def _patch_urlopen(monkeypatch, body: bytes):
    """Monkeypatch urllib.request.urlopen used inside _verify_google_id_token."""
    import urllib.request as _urlreq

    class _Resp:
        def __init__(self, data: bytes): self._data = data
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return self._data

    def _fake_urlopen(req, timeout=10):
        return _Resp(body)

    monkeypatch.setattr(_urlreq, "urlopen", _fake_urlopen)


# ──────────────────────────────────────────────────────────────────────────
# Token verifier
# ──────────────────────────────────────────────────────────────────────────

def test_verify_google_id_token_accepts_valid_payload(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("user@gmail.com"))
    from backend.routes.auth import _verify_google_id_token
    claims = _verify_google_id_token("fake-id-token")
    assert claims["email"] == "user@gmail.com"
    assert claims["name"] == "Test User"
    assert claims["sub"]  == "google:1234"


def test_verify_google_id_token_rejects_audience_mismatch(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("user@gmail.com", aud="other-app.googleusercontent.com"))
    from backend.routes.auth import _verify_google_id_token
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _verify_google_id_token("fake-id-token")
    assert exc_info.value.status_code == 401
    assert "audience" in str(exc_info.value.detail).lower()


def test_verify_google_id_token_rejects_unverified_email(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("u@gmail.com", verified=False))
    from backend.routes.auth import _verify_google_id_token
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _verify_google_id_token("fake")
    assert exc_info.value.status_code == 401


def test_verify_google_id_token_rejects_error_payload(auth_env, monkeypatch):
    bad = json.dumps({"error_description": "Token expired or bad"}).encode()
    _patch_urlopen(monkeypatch, bad)
    from backend.routes.auth import _verify_google_id_token
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _verify_google_id_token("fake")
    assert exc_info.value.status_code == 401


# ──────────────────────────────────────────────────────────────────────────
# Route /auth/google
# ──────────────────────────────────────────────────────────────────────────

def test_auth_google_creates_user_and_issues_jwt(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("alice@example.com"))
    client = _fresh_app()
    r = client.post("/auth/google", json={"id_token": "fake"})
    assert r.status_code == 200, r.text
    body = r.json()
    # Issued bearer matches the documented shape
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str) and body["access_token"].count(".") == 2
    assert body["user"]["email"] == "alice@example.com"
    assert body["user"]["kind"] == "google"
    assert body["user"]["is_owner"] is False  # not the OWNER_EMAIL


def test_auth_google_is_idempotent_for_same_email(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("alice@example.com"))
    client = _fresh_app()
    r1 = client.post("/auth/google", json={"id_token": "fake"})
    r2 = client.post("/auth/google", json={"id_token": "fake"})
    assert r1.status_code == r2.status_code == 200
    # Same user id across logins — the user row was reused, not duplicated
    assert r1.json()["user"]["id"] == r2.json()["user"]["id"]


def test_auth_google_annotates_is_owner_when_email_matches(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo(_OWNER_EMAIL))
    client = _fresh_app()
    r = client.post("/auth/google", json={"id_token": "fake"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == _OWNER_EMAIL
    # The is_owner flag from _annotate_owner() flips on the OWNER_EMAIL
    # match — the FE uses this to render the Owner Session chip
    # immediately after Google login.
    assert body["user"]["is_owner"] is True


def test_auth_google_does_not_flag_non_owner_emails(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("random@gmail.com"))
    client = _fresh_app()
    r = client.post("/auth/google", json={"id_token": "fake"})
    assert r.json()["user"]["is_owner"] is False


def test_auth_google_rejects_invalid_id_token(auth_env, monkeypatch):
    # Google returns an error payload (e.g. expired token).
    bad = json.dumps({"error_description": "Invalid Value"}).encode()
    _patch_urlopen(monkeypatch, bad)
    client = _fresh_app()
    r = client.post("/auth/google", json={"id_token": "fake"})
    assert r.status_code == 401


# ──────────────────────────────────────────────────────────────────────────
# End-to-end: /auth/me with the issued JWT
# ──────────────────────────────────────────────────────────────────────────

def test_auth_me_after_google_login_returns_user(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo("alice@example.com"))
    client = _fresh_app()
    issued = client.post("/auth/google", json={"id_token": "fake"}).json()
    token = issued["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["user"]["email"] == "alice@example.com"
    assert me.json()["user"]["kind"]  == "google"


def test_auth_me_after_google_login_carries_owner_flag(auth_env, monkeypatch):
    _patch_urlopen(monkeypatch, _fake_tokeninfo(_OWNER_EMAIL))
    client = _fresh_app()
    issued = client.post("/auth/google", json={"id_token": "fake"}).json()
    token = issued["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    body = me.json()
    assert body["user"]["is_owner"] is True
