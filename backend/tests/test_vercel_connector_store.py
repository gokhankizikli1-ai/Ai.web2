# coding: utf-8
"""Vercel connector — connection + credential store.

Proves the credential-at-rest and isolation guarantees:
  * the access token is NEVER written in plaintext, and encryption is the
    EXISTING shared authority (`gmail.crypto` / KORVIX_CREDENTIAL_ENCRYPTION_KEY)
    rather than a second cipher;
  * an unavailable encryption key FAILS CLOSED (nothing is stored);
  * `public_view()` leaks no token material;
  * the two-step lifecycle (authorize → pending_selection → bound → connected)
    holds, and re-authorizing resets a stale project binding (the new token may
    carry a different team scope);
  * revoke/delete wipe credential material.
"""
from __future__ import annotations

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import _sqlite
from backend.services.vercel import setup_state as vc_setup
from backend.services.vercel import store as vc_store
from backend.services.vercel.errors import CredentialEncryptionError

TOKEN = "vercel_live_TOKEN_VALUE"


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(vc_store, "DB_PATH", path, raising=False)
    monkeypatch.setattr(vc_setup, "DB_PATH", path, raising=False)
    vc_store._reset_for_tests(); vc_store.init_vercel_tables()
    vc_setup._reset_for_tests(); vc_setup.init_vercel_setup_tables()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _authorize(**kw):
    base = dict(project_id="p1", owner_user_id="uA", access_token=TOKEN,
                account_label="Acme Inc", team_id="team_9",
                installation_id="icfg_1", vercel_user_id="vu_1")
    base.update(kw)
    return vc_store.upsert_authorization(**base)


# ── credential at rest ───────────────────────────────────────────────────────

def test_token_is_never_stored_in_plaintext(db):
    conn = _authorize()
    assert conn is not None
    assert conn.access_token_enc and TOKEN not in conn.access_token_enc
    # ...and the raw SQLite bytes contain no plaintext token either.
    with _sqlite.connection(db) as c:
        row = dict(c.execute("SELECT * FROM vercel_connections WHERE project_id='p1'").fetchone())
    assert TOKEN not in "".join(str(v) for v in row.values())
    assert vc_store.decrypt_access_token(conn) == TOKEN


def test_encryption_uses_the_shared_credential_authority(db):
    """The Vercel token must round-trip through the SAME cipher the Gmail
    connector uses — one credential authority, not one per connector."""
    conn = _authorize()
    assert credential_crypto.is_envelope(conn.access_token_enc)
    assert credential_crypto.decrypt(conn.access_token_enc) == TOKEN


def test_missing_encryption_key_fails_closed(db):
    credential_crypto.set_cipher_for_tests(None)
    with pytest.raises(CredentialEncryptionError):
        _authorize()
    assert vc_store.get_connection("p1") is None  # nothing stored


def test_public_view_carries_no_token(db):
    conn = _authorize()
    view = conn.public_view()
    assert TOKEN not in str(view)
    assert conn.access_token_enc not in str(view)
    assert "access_token" not in str(view)
    assert view["account_label"] == "Acme Inc"
    assert view["team_id"] == "team_9"


def test_no_connection_without_a_token(db):
    assert _authorize(access_token="") is None


def test_no_connection_without_owner_or_project(db):
    assert _authorize(project_id="") is None
    assert _authorize(owner_user_id="") is None


# ── two-step lifecycle ───────────────────────────────────────────────────────

def test_authorization_awaits_project_selection(db):
    conn = _authorize()
    assert conn.status == vc_store.STATUS_PENDING_SELECTION
    assert conn.needs_project_selection is True
    assert conn.is_connected is False   # nothing syncs before a project is bound
    assert conn.vercel_project_id == ""


def test_bind_project_completes_the_connection(db):
    _authorize()
    conn = vc_store.bind_project(project_id="p1", vercel_project_id="prj_1",
                                 name="site", framework="nextjs",
                                 production_url="https://site.vercel.app")
    assert conn is not None
    assert conn.status == vc_store.STATUS_CONNECTED
    assert conn.is_connected is True
    assert conn.vercel_project_id == "prj_1"
    assert conn.public_view()["production_url"] == "https://site.vercel.app"


def test_bind_requires_an_existing_authorization(db):
    assert vc_store.bind_project(project_id="p1", vercel_project_id="prj_1") is None


def test_bind_refused_after_revoke(db):
    _authorize()
    vc_store.mark_revoked("p1")
    assert vc_store.bind_project(project_id="p1", vercel_project_id="prj_1") is None


def test_reauthorization_resets_a_stale_binding(db):
    _authorize()
    vc_store.bind_project(project_id="p1", vercel_project_id="prj_1", name="site")
    # A fresh authorization may carry a DIFFERENT team scope, so the old project
    # binding must not survive it.
    conn = _authorize(team_id="team_other", access_token="second-token")
    assert conn.team_id == "team_other"
    assert conn.vercel_project_id == ""
    assert conn.status == vc_store.STATUS_PENDING_SELECTION
    assert conn.last_sync_at == ""
    assert vc_store.decrypt_access_token(conn) == "second-token"


def test_created_at_is_preserved_across_reauthorization(db):
    first = _authorize()
    again = _authorize(access_token="second-token")
    assert again.created_at == first.created_at


# ── revoke / delete ──────────────────────────────────────────────────────────

def test_mark_revoked_wipes_credential(db):
    _authorize()
    assert vc_store.mark_revoked("p1") is True
    conn = vc_store.get_connection("p1")
    assert conn.is_revoked and conn.access_token_enc == ""
    assert vc_store.decrypt_access_token(conn) == ""


def test_delete_removes_everything(db):
    _authorize()
    assert vc_store.delete_connection("p1") is True
    assert vc_store.get_connection("p1") is None


def test_mark_synced_advances_last_sync(db):
    _authorize()
    vc_store.bind_project(project_id="p1", vercel_project_id="prj_1")
    vc_store.mark_synced("p1")
    assert vc_store.get_connection("p1").last_sync_at


def test_update_project_metadata_refreshes_display_fields(db):
    _authorize()
    vc_store.bind_project(project_id="p1", vercel_project_id="prj_1", name="old")
    vc_store.update_project_metadata("p1", name="new", framework="remix",
                                     production_url="https://new.vercel.app")
    conn = vc_store.get_connection("p1")
    assert (conn.vercel_project_name, conn.framework) == ("new", "remix")
    assert conn.production_url == "https://new.vercel.app"


# ── isolation ────────────────────────────────────────────────────────────────

def test_owner_scope_is_stored_from_the_project_not_the_caller(db):
    conn = _authorize(project_id="p2", owner_user_id="uB")
    assert conn.owner_user_id == "uB"
    # Each Korvix project holds its own independent connection row.
    _authorize(project_id="p3", owner_user_id="uC", access_token="tok3")
    assert vc_store.get_connection("p2").owner_user_id == "uB"
    assert vc_store.get_connection("p3").owner_user_id == "uC"


# ── pending project set ──────────────────────────────────────────────────────

def test_pending_projects_are_owner_bound(db):
    vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA",
        projects=[{"vercel_project_id": "prj_1", "name": "site", "framework": "nextjs"}])
    assert len(vc_setup.list_pending_projects("p1", owner_user_id="uA")) == 1
    # Another user cannot read or resolve this project's pending set.
    assert vc_setup.list_pending_projects("p1", owner_user_id="uB") == []
    assert vc_setup.get_pending_project("p1", owner_user_id="uB",
                                        vercel_project_id="prj_1") is None


def test_pending_projects_replace_drops_stale_entries(db):
    vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA",
        projects=[{"vercel_project_id": "old"}, {"vercel_project_id": "keep"}])
    vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA", projects=[{"vercel_project_id": "keep"}])
    ids = [p.vercel_project_id for p in vc_setup.list_pending_projects("p1", owner_user_id="uA")]
    assert ids == ["keep"]


def test_pending_projects_are_capped(db, monkeypatch):
    monkeypatch.setenv("VERCEL_PENDING_PROJECTS_MAX", "3")
    vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA",
        projects=[{"vercel_project_id": f"prj_{i}"} for i in range(50)])
    assert len(vc_setup.list_pending_projects("p1", owner_user_id="uA")) == 3


def test_unknown_pending_project_is_not_resolvable(db):
    vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA", projects=[{"vercel_project_id": "prj_1"}])
    assert vc_setup.get_pending_project("p1", owner_user_id="uA",
                                        vercel_project_id="prj_evil") is None


def test_expired_pending_projects_are_filtered(db):
    vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA", projects=[{"vercel_project_id": "prj_1"}])
    with _sqlite.connection(db) as c:
        c.execute("UPDATE vercel_pending_projects SET expires_at='2000-01-01T00:00:00Z'")
    assert vc_setup.list_pending_projects("p1", owner_user_id="uA") == []
    assert vc_setup.get_pending_project("p1", owner_user_id="uA",
                                        vercel_project_id="prj_1") is None


def test_pending_public_view_is_display_only(db):
    pending = vc_setup.replace_pending_projects(
        project_id="p1", owner_user_id="uA",
        projects=[{"vercel_project_id": "prj_1", "name": "site", "framework": "nextjs"}])
    assert pending[0].public_view() == {
        "vercel_project_id": "prj_1", "name": "site", "framework": "nextjs"}
