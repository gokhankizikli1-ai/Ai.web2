# coding: utf-8
"""Slack ⇄ Project Brain / Business Brain — proving the wiring, end to end.

These tests exercise the REAL chain a Slack sync uses, with NO connector-
specific reasoning loop anywhere in it:

    Slack message → slack.normalize (pure) → slack.ingest
        → observations_store.record_observation()
        → project_brain.client (connector signals, via CONNECTOR_SOURCES)
        → project_supervisor.assess_business_brain() / candidate_synthesis
          (the Business Brain OBSERVE + PRIORITIZE authorities)

The guarantees asserted mirror the ones the Gmail/GitHub/Vercel/Calendar
connectors set, plus the Slack-specific ones from this PR:

 1. "slack" is registered in the ONE canonical connector-source registry, and no
    parallel provider allowlist exists in the brain path.
 2. A Slack observation reaches Project Brain's connector signals for its own
    project, and the Business Brain assessment for that project.
 3. Ingesting an observation ALONE creates no task/run/candidate.
 4. Slack deliberately never promotes itself into a candidate action — chat must
    not queue-jump a failed production deployment.
 5. A historical backfill keeps its historical timestamp.
 6. A duplicate sync does not amplify the effective signal.
 7. User B cannot consume user A's Slack observations, and a foreign project id
    surfaces nothing.
 8. Provider-supplied identity in a message payload cannot re-scope an
    observation.
 9. Gmail/GitHub/Vercel/Calendar signals are unaffected by Slack's presence.

No network, no model calls: connections are constructed in-process and
observations are normalized from plain fixture dicts.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

NOW_TS = "1700000000.000100"     # 2023-11-14T22:13:20.000100Z
OLD_TS = "1600000000.000100"     # 2020-09-13


def _slack_conn(store_cls, chan_cls, *, project_id="pA", owner="uA"):
    return store_cls(
        project_id=project_id, owner_user_id=owner, provider="slack",
        team_id="T_WORKSPACE", team_name="Korvix HQ", bot_user_id="U0BOT",
        app_id="A1", scopes="channels:read,channels:history",
        bot_token_enc="", status="connected",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="",
        channels=(chan_cls(channel_id="C_PRODUCT", name="product",
                           is_private=False),),
    )


def _message(ts=NOW_TS, text="Checkout is failing for EU customers", **kw):
    base = {"type": "message", "ts": ts, "user": "U_HUMAN", "text": text}
    base.update(kw)
    return base


@pytest.fixture()
def bb(tmp_path, monkeypatch):
    """A shared projects.db with every Business Brain store scoped to it, plus
    the Slack (and GitHub/Vercel) ingest/normalize modules bound to the same
    observation store."""
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")

    from backend.services.orchestrator import (
        observations_store, candidate_actions_store, goals_store,
        decisions_store, metrics_store, project_supervisor, candidate_synthesis,
        tasks_store,
    )
    from backend.services.github import ingest as gh_ingest, normalize as gh_norm
    from backend.services.github.store import GitHubConnection
    from backend.services.project_brain import client as brain_client
    from backend.services.slack import ingest as sl_ingest, normalize as sl_norm
    from backend.services.slack.store import SelectedChannel, SlackConnection
    from backend.services.vercel import ingest as vc_ingest, normalize as vc_norm
    from backend.services.vercel.store import VercelConnection

    for mod in (observations_store, candidate_actions_store, goals_store,
                decisions_store, metrics_store, tasks_store):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    observations_store.init_observations_table()
    candidate_actions_store.init_candidate_actions_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    metrics_store.init_metrics_table()

    gh_conn = GitHubConnection(
        project_id="pA", owner_user_id="uA", installation_id="100",
        repo_full_name="gokhankizikli1-ai/ai.web2", repo_id="42",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="")
    vc_conn = VercelConnection(
        project_id="pA", owner_user_id="uA", provider="vercel",
        account_label="Acme", team_id="team_9", installation_id="icfg_1",
        vercel_user_id="vu_1", access_token_enc="", vercel_project_id="prj_1",
        vercel_project_name="korvix-site", framework="nextjs",
        production_url="https://korvixai.com", status="connected",
        created_at="2024-01-01T00:00:00Z", updated_at="2024-01-01T00:00:00Z",
        last_sync_at="")

    return SimpleNamespace(
        obs=observations_store, cas=candidate_actions_store, tasks=tasks_store,
        supervisor=project_supervisor, synth=candidate_synthesis,
        brain=brain_client, sl_ingest=sl_ingest, sl_norm=sl_norm,
        conn=_slack_conn(SlackConnection, SelectedChannel),
        conn_b=_slack_conn(SlackConnection, SelectedChannel,
                           project_id="pB", owner="uB"),
        gh_ingest=gh_ingest, gh_norm=gh_norm, gh_conn=gh_conn,
        vc_ingest=vc_ingest, vc_norm=vc_norm, vc_conn=vc_conn,
    )


def _ingest(bb, message=None, *, conn=None):
    normalized = bb.sl_norm.normalize_message(
        message or _message(), team_id="T_WORKSPACE", channel_id="C_PRODUCT",
        channel_name="product")
    return bb.sl_ingest.ingest_one(conn or bb.conn, normalized)


# ── 1. the ONE canonical connector-source registry ──────────────────────────

def test_slack_is_registered_in_the_single_connector_source_registry(bb):
    from backend.services.orchestrator import observations_store as obs
    assert bb.sl_norm.SOURCE == "slack"
    assert bb.sl_norm.SOURCE in obs.CONNECTOR_SOURCES
    # ...and the pre-existing connectors are still registered (no displacement).
    assert {"github", "gmail", "vercel", "calendar", "slack"} <= set(obs.CONNECTOR_SOURCES)


def test_no_second_connector_registry_exists():
    """A parallel allowlist would silently drop Slack signals. The Project Brain
    must read the ONE registry, not a hardcoded provider list."""
    import importlib
    import inspect
    pb_module = importlib.import_module("backend.services.project_brain.client")
    src = inspect.getsource(pb_module)
    assert "CONNECTOR_SOURCES" in src
    for literal in ('"slack"', "'slack'", '"gmail"', "'gmail'", '"vercel"'):
        assert literal not in src


# ── 2. Project Brain + Business Brain see Slack activity ────────────────────

def test_a_slack_message_enters_project_brain_connector_signals(bb):
    assert _ingest(bb) == "recorded"

    brain = bb.brain.get("uA", "pA")
    assert brain is not None
    signal = next(s for s in brain.connector_signals if s["source"] == "slack")
    assert signal["kind"] == "slack.message.created"
    assert signal["summary"] == "#product: Checkout is failing for EU customers"
    assert signal["observed_at"] == "2023-11-14T22:13:20.000100Z"
    assert brain.counts["connector_signals"] == 1


def test_a_slack_observation_is_visible_to_the_business_brain(bb):
    _ingest(bb)
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    sources = {x["source"] for x in assessment["observations"]}
    assert "slack" in sources
    assert any(x["kind"] == "slack.message.created" for x in assessment["observations"])


def test_thread_activity_reaches_the_brain_with_its_bounded_evidence(bb):
    parent = _message(thread_ts=NOW_TS, reply_count=3, reply_users_count=2,
                      latest_reply="1700000900.000200",
                      text="Should we roll back the pricing change?")
    o = bb.sl_norm.normalize_thread(
        parent, [{"ts": "1700000900.000200", "user": "U2", "text": "Yes — revenue dropped"}],
        team_id="T_WORKSPACE", channel_id="C_PRODUCT", channel_name="product")
    assert bb.sl_ingest.ingest_one(bb.conn, o) == "recorded"

    [row] = [x for x in bb.obs.list_observations("pA")
             if x["kind"] == "slack.thread.activity"]
    assert row["payload"]["reply_count"] == 3
    assert row["payload"]["replies_sampled"] == 1
    assert row["payload"]["channel_name"] == "product"
    # The thread's source time is when it LAST moved.
    assert row["observed_at"] == "2023-11-14T22:28:20.000200Z"


# ── 3/4. observation ≠ execution, and Slack never queue-jumps ───────────────

def test_ingestion_alone_creates_no_task_run_or_candidate(bb):
    _ingest(bb, _message(text="EVERYTHING IS ON FIRE"))
    assert bb.cas.list_candidate_actions("pA") == []
    assert bb.tasks.list_tasks_for_project("pA") == []


def test_slack_chatter_never_promotes_itself_into_a_candidate_action(bb):
    """Only HIGH-importance observations are promoted by the EXISTING synthesis
    step, and Slack deliberately never emits "high" — so a busy channel cannot
    outrank a real failure signal."""
    for i in range(5):
        _ingest(bb, _message(ts=f"170000000{i}.000100", text=f"chat {i}"))
    bb.synth.synthesize_candidates("pA", "uA")
    assert bb.cas.list_candidate_actions("pA") == []
    assert bb.tasks.list_tasks_for_project("pA") == []


def test_a_real_failure_signal_still_outranks_slack_activity(bb):
    """Sanity check on the shared prioritizer: Slack's presence does not blunt a
    genuinely high-importance connector signal."""
    _ingest(bb, _message(text="anyone seen the deploy?"))
    bb.vc_ingest.ingest_one(bb.vc_conn, bb.vc_norm.normalize_deployment(
        {"uid": "dpl_1", "state": "ERROR", "target": "production",
         "ready": 1700000100000, "buildingAt": 1700000100000},
        vercel_project_id="prj_1"))

    created = bb.synth.synthesize_candidates("pA", "uA")
    assert created
    sources = {c.get("source") for c in bb.cas.list_candidate_actions("pA")}
    assert sources == {"OBSERVATION"}
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    assert assessment["recommended_next_action"] == "act_on_candidate_action"
    # Prioritization is a RECOMMENDATION — nothing was executed.
    assert bb.tasks.list_tasks_for_project("pA") == []


# ── 5/6. timestamp truth + idempotency ──────────────────────────────────────

def test_a_historical_backfill_stays_historical(bb):
    _ingest(bb, _message(ts=OLD_TS, text="old news"))
    [row] = bb.obs.recent_observations("pA", limit=10)
    assert row["observed_at"].startswith("2020-09-13")
    assert row["ingested_at"] != row["observed_at"]


def test_a_duplicate_sync_does_not_amplify(bb):
    assert _ingest(bb) == "recorded"
    assert _ingest(bb) == "deduplicated"
    assessment = bb.supervisor.assess_business_brain(
        None, project_id="pA", user_id="uA", learnings=[])
    matching = [x for x in assessment["observations"]
                if x["kind"] == "slack.message.created"]
    assert len(matching) == 1


# ── 7/8. cross-user / cross-project isolation ───────────────────────────────

def test_user_b_cannot_consume_user_a_slack_observations(bb):
    _ingest(bb, _message(ts="1700000001.000100", text="A only"))
    _ingest(bb, _message(ts="1700000002.000100", text="B only"), conn=bb.conn_b)

    a_ids = {s["external_id"] for s in bb.brain.get("uA", "pA").connector_signals}
    b_ids = {s["external_id"] for s in bb.brain.get("uB", "pB").connector_signals}
    assert "slack:message:T_WORKSPACE:C_PRODUCT:1700000001.000100" in a_ids
    assert "slack:message:T_WORKSPACE:C_PRODUCT:1700000002.000100" not in a_ids
    assert "slack:message:T_WORKSPACE:C_PRODUCT:1700000002.000100" in b_ids
    assert "slack:message:T_WORKSPACE:C_PRODUCT:1700000001.000100" not in b_ids


def test_a_brain_read_with_a_foreign_project_id_surfaces_nothing(bb):
    _ingest(bb)
    foreign = bb.brain.get("uB", "pA")
    assert [s for s in (foreign.connector_signals if foreign else [])] == []


def test_two_projects_on_the_same_workspace_and_channel_stay_separate(bb):
    """The SAME Slack channel may legitimately back two Korvix projects; their
    observations must never bleed across."""
    _ingest(bb, _message(ts="1700000001.000100"))
    _ingest(bb, _message(ts="1700000001.000100"), conn=bb.conn_b)
    a = bb.obs.list_observations("pA", user_id="uA")
    b = bb.obs.list_observations("pB", user_id="uB")
    assert len(a) == 1 and len(b) == 1
    assert a[0]["id"] != b[0]["id"]      # same external_id, different scopes


def test_ingest_ignores_provider_supplied_identity(bb):
    """The (user, project) scope comes from the CONNECTION, never from the
    normalized provider payload."""
    o = bb.sl_norm.normalize_message(_message(), team_id="T_WORKSPACE",
                                     channel_id="C_PRODUCT")
    o["payload"]["owner_user_id"] = "uB"     # hostile provider content
    o["payload"]["project_id"] = "pB"
    bb.sl_ingest.ingest_one(bb.conn, o)
    [row] = bb.obs.list_observations("pA")
    assert row["user_id"] == "uA" and row["project_id"] == "pA"
    assert bb.obs.list_observations("pB") == []


def test_a_malformed_observation_is_rejected_not_stored(bb):
    assert bb.sl_ingest.ingest_one(bb.conn, None) == "rejected"
    assert bb.sl_ingest.ingest_one(bb.conn, {"payload": {}}) == "rejected"
    assert bb.obs.list_observations("pA") == []


# ── 9. the other connectors are unaffected ──────────────────────────────────

def test_github_signals_are_unaffected_by_the_new_source(bb):
    bb.gh_ingest.ingest_one(bb.gh_conn, bb.gh_norm.normalize_issue(
        {"number": 7, "state": "open", "title": "Login is broken",
         "updated_at": "2024-04-01T00:00:00Z"},
        {"id": 42, "full_name": "gokhankizikli1-ai/ai.web2"}))
    _ingest(bb)

    brain = bb.brain.get("uA", "pA")
    gh = next(s for s in brain.connector_signals if s["source"] == "github")
    assert gh["kind"] == "github.issue.opened"
    assert {s["source"] for s in brain.connector_signals} == {"github", "slack"}
    assert brain.counts["connector_signals"] == 2


def test_all_five_connectors_coexist_in_one_projects_signal_slice(bb):
    _ingest(bb)
    bb.gh_ingest.ingest_one(bb.gh_conn, bb.gh_norm.normalize_issue(
        {"number": 7, "state": "open", "title": "x", "updated_at": "2024-04-01T00:00:00Z"},
        {"id": 42, "full_name": "o/r"}))
    bb.vc_ingest.ingest_one(bb.vc_conn, bb.vc_norm.normalize_deployment(
        {"uid": "dpl_1", "state": "READY", "target": "production",
         "ready": 1700000100000}, vercel_project_id="prj_1"))
    bb.obs.record_observation(user_id="uA", project_id="pA", source="gmail",
                              kind="gmail.message.received", summary="mail",
                              external_id="g1", observed_at="2023-11-14T10:00:00Z")
    bb.obs.record_observation(user_id="uA", project_id="pA", source="calendar",
                              kind="calendar.event.upcoming", summary="standup",
                              external_id="c1", observed_at="2023-11-14T11:00:00Z")

    rows = bb.obs.list_observations("pA", sources=list(bb.obs.CONNECTOR_SOURCES))
    assert {r["source"] for r in rows} == {"slack", "github", "vercel", "gmail", "calendar"}
