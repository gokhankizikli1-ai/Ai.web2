# coding: utf-8
"""Project Workspace — REALISTIC end-to-end sequences.

The unit tests for `project_brain.attention` feed it hand-written observation
dicts. That proves the RULES, but not that the rules read the field names the
connectors actually write. This file closes that gap: it drives the REAL
provider normalizers with realistic provider payloads, records them through the
REAL ingestion contract (`observations_store.record_observation`, exactly as
each connector's `ingest_one` calls it), and then reads the workspace the same
way the route does.

So a rename in `vercel.normalize`'s payload — or an assumption here about a
field GitHub never sends — fails LOUDLY instead of silently emptying Needs
Attention in production.

The three sequences are the ones a real project produces every week:

    failed deploy      → successful deploy      (the alarm must clear)
    PR opened          → PR merged              (the ask must clear)
    upcoming meeting   → the meeting passes     (the reminder must expire)

Plus the two states most likely to be rendered wrongly: an empty project, and a
project whose connectors were never connected.

No network, no model calls — the normalizers are pure and the store is SQLite.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.github import normalize as gh
from backend.services.google_calendar import normalize as cal
from backend.services.orchestrator import observations_store as obs
from backend.services.project_brain import workspace as ws_mod
from backend.services.vercel import normalize as vc

NOW = datetime(2026, 6, 10, 12, 0, 0, tzinfo=timezone.utc)
OWNER = "uA"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")

    from backend.services.projects import store as projects_store
    from backend.services.orchestrator import (
        deliverables_store as dls, build_execution_store as bes,
        goals_store, decisions_store,
    )
    from backend.services.connectors import store as shared
    from backend.services.sessions import store as sessions_store

    for mod in (projects_store, obs, dls, bes, goals_store, decisions_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    obs.init_observations_table()
    dls.init_deliverables_table()
    sessions_store.init()
    shared._reset_for_tests()
    shared.init_tables()

    projects_store.create_project(OWNER, name="Aurora", description="Habit tracker.",
                                  project_id="pA")
    projects_store.create_project(OWNER, name="Nordhavn", description="", project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="", project_id="pB")
    return {"projects": projects_store, "dls": dls}


def _ingest(normalized, *, project_id="pA", owner=OWNER) -> str:
    """Record one normalized observation exactly as every connector's
    `ingest_one` does — same argument list, same defaults."""
    assert normalized is not None, "the normalizer rejected this payload"
    res = obs.record_observation(
        user_id=owner,
        project_id=project_id,
        source=normalized.get("source"),
        kind=str(normalized.get("kind")),
        summary=str(normalized.get("summary") or ""),
        payload=normalized.get("payload") if isinstance(normalized.get("payload"), dict) else {},
        external_id=(normalized.get("external_id") or None),
        observed_at=(normalized.get("observed_at") or None),
        importance=str(normalized.get("importance") or obs.IMPORTANCE_NORMAL),
    )
    assert res["ok"], f"the store rejected {normalized.get('kind')}"
    return res["id"]


def _reasons(project_id="pA", owner=OWNER, now=NOW):
    snap = ws_mod.build(owner, project_id, now=now)
    assert snap is not None
    return [a["reason"] for a in snap["attention"]]


def _attention(project_id="pA", owner=OWNER, now=NOW):
    return ws_mod.build(owner, project_id, now=now)["attention"]


# ── realistic provider fixtures ──────────────────────────────────────────────

REPO = {"id": 55123, "full_name": "aurora/app", "name": "app",
        "owner": {"login": "aurora"}}


def _vercel_deployment(*, state: str, target: str, uid: str, at: datetime) -> dict:
    """A Vercel `deployments` list item, shaped as the API returns it."""
    return {
        "uid": uid, "name": "aurora-web", "state": state, "target": target,
        "url": "aurora-web-abc123.vercel.app",
        "inspectorUrl": "https://vercel.com/aurora/aurora-web/abc123",
        "created": _ms(at - timedelta(minutes=4)),
        "buildingAt": _ms(at - timedelta(minutes=3)),
        "ready": _ms(at),
        "creator": {"username": "gokhan"},
        "meta": {"githubCommitSha": "8f2c1a" + "0" * 34,
                 "githubCommitRef": "main", "githubRepo": "app"},
    }


def _pull_request(*, number: int, merged: bool, at: datetime) -> dict:
    return {
        "number": number, "title": "Shorten onboarding to three screens",
        "state": "closed" if merged else "open", "merged": merged,
        "merged_at": _iso(at) if merged else None,
        "closed_at": _iso(at) if merged else None,
        "created_at": _iso(at - timedelta(days=1)),
        "updated_at": _iso(at),
        "user": {"login": "gokhan"},
        "base": {"ref": "main"}, "head": {"ref": "onboarding-3-screens"},
        "html_url": "https://github.com/aurora/app/pull/214",
    }


def _workflow_run(*, conclusion: str, run_id: int, at: datetime) -> dict:
    return {
        "id": run_id, "name": "build-and-test", "status": "completed",
        "conclusion": conclusion, "head_branch": "main", "event": "push",
        "updated_at": _iso(at), "run_started_at": _iso(at - timedelta(minutes=6)),
        "created_at": _iso(at - timedelta(minutes=7)),
        "html_url": "https://github.com/aurora/app/actions/runs/%d" % run_id,
    }


def _calendar_event(*, start: datetime, updated: datetime,
                    status: str = "confirmed", event_id: str = "evt-pricing") -> dict:
    return {
        "id": event_id, "status": status, "summary": "Pricing review with design",
        "start": {"dateTime": _iso(start), "timeZone": "Europe/Istanbul"},
        "end": {"dateTime": _iso(start + timedelta(hours=1)), "timeZone": "Europe/Istanbul"},
        "created": _iso(updated - timedelta(days=3)), "updated": _iso(updated),
        "htmlLink": "https://calendar.google.com/event?eid=abc",
        "organizer": {"email": "gokhan@example.com"},
        "attendees": [{"email": "design@example.com", "responseStatus": "accepted"}],
    }


# ── sequence 1: failed deploy → successful deploy ────────────────────────────

def test_failed_production_deploy_surfaces_then_a_green_one_clears_it(env):
    """The alarm that matters most, and the one that must not linger."""
    failed = vc.normalize_deployment(
        _vercel_deployment(state="ERROR", target="production", uid="dpl_red",
                           at=NOW - timedelta(hours=3)),
        vercel_project_id="prj_aurora", project_name="aurora-web")
    _ingest(failed)

    items = _attention()
    assert [i["reason"] for i in items] == ["deploy_failed"]
    assert items[0]["severity"] == "blocking"
    assert items[0]["source"] == "vercel"
    # The human text is the normalizer's own summary — not re-invented here.
    assert items[0]["title"] == failed["summary"]
    assert items[0]["context"] == "aurora-web"

    # …a redeploy lands green on the SAME target.
    green = vc.normalize_deployment(
        _vercel_deployment(state="READY", target="production", uid="dpl_green",
                           at=NOW - timedelta(minutes=20)),
        vercel_project_id="prj_aurora", project_name="aurora-web")
    _ingest(green)

    assert _reasons() == []
    # The failure is still HISTORY — it just stopped being an alarm.
    titles = [a["title"] for a in ws_mod.build(OWNER, "pA", now=NOW)["activity"]]
    assert failed["summary"] in titles


def test_a_preview_failure_never_outranks_a_production_one(env):
    _ingest(vc.normalize_deployment(
        _vercel_deployment(state="ERROR", target="preview", uid="dpl_prev",
                           at=NOW - timedelta(minutes=10)),
        vercel_project_id="prj_aurora", project_name="aurora-web"))
    _ingest(vc.normalize_deployment(
        _vercel_deployment(state="ERROR", target="production", uid="dpl_prod",
                           at=NOW - timedelta(hours=2)),
        vercel_project_id="prj_aurora", project_name="aurora-web"))

    items = _attention()
    # Production first despite being older — severity beats recency.
    assert [i["reason"] for i in items] == ["deploy_failed", "preview_deploy_failed"]
    assert [i["severity"] for i in items] == ["blocking", "waiting"]


def test_ci_failure_then_a_green_rerun_of_the_same_workflow_clears_it(env):
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=9001, at=NOW - timedelta(hours=2)), REPO))
    assert _reasons() == ["ci_failed"]

    # A re-run of the SAME workflow run id, now green.
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="success", run_id=9001, at=NOW - timedelta(minutes=30)), REPO))
    assert _reasons() == []


def test_a_different_workflow_failing_is_its_own_subject(env):
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="success", run_id=9001, at=NOW - timedelta(minutes=30)), REPO))
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=9002, at=NOW - timedelta(minutes=40)), REPO))
    assert _reasons() == ["ci_failed"]


# ── sequence 2: PR opened → merged ───────────────────────────────────────────

def test_open_pull_request_waits_then_merging_it_clears_the_ask(env):
    opened = gh.normalize_pull_request(
        _pull_request(number=214, merged=False, at=NOW - timedelta(days=1)),
        REPO, action="opened")
    _ingest(opened)

    items = _attention()
    assert [i["reason"] for i in items] == ["pr_awaiting"]
    assert items[0]["severity"] == "waiting"
    assert items[0]["context"] == "aurora/app"

    merged = gh.normalize_pull_request(
        _pull_request(number=214, merged=True, at=NOW - timedelta(hours=1)),
        REPO, action="closed")
    assert merged["kind"] == "github.pull_request.merged"
    _ingest(merged)

    assert _reasons() == []


def test_a_second_open_pull_request_is_tracked_independently(env):
    _ingest(gh.normalize_pull_request(
        _pull_request(number=214, merged=True, at=NOW - timedelta(hours=1)),
        REPO, action="closed"))
    _ingest(gh.normalize_pull_request(
        _pull_request(number=215, merged=False, at=NOW - timedelta(hours=2)),
        REPO, action="opened"))
    assert _reasons() == ["pr_awaiting"]


# ── sequence 3: upcoming meeting → the meeting passes ────────────────────────

def test_imminent_meeting_surfaces_and_then_expires_as_it_passes(env):
    """The row is written ONCE (its dedup key has no clock component), so this
    is the case where trusting the stored `importance` would keep reminding the
    user about a meeting that ended hours ago."""
    start = NOW + timedelta(hours=2)
    event = cal.normalize_event(
        _calendar_event(start=start, updated=NOW - timedelta(days=1)),
        calendar_id="primary", now=NOW)
    assert event["kind"] == "calendar.event.upcoming"
    _ingest(event)

    assert _reasons(now=NOW) == ["meeting_soon"]

    # Same stored row, read three hours later — the meeting has now happened.
    assert _reasons(now=NOW + timedelta(hours=3)) == []
    # …and re-reading is stable, not flapping.
    assert _reasons(now=NOW + timedelta(hours=3)) == []


def test_a_meeting_further_out_than_the_window_is_not_yet_attention(env):
    event = cal.normalize_event(
        _calendar_event(start=NOW + timedelta(days=5), updated=NOW - timedelta(days=1),
                        event_id="evt-later"),
        calendar_id="primary", now=NOW)
    _ingest(event)
    assert _reasons() == []
    # It becomes attention only once it is genuinely imminent.
    assert _reasons(now=NOW + timedelta(days=4, hours=12)) == ["meeting_soon"]


def test_cancelling_a_future_meeting_is_time_sensitive_and_supersedes_upcoming(env):
    start = NOW + timedelta(hours=6)
    _ingest(cal.normalize_event(
        _calendar_event(start=start, updated=NOW - timedelta(days=2)),
        calendar_id="primary", now=NOW))
    assert _reasons() == ["meeting_soon"]

    cancelled = cal.normalize_event(
        _calendar_event(start=start, updated=NOW - timedelta(minutes=5),
                        status="cancelled"),
        calendar_id="primary", now=NOW)
    assert cancelled["kind"] == "calendar.event.cancelled"
    _ingest(cancelled)

    # ONE row for the event, and it now says "cancelled" — never both.
    assert _reasons() == ["meeting_cancelled"]


# ── the full mixed picture ───────────────────────────────────────────────────

def test_a_realistic_week_ranks_the_way_a_human_would(env):
    _ingest(vc.normalize_deployment(
        _vercel_deployment(state="ERROR", target="production", uid="dpl_red",
                           at=NOW - timedelta(hours=4)),
        vercel_project_id="prj_aurora", project_name="aurora-web"))
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=9001, at=NOW - timedelta(hours=1)), REPO))
    _ingest(cal.normalize_event(
        _calendar_event(start=NOW + timedelta(hours=3), updated=NOW - timedelta(days=1)),
        calendar_id="primary", now=NOW))
    _ingest(gh.normalize_pull_request(
        _pull_request(number=214, merged=False, at=NOW - timedelta(days=1)),
        REPO, action="opened"))
    # Noise that must NOT be promoted, however loud it looks.
    for i in range(6):
        _ingest(gh.normalize_commit(
            {"sha": f"{i}" * 40, "commit": {"message": f"chore {i}",
                                            "author": {"date": _iso(NOW - timedelta(minutes=i))}}},
            REPO))
    _ingest(gh.normalize_issue(
        {"number": 77, "title": "Dark mode request", "state": "open",
         "created_at": _iso(NOW - timedelta(minutes=5)),
         "updated_at": _iso(NOW - timedelta(minutes=5)), "user": {"login": "x"}},
        REPO, action="opened"))

    snap = ws_mod.build(OWNER, "pA", now=NOW)
    assert [a["reason"] for a in snap["attention"]] == [
        "ci_failed",        # blocking, 1h
        "deploy_failed",    # blocking, 4h
        "meeting_soon",     # time-sensitive
        "pr_awaiting",      # waiting
    ]
    # Commits and issues are activity, never attention.
    assert snap["counts"]["attention"] == 4
    assert any(a["kind"] == "github.commit.pushed" for a in snap["activity"])
    assert any(a["kind"] == "github.issue.opened" for a in snap["activity"])
    # Deterministic across repeated reads of the same state.
    assert ws_mod.build(OWNER, "pA", now=NOW)["attention"] == snap["attention"]


def test_freshness_reflects_the_newest_real_observation(env):
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=9001, at=NOW - timedelta(hours=1)), REPO))
    fresh = ws_mod.build(OWNER, "pA", now=NOW)["freshness"]
    assert fresh["last_observation_at"]
    assert fresh["last_activity_at"] == fresh["last_observation_at"]
    assert fresh["last_connector_sync_at"] == ""     # never synced ⇒ say nothing


# ── truthful empty / never-connected states ──────────────────────────────────

def test_a_project_with_no_connectors_renders_truthfully(env):
    snap = ws_mod.build(OWNER, "pA2", now=NOW)
    assert snap is not None
    assert snap["attention"] == []
    assert snap["activity"] == []
    assert snap["connectors"] == []
    assert snap["products"] == []
    assert snap["chats"] == []
    assert snap["goals"] == []
    assert snap["summary"] == {"text": "", "source": ""}
    assert snap["freshness"]["last_activity_at"] == ""
    assert snap["counts"] == {"attention": 0, "activity": 0, "goals": 0,
                              "products": 0, "chats": 0, "connectors": 0}


def test_a_project_whose_connectors_are_disabled_on_the_deployment_still_renders(env,
                                                                                monkeypatch):
    """Flipping every connector off must not empty the project's OWN state."""
    for flag in ("ENABLE_GITHUB_CONNECTOR", "ENABLE_GMAIL_CONNECTOR",
                 "ENABLE_VERCEL_CONNECTOR", "ENABLE_CALENDAR_CONNECTOR",
                 "ENABLE_SLACK_CONNECTOR"):
        monkeypatch.setenv(flag, "false")
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=9001, at=NOW - timedelta(hours=1)), REPO))
    env["dls"].create_deliverable(
        run_id="run-1", agent_id="builder", node_id="build", kind="web_build",
        title="Landing", project_id="pA", status="completed",
        content={"build_type": "web", "build_status": "completed"})

    snap = ws_mod.build(OWNER, "pA", now=NOW)
    assert snap is not None
    # Already-ingested observations remain readable — the flag gates SYNC, not
    # the durable record, so the page does not silently lose history.
    assert [a["reason"] for a in snap["attention"]] == ["ci_failed"]
    assert [p["title"] for p in snap["products"]] == ["Landing"]


def test_project_brain_disabled_leaves_the_rest_of_the_workspace_intact(env, monkeypatch):
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "false")
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=9001, at=NOW - timedelta(hours=1)), REPO))
    snap = ws_mod.build(OWNER, "pA", now=NOW)
    assert [a["reason"] for a in snap["attention"]] == ["ci_failed"]
    assert snap["summary"] == {"text": "Habit tracker.", "source": "project"}


# ── isolation, re-checked against REAL ingested observations ─────────────────

def test_real_observations_never_cross_projects_or_owners(env):
    _ingest(vc.normalize_deployment(
        _vercel_deployment(state="ERROR", target="production", uid="dpl_a",
                           at=NOW - timedelta(hours=1)),
        vercel_project_id="prj_aurora", project_name="aurora-web"),
        project_id="pA")
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=7777, at=NOW - timedelta(hours=1)), REPO),
        project_id="pA2")
    # Another OWNER records against the same project id the owner uses.
    _ingest(gh.normalize_workflow_run(
        _workflow_run(conclusion="failure", run_id=8888, at=NOW - timedelta(hours=1)), REPO),
        project_id="pA", owner="uB")

    a = ws_mod.build(OWNER, "pA", now=NOW)
    a2 = ws_mod.build(OWNER, "pA2", now=NOW)
    assert [i["reason"] for i in a["attention"]] == ["deploy_failed"]
    assert [i["reason"] for i in a2["attention"]] == ["ci_failed"]
    # user B's row against pA is invisible to pA's owner…
    assert all("8888" not in str(i) for i in a["activity"])
    # …and user B cannot open pA at all.
    assert ws_mod.build("uB", "pA", now=NOW) is None
    # …nor can pA's owner open user B's project.
    assert ws_mod.build(OWNER, "pB", now=NOW) is None
