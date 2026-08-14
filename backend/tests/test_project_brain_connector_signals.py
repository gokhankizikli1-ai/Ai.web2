# coding: utf-8
"""Project Brain aggregate ⇄ connector observations (Phase 3 production wiring).

The Phase 8 ProjectBrain is the WIRED brain surface: it backs
`GET /v2/projects/{id}/brain` and feeds the chat-context builder. Before this
sprint it aggregated memories/assets/workflows but IGNORED connector
observations, so Gmail/GitHub activity never reached a live brain. These tests
prove it now surfaces recent connector observations through the existing
observation authority — owner-scoped, read-only, and never leaking across users
or projects (the `/brain` route keys on the caller's user id, so owner-scoping
is a security property, not a nicety)."""
from __future__ import annotations

import pytest


@pytest.fixture()
def brain(tmp_path, monkeypatch):
    db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", db)
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    from backend.services.orchestrator import observations_store as obs
    monkeypatch.setattr(obs, "DB_PATH", db, raising=False)
    obs.init_observations_table()
    # `client` is the singleton ProjectBrainClient instance the route uses
    # (v2_brain.py: `from backend.services.project_brain import client`).
    from backend.services.project_brain import client as brain_client
    return brain_client, obs


def _record(obs, *, user, project, source, kind, summary, ext, importance="normal",
            observed_at="2024-04-01T00:00:00Z"):
    return obs.record_observation(
        user_id=user, project_id=project, source=source, kind=kind, summary=summary,
        external_id=ext, importance=importance, observed_at=observed_at)


def test_connector_signals_surface_for_owner(brain):
    brain_client, obs = brain
    _record(obs, user="uA", project="pA", source="github",
            kind="github.issue.opened", summary="Login is broken", ext="gh-1",
            importance="high")
    _record(obs, user="uA", project="pA", source="gmail",
            kind="gmail.message.received", summary="Invoice overdue", ext="gm-1")

    b = brain_client.get("uA", "pA")
    assert b is not None
    sources = {s["source"] for s in b.connector_signals}
    assert sources == {"github", "gmail"}
    # Provider metadata sufficient for reasoning is preserved.
    gh = next(s for s in b.connector_signals if s["source"] == "github")
    assert gh["kind"] == "github.issue.opened"
    assert gh["summary"] == "Login is broken"
    assert gh["external_id"] == "gh-1"
    assert gh["observed_at"] == "2024-04-01T00:00:00Z"
    assert b.counts["connector_signals"] == 2


def test_connector_signals_injected_into_context_block(brain):
    brain_client, obs = brain
    _record(obs, user="uA", project="pA", source="github",
            kind="github.check.failed", summary="CI failed on main", ext="gh-9",
            importance="high")
    block = brain_client.build_context("uA", "pA")
    assert block is not None
    assert "Recent connector activity" in block.text
    assert "CI failed on main" in block.text
    assert block.metadata.get("connector_signals") == 1


def test_no_cross_user_leak(brain):
    # The /brain route passes the CALLER's user id; a different user requesting
    # the same project must never see the owner's connector activity.
    brain_client, obs = brain
    _record(obs, user="uA", project="pA", source="github",
            kind="github.issue.opened", summary="A private signal", ext="gh-1")

    other = brain_client.get("uB", "pA")
    # Non-owner gets a brain shell with NO connector signals from user A.
    assert other is not None
    assert other.connector_signals == []


def test_non_connector_observation_not_surfaced(brain):
    # The observation store is connector-neutral — other subsystems may record
    # observations under non-connector sources. Those must NOT be mislabeled as
    # connector activity; only sources in CONNECTOR_SOURCES qualify.
    brain_client, obs = brain
    _record(obs, user="uA", project="pA", source="github",
            kind="github.issue.opened", summary="real connector signal", ext="gh-1")
    _record(obs, user="uA", project="pA", source="analytics",   # NOT a connector
            kind="metric.spike", summary="internal metric blip", ext="an-1")
    _record(obs, user="uA", project="pA", source="internal",    # NOT a connector
            kind="system.note", summary="internal note", ext="in-1")

    b = brain_client.get("uA", "pA")
    summaries = {s["summary"] for s in b.connector_signals}
    assert summaries == {"real connector signal"}
    assert all(s["source"] in ("github", "gmail") for s in b.connector_signals)
    assert b.counts["connector_signals"] == 1


def test_no_cross_project_leak(brain):
    brain_client, obs = brain
    _record(obs, user="uA", project="pA", source="github",
            kind="github.issue.opened", summary="A-only", ext="gh-a")
    _record(obs, user="uA", project="pB", source="github",
            kind="github.issue.opened", summary="B-only", ext="gh-b")

    a = brain_client.get("uA", "pA")
    summaries = {s["summary"] for s in a.connector_signals}
    assert summaries == {"A-only"}


def test_signals_are_bounded(brain):
    brain_client, obs = brain
    for i in range(20):
        _record(obs, user="uA", project="pA", source="github",
                kind="github.commit.pushed", summary=f"commit {i}", ext=f"c-{i}")
    b = brain_client.get("uA", "pA")
    # Bounded slice — never the whole history dumped into the brain/context.
    assert len(b.connector_signals) <= 6
