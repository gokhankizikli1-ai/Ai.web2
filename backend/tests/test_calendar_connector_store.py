# coding: utf-8
"""Google Calendar connector — connection store + central access-token lifecycle.

Covers: refresh token encrypted at rest (never plaintext in the DB), access
token refresh + persist, cached-token reuse, invalid_grant → revoked + wiped,
disconnect deletes credential material, the live-connection counter used by the
shared-grant revoke guard, and — critically — that every Calendar store
operation leaves the GMAIL connection table untouched.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import store as gm_store
from backend.services.google_calendar import access as cal_access
from backend.services.google_calendar import oauth as cal_oauth
from backend.services.google_calendar import store as cal_store
from backend.services.google_calendar.errors import (
    CalendarAuthError, CalendarOAuthError,
)


@pytest.fixture()
def cal_db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(cal_store, "DB_PATH", path, raising=False)
    monkeypatch.setattr(gm_store, "DB_PATH", path, raising=False)
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    cal_store._reset_for_tests(); cal_store.init_calendar_tables()
    gm_store._reset_for_tests(); gm_store.init_gmail_tables()
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _connect(project_id="p1", owner="uA", email="me@x.com",
             refresh="SECRET-REFRESH-1//abc", access="ACCESS-1",
             expires="2999-01-01T00:00:00Z"):
    return cal_store.upsert_connection(
        project_id=project_id, owner_user_id=owner, google_email=email,
        calendar_id="primary", time_zone="Europe/Istanbul",
        scopes="https://www.googleapis.com/auth/calendar.events.readonly",
        refresh_token=refresh, access_token=access, access_token_expires=expires,
    )


# ── credentials at rest ──────────────────────────────────────────────────────

def test_refresh_token_encrypted_at_rest(cal_db):
    conn = _connect()
    assert conn is not None
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(cal_db) as c:
        row = dict(c.execute(
            "SELECT * FROM calendar_connections WHERE project_id=?", ("p1",)).fetchone())
    assert "SECRET-REFRESH-1//abc" not in row["refresh_token_enc"]
    assert "ACCESS-1" not in row["access_token_enc"]
    assert credential_crypto.is_envelope(row["refresh_token_enc"])
    # …and it round-trips through the SAME shared credential authority.
    assert cal_store.decrypt_refresh_token(conn) == "SECRET-REFRESH-1//abc"


def test_public_view_carries_no_token_material(cal_db):
    conn = _connect()
    view = conn.public_view()
    blob = repr(view).lower()
    assert "token" not in blob and "secret-refresh" not in blob
    assert view["connected"] is True
    assert view["time_zone"] == "Europe/Istanbul"
    assert view["scopes"] == ["https://www.googleapis.com/auth/calendar.events.readonly"]


def test_connection_without_refresh_token_is_refused(cal_db):
    assert _connect(refresh="") is None
    assert cal_store.get_connection("p1") is None


# ── access-token lifecycle ───────────────────────────────────────────────────

def test_cached_access_token_is_reused(cal_db, monkeypatch):
    conn = _connect(expires=(datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z")
    called = {"n": 0}

    def _boom(_rt):
        called["n"] += 1
        raise AssertionError("must not refresh while the cached token is valid")
    monkeypatch.setattr(cal_oauth, "refresh_access_token", _boom)
    assert cal_access.access_token_for(conn) == "ACCESS-1"
    assert called["n"] == 0


def test_expired_token_refreshes_and_persists(cal_db, monkeypatch):
    conn = _connect(expires=(datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z")
    monkeypatch.setattr(
        cal_oauth, "refresh_access_token",
        lambda rt: cal_oauth.TokenResponse("ACCESS-2", "", 3600, "", "Bearer"))
    assert cal_access.access_token_for(conn) == "ACCESS-2"
    # Persisted (encrypted) for the next request in the same sync.
    latest = cal_store.get_connection("p1")
    assert cal_store.decrypt_access_token(latest) == "ACCESS-2"


def test_invalid_grant_marks_revoked_and_wipes_credentials(cal_db, monkeypatch):
    conn = _connect(expires="2000-01-01T00:00:00Z")

    def _rejected(_rt):
        raise CalendarOAuthError("nope", status=400, reason="invalid_grant")
    monkeypatch.setattr(cal_oauth, "refresh_access_token", _rejected)

    with pytest.raises(CalendarAuthError):
        cal_access.access_token_for(conn)
    latest = cal_store.get_connection("p1")
    assert latest.is_revoked
    assert latest.refresh_token_enc == "" and latest.access_token_enc == ""


def test_revoked_connection_refuses_token(cal_db):
    conn = _connect()
    cal_store.mark_revoked("p1")
    with pytest.raises(CalendarAuthError):
        cal_access.access_token_for(cal_store.get_connection("p1"))


# ── lifecycle bookkeeping ────────────────────────────────────────────────────

def test_mark_synced_and_metadata_update(cal_db):
    _connect(email="")
    assert cal_store.get_connection("p1").last_sync_at == ""
    cal_store.mark_synced("p1")
    assert cal_store.get_connection("p1").last_sync_at != ""
    cal_store.update_calendar_metadata("p1", google_email="me@x.com",
                                       time_zone="Europe/Berlin")
    latest = cal_store.get_connection("p1")
    assert latest.google_email == "me@x.com" and latest.time_zone == "Europe/Berlin"


def test_metadata_update_never_blanks_known_values(cal_db):
    _connect(email="me@x.com")
    cal_store.update_calendar_metadata("p1", google_email="", time_zone="")
    assert cal_store.get_connection("p1").google_email == "me@x.com"


def test_delete_removes_credentials(cal_db):
    _connect()
    assert cal_store.delete_connection("p1") is True
    assert cal_store.get_connection("p1") is None


# ── live-connection counter (input to the shared-grant revoke guard) ─────────

def test_count_connected_for_email(cal_db):
    _connect(project_id="p1", email="me@x.com")
    _connect(project_id="p2", email="me@x.com")
    _connect(project_id="p3", email="other@x.com")
    assert cal_store.count_connected_for_email("me@x.com") == 2
    assert cal_store.count_connected_for_email("ME@X.COM") == 2   # case-insensitive
    assert cal_store.count_connected_for_email("me@x.com", exclude_project_id="p1") == 1
    assert cal_store.count_connected_for_email("") == 0           # unknown ⇒ no match
    cal_store.mark_revoked("p2")
    assert cal_store.count_connected_for_email("me@x.com") == 1   # revoked ≠ live


# ── Gmail isolation at the STORE layer ───────────────────────────────────────

def test_calendar_store_never_touches_gmail_rows(cal_db):
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="https://www.googleapis.com/auth/gmail.readonly",
        refresh_token="GMAIL-REFRESH", access_token="GMAIL-ACCESS")
    before = gm_store.get_connection("p1")
    assert before is not None

    # A full Calendar lifecycle on the SAME project + SAME Google account.
    _connect(project_id="p1", email="me@x.com")
    cal_store.mark_synced("p1")
    cal_store.mark_revoked("p1")
    cal_store.delete_connection("p1")

    after = gm_store.get_connection("p1")
    assert after is not None
    assert after.status == gm_store.STATUS_CONNECTED
    assert gm_store.decrypt_refresh_token(after) == "GMAIL-REFRESH"
    assert after.refresh_token_enc == before.refresh_token_enc
