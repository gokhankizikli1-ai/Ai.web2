# coding: utf-8
"""Slack connector — OAuth state (CSRF) + verified pending channel set.

The state is the ONLY thing tying Slack's unauthenticated redirect back to an
authenticated Korvix (user, project), so it must be unguessable, one-time,
TTL-bound and ownership-bound. The pending set is the ONLY id source the picker
may offer, so it must be owner-scoped, expiring, bounded, and never widened by
client input.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services.slack import setup_state as sl_setup


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(sl_setup, "DB_PATH", path, raising=False)
    sl_setup._reset_for_tests()
    sl_setup.init_slack_setup_tables()
    yield path


def _channels(*ids, member=True):
    return [{"channel_id": i, "name": i.lower(), "is_private": False,
             "is_member": member} for i in ids]


# ── one-time CSRF state ──────────────────────────────────────────────────────

def test_state_is_unguessable_and_unique(db):
    a = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    b = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    assert a != b
    # 32 random bytes → 43 url-safe base64 chars.
    assert len(a) >= 40


def test_state_carries_the_initiating_owner_and_project(db):
    state = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    consumed = sl_setup.consume(state)
    assert consumed is not None
    assert (consumed.owner_user_id, consumed.project_id) == ("uA", "p1")
    assert consumed.provider == "slack"


def test_state_is_single_use(db):
    """A replayed callback must be rejected."""
    state = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    assert sl_setup.consume(state) is not None
    assert sl_setup.consume(state) is None


def test_expired_state_is_rejected(db, monkeypatch):
    monkeypatch.setenv("SLACK_OAUTH_STATE_TTL_S", "60")
    state = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    from backend.services.orchestrator import _sqlite
    stale = (datetime.utcnow() - timedelta(seconds=1)).isoformat() + "Z"
    with _sqlite.connection(db) as c:
        c.execute("UPDATE slack_oauth_states SET expires_at=? WHERE state=?",
                  (stale, state))
    assert sl_setup.consume(state) is None


def test_unknown_state_is_rejected_indistinguishably(db):
    assert sl_setup.consume("forged-state") is None
    assert sl_setup.consume("") is None


def test_state_requires_an_owner_and_project(db):
    with pytest.raises(ValueError):
        sl_setup.create_state(owner_user_id="", project_id="p1")
    # An EMPTY project id is now legitimate: it is how an ACCOUNT-LEVEL
    # authorization is minted (connect the provider once, bind projects later).
    # The owner binding — the thing that makes the callback safe — is still
    # required.
    account_state = sl_setup.create_state(owner_user_id="uA", project_id="")
    consumed = sl_setup.consume(account_state)
    assert consumed is not None
    assert consumed.owner_user_id == "uA" and consumed.project_id == ""


def test_purge_removes_expired_states_only(db):
    live = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    dead = sl_setup.create_state(owner_user_id="uA", project_id="p1")
    from backend.services.orchestrator import _sqlite
    stale = (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z"
    with _sqlite.connection(db) as c:
        c.execute("UPDATE slack_oauth_states SET expires_at=? WHERE state=?",
                  (stale, dead))
    assert sl_setup.purge_expired() >= 1
    assert sl_setup.consume(dead) is None
    assert sl_setup.consume(live) is not None


# ── pending channel set ──────────────────────────────────────────────────────

def test_pending_channels_round_trip_with_slack_membership_truth(db):
    sl_setup.replace_pending_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C1", "name": "general", "is_private": False,
                   "is_member": True},
                  {"channel_id": "C2", "name": "secret", "is_private": True,
                   "is_member": False}])
    rows = sl_setup.list_pending_channels("p1", owner_user_id="uA")
    by_id = {r.channel_id: r for r in rows}
    assert by_id["C1"].is_member is True and by_id["C1"].is_private is False
    assert by_id["C2"].is_member is False and by_id["C2"].is_private is True
    # Member-first ordering so connectable channels lead the picker.
    assert [r.channel_id for r in rows] == ["C1", "C2"]


def test_pending_public_view_carries_no_token_or_content(db):
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1"))
    view = sl_setup.list_pending_channels("p1", owner_user_id="uA")[0].public_view()
    assert set(view) == {"channel_id", "name", "is_private", "is_member"}


def test_pending_channels_are_owner_scoped(db):
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1"))
    assert sl_setup.list_pending_channels("p1", owner_user_id="uB") == []
    assert sl_setup.get_pending_channel("p1", owner_user_id="uB",
                                        channel_id="C1") is None


def test_pending_lookup_rejects_an_id_that_was_never_offered(db):
    """Arbitrary channel-id injection: only a server-stored row resolves."""
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1"))
    assert sl_setup.get_pending_channel("p1", owner_user_id="uA",
                                        channel_id="C_ATTACKER") is None
    assert sl_setup.get_pending_channel("p1", owner_user_id="uA",
                                        channel_id="") is None


def test_pending_channels_do_not_cross_projects(db):
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1"))
    sl_setup.replace_pending_channels(project_id="p2", owner_user_id="uA",
                                      channels=_channels("C2"))
    assert sl_setup.get_pending_channel("p2", owner_user_id="uA",
                                        channel_id="C1") is None
    assert [r.channel_id for r in
            sl_setup.list_pending_channels("p1", owner_user_id="uA")] == ["C1"]


def test_replacing_the_pending_set_drops_channels_slack_no_longer_shows(db):
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1", "C2"))
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C2"))
    ids = {r.channel_id for r in sl_setup.list_pending_channels("p1", owner_user_id="uA")}
    assert ids == {"C2"}


def test_pending_set_is_bounded(db, monkeypatch):
    monkeypatch.setenv("SLACK_PENDING_CHANNELS_MAX", "3")
    sl_setup.replace_pending_channels(
        project_id="p1", owner_user_id="uA",
        channels=_channels(*[f"C{i}" for i in range(50)]))
    assert len(sl_setup.list_pending_channels("p1", owner_user_id="uA")) == 3


def test_pending_set_deduplicates_and_skips_blank_ids(db):
    sl_setup.replace_pending_channels(
        project_id="p1", owner_user_id="uA",
        channels=[{"channel_id": "C1", "name": "a", "is_member": True},
                  {"channel_id": "C1", "name": "dup", "is_member": True},
                  {"channel_id": "", "name": "blank", "is_member": True}])
    assert [r.channel_id for r in
            sl_setup.list_pending_channels("p1", owner_user_id="uA")] == ["C1"]


def test_expired_pending_rows_are_invisible(db):
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1"))
    from backend.services.orchestrator import _sqlite
    stale = (datetime.utcnow() - timedelta(seconds=1)).isoformat() + "Z"
    with _sqlite.connection(db) as c:
        c.execute("UPDATE slack_pending_channels SET expires_at=?", (stale,))
    assert sl_setup.list_pending_channels("p1", owner_user_id="uA") == []
    assert sl_setup.get_pending_channel("p1", owner_user_id="uA",
                                        channel_id="C1") is None


def test_delete_pending_clears_the_whole_project_set(db):
    sl_setup.replace_pending_channels(project_id="p1", owner_user_id="uA",
                                      channels=_channels("C1", "C2"))
    assert sl_setup.delete_pending_channels("p1") is True
    assert sl_setup.list_pending_channels("p1", owner_user_id="uA") == []
