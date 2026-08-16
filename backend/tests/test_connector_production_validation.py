# coding: utf-8
"""PRODUCTION VALIDATION of the account-level connector model.

This suite is deliberately different from `test_connector_migration.py`. That one
uses hand-written fixtures to pin individual migration rules; this one builds a
REALISTIC pre-upgrade database — the legacy DDL copied VERBATIM from `main`
(indexes and the GitHub reverse-uniqueness index included), populated with the
kind of rows a real deployment accumulates — and then validates the whole upgrade
path end to end:

  * every provider migrates, and every previously-selected resource survives;
  * duplicate same-owner rows collapse; different-owner rows never merge;
  * a partially-migrated database converges instead of double-writing;
  * a row with unreadable credential material is refused, not silently adopted;
  * repeated boots are inert;
  * remove-from-project ≠ disconnect-provider;
  * the Google shared-grant revoke gate still fails closed under the new model;
  * GitHub webhook routing still resolves after the store move;
  * project A can never read or sync project B's resources.

The legacy schema below is a byte copy of the pre-refactor `_SCHEMA` blocks, so a
future change to the migration is tested against what production actually has on
disk rather than a convenient approximation.
"""
from __future__ import annotations

import json

import pytest

from backend.services import google_grant
from backend.services.connectors import migrate as conn_migrate
from backend.services.connectors import store as shared
from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import store as gm_store
from backend.services.github import store as gh_store
from backend.services.google_calendar import store as cal_store
from backend.services.orchestrator import _sqlite
from backend.services.slack import store as sl_store
from backend.services.vercel import store as vc_store

# ── the REAL pre-refactor schema (verbatim from main) ────────────────────────
LEGACY_DDL = """
CREATE TABLE IF NOT EXISTS gmail_connections (
    project_id            TEXT PRIMARY KEY,
    owner_user_id         TEXT NOT NULL,
    provider              TEXT NOT NULL DEFAULT 'gmail',
    google_email          TEXT NOT NULL DEFAULT '',
    scopes                TEXT NOT NULL DEFAULT '',
    refresh_token_enc     TEXT NOT NULL DEFAULT '',
    access_token_enc      TEXT NOT NULL DEFAULT '',
    access_token_expires  TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'connected',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_sync_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_gmailconn_owner  ON gmail_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_gmailconn_email  ON gmail_connections(google_email);
CREATE INDEX IF NOT EXISTS ix_gmailconn_status ON gmail_connections(status);

CREATE TABLE IF NOT EXISTS calendar_connections (
    project_id            TEXT PRIMARY KEY,
    owner_user_id         TEXT NOT NULL,
    provider              TEXT NOT NULL DEFAULT 'calendar',
    google_email          TEXT NOT NULL DEFAULT '',
    calendar_id           TEXT NOT NULL DEFAULT 'primary',
    time_zone             TEXT NOT NULL DEFAULT '',
    scopes                TEXT NOT NULL DEFAULT '',
    refresh_token_enc     TEXT NOT NULL DEFAULT '',
    access_token_enc      TEXT NOT NULL DEFAULT '',
    access_token_expires  TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'connected',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_sync_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_calconn_owner  ON calendar_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_calconn_email  ON calendar_connections(google_email);
CREATE INDEX IF NOT EXISTS ix_calconn_status ON calendar_connections(status);

CREATE TABLE IF NOT EXISTS github_connections (
    project_id       TEXT PRIMARY KEY,
    owner_user_id    TEXT NOT NULL,
    installation_id  TEXT NOT NULL,
    repo_full_name   TEXT NOT NULL,
    repo_id          TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    last_sync_at     TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ghconn_inst_repo
    ON github_connections(installation_id, repo_full_name);
CREATE INDEX IF NOT EXISTS ix_ghconn_repo  ON github_connections(repo_full_name);
CREATE INDEX IF NOT EXISTS ix_ghconn_inst  ON github_connections(installation_id);
CREATE INDEX IF NOT EXISTS ix_ghconn_owner ON github_connections(owner_user_id);

CREATE TABLE IF NOT EXISTS github_deliveries (
    delivery_id   TEXT PRIMARY KEY,
    received_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vercel_connections (
    project_id            TEXT PRIMARY KEY,
    owner_user_id         TEXT NOT NULL,
    provider              TEXT NOT NULL DEFAULT 'vercel',
    account_label         TEXT NOT NULL DEFAULT '',
    team_id               TEXT NOT NULL DEFAULT '',
    installation_id       TEXT NOT NULL DEFAULT '',
    vercel_user_id        TEXT NOT NULL DEFAULT '',
    access_token_enc      TEXT NOT NULL DEFAULT '',
    vercel_project_id     TEXT NOT NULL DEFAULT '',
    vercel_project_name   TEXT NOT NULL DEFAULT '',
    framework             TEXT NOT NULL DEFAULT '',
    production_url        TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'pending_selection',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    last_sync_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_vercelconn_owner   ON vercel_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_vercelconn_status  ON vercel_connections(status);
CREATE INDEX IF NOT EXISTS ix_vercelconn_project ON vercel_connections(vercel_project_id);

CREATE TABLE IF NOT EXISTS slack_connections (
    project_id      TEXT PRIMARY KEY,
    owner_user_id   TEXT NOT NULL,
    provider        TEXT NOT NULL DEFAULT 'slack',
    team_id         TEXT NOT NULL DEFAULT '',
    team_name       TEXT NOT NULL DEFAULT '',
    bot_user_id     TEXT NOT NULL DEFAULT '',
    app_id          TEXT NOT NULL DEFAULT '',
    scopes          TEXT NOT NULL DEFAULT '',
    bot_token_enc   TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending_selection',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_sync_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_slackconn_owner  ON slack_connections(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_slackconn_status ON slack_connections(status);
CREATE INDEX IF NOT EXISTS ix_slackconn_team   ON slack_connections(team_id);

CREATE TABLE IF NOT EXISTS slack_selected_channels (
    project_id    TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    is_private    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (project_id, channel_id)
);
CREATE INDEX IF NOT EXISTS ix_slackchan_owner ON slack_selected_channels(owner_user_id);
"""

T0 = "2026-01-04T09:12:00Z"
T1 = "2026-02-11T16:40:00Z"


@pytest.fixture()
def legacy(tmp_path, monkeypatch):
    """A realistic pre-upgrade projects.db, before the migration runs."""
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    shared._reset_for_tests()
    with _sqlite.connection(path) as c:
        c.executescript(LEGACY_DDL)
    _seed_realistic(path)
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _enc(v: str) -> str:
    return credential_crypto.encrypt(v)


def _seed_realistic(path: str) -> None:
    """The shape a real account accumulates:

    owner uA — three projects.
      · Gmail on p-alpha AND p-beta, SAME mailbox (the duplicate-OAuth pain).
      · Calendar on p-alpha, a non-primary calendar with a timezone.
      · GitHub on p-alpha and p-beta, SAME installation, DIFFERENT repos.
      · Vercel on p-alpha (bound) and p-gamma (authorized, never selected).
      · Slack on p-alpha (2 channels) and p-beta (1 channel), same workspace.
    owner uB — one project, the SAME Gmail mailbox and SAME Slack workspace as
      uA (a colleague on a shared team). These must NEVER merge with uA's.
    """
    with _sqlite.connection(path) as c:
        # Gmail — one mailbox, two projects (uA) + a different owner (uB).
        for pid in ("p-alpha", "p-beta"):
            c.execute(
                """INSERT INTO gmail_connections (project_id, owner_user_id, provider,
                   google_email, scopes, refresh_token_enc, access_token_enc,
                   access_token_expires, status, created_at, updated_at, last_sync_at)
                   VALUES (?,?,'gmail','founder@korvix.ai',
                   'https://www.googleapis.com/auth/gmail.readonly',?,?,?, 'connected',?,?,?)""",
                (pid, "uA", _enc("GMAIL-REFRESH-uA"), _enc("GMAIL-ACCESS-uA"),
                 "2030-01-01T00:00:00Z", T0, T1, T1),
            )
        c.execute(
            """INSERT INTO gmail_connections (project_id, owner_user_id, provider,
               google_email, scopes, refresh_token_enc, access_token_enc,
               access_token_expires, status, created_at, updated_at, last_sync_at)
               VALUES ('p-bee','uB','gmail','founder@korvix.ai','gmail.readonly',?,?,'','connected',?,?,'')""",
            (_enc("GMAIL-REFRESH-uB"), _enc("GMAIL-ACCESS-uB"), T0, T1),
        )
        # Calendar — a NON-primary calendar, so "primary" cannot be assumed.
        c.execute(
            """INSERT INTO calendar_connections (project_id, owner_user_id, provider,
               google_email, calendar_id, time_zone, scopes, refresh_token_enc,
               access_token_enc, access_token_expires, status, created_at, updated_at, last_sync_at)
               VALUES ('p-alpha','uA','calendar','founder@korvix.ai',
               'team@group.calendar.google.com','Europe/Istanbul',
               'https://www.googleapis.com/auth/calendar.events.readonly',?,?,'','connected',?,?,?)""",
            (_enc("CAL-REFRESH-uA"), _enc("CAL-ACCESS-uA"), T0, T1, T1),
        )
        # GitHub — one installation, two repos, two projects.
        for pid, repo, rid in (("p-alpha", "korvix-ai/web", "8811"),
                               ("p-beta", "korvix-ai/worker", "8812")):
            c.execute(
                """INSERT INTO github_connections (project_id, owner_user_id,
                   installation_id, repo_full_name, repo_id, created_at, updated_at, last_sync_at)
                   VALUES (?,?, '55501', ?, ?, ?, ?, ?)""",
                (pid, "uA", repo, rid, T0, T1, T1),
            )
        # Vercel — one bound project, one authorized-but-never-selected.
        c.execute(
            """INSERT INTO vercel_connections (project_id, owner_user_id, provider,
               account_label, team_id, installation_id, vercel_user_id, access_token_enc,
               vercel_project_id, vercel_project_name, framework, production_url,
               status, created_at, updated_at, last_sync_at)
               VALUES ('p-alpha','uA','vercel','Korvix Team','team_kx','icfg_9','vu_1',?,
               'prj_web','korvix-web','nextjs','https://korvix.ai','connected',?,?,?)""",
            (_enc("VERCEL-TOKEN-uA"), T0, T1, T1),
        )
        c.execute(
            """INSERT INTO vercel_connections (project_id, owner_user_id, provider,
               account_label, team_id, installation_id, vercel_user_id, access_token_enc,
               vercel_project_id, vercel_project_name, framework, production_url,
               status, created_at, updated_at, last_sync_at)
               VALUES ('p-gamma','uA','vercel','Korvix Team','team_kx','icfg_9','vu_1',?,
               '','','','','pending_selection',?,?,'')""",
            (_enc("VERCEL-TOKEN-uA"), T0, T1),
        )
        # Slack — one workspace, two projects, different channels; plus uB.
        for pid, status in (("p-alpha", "connected"), ("p-beta", "connected")):
            c.execute(
                """INSERT INTO slack_connections (project_id, owner_user_id, provider,
                   team_id, team_name, bot_user_id, app_id, scopes, bot_token_enc,
                   status, created_at, updated_at, last_sync_at)
                   VALUES (?,?, 'slack','T0KRVX','Korvix AI','B0BOT','A0APP',
                   'channels:history,channels:read',?,?,?,?,?)""",
                (pid, "uA", _enc("SLACK-BOT-uA"), status, T0, T1, T1),
            )
        for pid, cid, name, priv in (("p-alpha", "C_GENERAL", "general", 0),
                                     ("p-alpha", "C_PRODUCT", "product", 1),
                                     ("p-beta", "C_ENG", "engineering", 0)):
            c.execute(
                """INSERT INTO slack_selected_channels (project_id, channel_id,
                   owner_user_id, name, is_private, created_at) VALUES (?,?, 'uA', ?, ?, ?)""",
                (pid, cid, name, priv, T0),
            )
        c.execute(
            """INSERT INTO slack_connections (project_id, owner_user_id, provider,
               team_id, team_name, bot_user_id, app_id, scopes, bot_token_enc,
               status, created_at, updated_at, last_sync_at)
               VALUES ('p-bee','uB','slack','T0KRVX','Korvix AI','B0BOT','A0APP',
               'channels:history',?, 'connected',?,?,'')""",
            (_enc("SLACK-BOT-uB"), T0, T1),
        )
        c.execute(
            """INSERT INTO slack_selected_channels (project_id, channel_id,
               owner_user_id, name, is_private, created_at)
               VALUES ('p-bee','C_BEE','uB','bee-team',0,?)""",
            (T0,),
        )


# ═══════════════════════════════════════════════════════════════════════════
# 2 + 3. Migration against realistic legacy rows
# ═══════════════════════════════════════════════════════════════════════════

def test_full_migration_of_a_realistic_account(legacy):
    report = conn_migrate.migrate_legacy_connections()
    assert report.as_dict()["ok"] is True
    assert report.skipped_unsafe == [], report.skipped_unsafe

    # uA: gmail(1) + calendar(1) + github(1) + vercel(1) + slack(1) = 5 grants,
    # NOT the 10 legacy rows they came from.
    ua = shared.list_authorizations("uA")
    assert sorted(a.provider for a in ua) == [
        "calendar", "github", "gmail", "slack", "vercel"]
    # uB keeps its own gmail + slack, never merged into uA's.
    ub = shared.list_authorizations("uB")
    assert sorted(a.provider for a in ub) == ["gmail", "slack"]


def test_duplicate_same_owner_connections_collapse_to_one_grant(legacy):
    conn_migrate.migrate_legacy_connections()
    gmail = shared.list_authorizations("uA", provider="gmail")
    assert len(gmail) == 1, "two project rows for one mailbox must become ONE grant"
    assert shared.count_project_bindings(gmail[0].id) == 2
    # Both projects still work, on the same credential.
    for pid in ("p-alpha", "p-beta"):
        assert gm_store.decrypt_refresh_token(
            gm_store.get_connection(pid)) == "GMAIL-REFRESH-uA"


def test_different_owners_on_the_same_provider_account_never_merge(legacy):
    conn_migrate.migrate_legacy_connections()
    a = shared.list_authorizations("uA", provider="gmail")[0]
    b = shared.list_authorizations("uB", provider="gmail")[0]
    assert a.id != b.id
    assert a.account_key == b.account_key == "founder@korvix.ai"
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p-alpha")) == "GMAIL-REFRESH-uA"
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p-bee")) == "GMAIL-REFRESH-uB"
    # Same for the shared Slack workspace.
    sa = shared.list_authorizations("uA", provider="slack")[0]
    sb = shared.list_authorizations("uB", provider="slack")[0]
    assert sa.id != sb.id and sa.account_key == sb.account_key == "T0KRVX"


def test_a_partially_migrated_database_converges(legacy):
    """A boot that was interrupted after some providers migrated. The next boot
    must finish the rest and re-adopt nothing."""
    # Simulate: only Gmail got through last time.
    conn_migrate._migrate_google(
        conn_migrate.MigrationReport(), table="gmail_connections", provider="gmail")
    assert len(shared.list_authorizations("uA", provider="gmail")) == 1
    assert shared.list_authorizations("uA", provider="slack") == []

    report = conn_migrate.migrate_legacy_connections()
    # Gmail's 3 bindings (p-alpha, p-beta, p-bee) are recognised, not re-created.
    assert report.skipped_existing == 3
    assert len(shared.list_authorizations("uA", provider="gmail")) == 1
    assert shared.count_project_bindings(
        shared.list_authorizations("uA", provider="gmail")[0].id) == 2
    # …and the rest completed.
    assert len(shared.list_authorizations("uA", provider="slack")) == 1
    assert sl_store.get_connection("p-alpha") is not None


def test_a_row_with_unreadable_credential_material_is_refused(legacy):
    """A corrupted / truncated / pre-encryption credential column must never be
    adopted as if it were ciphertext."""
    with _sqlite.connection(legacy) as c:
        c.execute("UPDATE gmail_connections SET refresh_token_enc='PLAINTEXT-LEAK' "
                  "WHERE project_id='p-alpha'")
    report = conn_migrate.migrate_legacy_connections()

    assert any("gmail_connections[p-alpha]" in m for m in report.skipped_unsafe)
    assert gm_store.get_connection("p-alpha") is None
    # The unreadable value never reached the new tables in any form.
    with _sqlite.connection(legacy) as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM connector_authorizations")]
    assert "PLAINTEXT-LEAK" not in json.dumps(rows)
    # The legacy row is untouched, so an operator can act on the report.
    with _sqlite.connection(legacy) as c:
        n = c.execute("SELECT COUNT(*) AS n FROM gmail_connections "
                      "WHERE project_id='p-alpha'").fetchone()["n"]
    assert n == 1


def test_one_unreadable_row_does_not_block_its_healthy_siblings(legacy):
    with _sqlite.connection(legacy) as c:
        c.execute("UPDATE gmail_connections SET refresh_token_enc='CORRUPT' "
                  "WHERE project_id='p-alpha'")
    conn_migrate.migrate_legacy_connections()
    # p-beta shares the mailbox and IS readable — it must still migrate.
    beta = gm_store.get_connection("p-beta")
    assert beta is not None
    assert gm_store.decrypt_refresh_token(beta) == "GMAIL-REFRESH-uA"
    # And every other provider is unaffected.
    assert sl_store.get_connection("p-alpha") is not None
    assert gh_store.get_connection("p-alpha") is not None


def test_repeated_boots_are_inert(legacy):
    first = conn_migrate.migrate_legacy_connections()
    assert first.bindings_created > 0

    def snapshot():
        with _sqlite.connection(legacy) as c:
            a = [dict(r) for r in c.execute(
                "SELECT * FROM connector_authorizations ORDER BY id")]
            b = [dict(r) for r in c.execute(
                "SELECT * FROM connector_project_bindings "
                "ORDER BY project_id, provider, resource_id")]
        # `updated_at` legitimately moves; identity/content must not.
        for row in a + b:
            row.pop("updated_at", None)
        return json.dumps([a, b], sort_keys=True)

    after_first = snapshot()
    for _ in range(3):
        again = conn_migrate.migrate_legacy_connections()
        assert again.authorizations_created == 0
        assert again.bindings_created == 0
    assert snapshot() == after_first, "a repeated boot changed stored state"


def test_migration_needs_no_encryption_key_on_a_realistic_database(legacy):
    """Credentials move as ciphertext, so a deployment whose key is temporarily
    unavailable still migrates — and decrypts correctly once it is back."""
    credential_crypto.set_cipher_for_tests(None)
    report = conn_migrate.migrate_legacy_connections()
    assert report.as_dict()["ok"] is True
    assert report.skipped_unsafe == []

    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p-alpha")) == "GMAIL-REFRESH-uA"
    assert sl_store.decrypt_bot_token(sl_store.get_connection("p-alpha")) == "SLACK-BOT-uA"
    assert vc_store.decrypt_access_token(vc_store.get_connection("p-alpha")) == "VERCEL-TOKEN-uA"


def test_a_grant_whose_credentials_were_already_wiped_migrates_as_revoked(legacy):
    """Legacy `mark_revoked()` wiped a connection's tokens in place and kept the
    row so the UI could offer a reconnect. Such a row must NOT arrive as a
    healthy account-level grant — the card would say "Connected" while every
    sync failed."""
    with _sqlite.connection(legacy) as c:
        c.execute("""UPDATE gmail_connections
                     SET status='revoked', refresh_token_enc='', access_token_enc=''""")
    report = conn_migrate.migrate_legacy_connections()

    for owner in ("uA", "uB"):
        auth = shared.list_authorizations(owner, provider="gmail")[0]
        assert auth.is_revoked, "a credential-less grant must not report itself authorized"
        assert auth.public_view()["authorized"] is False
    assert len(report.revoked_without_credentials) == 2
    assert all("reconnect required" in m for m in report.revoked_without_credentials)
    # The rows are RETAINED so the user can reconnect in place.
    assert gm_store.get_connection("p-alpha") is not None
    assert gm_store.get_connection("p-alpha").is_revoked


def test_one_revoked_row_does_not_revoke_a_grant_another_project_still_uses(legacy):
    """Order-dependence guard: a mailbox with one stale (revoked, wiped) row and
    one live row merges into ONE grant that IS usable. Revoking it because the
    stale row was seen would break a working connection."""
    with _sqlite.connection(legacy) as c:
        c.execute("""UPDATE gmail_connections
                     SET status='revoked', refresh_token_enc='', access_token_enc=''
                     WHERE project_id='p-alpha'""")
    conn_migrate.migrate_legacy_connections()

    auth = shared.list_authorizations("uA", provider="gmail")[0]
    assert not auth.is_revoked, "the live row's credential must keep the grant alive"
    assert gm_store.decrypt_refresh_token(
        gm_store.get_connection("p-beta")) == "GMAIL-REFRESH-uA"


def test_github_stays_authorized_with_no_stored_credential(legacy):
    """GitHub deliberately stores NOTHING (installation tokens are minted on
    demand), so "no credential" is the healthy state and must not be mistaken
    for a wiped grant."""
    report = conn_migrate.migrate_legacy_connections()
    auth = shared.list_authorizations("uA", provider="github")[0]
    assert auth.credentials == {}
    assert auth.is_revoked is False
    assert not any("github" in m for m in report.revoked_without_credentials)
    assert gh_store.get_connection("p-alpha") is not None


# ═══════════════════════════════════════════════════════════════════════════
# 4. Selected resources survive verbatim
# ═══════════════════════════════════════════════════════════════════════════

def test_github_repository_selection_survives(legacy):
    conn_migrate.migrate_legacy_connections()
    alpha, beta = gh_store.get_connection("p-alpha"), gh_store.get_connection("p-beta")
    assert (alpha.repo_full_name, alpha.repo_id) == ("korvix-ai/web", "8811")
    assert (beta.repo_full_name, beta.repo_id) == ("korvix-ai/worker", "8812")
    assert alpha.installation_id == beta.installation_id == "55501"
    # One installation, two repos, two projects — the account-level shape.
    assert alpha.authorization_id == beta.authorization_id


def test_vercel_project_selection_and_team_scope_survive(legacy):
    conn_migrate.migrate_legacy_connections()
    alpha = vc_store.get_connection("p-alpha")
    assert alpha.is_connected
    assert alpha.vercel_project_id == "prj_web"
    assert alpha.vercel_project_name == "korvix-web"
    assert alpha.framework == "nextjs"
    assert alpha.production_url == "https://korvix.ai"
    # Team scope is part of the account identity — losing it would silently
    # re-scope every read to the personal account.
    assert alpha.team_id == "team_kx"
    # The never-selected project stays PENDING; it is not promoted to connected.
    gamma = vc_store.get_connection("p-gamma")
    assert gamma.needs_project_selection is True and gamma.is_connected is False
    assert gamma.authorization_id == alpha.authorization_id


def test_slack_channel_selection_survives_per_project(legacy):
    conn_migrate.migrate_legacy_connections()
    alpha, beta = sl_store.get_connection("p-alpha"), sl_store.get_connection("p-beta")
    assert [c.channel_id for c in alpha.channels] == ["C_GENERAL", "C_PRODUCT"]
    assert [c.channel_id for c in beta.channels] == ["C_ENG"]
    # Private flag is metadata the picker relies on.
    assert {c.channel_id: c.is_private for c in alpha.channels} == {
        "C_GENERAL": False, "C_PRODUCT": True}
    assert alpha.team_name == "Korvix AI" and alpha.bot_user_id == "B0BOT"
    assert alpha.authorization_id == beta.authorization_id


def test_gmail_and_calendar_connections_survive(legacy):
    conn_migrate.migrate_legacy_connections()
    gm = gm_store.get_connection("p-alpha")
    assert gm is not None and not gm.is_revoked
    assert gm.google_email == "founder@korvix.ai"
    assert gm.access_token_expires == "2030-01-01T00:00:00Z"
    assert gm_store.decrypt_access_token(gm) == "GMAIL-ACCESS-uA"

    cal = cal_store.get_connection("p-alpha")
    assert cal is not None and not cal.is_revoked
    # A NON-primary calendar must not be flattened to 'primary'.
    assert cal.calendar_id == "team@group.calendar.google.com"
    assert cal.time_zone == "Europe/Istanbul"
    assert cal_store.decrypt_refresh_token(cal) == "CAL-REFRESH-uA"
    # Two Google connectors on ONE account stay two grants with two scopes.
    assert gm.authorization_id != cal.authorization_id


# ═══════════════════════════════════════════════════════════════════════════
# 5 + 6. Remove-from-project vs disconnect-account
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture()
def migrated(legacy):
    conn_migrate.migrate_legacy_connections()
    return legacy


def test_remove_from_project_never_disconnects_a_provider_used_elsewhere(migrated):
    for store, pid_keep in ((gm_store, "p-beta"), (sl_store, "p-beta"),
                            (gh_store, "p-beta")):
        before = store.get_connection(pid_keep)
        assert before is not None
        assert store.delete_connection("p-alpha") is True
        after = store.get_connection(pid_keep)
        assert after is not None, f"{store.PROVIDER}: unbinding p-alpha broke p-beta"
        assert after.authorization_id == before.authorization_id
        assert shared.get_authorization(before.authorization_id) is not None
        assert store.get_connection("p-alpha") is None

    # Credentials for the surviving projects are intact and still decryptable.
    assert gm_store.decrypt_refresh_token(gm_store.get_connection("p-beta")) == "GMAIL-REFRESH-uA"
    assert sl_store.decrypt_bot_token(sl_store.get_connection("p-beta")) == "SLACK-BOT-uA"


def test_remove_from_project_does_not_touch_another_owner(migrated):
    gm_store.delete_connection("p-alpha")
    sl_store.delete_connection("p-alpha")
    assert gm_store.get_connection("p-bee") is not None
    assert sl_store.get_connection("p-bee") is not None


def test_removing_the_last_project_drops_the_now_unused_grant(migrated):
    """Vercel's p-gamma is the only other binding; after both go the grant must
    not linger as an orphan credential."""
    auth_id = vc_store.get_connection("p-alpha").authorization_id
    vc_store.delete_connection("p-alpha")
    assert shared.get_authorization(auth_id) is not None   # p-gamma still uses it
    vc_store.delete_connection("p-gamma")
    assert shared.get_authorization(auth_id) is None


def test_global_disconnect_takes_every_bound_project_and_nothing_else(migrated):
    auth = shared.list_authorizations("uA", provider="slack")[0]
    assert shared.count_project_bindings(auth.id) == 2

    assert sl_store.delete_authorization(auth.id) is True
    for pid in ("p-alpha", "p-beta"):
        assert sl_store.get_connection(pid) is None
        assert shared.list_project_bindings(pid, provider="slack") == []
    # The OTHER owner's workspace grant, and uA's other providers, survive.
    assert sl_store.get_connection("p-bee") is not None
    assert gm_store.get_connection("p-alpha") is not None
    assert gh_store.get_connection("p-alpha") is not None
    # No orphan binding rows anywhere.
    with _sqlite.connection(migrated) as c:
        orphans = c.execute(
            """SELECT COUNT(*) AS n FROM connector_project_bindings b
               LEFT JOIN connector_authorizations a ON a.id = b.authorization_id
               WHERE a.id IS NULL""").fetchone()["n"]
    assert orphans == 0


def test_global_disconnect_wipes_the_credential(migrated):
    auth = shared.list_authorizations("uA", provider="gmail")[0]
    gm_store.delete_authorization(auth.id)
    with _sqlite.connection(migrated) as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM connector_authorizations")]
    blob = json.dumps(rows)
    assert credential_crypto.encrypt("GMAIL-REFRESH-uA") not in blob
    assert "GMAIL-REFRESH-uA" not in blob


# ═══════════════════════════════════════════════════════════════════════════
# 7. Google sibling grant / revoke semantics under the new model
# ═══════════════════════════════════════════════════════════════════════════

def test_google_revoke_is_blocked_by_the_sibling_connector(migrated, monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "shared.apps.googleusercontent.com")
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    # Calendar disconnect must not revoke the grant Gmail still depends on.
    assert google_grant.remote_revoke_is_safe(
        provider="calendar", google_email="founder@korvix.ai",
        project_id="p-alpha") is False
    cal_auth = shared.list_authorizations("uA", provider="calendar")[0]
    assert google_grant.remote_revoke_is_safe_for_authorization(
        provider="calendar", google_email="founder@korvix.ai",
        authorization_id=cal_auth.id) is False


def test_google_revoke_is_blocked_by_the_same_connector_on_another_project(migrated, monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "shared.apps.googleusercontent.com")
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    # p-beta still uses the same mailbox.
    assert google_grant.remote_revoke_is_safe(
        provider="gmail", google_email="founder@korvix.ai",
        project_id="p-alpha") is False


def test_an_unused_authorization_still_blocks_a_remote_revoke(migrated, monkeypatch):
    """The account-level regression the binding-count check would have missed: a
    grant with ZERO project bindings is still live at Google."""
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "shared.apps.googleusercontent.com")
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    # Unbind Gmail from every project — the grant itself remains.
    gm_store.delete_connection("p-alpha")
    gmail_auth = shared.list_authorizations("uA", provider="gmail")
    assert gmail_auth, "the grant must survive while another project uses it"
    # Leave the grant with no bindings at all, without deleting it. The OTHER
    # owner's Gmail binding must go too, or it — not the account-level view —
    # would be what blocks the revoke, and the test would prove nothing.
    shared.delete_project_binding("p-beta", "gmail")
    shared.delete_project_binding("p-bee", "gmail")
    assert shared.count_project_bindings(gmail_auth[0].id) == 0

    cal_auth = shared.list_authorizations("uA", provider="calendar")[0]
    # Binding-level view: no PROJECT uses Gmail → a binding-count predicate would
    # call this "safe" and revoke a grant that is still live at Google.
    assert google_grant.remote_revoke_is_safe(
        provider="calendar", google_email="founder@korvix.ai", project_id="p-alpha") is True
    # Authorization-level view: the Gmail GRANT is alive → refuse. This is the
    # exact regression the new predicate exists to prevent.
    assert google_grant.remote_revoke_is_safe_for_authorization(
        provider="calendar", google_email="founder@korvix.ai",
        authorization_id=cal_auth.id) is False


@pytest.mark.parametrize("shared_client", [True, False])
def test_google_revoke_fails_closed_on_an_unknown_account(migrated, monkeypatch, shared_client):
    """Fail-closed must hold in BOTH client configurations. Parametrized because
    the shared-client branch is the default deployment AND the one that used to
    fall through to a permissive answer for an unregistered provider — a gap that
    only surfaced when another test left GMAIL_OAUTH_CLIENT_ID in the
    environment."""
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "shared.apps.googleusercontent.com")
    if shared_client:
        monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    else:
        monkeypatch.setenv("CALENDAR_OAUTH_CLIENT_ID", "calendar-only")

    # Unknown account identity.
    assert google_grant.remote_revoke_is_safe_for_authorization(
        provider="calendar", google_email="", authorization_id="whatever") is False
    # Unregistered provider.
    assert google_grant.remote_revoke_is_safe_for_authorization(
        provider="not-a-google-connector", google_email="x@y.com",
        authorization_id="whatever") is False
    assert google_grant.remote_revoke_is_safe(
        provider="not-a-google-connector", google_email="x@y.com") is False


def test_google_revoke_is_allowed_once_no_sibling_grant_remains(migrated, monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "shared.apps.googleusercontent.com")
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    gmail_auth = shared.list_authorizations("uA", provider="gmail")[0]
    uB_gmail = shared.list_authorizations("uB", provider="gmail")[0]
    cal_auth = shared.list_authorizations("uA", provider="calendar")[0]
    # A DIFFERENT owner's grant on the same mailbox is still a live grant on the
    # same Google account — it must keep blocking.
    gm_store.delete_authorization(gmail_auth.id)
    assert google_grant.remote_revoke_is_safe_for_authorization(
        provider="calendar", google_email="founder@korvix.ai",
        authorization_id=cal_auth.id) is False
    gm_store.delete_authorization(uB_gmail.id)
    # Now only Calendar's own grant is left — excluded by id → safe.
    assert google_grant.remote_revoke_is_safe_for_authorization(
        provider="calendar", google_email="founder@korvix.ai",
        authorization_id=cal_auth.id) is True


# ═══════════════════════════════════════════════════════════════════════════
# 8. GitHub webhook / install routing after the store move
# ═══════════════════════════════════════════════════════════════════════════

def test_webhook_routing_still_resolves_after_migration(migrated):
    hits = gh_store.find_connections_for_repo(
        installation_id="55501", repo_full_name="korvix-ai/web")
    assert [c.project_id for c in hits] == ["p-alpha"]
    hits = gh_store.find_connections_for_repo(
        installation_id="55501", repo_full_name="korvix-ai/worker")
    assert [c.project_id for c in hits] == ["p-beta"]


def test_webhook_routing_survives_a_repository_rename(migrated):
    hits = gh_store.find_connections_for_repo(
        installation_id="55501", repo_full_name="korvix-ai/web-renamed", repo_id="8811")
    assert [c.project_id for c in hits] == ["p-alpha"]


def test_a_webhook_for_a_foreign_installation_routes_nowhere(migrated):
    """The critical isolation property: another tenant's installation must never
    resolve to this account's project, even for an identically-named repo."""
    assert gh_store.find_connections_for_repo(
        installation_id="99999", repo_full_name="korvix-ai/web") == []
    assert gh_store.find_connections_for_repo(
        installation_id="55501", repo_full_name="someone-else/private") == []
    assert gh_store.find_connections_for_repo(
        installation_id="99999", repo_full_name="korvix-ai/web", repo_id="8811") == []


def test_webhook_delivery_dedup_still_works(migrated):
    assert gh_store.mark_delivery("delivery-abc") is True
    assert gh_store.mark_delivery("delivery-abc") is False
    assert gh_store.mark_delivery("") is True   # cannot dedup → process once


def test_a_repo_cannot_be_claimed_by_a_second_project(migrated):
    """The reverse-uniqueness the legacy UNIQUE index enforced must survive the
    move to the shared tables."""
    assert gh_store.upsert_connection(
        project_id="p-gamma", owner_user_id="uA", installation_id="55501",
        repo_full_name="korvix-ai/web") is None
    # p-alpha still owns it, untouched.
    assert gh_store.get_connection("p-alpha").repo_full_name == "korvix-ai/web"
    assert gh_store.get_connection("p-gamma") is None


# ═══════════════════════════════════════════════════════════════════════════
# 9. Project A can never reach project B's resources
# ═══════════════════════════════════════════════════════════════════════════

def test_a_projects_connection_exposes_only_its_own_resources(migrated):
    alpha = sl_store.get_connection("p-alpha")
    beta = sl_store.get_connection("p-beta")
    alpha_ids = {c.channel_id for c in alpha.channels}
    beta_ids = {c.channel_id for c in beta.channels}
    assert alpha_ids.isdisjoint(beta_ids)
    assert "C_ENG" not in alpha_ids and "C_GENERAL" not in beta_ids
    # Same for the single-resource providers.
    assert gh_store.get_connection("p-alpha").repo_full_name != \
        gh_store.get_connection("p-beta").repo_full_name
    # …and the other owner's channel is invisible to both.
    assert "C_BEE" not in alpha_ids | beta_ids


def test_reselecting_one_projects_channels_cannot_touch_another(migrated):
    sl_store.set_selected_channels(
        project_id="p-alpha", owner_user_id="uA",
        channels=[{"channel_id": "C_NEW", "name": "new"}])
    assert [c.channel_id for c in sl_store.get_connection("p-alpha").channels] == ["C_NEW"]
    # p-beta is untouched by a sibling project's edit.
    assert [c.channel_id for c in sl_store.get_connection("p-beta").channels] == ["C_ENG"]
    assert [c.channel_id for c in sl_store.get_connection("p-bee").channels] == ["C_BEE"]


def test_a_foreign_owner_cannot_rewrite_a_projects_resources(migrated):
    assert sl_store.set_selected_channels(
        project_id="p-alpha", owner_user_id="uB",
        channels=[{"channel_id": "C_HIJACK", "name": "hijack"}]) is None
    assert [c.channel_id for c in sl_store.get_connection("p-alpha").channels] == \
        ["C_GENERAL", "C_PRODUCT"]


def test_a_foreign_owner_cannot_bind_this_accounts_grant(migrated):
    ua_slack = shared.list_authorizations("uA", provider="slack")[0]
    assert shared.set_binding(
        project_id="p-bee", authorization_id=ua_slack.id, owner_user_id="uB",
        resources=[{"resource_id": "C_GENERAL", "resource_label": "general",
                    "resource": {}}]) == []
    # p-bee still points at uB's OWN grant with its OWN channel.
    bee = sl_store.get_connection("p-bee")
    assert bee.authorization_id != ua_slack.id
    assert [c.channel_id for c in bee.channels] == ["C_BEE"]


def test_every_binding_carries_the_owning_accounts_scope(migrated):
    """The denormalized owner on a binding is what scopes every recorded
    observation — it must always equal the grant's owner."""
    with _sqlite.connection(migrated) as c:
        mismatched = c.execute(
            """SELECT COUNT(*) AS n FROM connector_project_bindings b
               JOIN connector_authorizations a ON a.id = b.authorization_id
               WHERE a.owner_user_id <> b.owner_user_id""").fetchone()["n"]
    assert mismatched == 0


# ═══════════════════════════════════════════════════════════════════════════
# 9 (continued) + 10. Route-level sync scoping and standalone-chat isolation
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture()
def api(migrated, monkeypatch, app):
    """The migrated database, behind the real HTTP surface."""
    from backend.core import deps
    from backend.services.auth.identity import User
    from backend.services.orchestrator import observations_store as obs
    from backend.services.projects import store as projects_store

    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "true")
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "true")
    for mod in (projects_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", migrated, raising=False)
    projects_store.init()
    obs.init_observations_table()
    projects_store.create_project("uA", name="Alpha", project_id="p-alpha")
    projects_store.create_project("uA", name="Beta", project_id="p-beta")
    projects_store.create_project("uB", name="Bee", project_id="p-bee")
    app.dependency_overrides[deps.require_auth] = lambda: User(
        id="uA", kind="email", external_id="email:a@x.com", display_name="A")
    yield migrated
    app.dependency_overrides.clear()


def test_account_sync_hands_each_project_only_its_own_resources(client, api, monkeypatch):
    """The single most important runtime property: one account-level grant, two
    projects, and neither read may see the other's channels."""
    from backend.services.slack import sync as sl_sync

    seen = {}

    class _Report:
        def as_dict(self):
            return {"ok": True}

    def _fake_sync(conn, **kw):
        seen[conn.project_id] = sorted(c.channel_id for c in conn.channels)
        return _Report()

    monkeypatch.setattr(sl_sync, "sync_connection", _fake_sync)
    r = client.post("/v2/connectors/slack/sync")
    assert r.status_code == 200

    assert seen == {"p-alpha": ["C_GENERAL", "C_PRODUCT"], "p-beta": ["C_ENG"]}
    # The other owner's project was never visited at all.
    assert "p-bee" not in seen


def test_account_sync_never_visits_another_owners_project(client, api, monkeypatch):
    """Even with a binding whose denormalized owner was tampered to look like
    ours, sync re-checks the project's CURRENT owner before reading into it."""
    from backend.services.slack import sync as sl_sync

    ua_slack = shared.list_authorizations("uA", provider="slack")[0]
    with _sqlite.connection(api) as c:
        c.execute("""UPDATE connector_project_bindings
                     SET authorization_id=?, owner_user_id='uA'
                     WHERE project_id='p-bee' AND provider='slack'""", (ua_slack.id,))

    visited = []

    class _Report:
        def as_dict(self):
            return {"ok": True}

    monkeypatch.setattr(sl_sync, "sync_connection",
                        lambda conn, **kw: (visited.append(conn.project_id), _Report())[1])
    r = client.post("/v2/connectors/slack/sync")
    assert r.status_code == 200
    assert "p-bee" not in visited, "sync read into a project owned by someone else"
    assert sorted(visited) == ["p-alpha", "p-beta"]


def test_removing_one_project_leaves_the_other_syncing(client, api, monkeypatch):
    from backend.services.slack import sync as sl_sync

    assert client.delete("/v2/connectors/slack/projects/p-alpha").status_code == 200

    visited = []

    class _Report:
        def as_dict(self):
            return {"ok": True}

    monkeypatch.setattr(sl_sync, "sync_connection",
                        lambda conn, **kw: (visited.append(conn.project_id), _Report())[1])
    client.post("/v2/connectors/slack/sync")
    assert visited == ["p-beta"], "unbinding one project must not stop the others"


def test_a_standalone_chat_receives_no_connector_context(api):
    """A chat with no project sends no `project_id`, and the streaming route
    only builds the project block (the ONLY carrier of connector signals) when
    one is present. Asserted against the route's real guard, not a mock."""
    import inspect
    from backend.routes import v2_chat_stream

    src = inspect.getsource(v2_chat_stream)
    # The guard: project context is built ONLY under a truthy project_id.
    assert "if body.project_id and user_id and user_id != \"anonymous\":" in src
    # Nothing in the chat path reaches the connector authority directly.
    assert "connector_authorizations" not in src
    assert "connectors.store" not in src and "connectors import store" not in src


def test_project_context_is_owner_gated_not_just_project_scoped(api):
    """The block a project chat DOES receive is refused for a project the
    authenticated user does not own — so connector signals cannot cross accounts
    even when a project_id is supplied."""
    from backend.services.projects.context import build_project_context_block

    # uB's project, requested as uA → no block at all.
    assert build_project_context_block("p-bee", user_id="uA") is None
    # A project that does not exist → no block.
    assert build_project_context_block("does-not-exist", user_id="uA") is None
