# coding: utf-8
"""Google Calendar connector — OAuth state store (one-time, TTL, owner-bound).

The state is the ONLY thing tying Google's unauthenticated redirect back to an
authenticated Korvix user + project, so these are security tests: unguessable,
single-use, expiring, and never confusable with a Gmail state.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services.gmail import state_store as gm_state
from backend.services.google_calendar import state_store as cal_state


@pytest.fixture()
def state_db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(cal_state, "DB_PATH", path, raising=False)
    monkeypatch.setattr(gm_state, "DB_PATH", path, raising=False)
    cal_state._reset_for_tests(); cal_state.init_calendar_state_table()
    gm_state._reset_for_tests(); gm_state.init_gmail_state_table()
    return path


def test_state_is_long_and_random(state_db):
    a = cal_state.create_state(owner_user_id="uA", project_id="p1")
    b = cal_state.create_state(owner_user_id="uA", project_id="p1")
    assert a != b
    assert len(a) >= 40  # 256 bits url-safe


def test_consume_returns_bound_identity(state_db):
    s = cal_state.create_state(owner_user_id="uA", project_id="p1")
    got = cal_state.consume(s)
    assert got is not None
    assert got.owner_user_id == "uA" and got.project_id == "p1"
    assert got.provider == "calendar"


def test_state_is_single_use(state_db):
    s = cal_state.create_state(owner_user_id="uA", project_id="p1")
    assert cal_state.consume(s) is not None
    assert cal_state.consume(s) is None       # replay rejected


def test_unknown_state_rejected(state_db):
    assert cal_state.consume("forged-state") is None
    assert cal_state.consume("") is None


def test_expired_state_rejected(state_db, monkeypatch):
    monkeypatch.setenv("CALENDAR_OAUTH_STATE_TTL_S", "60")
    s = cal_state.create_state(owner_user_id="uA", project_id="p1")
    # Age the row past its expiry.
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(seconds=1)).isoformat() + "Z"
    with _sqlite.connection(state_db) as c:
        c.execute("UPDATE calendar_oauth_states SET expires_at=? WHERE state=?", (past, s))
    assert cal_state.consume(s) is None


def test_ttl_is_clamped(monkeypatch):
    from backend.services.google_calendar import config as cal_config
    monkeypatch.setenv("CALENDAR_OAUTH_STATE_TTL_S", "999999")
    assert cal_config.state_ttl_s() == 1800
    monkeypatch.setenv("CALENDAR_OAUTH_STATE_TTL_S", "1")
    assert cal_config.state_ttl_s() == 60
    monkeypatch.setenv("CALENDAR_OAUTH_STATE_TTL_S", "not-a-number")
    assert cal_config.state_ttl_s() == 600


def test_missing_scope_rejected(state_db):
    with pytest.raises(ValueError):
        cal_state.create_state(owner_user_id="", project_id="p1")
    # An EMPTY project id is now legitimate: it is how an ACCOUNT-LEVEL
    # authorization is minted (connect the provider once, bind projects later).
    # The owner binding — the thing that actually makes the callback safe — is
    # still required.
    account_state = cal_state.create_state(owner_user_id="uA", project_id="")
    consumed = cal_state.consume(account_state)
    assert consumed is not None
    assert consumed.owner_user_id == "uA" and consumed.project_id == ""


# ── cross-connector state isolation ──────────────────────────────────────────

def test_gmail_and_calendar_states_are_separate(state_db):
    """A Gmail state must never be consumable by the Calendar callback (and vice
    versa) — the two flows share a Google client but NOT a state table."""
    gm = gm_state.create_state(owner_user_id="uA", project_id="p1")
    cal = cal_state.create_state(owner_user_id="uA", project_id="p1")
    assert cal_state.consume(gm) is None
    assert gm_state.consume(cal) is None
    # Each is still usable by its own connector afterwards.
    assert gm_state.consume(gm) is not None
    assert cal_state.consume(cal) is not None


def test_purge_expired_removes_only_expired(state_db):
    live = cal_state.create_state(owner_user_id="uA", project_id="p1")
    dead = cal_state.create_state(owner_user_id="uA", project_id="p1")
    from backend.services.orchestrator import _sqlite
    past = (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z"
    with _sqlite.connection(state_db) as c:
        c.execute("UPDATE calendar_oauth_states SET expires_at=? WHERE state=?", (past, dead))
    assert cal_state.purge_expired() == 1
    assert cal_state.consume(live) is not None
