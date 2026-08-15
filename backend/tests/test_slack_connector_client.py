# coding: utf-8
"""Slack connector — read-only Web API client.

Covers the enforced read-only surface (GET only, four allowlisted methods), the
`{"ok": false}`-at-HTTP-200 mapping that keeps "the bot was removed from this
channel" from looking like "the channel is quiet", the crucial split between a
DEAD INSTALLATION (credential wiped, reconnect required) and an UNREADABLE
CHANNEL (credential intact), and every pagination/volume bound. The HTTP layer
is stubbed at the urllib seam — no real Slack call.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.parse

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.slack import client as sl_client_mod
from backend.services.slack import store as sl_store
from backend.services.slack.client import SlackClient, channel_identity
from backend.services.slack.errors import (
    SlackAccessError, SlackAuthError, SlackError, SlackRateLimitError,
    SlackServerError,
)

BOT_TOKEN = "xoxb-REAL-BOT-TOKEN"


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("SLACK_API_BASE", "https://slack.test/api")
    monkeypatch.setattr(sl_store, "DB_PATH", path, raising=False)
    sl_store._reset_for_tests()
    sl_store.init_slack_tables()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    sl_store.upsert_installation(project_id="p1", owner_user_id="uA",
                                 bot_token=BOT_TOKEN, team_id="T1")
    yield path
    credential_crypto.set_cipher_for_tests(None)


class _Resp(io.BytesIO):
    def __init__(self, payload):
        super().__init__(json.dumps(payload).encode("utf-8"))
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Transport:
    """Records every request and replies from a scripted queue."""

    def __init__(self, *payloads):
        self.payloads = list(payloads)
        self.calls = []

    def __call__(self, req, timeout=None):
        parsed = urllib.parse.urlparse(req.full_url)
        self.calls.append({
            "method": req.get_method(),
            "path": parsed.path,
            "params": dict(urllib.parse.parse_qsl(parsed.query)),
            "auth": req.headers.get("Authorization"),
        })
        payload = self.payloads.pop(0) if self.payloads else {"ok": True}
        if isinstance(payload, Exception):
            raise payload
        return _Resp(payload)


def _stub(monkeypatch, *payloads) -> Transport:
    t = Transport(*payloads)
    monkeypatch.setattr(sl_client_mod.urllib.request, "urlopen", t)
    return t


def _client(db):
    return SlackClient(sl_store.get_connection("p1"))


def _http_error(status, headers=None):
    return urllib.error.HTTPError("https://slack.test/api/x", status, "e",
                                  headers or {}, io.BytesIO(b"{}"))


def _channel(cid="C1", **kw):
    base = {"id": cid, "name": cid.lower(), "is_private": False,
            "is_member": True, "is_archived": False}
    base.update(kw)
    return base


def _message(ts="1700000000.000100", **kw):
    base = {"type": "message", "ts": ts, "user": "U1", "text": "hello"}
    base.update(kw)
    return base


# ── read-only enforcement ────────────────────────────────────────────────────

def test_every_request_is_a_get_with_a_bearer_token(db, monkeypatch):
    t = _stub(monkeypatch, {"ok": True, "channels": [_channel()]})
    _client(db).list_channels()
    assert t.calls[0]["method"] == "GET"
    assert t.calls[0]["auth"] == f"Bearer {BOT_TOKEN}"


def test_only_four_read_methods_are_reachable():
    assert sl_client_mod._READ_METHODS == {
        "conversations.list", "conversations.info",
        "conversations.history", "conversations.replies"}


@pytest.mark.parametrize("method", [
    "chat.postMessage", "chat.delete", "conversations.join",
    "conversations.invite", "conversations.archive", "reactions.add",
    "files.upload", "users.list", "auth.revoke",
])
def test_a_non_read_method_is_refused_before_any_network_call(db, monkeypatch, method):
    """A real raise, not an assert — `python -O` strips assertions, and the
    read-only guarantee must hold regardless of how the interpreter was
    launched."""
    t = _stub(monkeypatch, {"ok": True})
    with pytest.raises(SlackError):
        _client(db)._get(method, params={"channel": "C1"})
    assert t.calls == []


def test_client_exposes_no_mutation_helper():
    public = {n for n in dir(SlackClient) if not n.startswith("_")}
    assert public == {"list_channels", "list_channels_page", "get_channel",
                      "history", "replies"}


def test_channel_listing_never_requests_direct_messages(db, monkeypatch):
    """`im`/`mpim` are outside this connector entirely."""
    t = _stub(monkeypatch, {"ok": True, "channels": []})
    _client(db).list_channels()
    types = t.calls[0]["params"]["types"]
    assert types == "public_channel,private_channel"
    assert "im" not in types.split(",")
    assert t.calls[0]["params"]["exclude_archived"] == "true"


# ── ok:false mapping — the whole point ──────────────────────────────────────

def test_not_in_channel_is_an_access_error_and_keeps_the_credential(db, monkeypatch):
    """A bot removed from ONE channel must not look like a dead installation,
    and must never read as "no messages"."""
    _stub(monkeypatch, {"ok": False, "error": "not_in_channel"})
    with pytest.raises(SlackAccessError) as exc:
        _client(db).history("C1")
    assert exc.value.slack_error == "not_in_channel"
    conn = sl_store.get_connection("p1")
    assert conn.is_revoked is False and conn.bot_token_enc != ""


@pytest.mark.parametrize("code", ["channel_not_found", "missing_scope",
                                  "is_archived", "restricted_action"])
def test_resource_level_denials_are_access_errors(db, monkeypatch, code):
    _stub(monkeypatch, {"ok": False, "error": code})
    with pytest.raises(SlackAccessError):
        _client(db).get_channel("C1")
    assert sl_store.get_connection("p1").is_revoked is False


@pytest.mark.parametrize("code", ["invalid_auth", "token_revoked",
                                  "account_inactive", "token_expired"])
def test_installation_level_failures_wipe_the_credential(db, monkeypatch, code):
    _stub(monkeypatch, {"ok": False, "error": code})
    with pytest.raises(SlackAuthError):
        _client(db).history("C1")
    conn = sl_store.get_connection("p1")
    assert conn.is_revoked is True
    assert conn.bot_token_enc == ""


def test_ratelimited_envelope_is_a_typed_rate_limit(db, monkeypatch):
    _stub(monkeypatch, {"ok": False, "error": "ratelimited"})
    with pytest.raises(SlackRateLimitError):
        _client(db).history("C1")
    assert sl_store.get_connection("p1").is_revoked is False


def test_an_unknown_error_code_is_never_an_empty_success(db, monkeypatch):
    _stub(monkeypatch, {"ok": False, "error": "something_new"})
    with pytest.raises(SlackError) as exc:
        _client(db).history("C1")
    assert exc.value.slack_error == "something_new"


def test_http_429_carries_slacks_retry_after(db, monkeypatch):
    _stub(monkeypatch, _http_error(429, {"Retry-After": "30"}))
    with pytest.raises(SlackRateLimitError) as exc:
        _client(db).history("C1")
    assert exc.value.retry_after == 30


def test_http_5xx_is_transient(db, monkeypatch):
    _stub(monkeypatch, _http_error(503))
    with pytest.raises(SlackServerError):
        _client(db).history("C1")


def test_network_failure_is_transient(db, monkeypatch):
    _stub(monkeypatch, urllib.error.URLError("boom"))
    with pytest.raises(SlackServerError):
        _client(db).history("C1")


def test_malformed_json_is_never_an_empty_success(db, monkeypatch):
    class BadResp(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(sl_client_mod.urllib.request, "urlopen",
                        lambda req, timeout=None: BadResp(b"not json"))
    with pytest.raises(SlackServerError):
        _client(db).history("C1")


def test_a_revoked_connection_never_reaches_the_network(db, monkeypatch):
    sl_store.mark_revoked("p1")
    t = _stub(monkeypatch, {"ok": True})
    with pytest.raises(SlackAuthError):
        SlackClient(sl_store.get_connection("p1")).history("C1")
    assert t.calls == []


# ── bounds ───────────────────────────────────────────────────────────────────

def test_channel_listing_follows_a_bounded_number_of_cursor_pages(db, monkeypatch):
    monkeypatch.setenv("SLACK_CHANNELS_MAX_PAGES", "2")
    pages = [{"ok": True, "channels": [_channel(f"C{i}")],
              "response_metadata": {"next_cursor": f"cur{i}"}} for i in range(5)]
    t = _stub(monkeypatch, *pages)
    out = _client(db).list_channels()
    assert len(t.calls) == 2
    assert [c["id"] for c in out] == ["C0", "C1"]


def test_channel_listing_stops_at_the_picker_ceiling(db, monkeypatch):
    monkeypatch.setenv("SLACK_PENDING_CHANNELS_MAX", "2")
    _stub(monkeypatch, {"ok": True,
                        "channels": [_channel(f"C{i}") for i in range(10)]})
    assert len(_client(db).list_channels()) == 2


def test_channel_listing_dedupes_across_pages(db, monkeypatch):
    _stub(monkeypatch,
          {"ok": True, "channels": [_channel("C1")],
           "response_metadata": {"next_cursor": "n"}},
          {"ok": True, "channels": [_channel("C1"), _channel("C2")]})
    assert [c["id"] for c in _client(db).list_channels()] == ["C1", "C2"]


def test_history_respects_the_oldest_window_and_page_cap(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_PAGES", "2")
    monkeypatch.setenv("SLACK_SYNC_PAGE_SIZE", "5")
    pages = [{"ok": True, "messages": [_message(f"170000000{i}.000100")],
              "has_more": True,
              "response_metadata": {"next_cursor": f"c{i}"}} for i in range(4)]
    t = _stub(monkeypatch, *pages)
    out = _client(db).history("C1", oldest="1699999999.000000")
    assert len(t.calls) == 2
    assert t.calls[0]["params"]["oldest"] == "1699999999.000000"
    assert t.calls[0]["params"]["limit"] == "5"
    assert t.calls[0]["params"]["channel"] == "C1"
    assert len(out) == 2


def test_history_stops_when_slack_reports_no_more(db, monkeypatch):
    t = _stub(monkeypatch, {"ok": True, "messages": [_message()], "has_more": False,
                            "response_metadata": {"next_cursor": "unused"}})
    _client(db).history("C1", max_pages=5)
    assert len(t.calls) == 1


def test_history_honours_the_hard_message_ceiling(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_MESSAGES", "3")
    _stub(monkeypatch, {"ok": True,
                        "messages": [_message(f"17000000{i:02d}.000100")
                                     for i in range(20)]})
    assert len(_client(db).history("C1", max_pages=5)) == 3


def test_history_caller_budget_cannot_exceed_the_configured_ceiling(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_MAX_MESSAGES", "2")
    _stub(monkeypatch, {"ok": True,
                        "messages": [_message(f"17000000{i:02d}.000100")
                                     for i in range(20)]})
    assert len(_client(db).history("C1", max_messages=999)) == 2


def test_history_dedupes_by_ts(db, monkeypatch):
    _stub(monkeypatch, {"ok": True, "messages": [_message("1.1"), _message("1.1"),
                                                 _message("2.2")]})
    assert [m["ts"] for m in _client(db).history("C1")] == ["1.1", "2.2"]


def test_replies_are_bounded_and_exclude_the_parent(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_THREAD_MAX_REPLIES", "2")
    t = _stub(monkeypatch, {"ok": True, "messages": [
        _message("100.0"), _message("101.0"), _message("102.0"), _message("103.0")]})
    out = _client(db).replies("C1", thread_ts="100.0")
    assert [m["ts"] for m in out] == ["101.0", "102.0"]
    # +1 because Slack counts the parent in `limit`.
    assert t.calls[0]["params"]["limit"] == "3"
    assert t.calls[0]["path"].endswith("conversations.replies")


def test_replies_are_skipped_entirely_when_disabled(db, monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_THREAD_MAX_REPLIES", "0")
    t = _stub(monkeypatch, {"ok": True, "messages": []})
    assert _client(db).replies("C1", thread_ts="100.0") == []
    assert t.calls == []


def test_replies_makes_exactly_one_request_no_pagination(db, monkeypatch):
    t = _stub(monkeypatch, {"ok": True, "messages": [_message("100.0"), _message("101.0")],
                            "has_more": True,
                            "response_metadata": {"next_cursor": "more"}})
    _client(db).replies("C1", thread_ts="100.0")
    assert len(t.calls) == 1


def test_missing_ids_short_circuit_without_a_network_call(db, monkeypatch):
    t = _stub(monkeypatch, {"ok": True})
    assert _client(db).history("") == []
    assert _client(db).replies("C1", thread_ts="") == []
    assert t.calls == []


# ── channel identity projection ──────────────────────────────────────────────

def test_channel_identity_picks_only_safe_fields():
    ident = channel_identity({
        "id": "C1", "name": "general", "is_private": True, "is_member": True,
        "is_archived": False,
        # None of these may survive.
        "topic": {"value": "secret plans"}, "purpose": {"value": "x"},
        "creator": "U9", "num_members": 42, "shared_team_ids": ["T2"],
    })
    assert ident == {"id": "C1", "name": "general", "is_private": True,
                     "is_member": True, "is_archived": False}


def test_channel_identity_is_defensive_about_junk():
    assert channel_identity(None)["id"] == ""
    assert channel_identity({})["is_member"] is False


def test_membership_is_slacks_truth_not_inferred_from_a_name():
    ident = channel_identity({"id": "C1", "name": "public-everyone-welcome",
                              "is_member": False})
    assert ident["is_member"] is False
