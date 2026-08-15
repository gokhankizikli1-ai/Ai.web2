# coding: utf-8
"""Google Calendar connector — bounded read client + explicit sync.

Covers the bounds that make this connector safe (time window, page size, page
count, absolute event ceiling), read-only request shape, idempotency across
re-syncs, partial-failure truthfulness, and the `last_sync_at` semantics.

No network: the client's single GET seam is stubbed, and the sync is driven with
a fake client — mirroring the Gmail/Vercel connector test suites.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.google_calendar import store as cal_store
from backend.services.google_calendar import sync as cal_sync
from backend.services.google_calendar.client import CalendarClient, EventsPage
from backend.services.google_calendar.errors import (
    CalendarRateLimitError, CalendarServerError,
)
from backend.services.orchestrator import observations_store as obs

NOW = datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture()
def cal_db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(cal_store, "DB_PATH", path, raising=False)
    monkeypatch.setattr(obs, "DB_PATH", path, raising=False)
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    cal_store._reset_for_tests(); cal_store.init_calendar_tables()
    obs.init_observations_table()
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _conn(project_id="p1", owner="uA", last_sync=""):
    conn = cal_store.upsert_connection(
        project_id=project_id, owner_user_id=owner, google_email="me@x.com",
        calendar_id="primary", time_zone="UTC", scopes="",
        refresh_token="RT", access_token="AT",
        access_token_expires="2999-01-01T00:00:00Z")
    if last_sync:
        cal_store.mark_synced(project_id)
        conn = cal_store.get_connection(project_id)
    return conn


def _event(eid="ev1", start="2026-03-20T14:00:00Z", status="confirmed",
           updated="2026-03-01T09:00:00Z", summary="Design review"):
    return {"id": eid, "status": status, "summary": summary, "updated": updated,
            "created": "2026-02-01T09:00:00Z",
            "start": {"dateTime": start}, "end": {"dateTime": start}}


class _FakeClient:
    """Records the arguments the sync passes down and replays canned events."""

    def __init__(self, events, *, error=None, summary="me@x.com", time_zone="UTC"):
        self._events = events
        self._error = error
        self._summary = summary
        self._tz = time_zone
        self.calls = []

    def list_events(self, *, calendar_id="", time_min="", time_max="", max_pages=None):
        self.calls.append({"calendar_id": calendar_id, "time_min": time_min,
                           "time_max": time_max, "max_pages": max_pages})
        if self._error:
            raise self._error
        return EventsPage(items=list(self._events), next_page_token="",
                          summary=self._summary, time_zone=self._tz)


# ── the read window is bounded on BOTH sides ─────────────────────────────────

def test_sync_window_bounds(monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_PAST_DAYS", "7")
    monkeypatch.setenv("CALENDAR_SYNC_UPCOMING_DAYS", "30")
    lo, hi = cal_sync.sync_window(NOW)
    assert lo == "2026-03-03T12:00:00Z"
    assert hi == "2026-04-09T12:00:00Z"


def test_sync_passes_the_bounded_window_to_the_client(cal_db, monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_PAST_DAYS", "7")
    monkeypatch.setenv("CALENDAR_SYNC_UPCOMING_DAYS", "30")
    client = _FakeClient([_event()])
    report = cal_sync.sync_connection(_conn(), client=client, now=NOW)
    call = client.calls[0]
    assert call["time_min"] == "2026-03-03T12:00:00Z"
    assert call["time_max"] == "2026-04-09T12:00:00Z"
    assert call["calendar_id"] == "primary"
    assert report.window_start == call["time_min"]
    assert report.window_end == call["time_max"]


def test_first_sync_uses_the_initial_page_cap_then_the_incremental_one(cal_db, monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_INITIAL_MAX_PAGES", "3")
    monkeypatch.setenv("CALENDAR_SYNC_MAX_PAGES", "1")
    client = _FakeClient([_event()])
    cal_sync.sync_connection(_conn(), client=client, now=NOW)
    assert client.calls[0]["max_pages"] == 3          # initial import
    # After a clean sync, last_sync_at is set → the next sync is incremental.
    cal_sync.sync_connection(cal_store.get_connection("p1"), client=client, now=NOW)
    assert client.calls[1]["max_pages"] == 1


# ── observations reach the canonical store, idempotently ─────────────────────

def test_sync_records_observations(cal_db):
    client = _FakeClient([_event("a"), _event("b", status="cancelled")])
    report = cal_sync.sync_connection(_conn(), client=client, now=NOW)
    assert report.ok is True
    assert report.events == 2
    assert report.recorded == 2 and report.deduplicated == 0
    kinds = {o["kind"] for o in obs.list_observations("p1")}
    assert kinds == {"calendar.event.upcoming", "calendar.event.cancelled"}
    assert all(o["source"] == "calendar" for o in obs.list_observations("p1"))


def test_resync_is_idempotent(cal_db):
    client = _FakeClient([_event("a")])
    conn = _conn()
    first = cal_sync.sync_connection(conn, client=client, now=NOW)
    second = cal_sync.sync_connection(cal_store.get_connection("p1"), client=client, now=NOW)
    assert first.recorded == 1
    assert second.recorded == 0 and second.deduplicated == 1
    assert len(obs.list_observations("p1")) == 1


def test_edited_event_records_a_second_observation(cal_db):
    conn = _conn()
    cal_sync.sync_connection(conn, client=_FakeClient([_event("a")]), now=NOW)
    cal_sync.sync_connection(
        cal_store.get_connection("p1"),
        client=_FakeClient([_event("a", updated="2026-03-05T10:00:00Z",
                                   summary="Design review (moved)")]),
        now=NOW)
    rows = obs.list_observations("p1")
    assert len(rows) == 2


def test_sync_records_no_task_or_candidate(cal_db):
    """Observations are INPUTS ONLY — a sync must never create anything
    executable, even for a high-importance imminent event."""
    from backend.services.orchestrator import candidate_actions_store, tasks_store
    client = _FakeClient([_event("a", start="2026-03-10T18:00:00Z")])
    report = cal_sync.sync_connection(_conn(), client=client, now=NOW)
    assert report.recorded == 1
    assert obs.list_observations("p1")[0]["importance"] == "high"
    assert candidate_actions_store.list_candidate_actions("p1") == []
    assert tasks_store.list_tasks_for_project("p1") == []


# ── failure truthfulness ─────────────────────────────────────────────────────

def test_provider_failure_is_not_an_empty_success(cal_db):
    client = _FakeClient([], error=CalendarServerError("Google 503", status=503))
    report = cal_sync.sync_connection(_conn(), client=client, now=NOW)
    assert report.ok is False
    assert "events" in report.errors
    assert report.recorded == 0
    # last_sync_at must NOT advance on a failed sync.
    assert cal_store.get_connection("p1").last_sync_at == ""


def test_failed_sync_stays_an_initial_import_on_retry(cal_db, monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_INITIAL_MAX_PAGES", "3")
    monkeypatch.setenv("CALENDAR_SYNC_MAX_PAGES", "1")
    failing = _FakeClient([], error=CalendarRateLimitError("429", status=429))
    cal_sync.sync_connection(_conn(), client=failing, now=NOW)
    retry = _FakeClient([_event("a")])
    cal_sync.sync_connection(cal_store.get_connection("p1"), client=retry, now=NOW)
    assert retry.calls[0]["max_pages"] == 3      # still the fuller backfill
    assert cal_store.get_connection("p1").last_sync_at != ""


def test_last_sync_at_advances_only_on_a_clean_sync(cal_db):
    conn = _conn()
    cal_sync.sync_connection(conn, client=_FakeClient([_event("a")]), now=NOW)
    assert cal_store.get_connection("p1").last_sync_at != ""


def test_sync_project_reports_missing_and_revoked_connections(cal_db):
    r = cal_sync.sync_project("nope")
    assert r.ok is False and "connection" in r.errors
    _conn()
    cal_store.mark_revoked("p1")
    r2 = cal_sync.sync_project("p1")
    assert r2.ok is False and "reconnect" in r2.errors["connection"].lower()


# ── the sync refreshes display identity from the SAME response ───────────────

def test_sync_updates_calendar_identity_without_an_extra_request(cal_db):
    client = _FakeClient([_event()], summary="owner@acme.com", time_zone="Europe/Berlin")
    report = cal_sync.sync_connection(_conn(), client=client, now=NOW)
    latest = cal_store.get_connection("p1")
    assert latest.google_email == "owner@acme.com"
    assert latest.time_zone == "Europe/Berlin"
    assert report.google_email == "owner@acme.com"
    assert len(client.calls) == 1          # one read, not two


# ── the read client's own bounds + read-only request shape ───────────────────

class _StubbedClient(CalendarClient):
    """CalendarClient with only its single GET seam replaced, so the real
    paging / ceiling / parameter logic is exercised."""

    def __init__(self, pages):
        self._pages = pages
        self.requests = []

    def _get(self, path, *, params=None, _retry_on_auth=True):
        self.requests.append((path, dict(params or {})))
        return self._pages[min(len(self.requests) - 1, len(self._pages) - 1)]


def _page(ids, next_token=""):
    body = {"summary": "me@x.com", "timeZone": "UTC",
            "items": [_event(i) for i in ids]}
    if next_token:
        body["nextPageToken"] = next_token
    return body


def test_client_request_is_a_bounded_read_only_events_list(monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_PAGE_SIZE", "50")
    c = _StubbedClient([_page(["a"])])
    c.list_events(calendar_id="primary", time_min="T0", time_max="T1", max_pages=1)
    path, params = c.requests[0]
    assert path == "/calendar/v3/calendars/primary/events"
    assert params["maxResults"] == 50
    assert params["singleEvents"] == "true"     # windowed recurrence instances
    assert params["orderBy"] == "startTime"
    assert params["showDeleted"] == "true"      # so cancellations are visible
    assert params["timeMin"] == "T0" and params["timeMax"] == "T1"


def test_client_follows_at_most_max_pages(monkeypatch):
    pages = [_page(["a"], "t1"), _page(["b"], "t2"), _page(["c"], "t3")]
    c = _StubbedClient(pages)
    out = c.list_events(time_min="T0", time_max="T1", max_pages=2)
    assert len(c.requests) == 2                 # never followed the 3rd token
    assert [e["id"] for e in out.items] == ["a", "b"]


def test_client_stops_at_the_absolute_event_ceiling(monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_MAX_EVENTS", "3")
    pages = [_page([f"e{i}" for i in range(10)], "t1")]
    c = _StubbedClient(pages)
    out = c.list_events(time_min="T0", time_max="T1", max_pages=5)
    assert len(out.items) == 3
    assert len(c.requests) == 1                 # ceiling reached → stop paging


def test_client_page_cap_is_clamped():
    pages = [_page(["a"], "t")] * 10
    c = _StubbedClient(pages)
    c.list_events(time_min="T0", time_max="T1", max_pages=99)
    assert len(c.requests) <= 5


def test_client_dedups_ids_across_pages():
    c = _StubbedClient([_page(["a", "b"], "t1"), _page(["b", "c"])])
    out = c.list_events(time_min="T0", time_max="T1", max_pages=2)
    assert [e["id"] for e in out.items] == ["a", "b", "c"]


def test_client_stops_when_there_is_no_next_page():
    c = _StubbedClient([_page(["a"])])
    c.list_events(time_min="T0", time_max="T1", max_pages=5)
    assert len(c.requests) == 1
