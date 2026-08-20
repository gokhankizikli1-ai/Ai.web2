# coding: utf-8
"""SMART PROJECT REFRESH — the exact semantics of "opening a project refreshes
what has gone stale", attacked rather than assumed.

The claim under test is narrow and expensive to get wrong:

    opening a Project Workspace may start a bounded background refresh of the
    connectors it is BOUND to whose last SUCCESSFUL sync is past their TTL —
    and must do nothing at all otherwise.

So the properties measured here are the ones that cost real money or real
trust when they break:

  ZERO-CALL          a fresh connector is never touched, no matter how often
                     the page is opened;
  ONE-CALL           a stale connector is refreshed exactly once, through the
                     SAME `connectors.sync.sync_binding` the explicit Sync
                     button uses — never a second sync path;
  DEDUP              two tabs, a double-mount and a rapid away-and-back
                     collapse to ONE provider call, because the lease is taken
                     synchronously in the route;
  BACK-OFF           a connector that FAILS does not get retried on the next
                     open — the failure mode `last_sync_at` alone cannot
                     prevent, and the whole reason the coordinator exists;
  FAIL-SOFT          a provider that is down, disconnected mid-flight, or
                     rate-limited still leaves the page loading normally;
  NO EXECUTION       none of it writes a candidate action, task or run, and
                     none of it spends a model token.

Every provider call in this file is a monkeypatched fake. Nothing here talks to
GitHub, Vercel, Gmail, Calendar or Slack, and nothing here calls a model.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


NOW = datetime(2026, 8, 20, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    """One owner (uA) with a project pA, plus a project pB owned by someone
    else. Every connector is switched ON so the tests exercise the real gates
    rather than the disabled short-circuit."""
    projects_db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    for flag in ("ENABLE_GITHUB_CONNECTOR", "ENABLE_VERCEL_CONNECTOR",
                 "ENABLE_GMAIL_CONNECTOR", "ENABLE_CALENDAR_CONNECTOR",
                 "ENABLE_SLACK_CONNECTOR"):
        monkeypatch.setenv(flag, "true")
    monkeypatch.delenv("ENABLE_WORKSPACE_AUTO_REFRESH", raising=False)

    from backend.services.projects import store as projects_store
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import (
        candidate_actions_store as cas, decisions_store,
        deliverables_store as dls, goals_store, observations_store as obs,
        runs_store,
    )
    from backend.services.orchestrator import tasks_store as orch_tasks
    from backend.services.connectors import store as shared
    from backend.services.connectors import refresh as refresh_mod

    # Every store that captured its path at import gets repointed. `shared` and
    # `refresh` resolve theirs per call from PROJECTS_DB_PATH, so the env var
    # above is enough for them.
    for mod in (projects_store, tasks_store, views_store, obs, cas, dls,
                goals_store, decisions_store, runs_store, orch_tasks):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)

    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    obs.init_observations_table()
    dls.init_deliverables_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    shared._reset_for_tests()
    shared.init_tables()
    refresh_mod._reset_for_tests()
    refresh_mod.init_refresh_table()

    projects_store.create_project("uA", name="Fitness App", description="d",
                                  project_id="pA")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    _as(app, USER_A)
    yield {"shared": shared, "refresh": refresh_mod, "obs": obs,
           "projects": projects_store, "db": projects_db}
    app.dependency_overrides.clear()


def _as(app, user):
    """The workspace read authenticates through `current_user`; the connector
    routes through `require_auth`. Both are overridden so a test can move
    between the two surfaces as one identity."""
    app.dependency_overrides[deps.current_user] = lambda: user
    app.dependency_overrides[deps.require_auth] = lambda: user


def _bind(env, provider: str, *, project_id: str = "pA", owner: str = "uA",
          last_sync: str = "", status: str = "") -> None:
    """Give (project, provider) a LIVE binding with a chosen last-sync stamp.

    Goes through the shared connector store — the same authority a real
    authorize+bind produces — so the tests attack the real freshness data, not
    a stand-in."""
    shared = env["shared"]
    auth = shared.upsert_authorization(
        owner_user_id=owner, provider=provider,
        account_key=f"acct-{provider}-{owner}", account_label="acct",
        credentials={}, metadata={},
    )
    shared.set_binding(
        project_id=project_id, authorization_id=auth.id, owner_user_id=owner,
        resources=[{"resource_id": f"r-{provider}",
                    "resource_label": f"{provider}-resource", "resource": {}}],
        status=status or shared.BIND_CONNECTED,
    )
    if last_sync:
        from backend.services.orchestrator import _sqlite
        with _sqlite.connection(env["db"]) as c:
            c.execute(
                "UPDATE connector_project_bindings SET last_sync_at=? "
                "WHERE project_id=? AND provider=?",
                (last_sync, project_id, provider))


@pytest.fixture()
def calls(monkeypatch):
    """Record every provider read the code under test performs, and let a test
    decide how each one behaves. Patching `sync_binding` is deliberate: it is
    THE seam both the explicit Sync route and the refresh coordinator go
    through, so anything that reached a provider some other way would be
    invisible here — and that invisibility is itself the bug we would want to
    catch. `raw` counts calls that reached the real implementation."""
    from backend.services.connectors import sync as connector_sync
    seen = []
    behaviour = {"mode": "ok"}

    real = connector_sync.sync_binding

    def _fake(user_id, project_id, provider):
        seen.append((str(user_id), str(project_id), str(provider)))
        if behaviour["mode"] == "raise":
            raise RuntimeError("provider exploded")
        if behaviour["mode"] == "real":
            return real(user_id, project_id, provider)
        if behaviour["mode"] == "fail":
            return connector_sync.SyncOutcome(
                project_id, provider, connector_sync.OUTCOME_FAILED,
                detail="Timeout")
        return connector_sync.SyncOutcome(
            project_id, provider, connector_sync.OUTCOME_SYNCED, ok=True,
            report_ok=True, report={"ok": True})

    monkeypatch.setattr(connector_sync, "sync_binding", _fake)
    # `refresh` imported the module, not the symbol, so patching the module
    # attribute is enough for the coordinator to see the fake too.
    return {"seen": seen, "behaviour": behaviour}


# ══════════════════════════════════════════════════════════════════════════
# Freshness — the zero-call case is the important one
# ══════════════════════════════════════════════════════════════════════════

def test_a_fresh_connector_is_never_refreshed(env, calls, client, app):
    """The single most expensive property: a project whose connectors synced a
    minute ago must cost ZERO provider calls, however often it is opened."""
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(seconds=30)))

    for _ in range(5):
        res = client.get("/v2/projects/pA/workspace")
        assert res.status_code == 200
        refresh = res.json()["data"]["refresh"]
        assert refresh["stale"] == []
        assert refresh["started"] == []
        assert refresh["recheck_in_ms"] == 0
    assert calls["seen"] == [], "a fresh connector must never be called"


def test_a_project_with_no_connectors_plans_nothing(env, calls, client):
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    assert res.json()["data"]["refresh"] == {
        "started": [], "in_flight": [], "stale": [], "recheck_in_ms": 0}
    assert calls["seen"] == []


def test_a_never_synced_connector_is_stale(env, calls, client):
    """No `last_sync_at` at all is the strongest possible staleness — a binding
    that has never been read is exactly what the user wants filled in."""
    _bind(env, "vercel", last_sync="")
    res = client.get("/v2/projects/pA/workspace")
    assert res.json()["data"]["refresh"]["started"] == ["vercel"]
    assert calls["seen"] == [("uA", "pA", "vercel")]


def test_a_stale_connector_is_refreshed_exactly_once(env, calls, client):
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(hours=6)))
    res = client.get("/v2/projects/pA/workspace")
    body = res.json()["data"]["refresh"]
    assert body["stale"] == ["github"]
    assert body["started"] == ["github"]
    assert body["recheck_in_ms"] > 0
    assert calls["seen"] == [("uA", "pA", "github")]


def test_github_stale_and_vercel_fresh_touches_only_github(env, calls, client):
    now = datetime.now(timezone.utc)
    _bind(env, "github", last_sync=_iso(now - timedelta(days=2)))
    _bind(env, "vercel", last_sync=_iso(now - timedelta(seconds=10)))
    res = client.get("/v2/projects/pA/workspace")
    assert res.json()["data"]["refresh"]["started"] == ["github"]
    assert [c[2] for c in calls["seen"]] == ["github"]


def test_the_fan_out_per_page_open_is_bounded(env, calls, client):
    """Five stale connectors must not become five provider calls on one open.
    GitHub and Vercel lead — they are the declared freshness priority."""
    old = _iso(datetime.now(timezone.utc) - timedelta(days=3))
    for provider in ("gmail", "calendar", "github", "vercel", "slack"):
        _bind(env, provider, last_sync=old)

    from backend.services.connectors import refresh as refresh_mod
    res = client.get("/v2/projects/pA/workspace")
    body = res.json()["data"]["refresh"]
    assert len(body["stale"]) == 5
    assert body["started"] == ["github", "vercel"]
    assert len(calls["seen"]) == refresh_mod.MAX_PER_OPEN


# ══════════════════════════════════════════════════════════════════════════
# Dedup — two tabs, double mounts, rapid navigation
# ══════════════════════════════════════════════════════════════════════════

def test_two_simultaneous_opens_produce_one_provider_call(env, calls, client, app,
                                                          monkeypatch):
    """The lease is taken SYNCHRONOUSLY in the route, so a second tab arriving
    WHILE the first refresh is still running cannot start its own.

    The background run is stubbed out here so the lease stays held for the
    second request — that is what "still running" means, and it is the state a
    single-threaded TestClient would otherwise never let us observe."""
    from backend.services.connectors import refresh as refresh_mod
    monkeypatch.setattr(refresh_mod, "run_claimed", lambda *a, **k: [])
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))

    first = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    second = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]

    assert first["started"] == ["github"]
    assert second["started"] == [], "the second tab must not start its own"
    assert second["in_flight"] == ["github"]
    # The second tab is told something IS coming, so it still re-reads once.
    assert second["recheck_in_ms"] > 0


def test_a_finished_refresh_is_not_immediately_repeated(env, calls, client):
    """Once the background run has completed, the next open must NOT start
    another one — the cooldown, not the lease, is what stops it, and the page is
    told there is nothing left to wait for."""
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))
    first = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    second = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert first["started"] == ["github"]
    assert second["started"] == [] and second["in_flight"] == []
    assert second["recheck_in_ms"] == 0
    assert len(calls["seen"]) == 1, calls["seen"]


def test_only_one_of_two_racing_claims_wins(env):
    """The coordinator's own guarantee, without HTTP in the way."""
    from backend.services.connectors import refresh as refresh_mod
    now = datetime.now(timezone.utc)
    won = [refresh_mod.claim("pA", "github", "uA", now=now) for _ in range(5)]
    assert bool(won[0]) is True
    assert won[1:] == ["", "", "", ""]


def test_a_slow_holder_cannot_release_a_newer_holders_lease(env):
    """The lease-STEAL race. A refresh that outlives its lease window has
    already had a later page open take a fresh lease. If the slow holder's
    release wiped that, a third open could start yet another concurrent read of
    the same provider — a sync storm produced by the very mechanism meant to
    prevent one. The release is token-scoped, so it cannot."""
    from backend.services.connectors import refresh as refresh_mod
    now = datetime.now(timezone.utc)
    stale_token = refresh_mod.claim("pA", "github", "uA", now=now)
    later = now + timedelta(seconds=refresh_mod.LEASE_SECONDS + 1)
    live_token = refresh_mod.claim("pA", "github", "uA", now=later)
    assert live_token and live_token != stale_token

    # The slow, superseded holder finally finishes and releases.
    refresh_mod.release("pA", "github", "synced", token=stale_token,
                        now=later + timedelta(seconds=1))

    # The live holder still holds its lease, so nobody else may start.
    assert refresh_mod.claim("pA", "github", "uA",
                             now=later + timedelta(seconds=2)) == ""


def test_repeated_mounts_do_not_storm_the_provider(env, calls, client):
    _bind(env, "vercel", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))
    for _ in range(10):
        client.get("/v2/projects/pA/workspace")
    assert len(calls["seen"]) == 1, calls["seen"]


def test_a_dead_lease_can_be_reclaimed(env, calls):
    """A worker that died mid-refresh must not wedge a connector forever."""
    from backend.services.connectors import refresh as refresh_mod
    now = datetime.now(timezone.utc)
    first = refresh_mod.claim("pA", "github", "uA", now=now)
    assert first, "the first caller takes the lease"
    assert refresh_mod.claim("pA", "github", "uA", now=now) == ""
    later = now + timedelta(seconds=refresh_mod.LEASE_SECONDS + 1)
    # The cooldown only applies to a FINISHED attempt; this lease never
    # finished, so the expiry is the only thing standing in the way.
    second = refresh_mod.claim("pA", "github", "uA", now=later)
    assert second and second != first, "a new holder gets a new token"


# ══════════════════════════════════════════════════════════════════════════
# Back-off — the failure mode `last_sync_at` alone cannot prevent
# ══════════════════════════════════════════════════════════════════════════

def test_a_failing_connector_backs_off_instead_of_being_hammered(env, calls, client):
    """`last_sync_at` only advances on a FULLY successful sync, so a broken
    connector stays stale forever. Without the attempt record it would be
    re-called on every single page open. It must not be."""
    calls["behaviour"]["mode"] = "fail"
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))

    for _ in range(6):
        body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
        assert body["stale"] == ["github"]      # still stale — told truthfully
    assert len(calls["seen"]) == 1, calls["seen"]


def test_a_provider_that_raises_still_releases_its_lease(env, calls, client):
    """A refresh that explodes must not leave the lease held for the whole lease
    window — the next attempt should be blocked by the COOLDOWN (a finished
    attempt), not by a phantom in-flight refresh."""
    calls["behaviour"]["mode"] = "raise"
    _bind(env, "vercel", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))
    client.get("/v2/projects/pA/workspace")

    from backend.services.connectors import refresh as refresh_mod
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env["db"]) as c:
        row = c.execute(
            "SELECT started_at, finished_at FROM connector_refresh_attempts "
            "WHERE project_id='pA' AND provider='vercel'").fetchone()
    assert str(row["started_at"]) == "", "the lease must be released"
    assert str(row["finished_at"]) != "", "the attempt must be recorded"


def test_the_page_still_loads_when_a_connector_is_broken(env, calls, client):
    calls["behaviour"]["mode"] = "raise"
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    assert res.json()["data"]["project"]["id"] == "pA"


def test_a_planning_failure_degrades_to_no_refresh(env, calls, client, monkeypatch):
    """If the coordinator itself is unavailable the page must render exactly as
    it did before this feature existed."""
    from backend.services.connectors import refresh as refresh_mod

    def _boom(*a, **k):
        raise RuntimeError("coordinator down")

    monkeypatch.setattr(refresh_mod, "plan", _boom)
    _bind(env, "github", last_sync="")
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 200
    assert res.json()["data"]["refresh"] == {
        "started": [], "in_flight": [], "stale": [], "recheck_in_ms": 0}
    assert calls["seen"] == []


# ══════════════════════════════════════════════════════════════════════════
# Bindings that must NOT be refreshed
# ══════════════════════════════════════════════════════════════════════════

def test_a_binding_awaiting_resource_selection_is_not_refreshed(env, calls, client):
    """There is nothing to read yet — no repo, no Vercel project, no channel."""
    shared = env["shared"]
    _bind(env, "slack", last_sync="", status=shared.BIND_PENDING)
    body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert body["stale"] == []
    assert calls["seen"] == []


def test_a_revoked_binding_is_not_refreshed(env, calls, client):
    shared = env["shared"]
    _bind(env, "gmail", last_sync="", status=shared.BIND_REVOKED)
    body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert body["stale"] == []
    assert calls["seen"] == []


def test_a_disabled_connector_is_not_refreshed(env, calls, client, monkeypatch):
    monkeypatch.setenv("ENABLE_GITHUB_CONNECTOR", "false")
    _bind(env, "github", last_sync="")
    body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert body["stale"] == []
    assert calls["seen"] == []


def test_a_connector_disconnected_mid_refresh_makes_no_provider_call(env, monkeypatch):
    """The binding is deleted between the claim and the background run — the
    user pressed Disconnect while a refresh was queued. The real `sync_binding`
    re-resolves the connection every time, so the provider is never reached."""
    _bind(env, "vercel", last_sync="")
    from backend.services.connectors import sync as connector_sync
    from backend.services.vercel import sync as vc_sync
    reached = []
    monkeypatch.setattr(vc_sync, "sync_connection",
                        lambda conn, **k: reached.append(conn.project_id))

    env["shared"].delete_project_binding("pA", "vercel")
    outcome = connector_sync.sync_binding("uA", "pA", "vercel")
    assert outcome.outcome == connector_sync.OUTCOME_NOT_CONNECTED
    assert reached == [], "a disconnected connector must never be fetched"


def test_the_kill_switch_returns_the_previous_behaviour(env, calls, client, monkeypatch):
    monkeypatch.setenv("ENABLE_WORKSPACE_AUTO_REFRESH", "false")
    _bind(env, "github", last_sync="")
    body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert body == {"started": [], "in_flight": [], "stale": [], "recheck_in_ms": 0}
    assert calls["seen"] == []


# ══════════════════════════════════════════════════════════════════════════
# Isolation
# ══════════════════════════════════════════════════════════════════════════

def test_a_foreign_project_leaks_nothing_and_refreshes_nothing(env, calls, client, app):
    _bind(env, "github", last_sync="")
    _as(app, USER_B)
    res = client.get("/v2/projects/pA/workspace")
    assert res.status_code == 404
    assert "pA" not in res.text
    assert calls["seen"] == [], "a project the caller does not own is never refreshed"


def test_a_nonexistent_project_is_indistinguishable_from_a_foreign_one(env, client, app):
    missing = client.get("/v2/projects/nope/workspace")
    _as(app, USER_B)
    foreign = client.get("/v2/projects/pA/workspace")
    # The ENTIRE body, not just a code: identical responses are what make the
    # two cases indistinguishable to a prober.
    assert missing.status_code == foreign.status_code == 404
    assert missing.json() == foreign.json()


def test_a_binding_recorded_against_another_owner_is_ignored(env, calls, client):
    """Defence in depth: a binding row whose owner has drifted must not make a
    project's connector look refreshable to the wrong person."""
    _bind(env, "github", project_id="pA", owner="uB", last_sync="")
    body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert body["stale"] == []
    assert calls["seen"] == []


def test_the_real_sync_seam_refuses_a_project_the_caller_does_not_own(env, calls):
    """`sync_binding` is the last line: even called directly with a foreign
    project it must not reach the provider."""
    calls["behaviour"]["mode"] = "real"
    _bind(env, "github", project_id="pB", owner="uB", last_sync="")
    from backend.services.connectors import sync as connector_sync
    outcome = connector_sync.sync_binding("uA", "pB", "github")
    assert outcome.outcome == connector_sync.OUTCOME_NOT_OWNED
    assert outcome.ok is False


# ══════════════════════════════════════════════════════════════════════════
# The refresh is not execution, and new observations do reach the page
# ══════════════════════════════════════════════════════════════════════════

def test_a_refresh_writes_no_candidate_task_or_run(env, calls, client):
    from backend.services.orchestrator import candidate_actions_store as cas
    from backend.services.orchestrator import runs_store, tasks_store
    _bind(env, "github", last_sync="")
    client.get("/v2/projects/pA/workspace")
    assert cas.list_candidate_actions("pA", limit=50) == []
    assert tasks_store.list_tasks_for_project("pA") == []
    assert runs_store.list_runs(project_id="pA") == []


def test_a_zero_new_observation_sync_is_a_normal_success(env, calls, client):
    """A provider with nothing new is not a failure: the connector becomes
    fresh, the page stops asking, and the next open costs nothing."""
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))
    client.get("/v2/projects/pA/workspace")
    assert len(calls["seen"]) == 1

    # The real sync marks the binding synced; simulate that outcome and confirm
    # the next open is free.
    env["shared"].mark_binding_synced("pA", "github")
    body = client.get("/v2/projects/pA/workspace").json()["data"]["refresh"]
    assert body["stale"] == []
    assert len(calls["seen"]) == 1


def test_an_observation_that_lands_after_the_refresh_shows_on_the_next_read(env, calls, client):
    """The stale-while-revalidate contract, end to end: the first read shows the
    old world, the refresh ingests, and the SECOND read of the same projection
    shows the new observation. No new read model, no push channel."""
    _bind(env, "github", last_sync=_iso(datetime.now(timezone.utc) - timedelta(days=1)))
    first = client.get("/v2/projects/pA/workspace").json()["data"]
    assert first["activity"] == []
    assert first["refresh"]["started"] == ["github"]

    # What a real `sync_binding` would have done: ingest through the ONE
    # canonical observation authority.
    env["obs"].record_observation(
        user_id="uA", project_id="pA", source="github",
        kind="github.commit.pushed", summary="Fix the login redirect",
        external_id="c1", observed_at=_iso(datetime.now(timezone.utc)))
    env["shared"].mark_binding_synced("pA", "github")

    second = client.get("/v2/projects/pA/workspace").json()["data"]
    assert [a["title"] for a in second["activity"]] == ["Fix the login redirect"]
    assert second["refresh"]["recheck_in_ms"] == 0, "nothing more is coming"


# ══════════════════════════════════════════════════════════════════════════
# The explicit Sync button is untouched
# ══════════════════════════════════════════════════════════════════════════

def test_the_explicit_sync_route_goes_through_the_same_seam(env, calls, client):
    """One connector sync authority, two callers. If the manual button ever
    stopped going through `sync_binding`, the refresh coordinator and the
    button would start disagreeing about what is safe to read."""
    _bind(env, "gmail", last_sync="")
    res = client.post("/v2/connectors/gmail/sync")
    assert res.status_code == 200
    assert res.json()["data"]["results"] == [{"project_id": "pA", "ok": True,
                                              "sync": {"ok": True}}]
    assert calls["seen"] == [("uA", "pA", "gmail")]


def test_the_manual_sync_is_not_blocked_by_the_refresh_cooldown(env, calls, client):
    """The cooldown protects the AUTOMATIC path. A user who presses Sync is
    asking explicitly, and must always be obeyed."""
    _bind(env, "github", last_sync="")
    client.get("/v2/projects/pA/workspace")          # auto refresh #1
    assert len(calls["seen"]) == 1
    res = client.post("/v2/connectors/github/sync")  # explicit press
    assert res.status_code == 200
    assert len(calls["seen"]) == 2
