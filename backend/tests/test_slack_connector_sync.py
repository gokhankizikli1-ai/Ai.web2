# coding: utf-8
"""Slack connector — bounded, explicit sync.

Covers every ingestion bound (channels, time window, fair per-channel message
share, pages, threads, replies), the partial-failure contract (a channel Korvix
cannot read NEVER reads as "no messages", and `last_sync_at` only advances on a
fully clean sync), idempotency across repeated syncs, and the rate-limit abort
that keeps the connector from hammering a limited workspace. A fake client
stands in for the network.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import observations_store as obs
from backend.services.slack import store as sl_store
from backend.services.slack import sync as sl_sync
from backend.services.slack.errors import (
    SlackAccessError, SlackAuthError, SlackRateLimitError, SlackServerError,
)

NOW = datetime(2023, 11, 15, 12, 0, 0, tzinfo=timezone.utc)
BOT_TOKEN = "xoxb-REAL-BOT-TOKEN"


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    for mod in (sl_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    sl_store._reset_for_tests()
    sl_store.init_slack_tables()
    obs.init_observations_table()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _connect(db, *channel_ids, project_id="p1", owner="uA"):
    sl_store.upsert_installation(project_id=project_id, owner_user_id=owner,
                                 bot_token=BOT_TOKEN, team_id="T1",
                                 team_name="Korvix HQ")
    sl_store.set_selected_channels(
        project_id=project_id, owner_user_id=owner,
        channels=[{"channel_id": c, "name": c.lower()} for c in channel_ids])
    return sl_store.get_connection(project_id)


def _msg(ts, **kw):
    base = {"type": "message", "ts": ts, "user": "U1", "text": f"msg {ts}"}
    base.update(kw)
    return base


class FakeClient:
    """Stands in for SlackClient — records calls, replays scripted answers."""

    def __init__(self, conn=None, *, history=None, replies=None, errors=None):
        self.conn = conn
        self._history = history or {}
        self._replies = replies or {}
        self._errors = errors or {}
        self.history_calls = []
        self.reply_calls = []

    def history(self, channel_id, *, oldest="", max_pages=None, max_messages=None):
        self.history_calls.append({"channel": channel_id, "oldest": oldest,
                                   "max_pages": max_pages,
                                   "max_messages": max_messages})
        exc = self._errors.get(channel_id)
        if exc:
            raise exc
        out = list(self._history.get(channel_id, []))
        return out[:max_messages] if max_messages is not None else out

    def replies(self, channel_id, *, thread_ts, limit=None):
        self.reply_calls.append({"channel": channel_id, "thread_ts": thread_ts})
        exc = self._errors.get(f"thread:{thread_ts}")
        if exc:
            raise exc
        return list(self._replies.get(thread_ts, []))


# ── happy path + bounds ──────────────────────────────────────────────────────

def test_sync_records_observations_for_every_selected_channel(db):
    conn = _connect(db, "C1", "C2")
    client = FakeClient(history={"C1": [_msg("1700000001.0")],
                                 "C2": [_msg("1700000002.0")]})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert report.ok is True
    assert (report.channels, report.channels_read, report.messages) == (2, 2, 2)
    assert report.recorded == 2
    rows = obs.list_observations("p1")
    assert {r["source"] for r in rows} == {"slack"}
    assert {r["payload"]["channel_id"] for r in rows} == {"C1", "C2"}


def test_sync_reads_only_the_selected_channels(db):
    conn = _connect(db, "C1")
    client = FakeClient(history={"C1": [_msg("1.0")], "C_OTHER": [_msg("2.0")]})
    sl_sync.sync_connection(conn, client=client, now=NOW)
    assert [c["channel"] for c in client.history_calls] == ["C1"]


def test_the_read_window_is_bounded_and_wider_on_the_first_sync(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_LOOKBACK_DAYS", "7")
    monkeypatch.setenv("SLACK_SYNC_INITIAL_LOOKBACK_DAYS", "14")
    conn = _connect(db, "C1")

    initial = FakeClient(history={"C1": []})
    r1 = sl_sync.sync_connection(conn, client=initial, now=NOW, initial=True)
    incremental = FakeClient(history={"C1": []})
    r2 = sl_sync.sync_connection(conn, client=incremental, now=NOW, initial=False)

    assert float(initial.history_calls[0]["oldest"]) == \
        pytest.approx((NOW - timedelta(days=14)).timestamp())
    assert float(incremental.history_calls[0]["oldest"]) == \
        pytest.approx((NOW - timedelta(days=7)).timestamp())
    assert r1.window_start < r2.window_start   # the initial window opens earlier


def test_the_first_sync_is_inferred_from_last_sync_at(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_PAGES", "1")
    monkeypatch.setenv("SLACK_SYNC_INITIAL_MAX_PAGES", "2")
    conn = _connect(db, "C1")
    first = FakeClient(history={"C1": []})
    sl_sync.sync_connection(conn, client=first, now=NOW)
    assert first.history_calls[0]["max_pages"] == 2

    later = FakeClient(history={"C1": []})
    sl_sync.sync_connection(sl_store.get_connection("p1"), client=later, now=NOW)
    assert later.history_calls[0]["max_pages"] == 1


def test_the_message_ceiling_is_split_into_a_fair_per_channel_share(db, monkeypatch):
    """A noisy channel must never starve the others of their budget."""
    monkeypatch.setenv("SLACK_SYNC_MAX_MESSAGES", "10")
    conn = _connect(db, "C1", "C2", "C3", "C4", "C5")
    client = FakeClient(history={c: [] for c in ("C1", "C2", "C3", "C4", "C5")})
    sl_sync.sync_connection(conn, client=client, now=NOW)
    assert [c["max_messages"] for c in client.history_calls] == [2, 2, 2, 2, 2]


def test_a_channel_that_fills_its_share_marks_the_sync_truncated(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_MESSAGES", "2")
    conn = _connect(db, "C1")
    client = FakeClient(history={"C1": [_msg(f"170000000{i}.0") for i in range(5)]})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert report.truncated is True
    # Truncation is a configured BOUND, not a provider failure.
    assert report.ok is True
    assert report.messages == 2


def test_the_selected_channel_cap_is_re_enforced_at_read_time(db, monkeypatch):
    """Lowering the cap after a selection must narrow the read, not honour an
    old, now-oversized binding."""
    conn = _connect(db, "C1", "C2", "C3")
    monkeypatch.setenv("SLACK_MAX_SELECTED_CHANNELS", "2")
    client = FakeClient(history={"C1": [], "C2": [], "C3": []})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert [c["channel"] for c in client.history_calls] == ["C1", "C2"]
    assert report.channels == 2


# ── threads ──────────────────────────────────────────────────────────────────

def _threaded(ts="1700000001.0", replies=2):
    return _msg(ts, thread_ts=ts, reply_count=replies, reply_users_count=2,
                latest_reply="1700000500.0")


def test_threads_are_expanded_within_bounds(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_THREADS_PER_CHANNEL", "1")
    conn = _connect(db, "C1")
    client = FakeClient(
        history={"C1": [_threaded("1700000001.0"), _threaded("1700000002.0")]},
        replies={"1700000001.0": [_msg("1700000500.0")]})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert len(client.reply_calls) == 1
    assert report.threads == 1
    assert report.truncated is True   # a second thread existed but was not read
    kinds = {r["kind"] for r in obs.list_observations("p1")}
    assert kinds == {"slack.message.created", "slack.thread.activity"}


def test_thread_expansion_can_be_disabled_entirely(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_THREADS_PER_CHANNEL", "0")
    conn = _connect(db, "C1")
    client = FakeClient(history={"C1": [_threaded()]})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert client.reply_calls == []
    assert report.threads == 0


def test_unthreaded_messages_cost_no_reply_request(db):
    conn = _connect(db, "C1")
    client = FakeClient(history={"C1": [_msg("1.0"), _msg("2.0")]})
    sl_sync.sync_connection(conn, client=client, now=NOW)
    assert client.reply_calls == []


def test_a_thread_read_failure_is_recorded_without_aborting_the_channel(db):
    conn = _connect(db, "C1")
    client = FakeClient(
        history={"C1": [_threaded("1700000001.0")]},
        errors={"thread:1700000001.0": SlackAccessError("gone",
                                                        slack_error="thread_not_found")})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert report.ok is False
    assert "thread:C1:1700000001.0" in report.errors
    # The channel's own messages still landed.
    assert report.messages == 1


# ── partial failure semantics ────────────────────────────────────────────────

def test_an_unreadable_channel_is_reported_never_read_as_empty(db):
    conn = _connect(db, "C1", "C2")
    client = FakeClient(history={"C2": [_msg("1700000002.0")]},
                        errors={"C1": SlackAccessError("no",
                                                       slack_error="not_in_channel")})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert report.ok is False
    assert report.errors["channel:C1"] == "SlackAccessError (not_in_channel)"
    assert report.channels_read == 1        # C2 still synced
    assert report.messages == 1


def test_last_sync_at_advances_only_on_a_fully_clean_sync(db):
    conn = _connect(db, "C1", "C2")
    failing = FakeClient(history={"C2": []},
                         errors={"C1": SlackServerError("500", status=500)})
    sl_sync.sync_connection(conn, client=failing, now=NOW)
    assert sl_store.get_connection("p1").last_sync_at == ""

    clean = FakeClient(history={"C1": [], "C2": []})
    sl_sync.sync_connection(sl_store.get_connection("p1"), client=clean, now=NOW)
    assert sl_store.get_connection("p1").last_sync_at != ""


def test_a_partial_failure_keeps_the_next_sync_at_initial_breadth(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_INITIAL_LOOKBACK_DAYS", "14")
    monkeypatch.setenv("SLACK_SYNC_LOOKBACK_DAYS", "1")
    conn = _connect(db, "C1")
    sl_sync.sync_connection(
        conn, client=FakeClient(errors={"C1": SlackServerError("500")}), now=NOW)
    retry = FakeClient(history={"C1": []})
    sl_sync.sync_connection(sl_store.get_connection("p1"), client=retry, now=NOW)
    assert float(retry.history_calls[0]["oldest"]) == \
        pytest.approx((NOW - timedelta(days=14)).timestamp())


def test_a_dead_installation_aborts_the_whole_sync(db):
    conn = _connect(db, "C1", "C2")
    client = FakeClient(history={"C2": [_msg("1.0")]},
                        errors={"C1": SlackAuthError("dead",
                                                     slack_error="invalid_auth")})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert report.ok is False
    assert report.errors["connection"] == "SlackAuthError (invalid_auth)"
    # C2 is never attempted — nothing else could succeed.
    assert [c["channel"] for c in client.history_calls] == ["C1"]


def test_a_rate_limit_stops_the_read_instead_of_hammering_slack(db):
    conn = _connect(db, "C1", "C2", "C3")
    client = FakeClient(errors={"C2": SlackRateLimitError("slow down",
                                                          slack_error="ratelimited")},
                        history={"C1": [_msg("1.0")], "C3": [_msg("3.0")]})
    report = sl_sync.sync_connection(conn, client=client, now=NOW)
    assert report.ok is False
    assert "rate_limit" in report.errors
    assert [c["channel"] for c in client.history_calls] == ["C1", "C2"]
    assert sl_store.get_connection("p1").last_sync_at == ""


def test_a_connection_with_no_channels_reports_it_truthfully(db):
    sl_store.upsert_installation(project_id="p1", owner_user_id="uA",
                                 bot_token=BOT_TOKEN, team_id="T1")
    report = sl_sync.sync_connection(sl_store.get_connection("p1"), now=NOW)
    assert report.ok is False
    assert "connection" in report.errors


# ── idempotency ──────────────────────────────────────────────────────────────

def test_repeated_syncs_deduplicate(db):
    conn = _connect(db, "C1")
    messages = {"C1": [_threaded("1700000001.0"), _msg("1700000003.0")]}
    replies = {"1700000001.0": [_msg("1700000500.0")]}

    first = sl_sync.sync_connection(conn, client=FakeClient(history=messages,
                                                            replies=replies), now=NOW)
    second = sl_sync.sync_connection(sl_store.get_connection("p1"),
                                     client=FakeClient(history=messages,
                                                       replies=replies), now=NOW)
    assert first.recorded == 3 and first.deduplicated == 0
    assert second.recorded == 0 and second.deduplicated == 3
    assert len(obs.list_observations("p1", limit=100)) == 3


def test_a_thread_that_gains_replies_records_once_more(db):
    conn = _connect(db, "C1")
    sl_sync.sync_connection(conn, client=FakeClient(
        history={"C1": [_threaded("1700000001.0", replies=1)]},
        replies={"1700000001.0": [_msg("1700000500.0")]}), now=NOW)

    grown = _threaded("1700000001.0", replies=2)
    grown["latest_reply"] = "1700000600.0"
    report = sl_sync.sync_connection(sl_store.get_connection("p1"), client=FakeClient(
        history={"C1": [grown]},
        replies={"1700000001.0": [_msg("1700000500.0"), _msg("1700000600.0")]}), now=NOW)
    threads = [r for r in obs.list_observations("p1", limit=100)
               if r["kind"] == "slack.thread.activity"]
    assert report.recorded == 1        # the thread row; the parent message dedups
    assert len(threads) == 2


def test_a_retry_after_a_partial_failure_creates_no_duplicates(db):
    conn = _connect(db, "C1", "C2")
    history = {"C1": [_msg("1700000001.0")], "C2": [_msg("1700000002.0")]}
    sl_sync.sync_connection(conn, client=FakeClient(
        history=history, errors={"C2": SlackServerError("500")}), now=NOW)
    retry = sl_sync.sync_connection(sl_store.get_connection("p1"),
                                    client=FakeClient(history=history), now=NOW)
    assert retry.deduplicated == 1 and retry.recorded == 1
    assert len(obs.list_observations("p1", limit=100)) == 2


# ── scoping ──────────────────────────────────────────────────────────────────

def test_observations_are_scoped_to_the_connections_owner_and_project(db):
    conn = _connect(db, "C1")
    sl_sync.sync_connection(conn, client=FakeClient(history={"C1": [_msg("1.0")]}),
                            now=NOW)
    [row] = obs.list_observations("p1")
    assert (row["user_id"], row["project_id"]) == ("uA", "p1")


def test_two_projects_sharing_a_workspace_stay_isolated(db):
    a = _connect(db, "C1", project_id="p1", owner="uA")
    b = _connect(db, "C1", project_id="p2", owner="uB")
    sl_sync.sync_connection(a, client=FakeClient(history={"C1": [_msg("1.0")]}), now=NOW)
    sl_sync.sync_connection(b, client=FakeClient(history={"C1": [_msg("2.0")]}), now=NOW)
    assert [r["payload"]["ts"] for r in obs.list_observations("p1")] == ["1.0"]
    assert [r["payload"]["ts"] for r in obs.list_observations("p2")] == ["2.0"]
    assert obs.list_observations("p1", user_id="uB") == []


# ── explicit-only guarantees ─────────────────────────────────────────────────

def test_sync_module_has_no_scheduler_webhook_or_poller():
    import inspect
    src = inspect.getsource(sl_sync).split('"""', 2)[-1]
    for forbidden in ("celery", "schedule", "cron", "webhook", "while True",
                      "time.sleep", "asyncio"):
        assert forbidden not in src.lower()


def test_sync_makes_no_model_or_embedding_call():
    import inspect
    # The module docstring legitimately NAMES what must not happen ("ZERO
    # embeddings"), so only the code below it is inspected.
    src = inspect.getsource(sl_sync).split('"""', 2)[-1].lower()
    for forbidden in ("openai", "anthropic", "embedding", "ai_client",
                      "completion"):
        assert forbidden not in src


def test_sync_project_reports_missing_and_revoked_connections(db):
    assert sl_sync.sync_project("nope").errors["connection"]
    _connect(db, "C1")
    sl_store.mark_revoked("p1")
    assert "no longer" in sl_sync.sync_project("p1").errors["connection"]


def test_report_dict_is_json_safe_and_carries_no_token(db):
    import json
    conn = _connect(db, "C1")
    report = sl_sync.sync_connection(conn, client=FakeClient(history={"C1": [_msg("1.0")]}),
                                     now=NOW)
    body = json.dumps(report.as_dict())
    assert BOT_TOKEN not in body
    assert set(report.as_dict()) == {
        "project_id", "team_id", "channels", "channels_read", "messages",
        "threads", "recorded", "deduplicated", "rejected", "window_start",
        "truncated", "errors", "ok"}
