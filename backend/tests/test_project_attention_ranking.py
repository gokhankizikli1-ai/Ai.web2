# coding: utf-8
"""Needs-Attention — the deterministic presentation ranking.

`project_brain.attention` is the ONLY place the Project page decides what
"deserves a look now" means, and it is pure: no store, no clock it did not
receive, no model, no writes. These tests pin the rules the module documents,
because every one of them is a place where a naive implementation would produce
FAKE urgency:

  * `importance == high` is NOT the trigger (a routine merged PR must not alarm);
  * a resolved subject is silent (a green deploy retires the earlier red one);
  * a calendar event's imminence is recomputed from its own start time, never
    trusted from the stored importance hint, because a calendar observation is
    written once and deduplicated for the life of the event;
  * an in-flight deployment status neither alarms nor resolves;
  * Gmail and Slack are never attention;
  * ordering and bounds are stable for identical inputs.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.services.project_brain import attention as att

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _obs(source, kind, *, summary="", payload=None, when=None, importance="normal",
         oid="o1"):
    return {
        "id": oid, "source": source, "kind": kind, "summary": summary,
        "payload": payload or {}, "importance": importance,
        "observed_at": _iso(when or (NOW - timedelta(hours=1))),
    }


def _rank(observations, **kw):
    return att.rank_attention(observations, now=NOW, **kw)


# ── what qualifies ───────────────────────────────────────────────────────────

def test_failed_ci_is_blocking():
    items = _rank([_obs("github", "github.check.failed", summary="CI 'build' failed on main",
                        payload={"repo": "acme/site", "run_id": 7, "name": "build"},
                        importance="high")])
    assert len(items) == 1
    assert items[0]["severity"] == att.SEV_BLOCKING
    assert items[0]["reason"] == att.REASON_CI_FAILED
    assert items[0]["source"] == "github"
    assert items[0]["context"] == "acme/site"
    assert items[0]["title"] == "CI 'build' failed on main"


def test_production_deploy_error_is_blocking_preview_is_only_waiting():
    prod = _rank([_obs("vercel", "vercel.deployment.error",
                       payload={"vercel_project_id": "vp1", "target": "production",
                                "project_name": "Acme"})])
    prev = _rank([_obs("vercel", "vercel.deployment.error",
                       payload={"vercel_project_id": "vp1", "target": "preview"})])
    assert prod[0]["severity"] == att.SEV_BLOCKING
    assert prod[0]["reason"] == att.REASON_DEPLOY_FAILED
    assert prev[0]["severity"] == att.SEV_WAITING
    assert prev[0]["reason"] == att.REASON_PREVIEW_DEPLOY_FAILED


def test_open_pull_request_is_waiting_not_blocking():
    items = _rank([_obs("github", "github.pull_request.opened",
                        payload={"repo": "acme/site", "number": 12})])
    assert items[0]["severity"] == att.SEV_WAITING
    assert items[0]["reason"] == att.REASON_PR_AWAITING


def test_failed_product_build_is_blocking():
    items = att.rank_attention(
        [], products=[{"deliverable_id": "d1", "build_type": "app", "status": "failed",
                       "title": "iOS Shell", "updated_at": _iso(NOW - timedelta(hours=2))}],
        now=NOW)
    assert items[0]["severity"] == att.SEV_BLOCKING
    assert items[0]["reason"] == att.REASON_BUILD_FAILED
    assert items[0]["ref"] == "d1"
    assert items[0]["kind"] == "product.app_build"


def test_completed_product_is_not_attention():
    assert att.rank_attention([], products=[
        {"deliverable_id": "d1", "build_type": "web", "status": "completed",
         "title": "Landing", "updated_at": _iso(NOW)}], now=NOW) == []


# ── what does NOT qualify ────────────────────────────────────────────────────

def test_high_importance_alone_never_promotes():
    """The naive rule this module exists to avoid: a HIGH-importance observation
    whose kind is not an attention concept stays activity."""
    noisy = [
        _obs("gmail", "gmail.message.received", summary="Invoice", importance="high"),
        _obs("slack", "slack.message.created", summary="hey", importance="high"),
        _obs("github", "github.commit.pushed", summary="Commit abc", importance="high"),
        _obs("github", "github.issue.opened", summary="Issue #4", importance="high"),
        _obs("vercel", "vercel.project.updated", summary="settings", importance="high"),
    ]
    assert _rank(noisy) == []


def test_successful_check_alone_is_not_attention():
    assert _rank([_obs("github", "github.check.succeeded",
                       payload={"repo": "acme/site", "run_id": 7})]) == []


def test_unknown_source_and_kind_are_ignored():
    assert _rank([_obs("analytics", "metric.spike", summary="spike"),
                  _obs("github", "github.totally.new.kind", summary="?")]) == []


# ── supersession: the latest state of a subject wins ─────────────────────────

def test_green_deploy_retires_the_earlier_red_one():
    items = _rank([
        _obs("vercel", "vercel.deployment.ready", oid="new",
             payload={"vercel_project_id": "vp1", "target": "production"},
             when=NOW - timedelta(hours=1)),
        _obs("vercel", "vercel.deployment.error", oid="old",
             payload={"vercel_project_id": "vp1", "target": "production"},
             when=NOW - timedelta(hours=5)),
    ])
    assert items == []


def test_a_newer_failure_after_a_success_is_still_surfaced():
    items = _rank([
        _obs("vercel", "vercel.deployment.error", oid="new",
             payload={"vercel_project_id": "vp1", "target": "production"},
             when=NOW - timedelta(hours=1)),
        _obs("vercel", "vercel.deployment.ready", oid="old",
             payload={"vercel_project_id": "vp1", "target": "production"},
             when=NOW - timedelta(hours=5)),
    ])
    assert len(items) == 1
    assert items[0]["severity"] == att.SEV_BLOCKING


def test_merged_pull_request_retires_the_opened_one():
    assert _rank([
        _obs("github", "github.pull_request.merged", oid="m",
             payload={"repo": "acme/site", "number": 12}, when=NOW - timedelta(hours=1)),
        _obs("github", "github.pull_request.opened", oid="o",
             payload={"repo": "acme/site", "number": 12}, when=NOW - timedelta(days=2)),
    ]) == []


def test_a_different_pull_request_is_a_different_subject():
    items = _rank([
        _obs("github", "github.pull_request.merged", oid="m",
             payload={"repo": "acme/site", "number": 12}),
        _obs("github", "github.pull_request.opened", oid="o",
             payload={"repo": "acme/site", "number": 13}),
    ])
    assert len(items) == 1
    assert items[0]["reason"] == att.REASON_PR_AWAITING


def test_in_flight_deployment_status_neither_alarms_nor_resolves():
    """A `pending` status arriving after a failure must not silently clear it."""
    items = _rank([
        _obs("github", "github.deployment_status.pending", oid="p",
             payload={"repo": "acme/site", "environment": "production"},
             when=NOW - timedelta(minutes=10)),
        _obs("github", "github.deployment_status.failure", oid="f",
             payload={"repo": "acme/site", "environment": "production"},
             when=NOW - timedelta(hours=1)),
    ])
    assert len(items) == 1
    assert items[0]["reason"] == att.REASON_DEPLOY_FAILED
    # …and a pending status on its own raises nothing.
    assert _rank([_obs("github", "github.deployment_status.pending",
                       payload={"repo": "acme/site", "environment": "production"})]) == []


# ── calendar: imminence is RECOMPUTED, never trusted from the stored hint ────

def test_upcoming_meeting_within_the_window_is_time_sensitive():
    items = _rank([_obs("calendar", "calendar.event.upcoming", summary="Upcoming event: Standup",
                        payload={"event_id": "e1", "start": _iso(NOW + timedelta(hours=3))},
                        importance="high")])
    assert items[0]["severity"] == att.SEV_TIME_SENSITIVE
    assert items[0]["reason"] == att.REASON_MEETING_SOON


def test_a_meeting_that_already_happened_is_never_attention():
    """The observation is still stored as `upcoming` with importance=high —
    deduplication keeps it for the life of the event — so trusting the stored
    hint would keep alarming about a meeting that ended days ago."""
    assert _rank([_obs("calendar", "calendar.event.upcoming",
                       payload={"event_id": "e1", "start": _iso(NOW - timedelta(hours=3))},
                       importance="high")]) == []


def test_a_meeting_far_in_the_future_is_not_yet_attention():
    assert _rank([_obs("calendar", "calendar.event.upcoming",
                       payload={"event_id": "e1", "start": _iso(NOW + timedelta(days=6))},
                       importance="high")]) == []


def test_cancelled_future_meeting_is_time_sensitive_past_one_is_not():
    future = _rank([_obs("calendar", "calendar.event.cancelled", summary="Event cancelled: Review",
                         payload={"event_id": "e1", "start": _iso(NOW + timedelta(days=2))},
                         importance="high")])
    past = _rank([_obs("calendar", "calendar.event.cancelled",
                       payload={"event_id": "e2", "start": _iso(NOW - timedelta(days=2))},
                       importance="high")])
    assert future[0]["reason"] == att.REASON_MEETING_CANCELLED
    assert past == []


def test_cancelled_meeting_with_unknown_start_is_not_fabricated_as_urgent():
    assert _rank([_obs("calendar", "calendar.event.cancelled",
                       payload={"event_id": "e3"}, importance="high")]) == []


def test_all_day_event_start_dates_parse():
    items = _rank([_obs("calendar", "calendar.event.upcoming",
                        payload={"event_id": "e4", "all_day": True,
                                 "start": (NOW + timedelta(days=1)).date().isoformat()},
                        importance="high")])
    # A bare `YYYY-MM-DD` parses as midnight UTC of that day — 12h after NOW,
    # inside the window. (A parse failure would yield None and drop the item,
    # so this asserts the all-day shape is genuinely understood.)
    assert len(items) == 1
    assert items[0]["reason"] == att.REASON_MEETING_SOON


# ── age, ordering, bounds ────────────────────────────────────────────────────

def test_signals_older_than_the_window_are_history_not_attention():
    assert _rank([_obs("github", "github.check.failed",
                       payload={"repo": "acme/site", "run_id": 1},
                       when=NOW - timedelta(days=att.MAX_AGE_DAYS + 1))]) == []


def test_signal_with_unparseable_timestamp_is_kept_and_sorts_last():
    bad = _obs("github", "github.check.failed", oid="bad",
               payload={"repo": "acme/site", "run_id": 1})
    bad["observed_at"] = "not-a-timestamp"
    good = _obs("github", "github.check.failed", oid="good",
                payload={"repo": "acme/site", "run_id": 2},
                when=NOW - timedelta(hours=1))
    items = _rank([bad, good])
    assert len(items) == 2
    assert items[0]["title"] == good["summary"] or items[1]["observed_at"] == "not-a-timestamp"
    assert items[-1]["observed_at"] == "not-a-timestamp"


def test_order_is_severity_then_recency_and_is_deterministic():
    observations = [
        _obs("github", "github.pull_request.opened", oid="pr",
             payload={"repo": "acme/site", "number": 3}, when=NOW - timedelta(minutes=1)),
        _obs("calendar", "calendar.event.upcoming", oid="cal",
             payload={"event_id": "e1", "start": _iso(NOW + timedelta(hours=2))},
             when=NOW - timedelta(days=1)),
        _obs("github", "github.check.failed", oid="ci-old",
             payload={"repo": "acme/site", "run_id": 1}, when=NOW - timedelta(hours=6)),
        _obs("vercel", "vercel.deployment.error", oid="vc",
             payload={"vercel_project_id": "vp1", "target": "production"},
             when=NOW - timedelta(hours=2)),
    ]
    first = _rank(observations)
    assert [i["reason"] for i in first] == [
        att.REASON_DEPLOY_FAILED,     # blocking, 2h ago
        att.REASON_CI_FAILED,         # blocking, 6h ago
        att.REASON_MEETING_SOON,      # time-sensitive
        att.REASON_PR_AWAITING,       # waiting
    ]
    # Same inputs in a different order → the same ranking (no input-order bias).
    assert _rank(list(reversed(observations))) == first


def test_bounded_to_max_attention():
    many = [
        _obs("github", "github.check.failed", oid=f"c{i}",
             payload={"repo": "acme/site", "run_id": i},
             when=NOW - timedelta(minutes=i))
        for i in range(20)
    ]
    assert len(_rank(many)) == att.MAX_ATTENTION


def test_ids_are_stable_and_do_not_leak_provider_identifiers():
    payload = {"event_id": "google-opaque-event-id-1234", "start": _iso(NOW + timedelta(hours=1))}
    a = _rank([_obs("calendar", "calendar.event.upcoming", payload=payload)])
    b = _rank([_obs("calendar", "calendar.event.upcoming", payload=payload)])
    assert a[0]["id"] == b[0]["id"]
    assert "google-opaque-event-id-1234" not in str(a[0])


def test_malformed_input_never_raises():
    assert att.rank_attention([None, {}, {"kind": ""}, "nonsense"], now=NOW) == []
    assert att.rank_attention([], products=[None, {}, "x"], now=NOW) == []
