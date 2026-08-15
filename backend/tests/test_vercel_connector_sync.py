# coding: utf-8
"""Vercel connector — bounded sync → canonical observations.

Proves the hardened-connector sync contract:
  * the FIRST sync pulls a fuller (still capped) window so one click yields a
    sane dataset; later syncs read the light incremental window;
  * a re-sync is IDEMPOTENT — deterministic external ids dedup, nothing
    amplifies;
  * a partial provider failure is reported TRUTHFULLY and does NOT advance
    `last_sync_at` (so the retry still gets its initial backfill);
  * historical deployments keep their historical `observed_at`;
  * syncing creates observations ONLY — no task/run/decision — and makes ZERO
    model/provider-AI calls.

A fake client is injected, so there is no network anywhere in this module.
"""
from __future__ import annotations

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.orchestrator import observations_store as obs
from backend.services.vercel import store as vc_store
from backend.services.vercel import sync as vc_sync
from backend.services.vercel.errors import VercelNotFoundError, VercelServerError

READY_MS = 1700000000000


@pytest.fixture()
def env(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("VERCEL_SYNC_MAX_PAGES", "1")
    monkeypatch.setenv("VERCEL_SYNC_INITIAL_MAX_PAGES", "3")
    for mod in (vc_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", path, raising=False)
    vc_store._reset_for_tests(); vc_store.init_vercel_tables()
    obs.init_observations_table()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _conn(project_id="p1", owner="uA"):
    vc_store.upsert_authorization(project_id=project_id, owner_user_id=owner,
                                  access_token="vtok", team_id="team_9")
    vc_store.bind_project(project_id=project_id, vercel_project_id="prj_1",
                          name="korvix-site")
    return vc_store.get_connection(project_id)


def _deployment(uid="dpl_1", state="READY", target="production", ready=READY_MS):
    return {"uid": uid, "name": "korvix-site", "url": f"{uid}.vercel.app",
            "state": state, "target": target, "created": ready - 1000,
            "buildingAt": ready - 1000, "ready": ready,
            "meta": {"githubCommitSha": "abc123", "githubCommitRef": "main"}}


class FakeClient:
    """Records what the sync asked for and serves canned payloads."""

    def __init__(self, *, deployments=None, project=None,
                 project_error=None, deployments_error=None):
        self._deployments = deployments if deployments is not None else [_deployment()]
        self._project = project if project is not None else {
            "id": "prj_1", "name": "korvix-site", "framework": "nextjs",
            "updatedAt": READY_MS,
            "targets": {"production": {"alias": ["korvixai.com"]}}}
        self._project_error = project_error
        self._deployments_error = deployments_error
        self.calls = []

    def get_project(self, vercel_project_id):
        self.calls.append(("get_project", vercel_project_id))
        if self._project_error:
            raise self._project_error
        return self._project

    def list_deployments(self, vercel_project_id, *, max_pages=None):
        self.calls.append(("list_deployments", vercel_project_id, max_pages))
        if self._deployments_error:
            raise self._deployments_error
        return self._deployments


# ── bounded first vs incremental read ───────────────────────────────────────

def test_first_sync_uses_the_fuller_initial_page_cap(env):
    conn = _conn()
    client = FakeClient()
    vc_sync.sync_connection(conn, client=client)
    pages = [c[2] for c in client.calls if c[0] == "list_deployments"][0]
    assert pages == 3   # VERCEL_SYNC_INITIAL_MAX_PAGES


def test_incremental_sync_uses_the_light_cap(env):
    conn = _conn()
    vc_sync.sync_connection(conn, client=FakeClient())
    later = vc_store.get_connection("p1")
    assert later.last_sync_at   # first sync completed cleanly
    client = FakeClient()
    vc_sync.sync_connection(later, client=client)
    pages = [c[2] for c in client.calls if c[0] == "list_deployments"][0]
    assert pages == 1   # VERCEL_SYNC_MAX_PAGES


def test_initial_flag_can_be_forced(env):
    client = FakeClient()
    vc_sync.sync_connection(_conn(), client=client, initial=False)
    assert [c[2] for c in client.calls if c[0] == "list_deployments"][0] == 1


# ── observations land in the canonical store ────────────────────────────────

def test_sync_records_deployment_and_project_observations(env):
    report = vc_sync.sync_connection(_conn(), client=FakeClient())
    assert report.ok is True
    assert report.recorded == 2          # 1 project + 1 deployment
    assert report.deployments == 1
    kinds = {o["kind"] for o in obs.list_observations("p1", user_id="uA")}
    assert kinds == {"vercel.deployment.ready", "vercel.project.updated"}
    rows = obs.list_observations("p1", source="vercel")
    assert all(r["source"] == "vercel" for r in rows)
    assert all(r["user_id"] == "uA" and r["project_id"] == "p1" for r in rows)


def test_resync_is_idempotent(env):
    conn = _conn()
    first = vc_sync.sync_connection(conn, client=FakeClient())
    second = vc_sync.sync_connection(vc_store.get_connection("p1"), client=FakeClient())
    assert first.recorded == 2
    assert second.recorded == 0 and second.deduplicated == 2
    assert len(obs.list_observations("p1")) == 2


def test_a_new_terminal_state_records_a_second_observation(env):
    conn = _conn()
    vc_sync.sync_connection(conn, client=FakeClient(
        deployments=[_deployment(state="ERROR")]))
    vc_sync.sync_connection(vc_store.get_connection("p1"), client=FakeClient(
        deployments=[_deployment(state="READY")]))
    kinds = sorted(o["kind"] for o in obs.list_observations("p1")
                   if o["kind"].startswith("vercel.deployment"))
    assert kinds == ["vercel.deployment.error", "vercel.deployment.ready"]


def test_historical_backfill_keeps_its_historical_timestamp(env):
    old_ms = 1600000000000   # 2020-09-13
    vc_sync.sync_connection(_conn(), client=FakeClient(
        deployments=[_deployment(uid="old", ready=old_ms)]))
    row = next(o for o in obs.list_observations("p1")
               if o["kind"] == "vercel.deployment.ready")
    assert row["observed_at"].startswith("2020-09-13")
    # ...and the ingest time is recorded separately, so nothing is back-dated.
    assert row["ingested_at"] > row["observed_at"]


def test_in_flight_deployments_are_not_recorded(env):
    report = vc_sync.sync_connection(_conn(), client=FakeClient(
        deployments=[_deployment(state="BUILDING"), _deployment(uid="d2", state="QUEUED")]))
    assert report.deployments == 0
    assert not [o for o in obs.list_observations("p1")
                if o["kind"].startswith("vercel.deployment")]


# ── truthful partial failure ─────────────────────────────────────────────────

def test_deployment_failure_is_reported_and_blocks_last_sync(env):
    report = vc_sync.sync_connection(_conn(), client=FakeClient(
        deployments_error=VercelServerError("boom", status=500)))
    assert report.ok is False
    assert "deployments" in report.errors
    assert "VercelServerError (HTTP 500)" == report.errors["deployments"]
    # last_sync_at stays empty → the retry is still an INITIAL import.
    assert vc_store.get_connection("p1").last_sync_at == ""


def test_project_failure_does_not_abort_the_deployment_read(env):
    report = vc_sync.sync_connection(_conn(), client=FakeClient(
        project_error=VercelNotFoundError("gone", status=404)))
    assert report.ok is False and "project" in report.errors
    # The independent signal still landed.
    assert report.deployments == 1
    assert any(o["kind"] == "vercel.deployment.ready" for o in obs.list_observations("p1"))


def test_partial_failure_is_never_smoothed_into_success(env):
    report = vc_sync.sync_connection(_conn(), client=FakeClient(
        deployments=[], deployments_error=VercelServerError("x")))
    assert report.ok is False
    assert report.as_dict()["ok"] is False


def test_retry_after_partial_failure_backfills_and_dedups(env):
    conn = _conn()
    vc_sync.sync_connection(conn, client=FakeClient(
        project_error=VercelServerError("transient")))
    retry_client = FakeClient()
    report = vc_sync.sync_connection(vc_store.get_connection("p1"), client=retry_client)
    # Still treated as INITIAL (last_sync_at was never advanced)…
    assert [c[2] for c in retry_client.calls if c[0] == "list_deployments"][0] == 3
    # …and the already-ingested deployment dedups rather than duplicating.
    assert report.ok is True and report.deduplicated == 1 and report.recorded == 1
    assert vc_store.get_connection("p1").last_sync_at


def test_sync_project_requires_a_connection(env):
    assert vc_sync.sync_project("nope").ok is False


def test_sync_project_refuses_a_revoked_connection(env):
    _conn()
    vc_store.mark_revoked("p1")
    report = vc_sync.sync_project("p1")
    assert report.ok is False and "connection" in report.errors


def test_sync_refuses_a_connection_without_a_selected_project(env):
    vc_store.upsert_authorization(project_id="p9", owner_user_id="uA", access_token="t")
    report = vc_sync.sync_connection(vc_store.get_connection("p9"), client=FakeClient())
    assert report.ok is False and "connection" in report.errors


# ── connection metadata refresh ─────────────────────────────────────────────

def test_sync_refreshes_cached_project_metadata(env):
    vc_sync.sync_connection(_conn(), client=FakeClient())
    conn = vc_store.get_connection("p1")
    assert conn.framework == "nextjs"
    assert conn.production_url == "https://korvixai.com"


# ── observation ≠ execution, and zero model calls ───────────────────────────

def test_sync_creates_no_task_run_or_decision_and_calls_no_model(env, monkeypatch):
    from backend.services.orchestrator import tasks_store
    monkeypatch.setattr(tasks_store, "DB_PATH", env, raising=False)
    tasks_store.init_tasks_table()

    import backend.services.ai as ai_pkg
    called = {"n": 0}

    def _boom(*a, **k):  # any model call fails the test loudly
        called["n"] += 1
        raise AssertionError("connector sync must never call a model")

    for name in dir(ai_pkg):
        if name.startswith("_"):
            continue
        attr = getattr(ai_pkg, name, None)
        if callable(attr) and "complet" in name.lower():
            monkeypatch.setattr(ai_pkg, name, _boom, raising=False)

    vc_sync.sync_connection(_conn(), client=FakeClient())

    assert called["n"] == 0
    assert tasks_store.list_tasks_for_project("p1") == []
    assert len(obs.list_observations("p1")) == 2
