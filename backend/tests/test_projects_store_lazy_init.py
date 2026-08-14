# coding: utf-8
"""Regression — the projects store self-initializes its schema on first access,
so a connector-only deploy (ENABLE_PROJECTS off, but a connector flag on) never
hits `sqlite3.OperationalError: no such table: projects`.

Root cause: the schema used to be created only when routes/projects.py imported
under ENABLE_PROJECTS=true. The Gmail/GitHub connector routes call
projects_store.get_project() to enforce ownership and are gated by their OWN
flags, so on a fresh DB they raised "no such table: projects" → HTTP 500.

Fix: projects_store._conn() lazily runs the idempotent schema (once per DB path).
These tests exercise a FRESH database WITHOUT calling projects_store.init().
"""
from __future__ import annotations

import sqlite3

import pytest

from backend.core import deps
from backend.services.auth.identity import User
from backend.services.projects import store as projects_store
from backend.services.gmail import store as gm_store
from backend.services.orchestrator import observations_store as obs

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")


@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    """A brand-new projects.db that has NEVER been init()'d — the exact
    production condition that raised the error."""
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    for mod in (projects_store, gm_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    # Forget any path initialized by earlier tests so this fresh path really
    # goes through lazy init (and never depend on a stale flag).
    projects_store._reset_for_tests()
    yield path


# ── store-level: no explicit init() ──────────────────────────────────────────

def test_get_project_on_fresh_db_does_not_raise(fresh_db):
    # Before the fix this raised sqlite3.OperationalError: no such table: projects.
    assert projects_store.get_project("ghost") is None


def test_create_then_get_roundtrips_on_fresh_db(fresh_db):
    p = projects_store.create_project("uA", name="Owned", project_id="p1")
    assert p.owner_user_id == "uA"
    got = projects_store.get_project("p1")
    assert got is not None and got.owner_user_id == "uA"


def test_projects_table_actually_exists_after_access(fresh_db):
    projects_store.get_project("ghost")  # triggers lazy init
    with sqlite3.connect(fresh_db) as c:
        names = {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "projects" in names


# ── connector route: the real call path from the traceback ────────────────────

def _as(app, user):
    app.dependency_overrides[deps.require_auth] = lambda: user


def test_gmail_connection_route_on_fresh_db_returns_404_not_500(client, app, fresh_db, monkeypatch):
    """GET /v2/gmail/projects/{id}/connection → _require_owned_project →
    projects_store.get_project(). On a fresh DB this must be a clean 404
    (project not found), NEVER a 500 from a missing table."""
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "true")
    _as(app, USER_A)
    try:
        r = client.get("/v2/gmail/projects/ghost/connection")
        assert r.status_code == 404          # not 500 (no OperationalError)
    finally:
        app.dependency_overrides.clear()


def test_gmail_connection_route_sees_owned_project_on_fresh_db(client, app, fresh_db, monkeypatch):
    monkeypatch.setenv("ENABLE_GMAIL_CONNECTOR", "true")
    # The project exists on the (fresh) backend, owned by the authenticated user.
    projects_store.create_project("uA", name="Proj A", project_id="p1")
    _as(app, USER_A)
    try:
        r = client.get("/v2/gmail/projects/p1/connection")
        assert r.status_code == 200
        assert r.json()["data"]["connected"] is False   # exists, just not connected
    finally:
        app.dependency_overrides.clear()
