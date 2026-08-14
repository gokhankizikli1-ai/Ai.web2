# coding: utf-8
"""Gmail connector — normalize (pure) + bounded sync (fake client)."""
from __future__ import annotations

import pytest

from backend.services.gmail import crypto as gm_crypto
from backend.services.gmail import normalize
from backend.services.gmail import store as gm_store
from backend.services.gmail import sync as gm_sync
from backend.services.gmail.errors import GmailServerError
from backend.services.orchestrator import observations_store as obs


def _msg(mid="m1", subject="Hello", sender="a@b.com", snippet="hi there",
         labels=("INBOX", "UNREAD"), internal="1700000000000", thread="t1"):
    return {
        "id": mid, "threadId": thread, "snippet": snippet,
        "internalDate": internal, "labelIds": list(labels),
        "payload": {"headers": [
            {"name": "From", "value": sender},
            {"name": "Subject", "value": subject},
            {"name": "Date", "value": "Wed, 15 Nov 2023 00:00:00 +0000"},
        ]},
    }


# ── normalize ────────────────────────────────────────────────────────────────

def test_normalize_message_shape():
    o = normalize.normalize_message(_msg(), connection_email="me@x.com")
    assert o["source"] == "gmail"
    assert o["kind"] == "gmail.message.received"
    assert o["external_id"] == "m1"  # stable dedup key
    assert "Hello" in o["summary"]
    p = o["payload"]
    assert p["message_id"] == "m1" and p["thread_id"] == "t1"
    assert p["from"] == "a@b.com" and p["subject"] == "Hello"
    assert p["connection_email"] == "me@x.com"
    # observed_at derived from internalDate (epoch ms) → ISO Z.
    assert o["observed_at"].endswith("Z")


def test_normalize_bounds_snippet(monkeypatch):
    monkeypatch.setenv("GMAIL_SNIPPET_MAX_CHARS", "5")
    o = normalize.normalize_message(_msg(snippet="0123456789abcdef"))
    assert len(o["payload"]["snippet"]) == 5


def test_normalize_never_carries_body():
    # A payload with a body part must NOT leak — normalize only reads headers +
    # snippet, never parts/body.
    m = _msg()
    m["payload"]["body"] = {"data": "SECRET-BODY-BASE64"}
    m["payload"]["parts"] = [{"body": {"data": "SECRET-PART"}}]
    o = normalize.normalize_message(m)
    import json
    blob = json.dumps(o)
    assert "SECRET-BODY" not in blob and "SECRET-PART" not in blob


def test_normalize_rejects_no_id():
    assert normalize.normalize_message({"threadId": "t"}) is None


# ── sync (fake client) ───────────────────────────────────────────────────────

class _FakeClient:
    def __init__(self, ids, messages, *, list_error=None, get_errors=None):
        self._ids = ids
        self._messages = messages
        self._list_error = list_error
        self._get_errors = get_errors or {}

    def list_message_ids(self, **kw):
        if self._list_error:
            raise self._list_error
        return list(self._ids)

    def get_message_metadata(self, mid):
        if mid in self._get_errors:
            raise self._get_errors[mid]
        return self._messages.get(mid, {})


@pytest.fixture()
def gmail_db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    for mod in (gm_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    gm_crypto.set_cipher_for_tests(gm_crypto._ReversibleTestCipher())
    gm_store._reset_for_tests()
    gm_store.init_gmail_tables()
    obs.init_observations_table()
    gm_store.upsert_connection(
        project_id="p1", owner_user_id="uA", google_email="me@x.com", scopes="",
        refresh_token="R", access_token="A", access_token_expires="2999-01-01T00:00:00Z",
    )
    yield path
    gm_crypto.set_cipher_for_tests(None)


def test_sync_records_bounded_observations(gmail_db):
    conn = gm_store.get_connection("p1")
    client = _FakeClient(["m1", "m2"], {"m1": _msg("m1"), "m2": _msg("m2", subject="Two")})
    report = gm_sync.sync_connection(conn, client=client)
    assert report.ok is True
    assert report.recorded == 2 and report.fetched == 2
    kinds = {o["kind"] for o in obs.list_observations("p1")}
    assert kinds == {"gmail.message.received"}
    # All scoped to the connection's owner — never message content.
    assert all(o["user_id"] == "uA" for o in obs.list_observations("p1"))


def test_sync_is_idempotent(gmail_db):
    conn = gm_store.get_connection("p1")
    client = _FakeClient(["m1"], {"m1": _msg("m1")})
    r1 = gm_sync.sync_connection(conn, client=client)
    r2 = gm_sync.sync_connection(conn, client=client)
    assert r1.recorded == 1
    assert r2.recorded == 0 and r2.deduplicated == 1
    assert len(obs.list_observations("p1")) == 1


def test_sync_list_failure_is_truthful_not_empty_success(gmail_db):
    conn = gm_store.get_connection("p1")
    client = _FakeClient([], {}, list_error=GmailServerError("boom", status=500))
    report = gm_sync.sync_connection(conn, client=client)
    assert report.ok is False
    assert "list" in report.errors
    assert obs.list_observations("p1") == []


def test_sync_per_message_failure_skips_not_aborts(gmail_db):
    conn = gm_store.get_connection("p1")
    client = _FakeClient(
        ["m1", "m2"], {"m2": _msg("m2")},
        get_errors={"m1": GmailServerError("bad", status=500)},
    )
    report = gm_sync.sync_connection(conn, client=client)
    assert report.skipped == 1
    assert report.recorded == 1  # m2 still recorded
    assert report.ok is False   # but the failure is surfaced


def test_first_sync_uses_initial_page_cap_then_incremental(gmail_db, monkeypatch):
    # First sync follows more pages (initial import); the next sync — once
    # last_sync_at is stamped — reads a single page.
    monkeypatch.setenv("GMAIL_SYNC_INITIAL_MAX_PAGES", "4")
    monkeypatch.setenv("GMAIL_SYNC_MAX_PAGES", "1")
    seen = []

    class _Capturing(_FakeClient):
        def list_message_ids(self, **kw):
            seen.append(kw.get("max_pages"))
            return list(self._ids)

    conn = gm_store.get_connection("p1")
    gm_sync.sync_connection(conn, client=_Capturing(["m1"], {"m1": _msg("m1")}))
    assert seen == [4]

    conn2 = gm_store.get_connection("p1")          # last_sync_at now set
    assert conn2.last_sync_at
    gm_sync.sync_connection(conn2, client=_Capturing(["m1"], {"m1": _msg("m1")}))
    assert seen == [4, 1]


def test_partial_first_sync_stays_initial_until_success(gmail_db, monkeypatch):
    # A per-message failure makes the first sync partial → the initial import is
    # NOT completed; the next sync is still initial (fuller cap). Only a fully
    # clean sync flips to the incremental cap.
    monkeypatch.setenv("GMAIL_SYNC_INITIAL_MAX_PAGES", "4")
    monkeypatch.setenv("GMAIL_SYNC_MAX_PAGES", "1")
    seen = []

    class _Cap(_FakeClient):
        def list_message_ids(self, **kw):
            seen.append(kw.get("max_pages"))
            return list(self._ids)

    conn = gm_store.get_connection("p1")
    c1 = _Cap(["m1", "m2"], {"m2": _msg("m2")},
              get_errors={"m1": GmailServerError("bad", status=500)})
    r1 = gm_sync.sync_connection(conn, client=c1)
    assert r1.ok is False
    assert not gm_store.get_connection("p1").last_sync_at   # initial NOT completed

    conn2 = gm_store.get_connection("p1")                   # still last_sync_at=""
    c2 = _Cap(["m2"], {"m2": _msg("m2")})
    r2 = gm_sync.sync_connection(conn2, client=c2)
    assert r2.ok is True
    assert gm_store.get_connection("p1").last_sync_at        # now complete

    conn3 = gm_store.get_connection("p1")
    c3 = _Cap(["m2"], {"m2": _msg("m2")})
    gm_sync.sync_connection(conn3, client=c3)
    assert seen == [4, 4, 1]                                 # initial, initial (retry), incremental


def test_client_list_message_ids_follows_bounded_pages(gmail_db, monkeypatch):
    # The real client follows nextPageToken up to max_pages, then stops — never a
    # full-mailbox crawl — and de-duplicates ids across pages.
    from backend.services.gmail.client import GmailClient
    pages = [
        {"messages": [{"id": "a"}, {"id": "b"}], "nextPageToken": "t2"},
        {"messages": [{"id": "b"}, {"id": "c"}], "nextPageToken": "t3"},
        {"messages": [{"id": "d"}], "nextPageToken": "t4"},   # must NOT be reached
    ]
    calls = {"n": 0}

    def _fake_get(self, path, *, params=None, _retry_on_auth=True):
        i = calls["n"]; calls["n"] += 1
        return pages[i]

    monkeypatch.setattr(GmailClient, "_get", _fake_get)
    c = GmailClient(gm_store.get_connection("p1"))
    ids = c.list_message_ids(max_pages=2)
    assert ids == ["a", "b", "c"]     # 2 pages, deduped; page 3 not fetched
    assert calls["n"] == 2


def test_sync_does_not_create_tasks_or_decisions(gmail_db):
    conn = gm_store.get_connection("p1")
    client = _FakeClient(["m1"], {"m1": _msg("m1")})
    gm_sync.sync_connection(conn, client=client)
    from backend.services.orchestrator import candidate_actions_store, tasks_store
    assert candidate_actions_store.list_candidate_actions("p1") == []
    assert tasks_store.list_tasks_for_project("p1") == []
