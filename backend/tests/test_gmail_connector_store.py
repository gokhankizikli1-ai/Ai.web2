# coding: utf-8
"""Gmail connector — connection store + central access-token lifecycle.

Covers: refresh token encrypted at rest (never plaintext in the DB), access
token refresh + persist, cached-token reuse, invalid_grant → revoked + wiped,
and disconnect deletes credential material.
"""
from __future__ import annotations

import json

from datetime import datetime, timedelta

import pytest

from backend.services.gmail import access as gm_access
from backend.services.gmail import crypto as gm_crypto
from backend.services.gmail import oauth as gm_oauth
from backend.services.gmail import store as gm_store
from backend.services.gmail.errors import GmailAuthError, GmailOAuthError


@pytest.fixture()
def gmail_store_db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(gm_store, "DB_PATH", path, raising=False)
    gm_crypto.set_cipher_for_tests(gm_crypto._ReversibleTestCipher())
    gm_store._reset_for_tests()
    gm_store.init_gmail_tables()
    yield path
    gm_crypto.set_cipher_for_tests(None)


def test_refresh_token_encrypted_at_rest(gmail_store_db):
    conn = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com",
        scopes="https://www.googleapis.com/auth/gmail.readonly",
        refresh_token="SECRET-REFRESH-1//abc", access_token="ACCESS-1",
        access_token_expires="2999-01-01T00:00:00Z",
    )
    assert conn is not None
    # Read the RAW authorization row in the SHARED connector authority (Gmail no
    # longer owns a per-project credential table): the plaintext refresh token
    # must never appear anywhere in it.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(gmail_store_db) as c:
        row = dict(c.execute(
            "SELECT * FROM connector_authorizations WHERE id=?",
            (conn.authorization_id,)).fetchone())
    blob = json.dumps(row)
    assert "SECRET-REFRESH-1//abc" not in blob
    assert "ACCESS-1" not in blob
    creds = json.loads(row["credentials_json"])
    assert creds["refresh_token"].startswith("f1:")
    assert creds["access_token"].startswith("f1:")
    # But it decrypts back correctly.
    assert gm_store.decrypt_refresh_token(conn) == "SECRET-REFRESH-1//abc"


def test_public_view_carries_no_secret(gmail_store_db):
    conn = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com",
        scopes="https://www.googleapis.com/auth/gmail.readonly",
        refresh_token="SECRET-REFRESH", access_token="ACCESS",
    )
    view = conn.public_view()
    import json
    blob = json.dumps(view).lower()
    assert "token" not in blob
    assert "secret-refresh" not in blob
    assert view["google_email"] == "a@x.com"
    assert view["connected"] is True


def test_upsert_refuses_without_refresh_token(gmail_store_db):
    assert gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com",
        scopes="", refresh_token="",
    ) is None


def test_access_token_cached_when_valid(gmail_store_db, monkeypatch):
    future = (datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z"
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com", scopes="",
        refresh_token="R", access_token="CACHED-ACCESS", access_token_expires=future,
    )
    conn = gm_store.get_connection("p1")

    def _boom(_rt):
        raise AssertionError("refresh must not be called when cache is valid")
    monkeypatch.setattr(gm_oauth, "refresh_access_token", _boom)
    assert gm_access.access_token_for(conn) == "CACHED-ACCESS"


def test_access_token_refreshes_when_expired(gmail_store_db, monkeypatch):
    past = (datetime.utcnow() - timedelta(minutes=1)).isoformat() + "Z"
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com", scopes="",
        refresh_token="R", access_token="OLD", access_token_expires=past,
    )
    conn = gm_store.get_connection("p1")

    monkeypatch.setattr(gm_oauth, "refresh_access_token",
                        lambda rt: gm_oauth.TokenResponse("NEW-ACCESS", "", 3600, "", "Bearer"))
    tok = gm_access.access_token_for(conn)
    assert tok == "NEW-ACCESS"
    # Persisted (encrypted) so the next call uses the cache.
    refreshed = gm_store.get_connection("p1")
    assert gm_store.decrypt_access_token(refreshed) == "NEW-ACCESS"


def test_invalid_grant_marks_revoked_and_wipes(gmail_store_db, monkeypatch):
    past = (datetime.utcnow() - timedelta(minutes=1)).isoformat() + "Z"
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com", scopes="",
        refresh_token="R", access_token="OLD", access_token_expires=past,
    )
    conn = gm_store.get_connection("p1")

    def _revoked(rt):
        raise GmailOAuthError("bad", status=400, reason="invalid_grant")
    monkeypatch.setattr(gm_oauth, "refresh_access_token", _revoked)

    with pytest.raises(GmailAuthError):
        gm_access.access_token_for(conn)
    after = gm_store.get_connection("p1")
    assert after.is_revoked
    assert after.refresh_token_enc == ""  # credential material wiped
    assert after.access_token_enc == ""


def test_delete_removes_credential_material(gmail_store_db):
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="a@x.com", scopes="",
        refresh_token="R", access_token="A",
    )
    assert gm_store.delete_connection("p1") is True
    assert gm_store.get_connection("p1") is None
