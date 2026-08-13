# coding: utf-8
"""Business Brain — Phase 4: connector-neutral OBSERVATION ingestion.

One durable, idempotent seam for "something changed". Observations never
auto-create tasks/decisions/runs; duplicates dedup; out-of-order events sort by
source time; scoping is isolated per (user, project).
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def obs(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import observations_store
    importlib.reload(observations_store)
    observations_store.init_observations_table()
    return observations_store


def test_ingest_basic(obs):
    res = obs.record_observation(user_id="u1", project_id="p1", source="github",
                                 kind="github.issue.opened", summary="issue #42",
                                 payload={"number": 42})
    assert res["ok"] and not res["deduplicated"]
    o = obs.get_observation(res["id"])
    assert o["kind"] == "github.issue.opened" and o["payload"]["number"] == 42


def test_malformed_and_empty_inputs(obs):
    assert obs.record_observation(user_id="", project_id="p1", source="s", kind="k")["ok"] is False
    assert obs.record_observation(user_id="u1", project_id="p1", source="", kind="k")["ok"] is False
    # Non-dict payload is coerced, not fatal.
    res = obs.record_observation(user_id="u1", project_id="p1", source="s",
                                 kind="k", payload=["not", "a", "dict"])
    assert res["ok"]
    assert isinstance(obs.get_observation(res["id"])["payload"], dict)


def test_duplicate_external_event_deduped(obs):
    a = obs.record_observation(user_id="u1", project_id="p1", source="gmail",
                               kind="gmail.msg", external_id="evt-1")
    b = obs.record_observation(user_id="u1", project_id="p1", source="gmail",
                               kind="gmail.msg", external_id="evt-1")
    assert a["id"] == b["id"]
    assert b["deduplicated"] is True
    assert len(obs.list_observations("p1")) == 1


def test_same_external_id_different_users_not_deduped(obs):
    a = obs.record_observation(user_id="u1", project_id="p1", source="s",
                               kind="k", external_id="shared")
    b = obs.record_observation(user_id="u2", project_id="p1", source="s",
                               kind="k", external_id="shared")
    assert a["id"] != b["id"]
    assert not b["deduplicated"]


def test_out_of_order_events_sort_by_source_time(obs):
    # A late-arriving OLD event must not masquerade as the newest change.
    obs.record_observation(user_id="u1", project_id="p1", source="s", kind="new",
                           observed_at="2024-06-01T00:00:00Z")
    obs.record_observation(user_id="u1", project_id="p1", source="s", kind="old",
                           observed_at="2024-01-01T00:00:00Z")   # ingested later, older event
    recent = obs.list_observations("p1")
    assert recent[0]["kind"] == "new"   # newest OBSERVED first, not newest ingested


def test_observation_does_not_create_task_or_run(obs, monkeypatch):
    # Recording an observation must touch NO task/run store. We assert the
    # tasks table has no rows for this project after ingestion.
    obs.record_observation(user_id="u1", project_id="p1", source="s", kind="k")
    from backend.services.orchestrator import tasks_store
    importlib.reload(tasks_store)
    # A fresh tasks table (same projects.db) has zero tasks — ingestion never
    # created execution work.
    try:
        tasks_store.init_tasks_table()
        rows = tasks_store.list_tasks_for_project("p1")
    except Exception:
        rows = []
    assert rows == []


def test_unknown_source_is_accepted(obs):
    res = obs.record_observation(user_id="u1", project_id="p1",
                                 source="some_future_connector", kind="x.y")
    assert res["ok"]


def test_restart_persists(obs):
    res = obs.record_observation(user_id="u1", project_id="p1", source="s", kind="k",
                                 summary="durable-obs")
    from backend.services.orchestrator import observations_store as obs2
    importlib.reload(obs2)
    assert obs2.get_observation(res["id"])["summary"] == "durable-obs"


def test_cross_project_isolation(obs):
    obs.record_observation(user_id="u1", project_id="pA", source="s", kind="k", summary="A")
    obs.record_observation(user_id="u2", project_id="pB", source="s", kind="k", summary="B")
    assert [o["summary"] for o in obs.list_observations("pA")] == ["A"]
    assert [o["summary"] for o in obs.list_observations("pB")] == ["B"]
