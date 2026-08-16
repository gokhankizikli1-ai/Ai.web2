# coding: utf-8
"""Slack connector — connection + credential store.

Covers credential-at-rest encryption through the EXISTING shared authority
(never a plaintext token on disk, never a token in a public projection), the
three-step lifecycle (pending selection → connected → revoked), the hard cap on
selected channels, owner scoping, and the shared-workspace-installation
accounting that makes disconnect provably non-destructive for other projects.
"""
from __future__ import annotations

import json

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail.errors import CredentialEncryptionError
from backend.services.slack import store as sl_store

BOT_TOKEN = "xoxb-REAL-BOT-TOKEN"


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(sl_store, "DB_PATH", path, raising=False)
    sl_store._reset_for_tests()
    sl_store.init_slack_tables()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _install(project_id="p1", owner="uA", team="T1", token=BOT_TOKEN):
    return sl_store.upsert_installation(
        project_id=project_id, owner_user_id=owner, bot_token=token,
        team_id=team, team_name="Korvix HQ", bot_user_id="U0BOT",
        app_id="A1", scopes="channels:read,channels:history")


def _chans(*ids):
    return [{"channel_id": i, "name": i.lower(), "is_private": False} for i in ids]


# ── credential at rest ───────────────────────────────────────────────────────

def test_bot_token_is_never_stored_in_plaintext(db):
    conn = _install()
    assert conn is not None
    assert BOT_TOKEN not in conn.bot_token_enc
    assert credential_crypto.is_envelope(conn.bot_token_enc)
    assert sl_store.decrypt_bot_token(conn) == BOT_TOKEN
    # ...and the raw DB rows carry no plaintext either. The bot token lives on
    # the ACCOUNT authorization in the shared connector authority — Slack no
    # longer owns a per-project credential table.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(db) as c:
        row = dict(c.execute(
            "SELECT * FROM connector_authorizations WHERE id=?",
            (conn.authorization_id,)).fetchone())
        bindings = [dict(r) for r in c.execute(
            "SELECT * FROM connector_project_bindings WHERE provider='slack'").fetchall()]
    assert BOT_TOKEN not in json.dumps(row)
    assert BOT_TOKEN not in json.dumps(bindings)


def test_install_fails_closed_without_encryption(db):
    credential_crypto.set_cipher_for_tests(None)
    with pytest.raises(CredentialEncryptionError):
        _install()
    assert sl_store.get_connection("p1") is None


def test_public_view_carries_no_token_material(db):
    conn = _install()
    view = json.dumps(conn.public_view())
    assert BOT_TOKEN not in view
    assert "token" not in view.lower().replace("bot_user_id", "")
    assert conn.public_view()["team_name"] == "Korvix HQ"


def test_install_requires_a_token_and_an_authoritative_team(db):
    assert sl_store.upsert_installation(
        project_id="p1", owner_user_id="uA", bot_token="", team_id="T1") is None
    assert sl_store.upsert_installation(
        project_id="p1", owner_user_id="uA", bot_token=BOT_TOKEN, team_id="") is None
    assert sl_store.upsert_installation(
        project_id="", owner_user_id="uA", bot_token=BOT_TOKEN, team_id="T1") is None
    assert sl_store.get_connection("p1") is None


# ── lifecycle ────────────────────────────────────────────────────────────────

def test_a_fresh_install_awaits_channel_selection(db):
    conn = _install()
    assert conn.status == sl_store.STATUS_PENDING_SELECTION
    assert conn.needs_channel_selection is True
    assert conn.is_connected is False
    assert conn.channels == ()


def test_selecting_channels_connects_the_project(db):
    _install()
    conn = sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uA", channels=_chans("C1", "C2"))
    assert conn is not None
    assert conn.status == sl_store.STATUS_CONNECTED
    assert conn.is_connected is True
    assert [c.channel_id for c in conn.channels] == ["C1", "C2"]
    assert conn.public_view()["channel_count"] == 2


def test_selection_replaces_rather_than_appends(db):
    _install()
    sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                   channels=_chans("C1", "C2"))
    conn = sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                          channels=_chans("C3"))
    assert [c.channel_id for c in conn.channels] == ["C3"]


def test_selection_is_hard_capped_and_refused_not_truncated(db, monkeypatch):
    """Silently ingesting fewer channels than the user chose would be a lie."""
    monkeypatch.setenv("SLACK_MAX_SELECTED_CHANNELS", "2")
    _install()
    assert sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uA", channels=_chans("C1", "C2", "C3")) is None
    assert sl_store.get_connection("p1").status == sl_store.STATUS_PENDING_SELECTION


def test_selection_refuses_an_empty_set(db):
    _install()
    assert sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                          channels=[]) is None
    assert sl_store.get_connection("p1").is_connected is False


def test_selection_deduplicates_ids(db):
    _install()
    conn = sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C1", "name": "a"}, {"channel_id": "C1", "name": "b"}])
    assert [c.channel_id for c in conn.channels] == ["C1"]


def test_selection_requires_a_live_installation(db):
    """No orphan channel rows can be created without a stored credential."""
    assert sl_store.set_selected_channels(project_id="p_none", owner_user_id="uA",
                                          channels=_chans("C1")) is None
    _install()
    sl_store.mark_revoked("p1")
    assert sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                          channels=_chans("C1")) is None


def test_reinstall_resets_the_channel_binding(db):
    """A re-authorization may target a different workspace, so old channel ids
    are never assumed to still be valid."""
    _install()
    sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                   channels=_chans("C1"))
    conn = _install(team="T_OTHER")
    assert conn.team_id == "T_OTHER"
    assert conn.status == sl_store.STATUS_PENDING_SELECTION
    assert conn.channels == ()
    assert conn.last_sync_at == ""


def test_revoke_wipes_the_credential_but_keeps_the_row(db):
    _install()
    sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                   channels=_chans("C1"))
    assert sl_store.mark_revoked("p1") is True
    conn = sl_store.get_connection("p1")
    assert conn.is_revoked is True
    assert conn.bot_token_enc == ""
    assert conn.is_connected is False
    assert sl_store.decrypt_bot_token(conn) == ""


def test_mark_synced_advances_last_sync_at(db):
    _install()
    sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                   channels=_chans("C1"))
    assert sl_store.get_connection("p1").last_sync_at == ""
    sl_store.mark_synced("p1")
    assert sl_store.get_connection("p1").last_sync_at


def test_delete_removes_the_connection_and_its_channels(db):
    _install()
    sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                   channels=_chans("C1", "C2"))
    assert sl_store.delete_connection("p1") is True
    assert sl_store.get_connection("p1") is None
    assert sl_store.list_selected_channels("p1") == ()
    assert sl_store.delete_connection("p1") is False   # idempotent


# ── isolation between projects / owners ──────────────────────────────────────

def test_projects_hold_independent_connections(db):
    _install(project_id="p1", owner="uA")
    _install(project_id="p2", owner="uB")
    sl_store.set_selected_channels(project_id="p1", owner_user_id="uA",
                                   channels=_chans("C1"))
    sl_store.set_selected_channels(project_id="p2", owner_user_id="uB",
                                   channels=_chans("C2"))
    assert [c.channel_id for c in sl_store.get_connection("p1").channels] == ["C1"]
    assert [c.channel_id for c in sl_store.get_connection("p2").channels] == ["C2"]


def test_deleting_one_project_never_touches_another(db):
    """Slack installs an app once per WORKSPACE, so two projects can share one
    installation. Removing one must leave the other completely intact."""
    _install(project_id="p1", owner="uA", team="T_SHARED")
    _install(project_id="p2", owner="uB", team="T_SHARED")
    sl_store.set_selected_channels(project_id="p2", owner_user_id="uB",
                                   channels=_chans("C2"))
    sl_store.delete_connection("p1")
    other = sl_store.get_connection("p2")
    assert other is not None and other.is_connected is True
    assert sl_store.decrypt_bot_token(other) == BOT_TOKEN


# ── shared workspace accounting (fail-closed disconnect semantics) ───────────

def test_count_connected_for_team_excludes_the_disconnecting_project(db):
    _install(project_id="p1", owner="uA", team="T_SHARED")
    _install(project_id="p2", owner="uB", team="T_SHARED")
    assert sl_store.count_connected_for_team("T_SHARED", exclude_project_id="p1") == 1
    assert sl_store.count_connected_for_team("T_SHARED") == 2


def test_count_connected_ignores_revoked_and_unknown_teams(db):
    _install(project_id="p1", owner="uA", team="T_SHARED")
    _install(project_id="p2", owner="uB", team="T_SHARED")
    sl_store.mark_revoked("p2")
    assert sl_store.count_connected_for_team("T_SHARED", exclude_project_id="p1") == 0
    # A blank team id proves nothing, so it must claim nothing.
    assert sl_store.count_connected_for_team("") == 0
    assert sl_store.count_connected_for_team("T_UNKNOWN") == 0


def test_store_never_reaches_slack_at_all():
    """The store manages LOCAL rows only. `mark_revoked` is a status flag on our
    own row — there is no network path here, so a disconnect can never mutate a
    workspace or another project's installation."""
    import inspect
    # The module docstring legitimately NAMES the things that must not exist, so
    # only the code below it is inspected.
    src = inspect.getsource(sl_store).split('"""', 2)[-1]
    for forbidden in ("urllib", "requests", "httpx", "api_base",
                      "auth.revoke", "SlackClient"):
        assert forbidden not in src, f"{forbidden} appears in the Slack store"
