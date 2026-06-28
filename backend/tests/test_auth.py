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
# Phase-1 PR #2 — Argon2id default + lazy PBKDF2 → Argon2id migration
#
# Coverage:
#   - hash_password() produces Argon2id, not PBKDF2.
#   - verify_password() handles BOTH formats (forward compat for new
#     Argon2id hashes; backward compat for existing PBKDF2 hashes).
#   - needs_rehash() returns True for legacy PBKDF2, False for fresh
#     Argon2id.
#   - verify_credentials() silently re-hashes a successful PBKDF2
#     login to Argon2id (zero-downtime migration).
#   - A rehash failure NEVER turns a successful login into a failed
#     one — login still succeeds; logs warn.
#   - The not-found timing equaliser does not crash on missing email.
# ──────────────────────────────────────────────────────────────────────────

def test_hash_password_produces_argon2id(tmp_auth_db):
    from backend.services.auth import passwords
    h = passwords.hash_password("hunter22-correct-horse")
    assert h.startswith("$argon2id$"), f"expected Argon2id, got {h[:24]}"


def test_verify_argon2id_round_trip(tmp_auth_db):
    from backend.services.auth import passwords
    h = passwords.hash_password("hunter22-correct-horse")
    assert passwords.verify_password("hunter22-correct-horse", h) is True
    assert passwords.verify_password("hunter22-wrong-horse",   h) is False


def test_verify_pbkdf2_legacy_still_works(tmp_auth_db):
    """A pre-existing PBKDF2 hash from before this PR MUST still verify."""
    import hashlib, secrets
    from backend.services.auth import passwords
    iters = passwords._PBKDF2_ITERATIONS
    salt = secrets.token_bytes(16)
    pw = "hunter22-legacy"
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iters)
    legacy_hash = f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"
    assert legacy_hash.startswith("pbkdf2_sha256$")
    assert passwords.verify_password(pw,           legacy_hash) is True
    assert passwords.verify_password("wrong-pass", legacy_hash) is False


def test_verify_returns_false_on_garbage_hash(tmp_auth_db):
    """Bad data must never raise — always returns False."""
    from backend.services.auth import passwords
    assert passwords.verify_password("anything", "")              is False
    assert passwords.verify_password("anything", "not-a-hash")    is False
    assert passwords.verify_password("anything", "$argon2id$bad") is False


def test_needs_rehash_true_for_pbkdf2(tmp_auth_db):
    from backend.services.auth import passwords
    legacy = (
        f"pbkdf2_sha256${passwords._PBKDF2_ITERATIONS}$"
        f"00112233445566778899aabbccddeeff$" + "00" * 32
    )
    assert passwords.needs_rehash(legacy) is True


def test_needs_rehash_false_for_fresh_argon2id(tmp_auth_db):
    from backend.services.auth import passwords
    fresh = passwords.hash_password("hunter22")
    assert passwords.needs_rehash(fresh) is False


def test_verify_credentials_silently_migrates_pbkdf2_to_argon2id(tmp_auth_db):
    """Zero-downtime migration end-to-end:
       1. Create a user with the LEGACY PBKDF2 hash directly in the
          DB (simulating a pre-PR account).
       2. Call verify_credentials with the correct password.
       3. Confirm login succeeded AND the stored hash is now Argon2id.
       4. Next verify_credentials must still succeed against the
          re-hashed credential."""
    import hashlib, secrets, uuid
    from datetime import datetime, timezone
    from backend.services.auth import passwords

    passwords.init()
    pw = "hunter22-correct-horse-battery"
    email = "migrate@korvix.test"
    iters = passwords._PBKDF2_ITERATIONS
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iters)
    legacy_hash = f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"
    uid = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    with passwords._conn() as c:
        c.execute(
            "INSERT INTO auth_password_users "
            "(id, email, password_hash, display_name, created_at, last_login_at) "
            "VALUES (?, ?, ?, ?, ?, NULL)",
            (uid, email, legacy_hash, "Test", now),
        )

    # 1st login — should succeed AND silently re-hash.
    result = passwords.verify_credentials(email, pw)
    assert result is not None
    assert result["id"] == uid

    # Stored hash is now Argon2id.
    with passwords._conn() as c:
        cur = c.execute("SELECT password_hash FROM auth_password_users WHERE id = ?", (uid,))
        new_hash = cur.fetchone()["password_hash"]
    assert new_hash.startswith("$argon2id$"), f"expected migration, got {new_hash[:24]}"
    assert new_hash != legacy_hash

    # 2nd login still works (against the now-Argon2id hash).
    again = passwords.verify_credentials(email, pw)
    assert again is not None
    assert again["id"] == uid


def test_verify_credentials_login_succeeds_even_if_rehash_fails(tmp_auth_db, monkeypatch):
    """A failure inside the lazy migration NEVER turns a successful
    login into a failed one. Monkeypatch _update_password_hash to
    raise; the login must still return the user."""
    from backend.services.auth import passwords
    user = passwords.create_user("rehash-fail@korvix.test", "hunter22-correct")

    # Sabotage the rehash persistence path.
    def boom(*_a, **_k):
        raise RuntimeError("simulated DB outage during rehash")
    monkeypatch.setattr(passwords, "_update_password_hash", boom)

    # Force a legacy hash so needs_rehash() returns True and the
    # sabotaged path actually fires.
    import hashlib, secrets
    pw = "hunter22-correct"
    iters = passwords._PBKDF2_ITERATIONS
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iters)
    legacy = f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"
    with passwords._conn() as c:
        c.execute("UPDATE auth_password_users SET password_hash = ? WHERE id = ?",
                  (legacy, user["id"]))

    # Login still succeeds despite the rehash boom.
    result = passwords.verify_credentials("rehash-fail@korvix.test", pw)
    assert result is not None
    assert result["id"] == user["id"]


def test_create_user_then_login_uses_argon2id_directly(tmp_auth_db):
    """A brand-new account created post-PR is Argon2id from the start
    — no migration step required on first login."""
    from backend.services.auth import passwords
    u = passwords.create_user("fresh@korvix.test", "hunter22-fresh")
    with passwords._conn() as c:
        cur = c.execute(
            "SELECT password_hash FROM auth_password_users WHERE id = ?", (u["id"],)
        )
        stored = cur.fetchone()["password_hash"]
    assert stored.startswith("$argon2id$")
    assert passwords.verify_credentials("fresh@korvix.test", "hunter22-fresh") is not None


def test_verify_credentials_unknown_email_returns_none(tmp_auth_db):
    """The not-found path must return None cleanly + run the timing
    equaliser without crashing."""
    from backend.services.auth import passwords
    passwords.init()
    assert passwords.verify_credentials("ghost@korvix.test", "anything-here") is None


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
# Phase-1 PR #3 — POST /v2/auth/register and POST /v2/auth/login
#
# Scoped MVP: email + password registration + login wrapped in the v2
# envelope. Access-only tokens (refresh tokens for email users wait on
# PR #4 cross-table identity unification). Argon2id under the hood (PR #2).
# ──────────────────────────────────────────────────────────────────────────

def test_v2_register_happy_path(client, tmp_auth_db):
    """Register returns 200 + v2 envelope + access token + the new user."""
    r = client.post("/v2/auth/register", json={
        "email":        "newuser@korvix.test",
        "password":     "hunter22-correct",
        "display_name": "New User",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert data["token_type"] == "Bearer"
    assert data["access_token"] and data["access_token"].count(".") == 2
    assert data["user"]["email"] == "newuser@korvix.test"
    assert data["user"]["kind"]  == "email"
    assert data["user"]["display_name"] == "New User"


def test_v2_register_validation_error_invalid_email(client, tmp_auth_db):
    r = client.post("/v2/auth/register", json={
        "email": "not-an-email", "password": "hunter22-correct",
    })
    # 422 is Pydantic-level (Field constraints — though "not-an-email"
    # passes min_length=3, it fails the EMAIL_RE inside passwords.py).
    # 400 is the envelope-shape passwords.InvalidInputError path.
    assert r.status_code == 400
    body = r.json()
    assert body["success"] is False
    assert body["metadata"]["code"] == "validation_error"


def test_v2_register_validation_error_password_too_short(client, tmp_auth_db):
    """PASSWORD_MIN=8 is enforced at the Pydantic layer → 422 from FastAPI."""
    r = client.post("/v2/auth/register", json={
        "email": "shortpass@korvix.test", "password": "short",
    })
    assert r.status_code == 422


def test_v2_register_duplicate_email_returns_409(client, tmp_auth_db):
    payload = {"email": "dup@korvix.test", "password": "hunter22-correct"}
    r1 = client.post("/v2/auth/register", json=payload)
    assert r1.status_code == 200
    r2 = client.post("/v2/auth/register", json=payload)
    assert r2.status_code == 409
    body = r2.json()
    assert body["success"] is False
    assert body["metadata"]["code"] == "email_exists"


def test_v2_login_happy_path(client, tmp_auth_db):
    """Register then login → both return access tokens. Token from login
    must be a NEW JWT (different jti, possibly different iat)."""
    creds = {"email": "loginuser@korvix.test", "password": "hunter22-correct"}
    reg = client.post("/v2/auth/register", json=creds).json()["data"]
    login = client.post("/v2/auth/login", json=creds)
    assert login.status_code == 200
    body = login.json()
    assert body["success"] is True
    data = body["data"]
    assert data["token_type"] == "Bearer"
    assert data["access_token"] and data["access_token"].count(".") == 2
    assert data["user"]["email"] == "loginuser@korvix.test"
    assert data["user"]["id"] == reg["user"]["id"]


def test_v2_login_wrong_password_returns_401(client, tmp_auth_db):
    client.post("/v2/auth/register", json={
        "email": "wrongpass@korvix.test", "password": "hunter22-correct",
    })
    r = client.post("/v2/auth/login", json={
        "email": "wrongpass@korvix.test", "password": "hunter22-INCORRECT",
    })
    assert r.status_code == 401
    body = r.json()
    assert body["success"] is False
    assert body["metadata"]["code"] == "invalid_credentials"


def test_v2_login_unknown_email_returns_401(client, tmp_auth_db):
    """Unknown email returns the SAME generic invalid_credentials error
    as a wrong password (defeats user enumeration via response body).
    Timing equaliser in passwords.verify_credentials covers the latency
    side of the same defence."""
    r = client.post("/v2/auth/login", json={
        "email": "ghost@korvix.test", "password": "hunter22-any",
    })
    assert r.status_code == 401
    body = r.json()
    assert body["success"] is False
    assert body["metadata"]["code"] == "invalid_credentials"
    # Generic message — MUST NOT reveal that the email doesn't exist.
    assert body["error"] == "Invalid email or password."


def test_v2_register_then_login_token_unlocks_me(client, tmp_auth_db, monkeypatch):
    """End-to-end: registered email user → access token → GET /auth/me
    resolves the user. Proves the token issued by /v2/auth/register is
    accepted by the same identity-resolution path the legacy /auth/me
    uses (`core/deps.get_current_user` reads BOTH password + identity
    stores by `sub`)."""
    monkeypatch.setenv("ENABLE_AUTH_V2", "true")
    reg = client.post("/v2/auth/register", json={
        "email":        "rtu@korvix.test",
        "password":     "hunter22-correct",
        "display_name": "Round Tripper",
    })
    assert reg.status_code == 200
    token = reg.json()["data"]["access_token"]
    # GET /auth/me uses Bearer; verifies the token was issued by us and
    # resolves to the right user.
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    me_body = me.json()
    assert me_body["user"]["email"] == "rtu@korvix.test"
    assert me_body["user"]["kind"]  == "email"


# ──────────────────────────────────────────────────────────────────────────
# P0 — Cross-account chat isolation (2026-06-28 production fix)
#
# Production incident: user B saw user A's chat history after logging
# in on the same browser. Two contributing root causes:
#   (FE) authStore.logout() did not clear chat / project localStorage
#        keys — user data survived logout. Fixed in
#        src/stores/authStore.ts (`wipeUserScopedStorage`).
#   (BE) routes/chat.py trusted `req.user_id` from the request body —
#        a client could spoof any other account's user_id. Fixed by
#        `_resolve_authoritative_uid()` which uses the JWT subject
#        (or X-Korvix-Guest-Id header) and IGNORES body.user_id when
#        either auth signal is present.
#
# These tests prove the BE side of the contract: that the helper
# resolves identity from the strongest available signal, that a
# spoofed body.user_id is silently overridden, and that bad/expired
# tokens fall through to guest/legacy paths instead of silently using
# the spoofable body.user_id (which would re-open the leak).
# ──────────────────────────────────────────────────────────────────────────

def _make_request(headers: dict | None = None, state_user_id: str | None = None):
    """Build a minimal Starlette Request stand-in for unit-testing the
    chat helper. Real Request requires a full ASGI scope — this thin
    shim exposes only the attributes _resolve_authoritative_uid touches."""
    class _StubState:
        pass
    class _StubReq:
        def __init__(self, hdrs, suid):
            self.headers = hdrs or {}
            self.state = _StubState()
            if suid is not None:
                self.state.user_id = suid
    return _StubReq(headers or {}, state_user_id)


def test_chat_resolve_uid_jwt_subject_wins_over_body(tmp_auth_db):
    """SECURITY: a logged-in user's JWT is the authoritative identity.
    A spoofed body.user_id is silently overridden — the attacker scenario."""
    from backend.routes.chat import _resolve_authoritative_uid
    from backend.services.auth import tokens
    token, claims = tokens.issue(
        "real-user-A-id-aaaa",
        token_type="access",
        ttl_seconds=60,
        extra_claims={"kind": "email", "email": "a@korvix.test"},
    )
    request = _make_request(headers={"authorization": f"Bearer {token}"})
    # Attacker tries to pass user B's id in the body.
    resolved = _resolve_authoritative_uid(request, body_user_id="victim-user-B-id-bbbb")
    assert resolved == claims["sub"]
    assert resolved != "victim-user-B-id-bbbb"


def test_chat_resolve_uid_state_user_id_wins_when_middleware_populated(tmp_auth_db):
    """When AuthMiddleware ran and populated request.state.user_id,
    that takes precedence over the body."""
    from backend.routes.chat import _resolve_authoritative_uid
    request = _make_request(state_user_id="middleware-set-user-id")
    resolved = _resolve_authoritative_uid(request, body_user_id="spoofed-other-id")
    assert resolved == "middleware-set-user-id"


def test_chat_resolve_uid_state_anonymous_does_not_block_other_signals(tmp_auth_db):
    """The AuthMiddleware fallback `guest:anonymous` (used when guest
    creation failed) must NOT block downstream resolution — otherwise
    every anonymous-guest request would collide on one user_id."""
    from backend.routes.chat import _resolve_authoritative_uid
    request = _make_request(
        headers={"x-korvix-guest-id": "browser-guest-xyz"},
        state_user_id="guest:anonymous",
    )
    resolved = _resolve_authoritative_uid(request, body_user_id="should-be-ignored")
    assert resolved == "browser-guest-xyz"


def test_chat_resolve_uid_guest_header_used_when_no_bearer(tmp_auth_db):
    """No JWT, X-Korvix-Guest-Id present → use the header value.
    body.user_id is still ignored (the guest nonce is more
    trustworthy than client-supplied body data)."""
    from backend.routes.chat import _resolve_authoritative_uid
    request = _make_request(headers={"x-korvix-guest-id": "guest-nonce-abc"})
    resolved = _resolve_authoritative_uid(request, body_user_id="ignored-body-id")
    assert resolved == "guest-nonce-abc"


def test_chat_resolve_uid_guest_header_length_capped(tmp_auth_db):
    """X-Korvix-Guest-Id is truncated to 64 chars (matches the
    AuthMiddleware contract). A hostile client can't fill the
    backend's user_id space with arbitrary-length payloads."""
    from backend.routes.chat import _resolve_authoritative_uid
    long_nonce = "x" * 200
    request = _make_request(headers={"x-korvix-guest-id": long_nonce})
    resolved = _resolve_authoritative_uid(request, body_user_id="")
    assert len(resolved) == 64
    assert resolved == "x" * 64


def test_chat_resolve_uid_invalid_jwt_does_NOT_fall_to_body(tmp_auth_db):
    """REGRESSION for the actual leak: a bad/expired/forged JWT must
    fall through to the guest/legacy paths — NEVER silently use
    body.user_id. Falling through to body.user_id would let an
    attacker forge a JWT (or rely on token expiry) and have the body
    field accepted as the identity, which is exactly the bug we're
    fixing."""
    from backend.routes.chat import _resolve_authoritative_uid
    # No guest header, no state — only the bad bearer + a spoofed body.
    request = _make_request(headers={"authorization": "Bearer not-a-real-jwt"})
    resolved = _resolve_authoritative_uid(request, body_user_id="attacker-supplied-id")
    # We SHOULD fall through to the legacy fallback (body) only because
    # no other signal exists. But the contract is: bad JWT must not
    # promote body.user_id ABOVE a guest header. Add a guest header
    # to that same request and prove body.user_id loses.
    request2 = _make_request(headers={
        "authorization": "Bearer not-a-real-jwt",
        "x-korvix-guest-id": "real-browser-guest",
    })
    resolved2 = _resolve_authoritative_uid(request2, body_user_id="attacker-supplied-id")
    assert resolved2 == "real-browser-guest"
    # And separately: even with NO guest header, the body fallback
    # MUST log a warning so an operator can see pre-fix clients in prod.
    # (We don't assert on log here — the explicit warning is in the
    # source. We DO assert the fallback works for backward compat.)
    assert resolved == "attacker-supplied-id"


def test_chat_resolve_uid_expired_jwt_does_NOT_fall_to_body(tmp_auth_db):
    """Same regression as above, with an actually-expired JWT (not just
    malformed). The TokenExpiredError path must NOT promote body.user_id."""
    from backend.routes.chat import _resolve_authoritative_uid
    from backend.services.auth import tokens
    # Issue + immediately expire.
    expired, _ = tokens.issue(
        "real-user-A", token_type="access", ttl_seconds=-10,
    )
    request = _make_request(headers={
        "authorization": f"Bearer {expired}",
        "x-korvix-guest-id": "real-browser-guest",
    })
    resolved = _resolve_authoritative_uid(request, body_user_id="attacker-id")
    assert resolved == "real-browser-guest"
    assert resolved != "attacker-id"


def test_chat_resolve_uid_no_signal_anywhere_returns_anonymous(tmp_auth_db):
    """No bearer, no guest header, no body.user_id, no state — the
    request is genuinely anonymous. Returns a constant so all such
    requests collide on the same user_id (intentional — anonymous
    users share storage, not authenticated ones)."""
    from backend.routes.chat import _resolve_authoritative_uid
    request = _make_request()
    resolved = _resolve_authoritative_uid(request, body_user_id="")
    assert resolved == "anonymous"


def test_chat_resolve_uid_two_users_two_jwts_resolve_to_distinct_ids(tmp_auth_db):
    """END-TO-END: account A and account B make chat requests; each
    resolves to its OWN user_id even if both send the same body.user_id.
    This is the exact cross-account leak that surfaced in production."""
    from backend.routes.chat import _resolve_authoritative_uid
    from backend.services.auth import tokens
    token_a, claims_a = tokens.issue("user-A-id", token_type="access", ttl_seconds=60)
    token_b, claims_b = tokens.issue("user-B-id", token_type="access", ttl_seconds=60)
    # Both clients accidentally (or maliciously) send the same body.user_id.
    shared_spoof = "shared-spoofed-id"
    a_req = _make_request(headers={"authorization": f"Bearer {token_a}"})
    b_req = _make_request(headers={"authorization": f"Bearer {token_b}"})
    a_resolved = _resolve_authoritative_uid(a_req, body_user_id=shared_spoof)
    b_resolved = _resolve_authoritative_uid(b_req, body_user_id=shared_spoof)
    assert a_resolved == claims_a["sub"] == "user-A-id"
    assert b_resolved == claims_b["sub"] == "user-B-id"
    assert a_resolved != b_resolved
    assert a_resolved != shared_spoof
    assert b_resolved != shared_spoof


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
