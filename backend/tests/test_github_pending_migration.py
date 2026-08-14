# coding: utf-8
"""GitHub connector — github_pending_installations schema migration (#625 → #626).

#625 shipped this table as a SINGLE pending installation per project:

    CREATE TABLE github_pending_installations (
        project_id      TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        owner_user_id   TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL
    );

#626 needs a SET of installations per project (personal + orgs), so the table
becomes composite-key with account display columns:

    PRIMARY KEY (project_id, installation_id) + account_login + account_type

`CREATE TABLE IF NOT EXISTS` does NOT alter an existing table, so a production DB
created by #625 would keep the old shape — new inserts would fail on the missing
account columns and multi-install rows are impossible under the single-column PK.
These tests prove the explicit, transactional, idempotent migration fixes that on
the exact #625 DB while being a no-op on fresh / already-migrated / re-init DBs.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services.github import setup_state as gh_setup
from backend.services.orchestrator import _sqlite

# The EXACT #625 table + indexes (single-installation shape).
OLD_625_SCHEMA = """
CREATE TABLE github_pending_installations (
    project_id      TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    owner_user_id   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gh_pending_owner  ON github_pending_installations(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_gh_pending_expiry ON github_pending_installations(expires_at);
"""


def _future_iso(seconds: int = 900) -> str:
    return (datetime.utcnow() + timedelta(seconds=seconds)).isoformat() + "Z"


def _pending_pragma(path: str) -> dict:
    """name → PRAGMA table_info row (dict) for github_pending_installations."""
    with _sqlite.connection(path) as c:
        rows = c.execute("PRAGMA table_info(github_pending_installations)").fetchall()
    return {str(r["name"]): dict(r) for r in rows}


def _is_composite_new_shape(pragma: dict) -> bool:
    inst = pragma.get("installation_id")
    inst_in_pk = bool(inst and int(inst.get("pk") or 0) > 0)
    return ("account_login" in pragma and "account_type" in pragma and inst_in_pk)


@pytest.fixture()
def db_path(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(gh_setup, "DB_PATH", path, raising=False)
    return path


def _seed_old_625_db(path: str, *, project_id="p1", owner="uOLD", installation="555"):
    """Create the exact #625 table and insert one valid, non-expired pending row.
    Deliberately does NOT call init (so a test can trigger the migration)."""
    with _sqlite.connection(path) as c:
        c.executescript(OLD_625_SCHEMA)
        c.execute(
            """INSERT INTO github_pending_installations
               (project_id, installation_id, owner_user_id, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (project_id, installation, owner, datetime.utcnow().isoformat() + "Z", _future_iso()),
        )


# ── 2) exact #625 old DB → migrated, row preserved, multi-install works ───────

def test_migrates_exact_625_schema_and_preserves_row(db_path):
    _seed_old_625_db(db_path)
    # Sanity: the seeded table really is the OLD shape.
    before = _pending_pragma(db_path)
    assert "account_login" not in before and "account_type" not in before
    assert int(before["installation_id"]["pk"] or 0) == 0  # not part of PK

    # Initialising the #626 store performs the migration.
    gh_setup.init_github_setup_tables()

    # Migration succeeded: composite PK + account columns exist.
    after = _pending_pragma(db_path)
    assert "account_login" in after and "account_type" in after
    assert _is_composite_new_shape(after)

    # The old row remains usable through the #626 accessor (owner + id bound).
    pending = gh_setup.get_pending_installation("p1", owner_user_id="uOLD", installation_id="555")
    assert pending is not None
    assert pending.installation_id == "555"
    assert pending.owner_user_id == "uOLD"
    # Account display fields default to empty strings for a migrated #625 row.
    assert pending.account_login == "" and pending.account_type == ""


def test_migrated_db_supports_multiple_installations_per_project(db_path):
    _seed_old_625_db(db_path)
    gh_setup.init_github_setup_tables()

    # The whole point of #626: several accessible installations per project.
    stored = gh_setup.replace_pending_installations(
        project_id="p1", owner_user_id="uOLD",
        installations=[
            {"installation_id": "555", "account_login": "octo", "account_type": "User"},
            {"installation_id": "777", "account_login": "acme", "account_type": "Organization"},
        ],
    )
    assert {s.installation_id for s in stored} == {"555", "777"}
    listed = gh_setup.list_pending_installations("p1", owner_user_id="uOLD")
    assert {p.installation_id for p in listed} == {"555", "777"}
    logins = {p.installation_id: p.account_login for p in listed}
    assert logins["555"] == "octo" and logins["777"] == "acme"


# ── 4) repeated init is idempotent (data intact, shape stable) ────────────────

def test_reinit_is_idempotent_after_migration(db_path):
    _seed_old_625_db(db_path)
    gh_setup.init_github_setup_tables()
    # Re-run init several times — must not throw, drop data, or change the shape.
    for _ in range(3):
        gh_setup.init_github_setup_tables()
    assert _is_composite_new_shape(_pending_pragma(db_path))
    pending = gh_setup.get_pending_installation("p1", owner_user_id="uOLD", installation_id="555")
    assert pending is not None and pending.installation_id == "555"


# ── 1) fresh DB → new shape, no migration needed ──────────────────────────────

def test_fresh_db_gets_new_schema_directly(db_path):
    # No pre-existing table at all.
    gh_setup.init_github_setup_tables()
    assert _is_composite_new_shape(_pending_pragma(db_path))
    # And it is immediately usable for multiple installations.
    gh_setup.replace_pending_installations(
        project_id="p9", owner_user_id="u9",
        installations=[{"installation_id": "1", "account_login": "a", "account_type": "User"},
                       {"installation_id": "2", "account_login": "b", "account_type": "User"}])
    assert len(gh_setup.list_pending_installations("p9", owner_user_id="u9")) == 2


# ── 3) already-#626 DB → migration is a no-op that preserves rows ──────────────

def test_already_migrated_db_is_untouched(db_path):
    # First init builds the #626 schema; seed a real row via the store API.
    gh_setup.init_github_setup_tables()
    gh_setup.replace_pending_installations(
        project_id="p1", owner_user_id="uA",
        installations=[{"installation_id": "100", "account_login": "octo", "account_type": "User"}])
    assert _is_composite_new_shape(_pending_pragma(db_path))

    # Re-init: detects the current shape and does nothing (row survives).
    gh_setup.init_github_setup_tables()
    pending = gh_setup.get_pending_installation("p1", owner_user_id="uA", installation_id="100")
    assert pending is not None and pending.account_login == "octo"


def test_migration_drops_no_temp_table_behind(db_path):
    _seed_old_625_db(db_path)
    gh_setup.init_github_setup_tables()
    with _sqlite.connection(db_path) as c:
        names = {
            str(r["name"])
            for r in c.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
    assert "github_pending_installations" in names
    assert "github_pending_installations_new" not in names  # temp table cleaned up
