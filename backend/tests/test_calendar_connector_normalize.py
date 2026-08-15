# coding: utf-8
"""Google Calendar connector — event normalization (PURE, zero I/O).

Covers the observation kinds, the importance policy, the deterministic
state-aware dedup key, truthful source timestamps, and — the privacy contract —
that unbounded / sensitive fields (attachments, long descriptions, whole
attendee lists) are never copied into an observation payload.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.services.google_calendar import normalize

NOW = datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc)


def _event(**over):
    base = {
        "id": "ev1",
        "status": "confirmed",
        "summary": "Design review",
        "htmlLink": "https://calendar.google.com/event?eid=abc",
        "created": "2026-02-01T09:00:00Z",
        "updated": "2026-03-01T09:00:00Z",
        "start": {"dateTime": "2026-03-20T14:00:00+03:00", "timeZone": "Europe/Istanbul"},
        "end": {"dateTime": "2026-03-20T15:00:00+03:00", "timeZone": "Europe/Istanbul"},
        "organizer": {"email": "boss@acme.com", "displayName": "The Boss"},
        "location": "Room 4",
        "hangoutLink": "https://meet.google.com/abc-defg-hij",
    }
    base.update(over)
    return base


def _n(ev, **kw):
    kw.setdefault("now", NOW)
    kw.setdefault("calendar_id", "primary")
    return normalize.normalize_event(ev, **kw)


# ── kinds ────────────────────────────────────────────────────────────────────

def test_future_event_is_upcoming():
    o = _n(_event())
    assert o["source"] == "calendar"
    assert o["kind"] == "calendar.event.upcoming"
    assert "Design review" in o["summary"]


def test_past_event_is_updated_state():
    o = _n(_event(start={"dateTime": "2026-03-05T10:00:00Z"},
                  end={"dateTime": "2026-03-05T11:00:00Z"}))
    assert o["kind"] == "calendar.event.updated"
    assert o["importance"] == "low"


def test_cancelled_event_is_cancelled():
    o = _n(_event(status="cancelled"))
    assert o["kind"] == "calendar.event.cancelled"
    assert "cancelled" in o["summary"].lower()


def test_minimal_cancelled_instance_is_still_observed():
    """showDeleted=true returns cancelled recurring instances as a MINIMAL
    resource — no summary, timing only in originalStartTime. That is the most
    valuable signal this connector emits, so it must not be dropped."""
    o = _n({"id": "ev9", "status": "cancelled", "updated": "2026-03-09T08:00:00Z",
            "recurringEventId": "series-1",
            "originalStartTime": {"dateTime": "2026-03-15T09:00:00Z"}})
    assert o is not None
    assert o["kind"] == "calendar.event.cancelled"
    assert o["importance"] == "high"          # a future commitment disappeared
    assert o["payload"]["start"] == "2026-03-15T09:00:00Z"
    assert o["payload"]["recurring"] is True
    assert o["payload"]["recurring_event_id"] == "series-1"


# ── importance policy ────────────────────────────────────────────────────────

@pytest.mark.parametrize("start,status,expected", [
    ("2026-03-10T18:00:00Z", "confirmed", "high"),    # starts in 6h → imminent
    ("2026-03-25T09:00:00Z", "confirmed", "normal"),  # two weeks out
    ("2026-03-01T09:00:00Z", "confirmed", "low"),     # already happened
    ("2026-03-25T09:00:00Z", "cancelled", "high"),    # future commitment killed
    ("2026-03-01T09:00:00Z", "cancelled", "low"),     # a past event was cancelled
])
def test_importance_policy(start, status, expected):
    o = _n(_event(status=status, start={"dateTime": start}))
    assert o["importance"] == expected


def test_soon_window_is_configurable(monkeypatch):
    monkeypatch.setenv("CALENDAR_SOON_HOURS", "1")
    o = _n(_event(start={"dateTime": "2026-03-10T18:00:00Z"}))
    assert o["importance"] == "normal"        # 6h out is no longer "soon"


def test_unknown_start_on_cancelled_event_is_normal():
    o = _n({"id": "ev0", "status": "cancelled", "updated": "2026-03-09T08:00:00Z"})
    assert o["kind"] == "calendar.event.cancelled"
    assert o["importance"] == "normal"


# ── deterministic, state-aware, clock-INDEPENDENT dedup key ──────────────────

def test_external_id_is_stable_for_an_unchanged_event():
    a = _n(_event())
    b = _n(_event())
    assert a["external_id"] == b["external_id"]


def test_external_id_changes_when_the_event_is_edited():
    a = _n(_event())
    b = _n(_event(updated="2026-03-02T10:00:00Z", summary="Design review (moved)"))
    assert a["external_id"] != b["external_id"]


def test_external_id_changes_when_the_event_is_cancelled():
    a = _n(_event())
    b = _n(_event(status="cancelled", updated="2026-03-02T10:00:00Z"))
    assert a["external_id"] != b["external_id"]


def test_external_id_is_not_clock_relative():
    """An unchanged event that merely crosses "now" between two syncs must NOT
    produce a second observation — only its KIND may change."""
    later = NOW + timedelta(days=30)
    a = _n(_event())
    b = _n(_event(), now=later)
    assert a["kind"] == "calendar.event.upcoming"
    assert b["kind"] == "calendar.event.updated"
    assert a["external_id"] == b["external_id"]


def test_external_id_is_calendar_scoped_and_caller_supplied():
    a = _n(_event(), calendar_id="primary")
    b = _n(_event(), calendar_id="team@group.calendar.google.com")
    assert a["external_id"] != b["external_id"]
    # Event content (an organizer address) can never redirect the key.
    c = _n(_event(organizer={"email": "attacker@evil.com"}), calendar_id="primary")
    assert c["external_id"] == a["external_id"]


# ── truthful source time ─────────────────────────────────────────────────────

def test_observed_at_is_the_change_time_not_the_start_time():
    o = _n(_event())
    assert o["observed_at"] == "2026-03-01T09:00:00Z"     # `updated`
    assert o["observed_at"] != o["payload"]["start"]


def test_observed_at_falls_back_to_created():
    ev = _event()
    ev.pop("updated")
    o = _n(ev)
    assert o["observed_at"] == "2026-02-01T09:00:00Z"


# ── bounded payload / privacy contract ───────────────────────────────────────

def test_payload_fields():
    p = _n(_event())["payload"]
    assert p["provider"] == "calendar"
    assert p["calendar_id"] == "primary"
    assert p["event_id"] == "ev1"
    assert p["status"] == "confirmed"
    assert p["title"] == "Design review"
    assert p["start"] == "2026-03-20T14:00:00+03:00"
    assert p["end"] == "2026-03-20T15:00:00+03:00"
    assert p["all_day"] is False
    assert p["time_zone"] == "Europe/Istanbul"
    assert p["location"] == "Room 4"
    assert p["meeting_url"] == "https://meet.google.com/abc-defg-hij"
    assert p["html_link"].startswith("https://calendar.google.com/")
    assert p["organizer"] == {"email": "boss@acme.com", "display_name": "The Boss"}
    assert p["recurring"] is False
    assert p["attendee_count"] == 0


def test_all_day_event():
    p = _n(_event(start={"date": "2026-03-20"}, end={"date": "2026-03-21"}))["payload"]
    assert p["all_day"] is True
    assert p["start"] == "2026-03-20"        # the raw date is preserved verbatim


def test_conference_entry_point_is_used_when_no_hangout_link():
    ev = _event()
    ev.pop("hangoutLink")
    ev["conferenceData"] = {"entryPoints": [
        {"entryPointType": "phone", "uri": "tel:+1-555", "pin": "9999"},
        {"entryPointType": "video", "uri": "https://zoom.example/j/42"},
    ]}
    p = _n(ev)["payload"]
    assert p["meeting_url"] == "https://zoom.example/j/42"
    assert "9999" not in json.dumps(p)        # pins/phones are not copied


def test_attendees_are_bounded_and_counted(monkeypatch):
    monkeypatch.setenv("CALENDAR_ATTENDEES_MAX", "2")
    ev = _event(attendees=[
        {"email": f"a{i}@x.com", "displayName": f"Person {i}",
         "responseStatus": "accepted", "comment": "SECRET-COMMENT"}
        for i in range(50)
    ])
    p = _n(ev)["payload"]
    assert p["attendee_count"] == 50          # true total always reported
    assert len(p["attendees"]) == 2           # …but the list is bounded
    assert p["attendees"][0] == {"email": "a0@x.com", "response_status": "accepted"}
    blob = json.dumps(p)
    assert "SECRET-COMMENT" not in blob and "Person 0" not in blob


def test_attendee_list_can_be_disabled(monkeypatch):
    monkeypatch.setenv("CALENDAR_ATTENDEES_MAX", "0")
    p = _n(_event(attendees=[{"email": "a@x.com"}]))["payload"]
    assert p["attendee_count"] == 1
    assert "attendees" not in p


def test_description_is_truncated(monkeypatch):
    monkeypatch.setenv("CALENDAR_DESCRIPTION_MAX_CHARS", "10")
    p = _n(_event(description="0123456789ABCDEFGHIJ"))["payload"]
    assert p["description"] == "0123456789"


def test_description_can_be_disabled(monkeypatch):
    monkeypatch.setenv("CALENDAR_DESCRIPTION_MAX_CHARS", "0")
    p = _n(_event(description="anything at all"))["payload"]
    assert "description" not in p


def test_attachments_and_extended_properties_are_never_copied():
    ev = _event(
        attachments=[{"fileId": "SECRET-FILE-ID", "title": "Q3 board deck",
                      "fileUrl": "https://drive.google.com/SECRET"}],
        extendedProperties={"private": {"token": "SECRET-PROP"}},
        gadget={"preferences": {"x": "SECRET-GADGET"}},
    )
    blob = json.dumps(_n(ev))
    for secret in ("SECRET-FILE-ID", "SECRET", "SECRET-PROP", "SECRET-GADGET",
                   "board deck"):
        assert secret not in blob


def test_malformed_input_rejected():
    assert normalize.normalize_event({}, now=NOW) is None
    assert normalize.normalize_event({"summary": "no id"}, now=NOW) is None
    assert normalize.normalize_event("not-a-dict", now=NOW) is None


def test_normalize_events_skips_malformed_and_preserves_order():
    out = normalize.normalize_events(
        [_event(id="a"), {"no": "id"}, _event(id="b")],
        calendar_id="primary", now=NOW)
    assert [o["payload"]["event_id"] for o in out] == ["a", "b"]


def test_unparseable_start_does_not_raise():
    o = _n(_event(start={"dateTime": "not-a-timestamp"}))
    assert o is not None
    assert o["kind"] == "calendar.event.updated"   # unknown timing → recent state
    assert o["payload"]["start"] == "not-a-timestamp"
