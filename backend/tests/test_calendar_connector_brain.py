# coding: utf-8
"""Calendar ⇄ Business Brain / Project Brain consumption — proving the wiring.

These tests exercise the REAL chain the Calendar connector uses, which is the
SAME chain Gmail/GitHub/Vercel already use — no second registry, no second brain
loop, no connector-specific decision engine:

    Google Calendar event → google_calendar.normalize (pure)
        → google_calendar.ingest
        → observations_store.record_observation()
        → project_supervisor.assess_business_brain() / candidate_synthesis
          (the Business Brain OBSERVE + PRIORITIZE authorities)
        → project_brain.client.build_brain().connector_signals
          (the LIVE bounded project context the AI receives)

Asserted guarantees:
 1. "calendar" is in the ONE canonical connector-source registry.
 2. A Calendar observation for project A reaches the Business Brain for A.
 3. A Calendar observation reaches the LIVE Project Brain connector_signals.
 4. Project B cannot see A's Calendar observations (no cross-project leakage).
 5. User B cannot see user A's Calendar observations (no cross-user leakage).
 6. A duplicate sync does not duplicate the effective signal.
 7. Source timestamps are preserved, not overwritten with "now".
 8. Ingesting alone creates no task/run/candidate (INPUTS ONLY).
 9. The Business Brain PRIORITIZES a high-importance Calendar observation via
    its existing candidate flow.
10. Adding Calendar did not displace Gmail/GitHub/Vercel signals.

No network, no model calls: connections are constructed in-process and events
are normalized from plain fixture dicts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

NOW = datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc)


def _cal_conn(store_cls, *, project_id="pA", owner="uA"):
    return store_cls(
        project_id=project_id, owner_user_id=owner, provider="calendar",
        google_email="me@x.com", calendar_id="primary", time_zone="UTC",
        scopes="", refresh_token_enc="", access_token_enc="",
        access_token_expires="", status="connected",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
        last_sync_at="",
    )


def _gm_conn(store_cls, *, project_id="pA", owner="uA"):
    return store_cls(
        project_id=project_id, owner_user_id=owner, provider="gmail",
        google_email="me@x.com", scopes="", refresh_token_enc="",
        access_token_enc="", access_token_expires="", status="connected",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
        last_sync_at="",
    )


def _event(eid="ev1", start="2026-03-20T14:00:00Z", status="confirmed",
           updated="2026-03-01T09:00:00Z", summary="Investor update call"):
    return {"id": eid, "status": status, "summary": summary, "updated": updated,
            "created": "2026-02-01T09:00:00Z",
            "start": {"dateTime": start}, "end": {"dateTime": start},
            "organizer": {"email": "vc@fund.com"}}


@pytest.fixture()
def bb(tmp_path, monkeypatch):
    """A shared projects.db with every Business Brain store scoped to it, plus
    the connector ingest/normalize modules bound to the same observation store."""
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)

    from backend.services.orchestrator import (
        observations_store, candidate_actions_store, goals_store,
        decisions_store, metrics_store, project_supervisor, candidate_synthesis,
        tasks_store,
    )
    from backend.services.google_calendar import ingest as cal_ingest
    from backend.services.google_calendar import normalize as cal_norm
    from backend.services.google_calendar.store import CalendarConnection
    from backend.services.gmail import ingest as gm_ingest, normalize as gm_norm
    from backend.services.gmail.store import GmailConnection

    stores = (observations_store, candidate_actions_store, goals_store,
              decisions_store, metrics_store, tasks_store)
    for mod in stores:
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    observations_store.init_observations_table()
    candidate_actions_store.init_candidate_actions_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    metrics_store.init_metrics_table()

    return SimpleNamespace(
        obs=observations_store, cas=candidate_actions_store, tasks=tasks_store,
        supervisor=project_supervisor, synth=candidate_synthesis,
        cal_ingest=cal_ingest, cal_norm=cal_norm,
        cal_conn=_cal_conn(CalendarConnection),
        cal_conn_cls=CalendarConnection,
        gm_ingest=gm_ingest, gm_norm=gm_norm, gm_conn=_gm_conn(GmailConnection),
        path=path,
    )


def _ingest(bb, event, *, conn=None, now=NOW):
    normalized = bb.cal_norm.normalize_event(event, calendar_id="primary", now=now)
    return bb.cal_ingest.ingest_one(conn or bb.cal_conn, normalized)


# ── 1. the ONE canonical connector-source registry ───────────────────────────

def test_calendar_is_in_the_single_connector_source_registry():
    from backend.services.orchestrator import observations_store as obs
    from backend.services.google_calendar import normalize as cal_norm
    assert cal_norm.SOURCE in obs.CONNECTOR_SOURCES
    # The pre-existing connectors are still registered (no displacement).
    for src in ("github", "gmail", "vercel"):
        assert src in obs.CONNECTOR_SOURCES


def test_no_second_connector_registry_exists():
    """A parallel allowlist would silently drop Calendar signals. The Project
    Brain must read the ONE registry, not a hardcoded provider list."""
    import importlib
    import inspect
    # NB: the package attribute `client` is the singleton INSTANCE, so the
    # module itself has to be fetched explicitly.
    pb_module = importlib.import_module("backend.services.project_brain.client")
    src = inspect.getsource(pb_module)
    assert "CONNECTOR_SOURCES" in src
    # No hardcoded provider allowlist anywhere in the brain path.
    for literal in ('"gmail"', "'gmail'", '"vercel"', "'vercel'"):
        assert literal not in src


# ── 2. Business Brain sees the Calendar observation ──────────────────────────

def test_calendar_observation_visible_to_business_brain(bb):
    assert _ingest(bb, _event()) == "recorded"
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    sources = {o["source"] for o in assessment["observations"]}
    kinds = {o["kind"] for o in assessment["observations"]}
    assert "calendar" in sources
    assert "calendar.event.upcoming" in kinds


def test_all_three_calendar_kinds_flow_through(bb):
    assert _ingest(bb, _event("a", start="2026-03-20T14:00:00Z")) == "recorded"
    assert _ingest(bb, _event("b", start="2026-03-01T14:00:00Z")) == "recorded"
    assert _ingest(bb, _event("c", status="cancelled")) == "recorded"
    kinds = {o["kind"] for o in bb.obs.list_observations("pA")}
    assert kinds == {"calendar.event.upcoming", "calendar.event.updated",
                     "calendar.event.cancelled"}


# ── 3. LIVE Project Brain context (what the AI actually receives) ────────────

@pytest.fixture()
def live_brain(bb, monkeypatch):
    """The WIRED Project Brain surface (`GET /v2/projects/{id}/brain` + the
    chat-context builder), pointed at the same projects.db."""
    from backend.services.projects import store as projects_store
    from backend.services.project_brain import client as pb_client
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    monkeypatch.setattr(projects_store, "DB_PATH", bb.path, raising=False)
    projects_store.init()
    projects_store.create_project("uA", name="Proj A", project_id="pA")
    return pb_client


def test_calendar_event_appears_in_live_project_brain_context(bb, live_brain):
    """The end-to-end product claim: a project-scoped Calendar event shows up in
    the SAME bounded project context the AI already gets from connector signals."""
    _ingest(bb, _event(summary="Investor update call"))

    brain = live_brain.get("uA", "pA")
    assert brain is not None
    signals = brain.connector_signals
    hit = next(s for s in signals if s["source"] == "calendar")
    assert hit["kind"] == "calendar.event.upcoming"
    assert "Investor update call" in hit["summary"]
    assert hit["observed_at"] == "2026-03-01T09:00:00Z"

    # …and it reaches the SYSTEM-PROMPT fragment the chat layer injects — the
    # actual surface the AI reasons over.
    block = live_brain.build_context("uA", "pA")
    assert block is not None
    assert "Recent connector activity:" in block.text
    assert "[calendar]" in block.text
    assert "Investor update call" in block.text


def test_live_project_brain_is_owner_scoped(bb, live_brain):
    _ingest(bb, _event(summary="Investor update call"))
    other = live_brain.get("uB", "pA")
    assert other is not None
    assert other.connector_signals == []          # never another user's activity


def test_project_brain_context_still_carries_gmail_alongside_calendar(bb, live_brain):
    _ingest(bb, _event())
    bb.gm_ingest.ingest_one(bb.gm_conn, bb.gm_norm.normalize_message({
        "id": "m1", "threadId": "t1", "snippet": "hi", "internalDate": "1700000000000",
        "labelIds": ["INBOX"],
        "payload": {"headers": [{"name": "Subject", "value": "Invoice"}]},
    }, connection_email="me@x.com"))

    sources = {s["source"] for s in live_brain.get("uA", "pA").connector_signals}
    assert {"calendar", "gmail"} <= sources


# ── 4/5. no cross-project, no cross-user leakage ─────────────────────────────

def test_project_B_cannot_see_project_A_calendar_observations(bb):
    _ingest(bb, _event("a", summary="A-only meeting"))
    conn_b = _cal_conn(bb.cal_conn_cls, project_id="pB", owner="uB")
    _ingest(bb, _event("b", summary="B-only meeting"), conn=conn_b)

    a = bb.supervisor.assess_business_brain(None, project_id="pA", user_id="uA", learnings=[])
    b = bb.supervisor.assess_business_brain(None, project_id="pB", user_id="uB", learnings=[])
    a_titles = {o["payload"].get("title") for o in a["observations"]}
    b_titles = {o["payload"].get("title") for o in b["observations"]}
    assert "A-only meeting" in a_titles and "B-only meeting" not in a_titles
    assert "B-only meeting" in b_titles and "A-only meeting" not in b_titles


def test_user_B_cannot_read_user_A_calendar_observations(bb):
    _ingest(bb, _event("a", summary="A-only meeting"))
    # Same project id, different owner ⇒ the owner-scoped read returns nothing.
    assert bb.obs.recent_observations("pA", user_id="uB",
                                      sources=list(bb.obs.CONNECTOR_SOURCES)) == []
    assert bb.obs.recent_observations("pA", user_id="uA",
                                      sources=list(bb.obs.CONNECTOR_SOURCES))


def test_event_content_cannot_rescope_an_observation(bb):
    """The (user, project) scope comes from the CONNECTION, never from event
    content — an organizer/attendee address can never redirect an observation."""
    hostile = _event("h", summary="hostile")
    hostile["organizer"] = {"email": "uB@evil.com"}
    hostile["attendees"] = [{"email": "uB@evil.com"}]
    _ingest(bb, hostile)
    [row] = [o for o in bb.obs.list_observations("pA") if o["external_id"].endswith(":2026-03-01T09:00:00Z")]
    assert row["user_id"] == "uA" and row["project_id"] == "pA"


# ── 6/7. idempotency + truthful source time ──────────────────────────────────

def test_duplicate_sync_does_not_duplicate_the_signal(bb):
    assert _ingest(bb, _event()) == "recorded"
    assert _ingest(bb, _event()) == "deduplicated"
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    matching = [o for o in assessment["observations"] if o["source"] == "calendar"]
    assert len(matching) == 1


def test_source_timestamp_preserved(bb):
    _ingest(bb, _event(updated="2025-06-15T09:08:07Z"))
    [o] = bb.obs.recent_observations("pA", limit=10)
    assert o["observed_at"] == "2025-06-15T09:08:07Z"
    assert o["ingested_at"] != o["observed_at"]


# ── 8/9. inputs only, then prioritized by the EXISTING authority ─────────────

def test_ingestion_alone_creates_no_task_or_candidate(bb):
    # A cancelled FUTURE meeting is the highest-importance signal this connector
    # emits — ingesting it must still create nothing executable.
    normalized = bb.cal_norm.normalize_event(
        _event(status="cancelled"), calendar_id="primary", now=NOW)
    assert normalized["importance"] == "high"
    bb.cal_ingest.ingest_one(bb.cal_conn, normalized)
    assert bb.cas.list_candidate_actions("pA") == []
    assert bb.tasks.list_tasks_for_project("pA") == []


def test_business_brain_prioritizes_a_high_importance_calendar_observation(bb):
    normalized = bb.cal_norm.normalize_event(
        _event(status="cancelled"), calendar_id="primary", now=NOW)
    bb.cal_ingest.ingest_one(bb.cal_conn, normalized)

    # Explicit OBSERVATION → CANDIDATE promotion (the existing Business Brain
    # step), not a new connector-specific engine.
    created = bb.synth.synthesize_candidates("pA", "uA")
    assert created, "a high-importance calendar observation should yield a candidate"
    assert any(c.get("source") == "OBSERVATION" for c in bb.cas.list_candidate_actions("pA"))

    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    assert assessment["recommended_next_action"] == "act_on_candidate_action"
    # …and it did NOT auto-create a task/run — prioritization is a recommendation.
    assert bb.tasks.list_tasks_for_project("pA") == []


# ── 10. malformed input never poisons the store ──────────────────────────────

def test_malformed_normalized_item_is_rejected_not_stored(bb):
    assert bb.cal_ingest.ingest_one(bb.cal_conn, {}) == "rejected"
    assert bb.cal_ingest.ingest_one(bb.cal_conn, None) == "rejected"
    assert bb.obs.list_observations("pA") == []


def test_ingest_many_tallies_independently(bb):
    items = [
        bb.cal_norm.normalize_event(_event("a"), calendar_id="primary", now=NOW),
        {},  # malformed
        bb.cal_norm.normalize_event(_event("a"), calendar_id="primary", now=NOW),  # dup
    ]
    res = bb.cal_ingest.ingest_many(bb.cal_conn, items)
    assert (res.recorded, res.deduplicated, res.rejected) == (1, 1, 1)
    assert res.total == 3
