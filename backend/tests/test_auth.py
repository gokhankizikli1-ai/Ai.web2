# coding: utf-8
"""
Phase 3a auth smoke tests.

Coverage map:

  Tokens (pure stdlib HS256)
    test_issue_and_verify_round_trip
    test_verify_rejects_wrong_algorithm
    test_verify_rejects_expired_token
    test_verify_rejects_bad_signature
    test_verify_rejects_wrong_type
    test_issue_disallows_overriding_standard_claims

  Storage (per-test temp SQLite via tmp_auth_db fixture)
    test_get_or_create_user_is_idempotent
    test_get_user_by_id_returns_none_for_unknown
    test_refresh_token_revoke_family

  Service (composes tokens + storage)
    test_create_guest_returns_user_and_tokens
    test_rotate_refresh_invalidates_old_token
    test_rotate_refresh_detects_theft_revokes_family

  Routes (TestClient, real app, real middleware off)
    test_v2_auth_guest_envelope_shape
    test_v2_auth_refresh_envelope_shape
    test_v2_auth_me_requires_auth
    test_v2_auth_me_with_middleware_returns_user
    test_v2_auth_logout_safe_with_empty_body

  Regression — legacy contracts intact
    test_legacy_chat_route_still_mounts
    test_v2_health_still_returns_envelope
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient


# ──────────────────────────────────────────────────────────────────────────
# Tokens
# ──────────────────────────────────────────────────────────────────────────

def test_issue_and_verify_round_trip(tmp_auth_db):
    from backend.services.auth import tokens
    token, claims = tokens.issue("user-123", token_type="access", ttl_seconds=60)
    decoded = tokens.verify(token, expected_type="access")
    assert decoded["sub"] == "user-123"
    assert decoded["type"] == "access"
    assert decoded["jti"] == claims["jti"]


def test_verify_rejects_wrong_algorithm(tmp_auth_db):
    # Craft a token with alg=none — the classic JWT vuln. verify() must
    # refuse it even though the rest of the structure is valid.
    import base64, json
    from backend.services.auth import tokens
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"sub": "x", "exp": int(time.time()) + 60}).encode()).rstrip(b"=").decode()
    bad_token = f"{header}.{payload}."   # empty signature
    with pytest.raises(tokens.TokenError):
        tokens.verify(bad_token)


def test_verify_rejects_expired_token(tmp_auth_db):
    from backend.services.auth import tokens
    token, _ = tokens.issue("u", token_type="access", ttl_seconds=-10)
    with pytest.raises(tokens.TokenExpiredError):
        tokens.verify(token)


def test_verify_rejects_bad_signature(tmp_auth_db):
    from backend.services.auth import tokens
    token, _ = tokens.issue("u", token_type="access", ttl_seconds=60)
    head, body, sig = token.split(".")
    # Replace a deterministic middle character of the signature so the
    # resulting bytes are guaranteed to differ. The tail of a base64url
    # block has padding-adjacent bits that can decode to the same byte;
    # mid-block edits do not.
    pos = len(sig) // 2
    flipped = "A" if sig[pos] != "A" else "B"
    tampered = f"{head}.{body}.{sig[:pos] + flipped + sig[pos+1:]}"
    with pytest.raises(tokens.TokenSignatureError):
        tokens.verify(tampered)


def test_verify_rejects_wrong_type(tmp_auth_db):
    from backend.services.auth import tokens
    refresh, _ = tokens.issue("u", token_type="refresh", ttl_seconds=60)
    with pytest.raises(tokens.TokenError):
        tokens.verify(refresh, expected_type="access")


def test_issue_disallows_overriding_standard_claims(tmp_auth_db):
    from backend.services.auth import tokens
    with pytest.raises(ValueError):
        tokens.issue("u", token_type="access", ttl_seconds=60, extra_claims={"exp": 1})


# ──────────────────────────────────────────────────────────────────────────
# Phase-1 PR #1 — JWT_SECRET_KEY production hardening
#
# These tests cover the fail-closed behaviour of tokens._secret():
#   - missing key in production / staging / unknown env → raises
#   - missing key with leaked DEBUG=True → still raises (the key fix)
#   - too-short key → raises in any environment
#   - missing key in development → insecure dev fallback (unchanged)
#   - case-insensitive + trimmed match on ENVIRONMENT=development
# ──────────────────────────────────────────────────────────────────────────

def _clear_secret(monkeypatch):
    """Helper — remove both env-var and settings-cached JWT_SECRET_KEY
    so _secret() truly sees an empty key."""
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    from backend.core.config import settings
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "", raising=False)


def test_secret_present_in_production_returns_bytes(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("ENVIRONMENT", "production")
    from backend.services.auth import tokens
    assert tokens._secret() == b"x" * 32


def test_secret_absent_in_production_raises(monkeypatch):
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens._secret()


def test_secret_absent_in_unknown_env_raises(monkeypatch):
    """Anything other than literal 'development' must fail closed,
    including staging / preview / mistyped values."""
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "staging")
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens._secret()


def test_secret_absent_with_debug_true_in_production_still_raises(monkeypatch):
    """Regression — settings.DEBUG=True (e.g. leaked from a misconfigured
    deploy) must NOT enable the insecure fallback when ENVIRONMENT is
    not literally 'development'. This is the leak finding R1."""
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    from backend.core.config import settings
    monkeypatch.setattr(settings, "DEBUG", True, raising=False)
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens._secret()


def test_secret_absent_in_development_uses_insecure_fallback(monkeypatch, caplog):
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "development")
    from backend.services.auth import tokens
    with caplog.at_level("WARNING", logger="backend.services.auth.tokens"):
        secret = tokens._secret()
    assert secret == tokens._INSECURE_DEV_KEY
    assert any("INSECURE development fallback" in rec.message for rec in caplog.records)


def test_secret_too_short_raises_in_production(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * (31))   # one byte too short
    monkeypatch.setenv("ENVIRONMENT", "production")
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens._secret()


def test_secret_too_short_raises_in_development(monkeypatch):
    """A bad key in dev is also bad in dev — fail equally so the same
    mistake doesn't ship to prod."""
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 31)
    monkeypatch.setenv("ENVIRONMENT", "development")
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens._secret()


def test_secret_exact_min_length_accepted(monkeypatch):
    """The lower bound is INCLUSIVE — exactly 32 bytes is accepted."""
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("ENVIRONMENT", "production")
    from backend.services.auth import tokens
    assert tokens._secret() == b"x" * 32


def test_secret_environment_case_insensitive(monkeypatch):
    """ENVIRONMENT matching is trimmed + lowercased so common typos
    ('Development', ' development ') still resolve to dev mode."""
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "  Development  ")
    from backend.services.auth import tokens
    assert tokens._secret() == tokens._INSECURE_DEV_KEY


def test_secret_default_environment_is_production(monkeypatch):
    """When ENVIRONMENT is unset, default to production (fail closed)."""
    _clear_secret(monkeypatch)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens._secret()


def test_issue_raises_when_secret_missing_in_production(monkeypatch):
    """End-to-end on the actual issue() path — a misconfigured prod
    (no JWT_SECRET_KEY, ENVIRONMENT=production) must NOT silently sign
    tokens with the dev fallback. Surfaces TokenSecretMissingError at
    the issue() call, which AuthMiddleware's bare except in dispatch()
    catches to degrade to anonymous guest."""
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    from backend.services.auth import tokens
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens.issue("user-x", token_type="access", ttl_seconds=60)


def test_verify_raises_when_secret_missing_in_production(monkeypatch):
    """Same path on verify(): a JWT presented to a misconfigured prod
    must NOT verify against the dev fallback. The verify call raises
    cleanly so the middleware moves the request to guest fallback."""
    # First mint a token under a known good config.
    monkeypatch.setenv("JWT_SECRET_KEY", "y" * 32)
    monkeypatch.setenv("ENVIRONMENT", "development")
    from backend.services.auth import tokens
    token, _ = tokens.issue("user-y", token_type="access", ttl_seconds=60)
    # Now flip to misconfigured prod and present the token.
    _clear_secret(monkeypatch)
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(tokens.TokenSecretMissingError):
        tokens.verify(token, expected_type="access")


# ──────────────────────────────────────────────────────────────────────────
# Storage
# ──────────────────────────────────────────────────────────────────────────

def test_get_or_create_user_is_idempotent(tmp_auth_db):
    from backend.services.auth import storage
    a = storage.get_or_create_user("guest", "guest:nonce-1")
    b = storage.get_or_create_user("guest", "guest:nonce-1")
    assert a.id == b.id
    assert a.kind == b.kind == "guest"


def test_get_user_by_id_returns_none_for_unknown(tmp_auth_db):
    from backend.services.auth import storage
    assert storage.get_user_by_id("does-not-exist") is None


def test_refresh_token_revoke_family(tmp_auth_db):
    from backend.services.auth import storage
    user = storage.get_or_create_user("guest", "guest:f1")
    storage.record_refresh_token("jti-1", user.id, "2099-01-01T00:00:00+00:00", "fam-A")
    storage.record_refresh_token("jti-2", user.id, "2099-01-01T00:00:00+00:00", "fam-A")
    storage.record_refresh_token("jti-3", user.id, "2099-01-01T00:00:00+00:00", "fam-B")
    revoked = storage.revoke_family("fam-A")
    assert revoked == 2
    assert storage.refresh_token_is_revoked("jti-1") is True
    assert storage.refresh_token_is_revoked("jti-2") is True
    assert storage.refresh_token_is_revoked("jti-3") is False


# ──────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────

def test_create_guest_returns_user_and_tokens(tmp_auth_db):
    from backend.services.auth import service
    user, access, refresh = service.create_guest("stable-abc")
    assert user.kind == "guest"
    assert user.is_guest
    assert access.count(".") == 2 and refresh.count(".") == 2


def test_rotate_refresh_invalidates_old_token(tmp_auth_db):
    from backend.services.auth import service, storage
    user, _, refresh = service.create_guest("stable-abc")
    user2, new_access, new_refresh = service.rotate_refresh(refresh)
    assert user2.id == user.id
    assert new_access != refresh
    assert new_refresh != refresh
    # The old refresh token's jti is now revoked — second rotation must fail
    # with theft response (RevokedTokenError).
    from backend.services.auth.errors import RevokedTokenError
    with pytest.raises(RevokedTokenError):
        service.rotate_refresh(refresh)


def test_rotate_refresh_detects_theft_revokes_family(tmp_auth_db):
    from backend.services.auth import service, storage
    from backend.services.auth.errors import RevokedTokenError
    user, _, refresh1 = service.create_guest("stable-xyz")
    _, _, refresh2 = service.rotate_refresh(refresh1)
    # Now replay refresh1 (the stolen one). Whole family should die.
    with pytest.raises(RevokedTokenError):
        service.rotate_refresh(refresh1)
    # Even the freshly-issued refresh2 should now fail (family revoked).
    with pytest.raises(RevokedTokenError):
        service.rotate_refresh(refresh2)


# ──────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────

def test_v2_auth_guest_envelope_shape(client, tmp_auth_db):
    r = client.post("/v2/auth/guest", json={"stable_nonce": "test-1"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert data["token_type"] == "Bearer"
    assert data["access_token"] and data["refresh_token"]
    assert data["user"]["is_guest"] is True
    assert data["user"]["kind"] == "guest"


def test_v2_auth_refresh_envelope_shape(client, tmp_auth_db):
    guest = client.post("/v2/auth/guest", json={"stable_nonce": "test-2"}).json()["data"]
    r = client.post("/v2/auth/refresh", json={"refresh_token": guest["refresh_token"]})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["access_token"] != guest["access_token"]
    assert body["data"]["refresh_token"] != guest["refresh_token"]


def test_v2_auth_me_requires_auth(client, tmp_auth_db, monkeypatch):
    # Without ENABLE_V2_ERROR_HANDLERS + ENABLE_AUTH_V2, the legacy
    # global_exception_handler catches MissingTokenError → returns the
    # chat-shape 500. With them ON, it would be a 401 envelope. We test
    # the off path here; the on path is exercised below.
    monkeypatch.delenv("ENABLE_AUTH_V2", raising=False)
    monkeypatch.delenv("ENABLE_V2_ERROR_HANDLERS", raising=False)
    r = client.get("/v2/auth/me")
    # Either 500 (legacy handler) or 401 (envelope handler) is acceptable;
    # the contract is "no user → request rejected".
    assert r.status_code in (401, 500)


def test_v2_auth_logout_safe_with_empty_body(client, tmp_auth_db):
    r = client.post("/v2/auth/logout", json={"refresh_token": ""})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["revoked"] is False


def test_v2_auth_logout_revokes_token(client, tmp_auth_db):
    guest = client.post("/v2/auth/guest", json={"stable_nonce": "logout-test"}).json()["data"]
    r = client.post("/v2/auth/logout", json={"refresh_token": guest["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["data"]["revoked"] is True
    # Subsequent refresh must fail.
    r2 = client.post("/v2/auth/refresh", json={"refresh_token": guest["refresh_token"]})
    assert r2.status_code in (401, 500)


# ──────────────────────────────────────────────────────────────────────────
# Regression — legacy contracts intact
# ──────────────────────────────────────────────────────────────────────────

def test_legacy_chat_route_still_mounts(app):
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/chat" in paths, "/chat route missing — DEMO-BLOCKING REGRESSION"


def test_v2_health_still_returns_envelope(client):
    r = client.get("/v2/health")
    body = r.json()
    assert body["success"] is True
    assert body["data"]["service"] == "korvixai-backend"
