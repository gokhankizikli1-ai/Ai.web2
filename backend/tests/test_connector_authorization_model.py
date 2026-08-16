# coding: utf-8
"""The SHARED connector authority — authorize once, bind per project.

These tests pin the properties the whole refactor exists for, and the ones a
mistake here would quietly destroy:

  * one OAuth grant per (owner, provider, provider account) — a second project
    binds the SAME authorization and never re-authorizes;
  * owner isolation — user A can never bind user B's authorization, and two
    owners who connect the SAME provider account keep two independent grants;
  * project isolation — one project's resources never leak into another;
  * "remove from project" ≠ "disconnect provider" — unbinding one project must
    leave every other project working;
  * credentials are ciphertext at rest and never appear in any projection;
  * resource ids are never accepted from a client without provider validation
    (the shared store persists a decision; it does not make one).
"""
from __future__ import annotations

import json

import pytest

from backend.services.connectors import registry
from backend.services.connectors import store as shared
from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import store as gm_store
from backend.services.google_calendar import store as cal_store
from backend.services.github import store as gh_store
from backend.services.slack import store as sl_store
from backend.services.vercel import store as vc_store


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    shared._reset_for_tests()
    shared.init_tables()
    yield path
    credential_crypto.set_cipher_for_tests(None)


# ── authorize once ───────────────────────────────────────────────────────────

def test_second_project_reuses_the_same_authorization(db):
    """The whole point: connecting Gmail in a second project must NOT create a
    second grant, and must not require a second OAuth round-trip."""
    a = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT", access_token="AT")
    assert a is not None

    # No OAuth here — just a binding on the authorization we already hold.
    b = gm_store.bind_project(
        project_id="p2", owner_user_id="uA", authorization_id=a.authorization_id)
    assert b is not None
    assert b.authorization_id == a.authorization_id
    assert len(shared.list_authorizations("uA", provider="gmail")) == 1
    assert shared.count_project_bindings(a.authorization_id) == 2
    # Both projects read the same mailbox with the same credential.
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p2")) == "RT"


def test_reauthorizing_updates_the_one_authorization(db):
    first = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT-1", access_token="AT-1")
    second = gm_store.upsert_connection(
        project_id="p2", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT-2", access_token="AT-2")
    assert first.authorization_id == second.authorization_id
    assert len(shared.list_authorizations("uA", provider="gmail")) == 1
    # p1 now reads through the refreshed credential — one grant, one refresh.
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p1")) == "RT-2"


def test_authorize_account_binds_nothing(db):
    """Connecting a provider must NOT expose it to any project by itself."""
    auth = gm_store.authorize_account(
        owner_user_id="uA", google_email="me@x.com", scopes="s",
        refresh_token="RT", access_token="AT")
    assert auth is not None
    assert shared.count_project_bindings(auth.id) == 0
    assert gm_store.get_connection("p1") is None


# ── owner isolation ──────────────────────────────────────────────────────────

def test_user_a_cannot_bind_user_bs_authorization(db):
    b_auth = gm_store.authorize_account(
        owner_user_id="uB", google_email="b@x.com", scopes="s", refresh_token="B-RT")
    assert b_auth is not None
    # A binding whose recorded owner does not match the authorization's owner is
    # refused OUTRIGHT — nothing partial is written.
    written = shared.set_binding(
        project_id="pA", authorization_id=b_auth.id, owner_user_id="uA",
        resources=[{"resource_id": "", "resource_label": "", "resource": {}}],
    )
    assert written == []
    assert shared.list_project_bindings("pA") == []
    assert gm_store.get_connection("pA") is None


def test_two_owners_with_the_same_provider_account_stay_separate(db):
    a = gm_store.upsert_connection(
        project_id="pA", owner_user_id="uA", google_email="shared@x.com",
        scopes="s", refresh_token="A-RT")
    b = gm_store.upsert_connection(
        project_id="pB", owner_user_id="uB", google_email="shared@x.com",
        scopes="s", refresh_token="B-RT")
    assert a.authorization_id != b.authorization_id
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("pA")) == "A-RT"
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("pB")) == "B-RT"
    # Disconnecting A's account leaves B's completely intact.
    gm_store.delete_authorization(a.authorization_id)
    assert gm_store.get_connection("pA") is None
    assert gm_store.get_connection("pB") is not None


# ── project isolation ────────────────────────────────────────────────────────

def test_slack_channels_do_not_leak_between_projects(db):
    conn = sl_store.upsert_installation(
        project_id="p1", owner_user_id="uA", bot_token="xoxb-1", team_id="T1",
        team_name="Korvix", scopes="channels:history")
    assert conn is not None
    sl_store.start_project_binding(
        project_id="p2", owner_user_id="uA", authorization_id=conn.authorization_id)

    sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C_A", "name": "alpha"}])
    sl_store.set_selected_channels(
        project_id="p2", owner_user_id="uA",
        channels=[{"channel_id": "C_B", "name": "beta"}])

    assert [c.channel_id for c in sl_store.list_selected_channels("p1")] == ["C_A"]
    assert [c.channel_id for c in sl_store.list_selected_channels("p2")] == ["C_B"]
    # One workspace installation backing both.
    assert sl_store.get_connection("p1").authorization_id == \
        sl_store.get_connection("p2").authorization_id


def test_github_repo_belongs_to_exactly_one_project(db):
    first = gh_store.upsert_connection(
        project_id="p1", owner_user_id="uA", installation_id="100",
        repo_full_name="octo/hello", repo_id="42")
    assert first is not None
    clash = gh_store.upsert_connection(
        project_id="p2", owner_user_id="uA", installation_id="100",
        repo_full_name="octo/hello")
    assert clash is None, "a repo must not be claimable by a second project"
    # A DIFFERENT repo under the same installation is fine — that is the point
    # of an account-level installation.
    other = gh_store.upsert_connection(
        project_id="p2", owner_user_id="uA", installation_id="100",
        repo_full_name="octo/world")
    assert other is not None
    assert other.authorization_id == first.authorization_id


def test_vercel_projects_are_per_korvix_project(db):
    conn = vc_store.upsert_authorization(
        project_id="p1", owner_user_id="uA", access_token="TOK",
        account_label="Acme", team_id="team_1")
    assert conn is not None and conn.needs_project_selection
    vc_store.bind_project(project_id="p1", vercel_project_id="vp_1", name="site-a")
    vc_store.start_project_binding(
        project_id="p2", owner_user_id="uA", authorization_id=conn.authorization_id)
    vc_store.bind_project(project_id="p2", vercel_project_id="vp_2", name="site-b")

    assert vc_store.get_connection("p1").vercel_project_id == "vp_1"
    assert vc_store.get_connection("p2").vercel_project_id == "vp_2"
    assert vc_store.get_connection("p1").authorization_id == \
        vc_store.get_connection("p2").authorization_id


# ── remove-from-project vs disconnect-account ────────────────────────────────

def test_unbinding_one_project_leaves_the_others_working(db):
    a = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT")
    gm_store.bind_project(project_id="p2", owner_user_id="uA",
                          authorization_id=a.authorization_id)

    assert gm_store.delete_connection("p1") is True
    assert gm_store.get_connection("p1") is None
    # The provider authorization — and every other project — survives.
    surviving = gm_store.get_connection("p2")
    assert surviving is not None and surviving.authorization_id == a.authorization_id
    assert shared.get_authorization(a.authorization_id) is not None


def test_unbinding_the_last_project_drops_the_now_unused_authorization(db):
    """A single-project user keeps EXACTLY the previous behaviour: disconnecting
    removes the stored credential."""
    a = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT")
    assert gm_store.delete_connection("p1") is True
    assert shared.get_authorization(a.authorization_id) is None


def test_account_disconnect_removes_every_binding(db):
    a = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT")
    gm_store.bind_project(project_id="p2", owner_user_id="uA",
                          authorization_id=a.authorization_id)
    gm_store.bind_project(project_id="p3", owner_user_id="uA",
                          authorization_id=a.authorization_id)
    assert shared.count_project_bindings(a.authorization_id) == 3

    assert gm_store.delete_authorization(a.authorization_id) is True
    for pid in ("p1", "p2", "p3"):
        assert gm_store.get_connection(pid) is None
    assert shared.list_project_bindings("p2") == []


def test_delete_authorization_refuses_a_foreign_provider_id(db):
    """A Gmail authorization id must not be deletable through the Slack store —
    a provider-crossing id is refused rather than acted on."""
    a = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT")
    assert sl_store.delete_authorization(a.authorization_id) is False
    assert shared.get_authorization(a.authorization_id) is not None


def test_revoking_a_grant_marks_every_binding_revoked(db):
    """A rejected refresh token is ACCOUNT-level truth: no bound project may keep
    claiming to be live on a credential that no longer works."""
    a = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="RT")
    gm_store.bind_project(project_id="p2", owner_user_id="uA",
                          authorization_id=a.authorization_id)
    assert gm_store.mark_revoked("p1") is True
    for pid in ("p1", "p2"):
        conn = gm_store.get_connection(pid)
        assert conn is not None and conn.is_revoked
        assert conn.refresh_token_enc == "" and conn.access_token_enc == ""


# ── secrets ──────────────────────────────────────────────────────────────────

def test_credentials_are_ciphertext_at_rest_and_absent_from_projections(db):
    conn = gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        scopes="s", refresh_token="PLAINTEXT-REFRESH", access_token="PLAINTEXT-ACCESS")
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(db) as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM connector_authorizations")]
        binds = [dict(r) for r in c.execute("SELECT * FROM connector_project_bindings")]
    blob = json.dumps(rows) + json.dumps(binds)
    assert "PLAINTEXT-REFRESH" not in blob and "PLAINTEXT-ACCESS" not in blob
    creds = json.loads(rows[0]["credentials_json"])
    assert all(credential_crypto.is_envelope(v) for v in creds.values())
    # Neither the connection projection nor the authorization projection leaks.
    assert "PLAINTEXT" not in json.dumps(conn.public_view())
    auth = shared.get_authorization(conn.authorization_id)
    assert "credentials" not in auth.public_view()
    assert "PLAINTEXT" not in json.dumps(auth.public_view())


def test_upsert_refuses_a_credential_that_is_not_an_envelope(db):
    """The migration path accepts ALREADY-encrypted values; it must refuse
    anything that is not provably ciphertext, so a plaintext token can never be
    smuggled in through it."""
    assert shared.upsert_authorization(
        owner_user_id="uA", provider="gmail", account_key="me@x.com",
        encrypted_credentials={"refresh_token": "not-an-envelope"},
    ) is None
    assert shared.find_authorization(owner_user_id="uA", provider="gmail") is None


def test_missing_encryption_key_fails_closed(db):
    credential_crypto.set_cipher_for_tests(None)
    from backend.services.gmail.errors import CredentialEncryptionError
    with pytest.raises(CredentialEncryptionError):
        gm_store.upsert_connection(
            project_id="p1", owner_user_id="uA", google_email="me@x.com",
            scopes="s", refresh_token="RT")
    assert gm_store.get_connection("p1") is None


# ── resource semantics per provider ──────────────────────────────────────────

def test_registry_states_each_providers_real_resource_shape(db):
    assert registry.spec("gmail").resource_kind == registry.RESOURCE_ACCOUNT
    assert registry.spec("calendar").resource_kind == registry.RESOURCE_SINGLE
    assert registry.spec("github").resource_kind == registry.RESOURCE_SINGLE
    assert registry.spec("vercel").resource_kind == registry.RESOURCE_SINGLE
    assert registry.spec("slack").resource_kind == registry.RESOURCE_MULTI
    assert registry.spec("nope") is None


def test_calendar_binds_a_named_calendar_per_project(db):
    conn = cal_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com",
        calendar_id="primary", time_zone="UTC", scopes="s", refresh_token="RT")
    assert conn.calendar_id == "primary"
    binding = shared.get_binding("p1", "calendar")
    assert binding.resource_id == "primary"


def test_reselecting_resources_replaces_the_set_and_keeps_connected_since(db):
    conn = sl_store.upsert_installation(
        project_id="p1", owner_user_id="uA", bot_token="xoxb", team_id="T1")
    sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C1", "name": "one"},
                  {"channel_id": "C2", "name": "two"}])
    before = sl_store.get_connection("p1")
    sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C3", "name": "three"}])
    after = sl_store.get_connection("p1")
    assert [c.channel_id for c in after.channels] == ["C3"]
    # Changing which channels a project reads is an EDIT to one connection, not
    # a new connection — the "connected since" date must not jump forward.
    assert after.created_at == before.created_at
    assert conn.authorization_id == after.authorization_id


def test_slack_selection_refuses_a_foreign_owner(db):
    sl_store.upsert_installation(
        project_id="p1", owner_user_id="uA", bot_token="xoxb", team_id="T1")
    assert sl_store.set_selected_channels(
        project_id="p1", owner_user_id="uINTRUDER",
        channels=[{"channel_id": "C1", "name": "one"}]) is None
    assert sl_store.list_selected_channels("p1") == ()


def test_slack_selection_requires_a_live_installation(db):
    """No orphan rows: selecting channels for a project with no installation
    must not fabricate a connection."""
    assert sl_store.set_selected_channels(
        project_id="ghost", owner_user_id="uA",
        channels=[{"channel_id": "C1", "name": "one"}]) is None
    assert sl_store.get_connection("ghost") is None


def test_webhook_reverse_lookup_ignores_an_unknown_repo(db):
    gh_store.upsert_connection(
        project_id="p1", owner_user_id="uA", installation_id="100",
        repo_full_name="octo/hello", repo_id="42")
    assert [c.project_id for c in gh_store.find_connections_for_repo(
        installation_id="100", repo_full_name="octo/hello")] == ["p1"]
    # A repo rename still routes via the numeric id.
    assert [c.project_id for c in gh_store.find_connections_for_repo(
        installation_id="100", repo_full_name="octo/renamed", repo_id="42")] == ["p1"]
    # Unknown repo, and a right repo under the WRONG installation, both resolve
    # to nothing → the delivery is safely ignored.
    assert gh_store.find_connections_for_repo(
        installation_id="100", repo_full_name="someone/else") == []
    assert gh_store.find_connections_for_repo(
        installation_id="999", repo_full_name="octo/hello") == []
