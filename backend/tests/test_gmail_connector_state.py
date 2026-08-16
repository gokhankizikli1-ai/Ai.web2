# coding: utf-8
"""Gmail connector — OAuth state store: one-time, TTL-bound, ownership-bound."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services.gmail import state_store as gm_state


@pytest.fixture()
def state_db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(gm_state, "DB_PATH", path, raising=False)
    gm_state._reset_for_tests()
    gm_state.init_gmail_state_table()
    yield path


def test_create_and_consume_binds_owner_and_project(state_db):
    s = gm_state.create_state(owner_user_id="uA", project_id="p1")
    assert isinstance(s, str) and len(s) > 20
    consumed = gm_state.consume(s)
    assert consumed is not None
    assert consumed.owner_user_id == "uA"
    assert consumed.project_id == "p1"
    assert consumed.provider == "gmail"


def test_consume_is_one_time_replay_rejected(state_db):
    s = gm_state.create_state(owner_user_id="uA", project_id="p1")
    assert gm_state.consume(s) is not None
    # Replay → rejected.
    assert gm_state.consume(s) is None


def test_unknown_state_rejected(state_db):
    assert gm_state.consume("does-not-exist") is None
    assert gm_state.consume("") is None


def test_expired_state_rejected(state_db, monkeypatch):
    # Force a tiny TTL so the state is already expired on consume.
    monkeypatch.setenv("GMAIL_OAUTH_STATE_TTL_S", "60")
    s = gm_state.create_state(owner_user_id="uA", project_id="p1")
    # Rewrite the row's expiry into the past.
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z"
    with _sqlite.connection(state_db) as c:
        c.execute("UPDATE gmail_oauth_states SET expires_at=? WHERE state=?", (past, s))
    assert gm_state.consume(s) is None


def test_missing_scope_raises(state_db):
    with pytest.raises(ValueError):
        gm_state.create_state(owner_user_id="", project_id="p1")
    # An EMPTY project id is now legitimate: it is how an ACCOUNT-LEVEL
    # authorization is minted (connect the provider once, bind projects later).
    # The owner binding — the thing that actually makes the callback safe — is
    # still required.
    account_state = gm_state.create_state(owner_user_id="uA", project_id="")
    consumed = gm_state.consume(account_state)
    assert consumed is not None
    assert consumed.owner_user_id == "uA" and consumed.project_id == ""


def test_purge_expired_removes_old(state_db):
    s = gm_state.create_state(owner_user_id="uA", project_id="p1")
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z"
    with _sqlite.connection(state_db) as c:
        c.execute("UPDATE gmail_oauth_states SET expires_at=? WHERE state=?", (past, s))
    removed = gm_state.purge_expired()
    assert removed >= 1
    assert gm_state.consume(s) is None
