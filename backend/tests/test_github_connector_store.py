# coding: utf-8
"""GitHub connector — durable connection + delivery-dedup store."""
from __future__ import annotations

import pytest

from backend.services.github import store as gh_store


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(gh_store, "DB_PATH", path, raising=False)
    gh_store.init_github_tables()
    return gh_store


def test_upsert_and_get(db):
    conn = db.upsert_connection(
        project_id="p1", owner_user_id="uA", installation_id="100",
        repo_full_name="octo/hello", repo_id="42")
    assert conn is not None
    got = db.get_connection("p1")
    assert got.owner_user_id == "uA"
    assert got.installation_id == "100"
    assert got.repo_full_name == "octo/hello"
    assert got.repo_id == "42"


def test_upsert_is_idempotent_update(db):
    a = db.upsert_connection(project_id="p1", owner_user_id="uA",
                             installation_id="100", repo_full_name="octo/hello")
    b = db.upsert_connection(project_id="p1", owner_user_id="uA",
                             installation_id="100", repo_full_name="octo/world")
    assert b.repo_full_name == "octo/world"
    assert b.created_at == a.created_at   # preserved across update


def test_reverse_lookup_routes_repo_to_project(db):
    db.upsert_connection(project_id="p1", owner_user_id="uA",
                         installation_id="100", repo_full_name="octo/hello", repo_id="42")
    hits = db.find_connections_for_repo(installation_id="100", repo_full_name="octo/hello")
    assert [c.project_id for c in hits] == ["p1"]
    # by repo_id also routes (survives a rename)
    hits2 = db.find_connections_for_repo(installation_id="100",
                                         repo_full_name="octo/renamed", repo_id="42")
    assert [c.project_id for c in hits2] == ["p1"]


def test_unknown_repo_or_installation_routes_to_nothing(db):
    db.upsert_connection(project_id="p1", owner_user_id="uA",
                         installation_id="100", repo_full_name="octo/hello", repo_id="42")
    assert db.find_connections_for_repo(installation_id="999", repo_full_name="octo/hello") == []
    assert db.find_connections_for_repo(installation_id="100", repo_full_name="other/repo") == []


def test_cross_project_isolation_repo_claimed_once(db):
    # A repo under an installation belongs to exactly one project — a second
    # project trying to claim the same (installation, repo) is refused.
    assert db.upsert_connection(project_id="p1", owner_user_id="uA",
                                installation_id="100", repo_full_name="octo/hello") is not None
    clash = db.upsert_connection(project_id="p2", owner_user_id="uB",
                                 installation_id="100", repo_full_name="octo/hello")
    assert clash is None   # cannot inject repo A's events into project B
    # p2 has no connection; p1 still owns the repo.
    assert db.get_connection("p2") is None
    hits = db.find_connections_for_repo(installation_id="100", repo_full_name="octo/hello")
    assert [c.project_id for c in hits] == ["p1"]


def test_invalid_inputs_rejected(db):
    assert db.upsert_connection(project_id="", owner_user_id="u",
                                installation_id="1", repo_full_name="o/r") is None
    assert db.upsert_connection(project_id="p", owner_user_id="u",
                                installation_id="1", repo_full_name="norepo") is None


def test_delete_connection(db):
    db.upsert_connection(project_id="p1", owner_user_id="uA",
                         installation_id="100", repo_full_name="octo/hello")
    assert db.delete_connection("p1") is True
    assert db.get_connection("p1") is None
    assert db.delete_connection("p1") is False


# ── delivery dedup ───────────────────────────────────────────────────────────

def test_delivery_dedup(db):
    assert db.mark_delivery("delivery-1") is True    # first sight → process
    assert db.mark_delivery("delivery-1") is False   # redelivery → skip
    assert db.mark_delivery("delivery-2") is True
    # empty id can't be deduped → always process once
    assert db.mark_delivery("") is True
    assert db.mark_delivery("") is True
