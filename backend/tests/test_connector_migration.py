# coding: utf-8
"""Legacy → shared connector authority migration.

Existing users already have project-scoped connector rows. Adopting them into the
account-level model is the highest-risk part of the refactor, so these tests pin
the safety rules rather than just the happy path:

  * NO PLAINTEXT EVER — credentials move as the ciphertext already on disk. The
    migration must run with NO encryption key available at all, and must still
    produce a decryptable credential once the key is back.
  * NEVER MERGE ACROSS OWNERS — two owners who connected the same mailbox keep
    two independent authorizations.
  * DEDUPLICATE WITHIN AN OWNER — the same owner's two project-scoped rows for
    the same account collapse to ONE authorization with two bindings, which is
    exactly the "stop repeating OAuth" outcome.
  * PRESERVE SELECTED RESOURCES — repos, Vercel projects and Slack channels
    survive verbatim, and a row that never got past resource selection stays
    pending instead of being promoted to connected.
  * IDEMPOTENT — a second run changes nothing.
  * FAIL CONSERVATIVELY — a row whose provider account identity cannot be
    determined is SKIPPED and REPORTED, never guessed at or merged.
  * NON-DESTRUCTIVE — legacy tables are left in place, so a rollback is "stop
    reading the new tables".
"""
from __future__ import annotations

import pytest

from backend.services.connectors import migrate as conn_migrate
from backend.services.connectors import store as shared
from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import store as gm_store
from backend.services.github import store as gh_store
from backend.services.google_calendar import store as cal_store
from backend.services.orchestrator import _sqlite
from backend.services.slack import store as sl_store
from backend.services.vercel import store as vc_store

LEGACY_SCHEMA = """
CREATE TABLE IF NOT EXISTS gmail_connections (
    project_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'gmail', google_email TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT '', refresh_token_enc TEXT NOT NULL DEFAULT '',
    access_token_enc TEXT NOT NULL DEFAULT '', access_token_expires TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'connected', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_sync_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS calendar_connections (
    project_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'calendar', google_email TEXT NOT NULL DEFAULT '',
    calendar_id TEXT NOT NULL DEFAULT 'primary', time_zone TEXT NOT NULL DEFAULT '',
    scopes TEXT NOT NULL DEFAULT '', refresh_token_enc TEXT NOT NULL DEFAULT '',
    access_token_enc TEXT NOT NULL DEFAULT '', access_token_expires TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'connected', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_sync_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS github_connections (
    project_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
    installation_id TEXT NOT NULL, repo_full_name TEXT NOT NULL,
    repo_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_sync_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vercel_connections (
    project_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'vercel', account_label TEXT NOT NULL DEFAULT '',
    team_id TEXT NOT NULL DEFAULT '', installation_id TEXT NOT NULL DEFAULT '',
    vercel_user_id TEXT NOT NULL DEFAULT '', access_token_enc TEXT NOT NULL DEFAULT '',
    vercel_project_id TEXT NOT NULL DEFAULT '', vercel_project_name TEXT NOT NULL DEFAULT '',
    framework TEXT NOT NULL DEFAULT '', production_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_selection', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, last_sync_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS slack_connections (
    project_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'slack', team_id TEXT NOT NULL DEFAULT '',
    team_name TEXT NOT NULL DEFAULT '', bot_user_id TEXT NOT NULL DEFAULT '',
    app_id TEXT NOT NULL DEFAULT '', scopes TEXT NOT NULL DEFAULT '',
    bot_token_enc TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending_selection',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_sync_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS slack_selected_channels (
    project_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', is_private INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, PRIMARY KEY (project_id, channel_id)
);
"""

NOW = "2026-01-01T00:00:00Z"


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    shared._reset_for_tests()
    shared.init_tables()
    with _sqlite.connection(path) as c:
        c.executescript(LEGACY_SCHEMA)
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _enc(value: str) -> str:
    return credential_crypto.encrypt(value)


def _legacy_gmail(db, *, project_id, owner, email, refresh="RT", status="connected"):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO gmail_connections
               (project_id, owner_user_id, provider, google_email, scopes,
                refresh_token_enc, access_token_enc, access_token_expires,
                status, created_at, updated_at, last_sync_at)
               VALUES (?,?,'gmail',?,?,?,?,'',?,?,?,'')""",
            (project_id, owner, email, "gmail.readonly", _enc(refresh), _enc("AT"),
             status, NOW, NOW),
        )


# ── the core outcome ─────────────────────────────────────────────────────────

def test_two_project_rows_for_one_account_collapse_to_one_authorization(db):
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com")
    _legacy_gmail(db, project_id="p2", owner="uA", email="me@x.com")

    report = conn_migrate.migrate_legacy_connections()
    assert report.as_dict()["ok"] is True
    assert report.authorizations_created == 1
    assert report.bindings_created == 2

    auths = shared.list_authorizations("uA", provider="gmail")
    assert len(auths) == 1
    assert shared.count_project_bindings(auths[0].id) == 2
    # Both projects keep working, on ONE credential.
    for pid in ("p1", "p2"):
        conn = gm_store.get_connection(pid)
        assert conn is not None and not conn.is_revoked
        assert gm_store.decrypt_refresh_token(conn) == "RT"


def test_owners_are_never_merged(db):
    _legacy_gmail(db, project_id="pA", owner="uA", email="shared@x.com", refresh="A-RT")
    _legacy_gmail(db, project_id="pB", owner="uB", email="shared@x.com", refresh="B-RT")

    conn_migrate.migrate_legacy_connections()
    a = shared.list_authorizations("uA", provider="gmail")
    b = shared.list_authorizations("uB", provider="gmail")
    assert len(a) == 1 and len(b) == 1 and a[0].id != b[0].id
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("pA")) == "A-RT"
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("pB")) == "B-RT"


def test_migration_never_needs_the_encryption_key(db, monkeypatch):
    """Ciphertext is COPIED, so no plaintext secret exists even transiently. The
    migration must complete with encryption entirely unavailable."""
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com", refresh="SECRET")
    credential_crypto.set_cipher_for_tests(None)   # key gone

    report = conn_migrate.migrate_legacy_connections()
    assert report.as_dict()["ok"] is True
    assert report.authorizations_created == 1

    # …and once the key is back, the migrated credential decrypts correctly.
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p1")) == "SECRET"


def test_migration_is_idempotent(db):
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com")
    first = conn_migrate.migrate_legacy_connections()
    second = conn_migrate.migrate_legacy_connections()
    assert first.bindings_created == 1
    assert second.bindings_created == 0
    assert second.authorizations_created == 0
    assert second.skipped_existing == 1
    assert len(shared.list_authorizations("uA", provider="gmail")) == 1
    assert shared.count_project_bindings(
        shared.list_authorizations("uA", provider="gmail")[0].id) == 1


def test_legacy_tables_are_left_in_place(db):
    """Non-destructive: rollback is 'stop reading the new tables'."""
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com")
    conn_migrate.migrate_legacy_connections()
    with _sqlite.connection(db) as c:
        rows = c.execute("SELECT COUNT(*) AS n FROM gmail_connections").fetchone()
    assert rows["n"] == 1


def test_a_row_migrated_under_the_new_model_is_not_overwritten(db):
    """A legacy row must never clobber a binding the user has since changed."""
    _legacy_gmail(db, project_id="p1", owner="uA", email="old@x.com", refresh="OLD")
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="new@x.com",
        scopes="s", refresh_token="NEW")
    report = conn_migrate.migrate_legacy_connections()
    assert report.skipped_existing == 1
    conn = gm_store.get_connection("p1")
    assert conn.google_email == "new@x.com"
    assert gm_store.decrypt_refresh_token(conn) == "NEW"


# ── fail conservatively ──────────────────────────────────────────────────────

def test_a_row_with_no_provable_account_identity_is_skipped_and_reported(db):
    _legacy_gmail(db, project_id="p1", owner="uA", email="")   # address unknown
    report = conn_migrate.migrate_legacy_connections()
    assert report.bindings_created == 0
    assert any("p1" in msg for msg in report.skipped_unsafe)
    assert gm_store.get_connection("p1") is None
    # The legacy row is untouched, so an operator can act on the report.
    with _sqlite.connection(db) as c:
        assert c.execute("SELECT COUNT(*) AS n FROM gmail_connections").fetchone()["n"] == 1


def test_a_slack_row_with_no_workspace_id_is_skipped(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO slack_connections
               (project_id, owner_user_id, team_id, bot_token_enc, status,
                created_at, updated_at)
               VALUES ('p1','uA','',?, 'connected', ?, ?)""",
            (_enc("xoxb"), NOW, NOW),
        )
    report = conn_migrate.migrate_legacy_connections()
    assert any("slack_connections[p1]" in m for m in report.skipped_unsafe)
    assert sl_store.get_connection("p1") is None


def test_one_broken_provider_does_not_stop_the_others(db):
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com")
    with _sqlite.connection(db) as c:
        c.execute("DROP TABLE slack_connections")   # table absent entirely
    report = conn_migrate.migrate_legacy_connections()
    assert report.as_dict()["ok"] is True
    assert gm_store.get_connection("p1") is not None


# ── selected resources survive verbatim ──────────────────────────────────────

def test_github_repo_selection_is_preserved(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO github_connections
               (project_id, owner_user_id, installation_id, repo_full_name,
                repo_id, created_at, updated_at, last_sync_at)
               VALUES ('p1','uA','100','octo/hello','42',?,?,'')""",
            (NOW, NOW),
        )
    conn_migrate.migrate_legacy_connections()
    conn = gh_store.get_connection("p1")
    assert conn is not None
    assert conn.installation_id == "100"
    assert conn.repo_full_name == "octo/hello"
    assert conn.repo_id == "42"
    # Webhook reverse routing still resolves after the move.
    assert [c.project_id for c in gh_store.find_connections_for_repo(
        installation_id="100", repo_full_name="octo/hello")] == ["p1"]


def test_vercel_project_selection_is_preserved(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO vercel_connections
               (project_id, owner_user_id, account_label, team_id, vercel_user_id,
                access_token_enc, vercel_project_id, vercel_project_name, framework,
                production_url, status, created_at, updated_at)
               VALUES ('p1','uA','Acme','team_1','vu_1',?,'vp_1','site','next',
                       'https://site.vercel.app','connected',?,?)""",
            (_enc("TOK"), NOW, NOW),
        )
    conn_migrate.migrate_legacy_connections()
    conn = vc_store.get_connection("p1")
    assert conn is not None and conn.is_connected
    assert conn.vercel_project_id == "vp_1"
    assert conn.vercel_project_name == "site"
    assert conn.team_id == "team_1"          # team scope survives — never re-scoped
    assert conn.framework == "next"
    assert vc_store.decrypt_access_token(conn) == "TOK"


def test_a_vercel_row_that_never_selected_a_project_stays_pending(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO vercel_connections
               (project_id, owner_user_id, team_id, access_token_enc, status,
                created_at, updated_at)
               VALUES ('p1','uA','team_1',?, 'pending_selection', ?, ?)""",
            (_enc("TOK"), NOW, NOW),
        )
    conn_migrate.migrate_legacy_connections()
    conn = vc_store.get_connection("p1")
    assert conn is not None
    assert conn.needs_project_selection is True
    assert conn.is_connected is False


def test_slack_channel_selection_is_preserved(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO slack_connections
               (project_id, owner_user_id, team_id, team_name, bot_user_id, app_id,
                scopes, bot_token_enc, status, created_at, updated_at)
               VALUES ('p1','uA','T1','Korvix AI','B1','A1','channels:history',
                       ?, 'connected', ?, ?)""",
            (_enc("xoxb-1"), NOW, NOW),
        )
        for cid, name in (("C1", "general"), ("C2", "product")):
            c.execute(
                """INSERT INTO slack_selected_channels
                   (project_id, channel_id, owner_user_id, name, is_private, created_at)
                   VALUES ('p1',?, 'uA', ?, 0, ?)""",
                (cid, name, NOW),
            )
    conn_migrate.migrate_legacy_connections()
    conn = sl_store.get_connection("p1")
    assert conn is not None and conn.is_connected
    assert conn.team_id == "T1" and conn.team_name == "Korvix AI"
    assert [c.channel_id for c in conn.channels] == ["C1", "C2"]
    assert sl_store.decrypt_bot_token(conn) == "xoxb-1"


def test_a_slack_row_with_no_channels_stays_pending(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO slack_connections
               (project_id, owner_user_id, team_id, bot_token_enc, status,
                created_at, updated_at)
               VALUES ('p1','uA','T1',?, 'pending_selection', ?, ?)""",
            (_enc("xoxb"), NOW, NOW),
        )
    conn_migrate.migrate_legacy_connections()
    conn = sl_store.get_connection("p1")
    assert conn is not None
    assert conn.needs_channel_selection is True
    assert conn.channels == ()


def test_calendar_binds_the_recorded_calendar_id(db):
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO calendar_connections
               (project_id, owner_user_id, google_email, calendar_id, time_zone,
                scopes, refresh_token_enc, access_token_enc, status,
                created_at, updated_at)
               VALUES ('p1','uA','me@x.com','work@group.calendar.google.com',
                       'Europe/Istanbul','cal.readonly',?,?, 'connected', ?, ?)""",
            (_enc("RT"), _enc("AT"), NOW, NOW),
        )
    conn_migrate.migrate_legacy_connections()
    conn = cal_store.get_connection("p1")
    assert conn is not None
    assert conn.calendar_id == "work@group.calendar.google.com"
    assert conn.time_zone == "Europe/Istanbul"
    assert cal_store.decrypt_refresh_token(conn) == "RT"


def test_gmail_and_calendar_for_one_account_stay_separate_authorizations(db):
    """Two Google connectors, one Google account: still two consents with two
    scopes, so they must remain two authorizations."""
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com", refresh="GM")
    with _sqlite.connection(db) as c:
        c.execute(
            """INSERT INTO calendar_connections
               (project_id, owner_user_id, google_email, calendar_id, scopes,
                refresh_token_enc, status, created_at, updated_at)
               VALUES ('p1','uA','me@x.com','primary','cal.readonly',?, 'connected', ?, ?)""",
            (_enc("CAL"), NOW, NOW),
        )
    conn_migrate.migrate_legacy_connections()
    gm = shared.list_authorizations("uA", provider="gmail")
    cal = shared.list_authorizations("uA", provider="calendar")
    assert len(gm) == 1 and len(cal) == 1 and gm[0].id != cal[0].id
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p1")) == "GM"
    assert cal_store.decrypt_refresh_token(cal_store.get_connection("p1")) == "CAL"


def test_a_revoked_legacy_row_migrates_as_revoked(db):
    _legacy_gmail(db, project_id="p1", owner="uA", email="me@x.com", status="revoked")
    conn_migrate.migrate_legacy_connections()
    conn = gm_store.get_connection("p1")
    assert conn is not None and conn.is_revoked
