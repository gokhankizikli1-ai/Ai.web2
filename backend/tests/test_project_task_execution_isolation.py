# coding: utf-8
"""MERGE-SAFETY PROOF — a user-visible project task cannot reach execution.

A project task is ORGANIZATIONAL STATE: a note someone wrote to themselves.
The single most damaging way this feature could go wrong is for that note to
become an instruction — for "add a task" to quietly start a run, propose a
Business Brain candidate, request an approval, spend a model token, or touch a
connector. Nothing in the current implementation does, and these tests exist so
nothing in a FUTURE implementation can either.

Two independent proofs, because each catches what the other cannot:

  1. STATIC (`test_the_task_write_path_imports_nothing_that_can_execute`)
     The task authority's import list is asserted against an explicit inert
     allowlist, parsed from the source with `ast` — including function-level
     imports, which is how a lazy dependency would normally sneak in. A future
     `from backend.services.orchestrator import runs_store` fails here even if
     the call site is never exercised by a test.

  2. RUNTIME (`test_the_full_http_write_path_touches_no_execution_surface`)
     Every execution, provider, connector, observation, decision, memory and
     background-queue entry point is replaced with a tripwire, and the REAL
     HTTP create → update → complete → delete sequence is driven through the
     app. Any call at all fails the test by name.

Row-count assertions live in `test_project_workspace_tasks.py`; they prove the
tables stayed empty. These prove the FUNCTIONS were never reached — which also
covers the surfaces that have no table (a provider call, a queued job).

No network, no model calls.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")

#: Everything `projects/tasks_store.py` is allowed to depend on. All stdlib,
#: plus path resolution and the shared hardened SQLite helper. Deliberately
#: exhaustive: adding ANY entry to this list is a decision a reviewer must make
#: on purpose, which is the entire point.
_ALLOWED_TASK_STORE_IMPORTS = {
    "__future__", "logging", "uuid", "datetime", "typing",
    "backend.core.paths.resolve_db_path",
    "backend.services.orchestrator._sqlite",
}

#: Module prefixes that mean "this can make something happen".
_EXECUTION_PREFIXES = (
    "backend.services.orchestrator.runs_store",
    "backend.services.orchestrator.tasks_store",
    "backend.services.orchestrator.candidate_actions_store",
    "backend.services.orchestrator.candidate_synthesis",
    "backend.services.orchestrator.approvals_store",
    "backend.services.orchestrator.execution_policy",
    "backend.services.orchestrator.service",
    "backend.services.orchestrator.long_horizon_planner",
    "backend.services.orchestrator.plans_store",
    "backend.services.providers",
    "backend.services.connectors",
    "backend.services.jobs",
    "backend.services.tasks",
    "backend.services.agent",
    "backend.services.ai_client",
    "backend.services.events",
)


def _imported_modules(path: str) -> set:
    """Every dependency imported anywhere in a file — module level AND inside a
    function body. Parsed, not executed, so it sees dependencies a test run
    would never trigger.

    `from X import Y` is recorded as `X.Y` for first-party imports and as `X`
    for stdlib. The asymmetry is deliberate: at package granularity
    `from backend.services.orchestrator import _sqlite` and
    `from backend.services.orchestrator import runs_store` look identical, and
    the whole point of this guard is to tell them apart."""
    tree = ast.parse(pathlib.Path(path).read_text(encoding="utf-8"))
    found: set = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.module.startswith("backend"):
                for alias in node.names:
                    found.add(f"{node.module}.{alias.name}")
            else:
                found.add(node.module)
    return found


# ── 1. static proof ──────────────────────────────────────────────────────────

def test_the_task_write_path_imports_nothing_that_can_execute():
    """The task authority may depend on stdlib, path resolution and SQLite.
    Nothing else. An orchestrator, provider, connector or queue import here —
    at module level or hidden inside a function — is a merge blocker."""
    imported = _imported_modules("backend/services/projects/tasks_store.py")
    assert imported == _ALLOWED_TASK_STORE_IMPORTS, (
        "projects/tasks_store.py grew a dependency. Unexpected: "
        f"{sorted(imported - _ALLOWED_TASK_STORE_IMPORTS)}"
    )


def test_the_task_routes_import_nothing_that_can_execute():
    """The route module is the only other code on a task write path."""
    imported = _imported_modules("backend/routes/v2_project_workspace.py")
    offenders = [m for m in imported if m.startswith(_EXECUTION_PREFIXES)]
    assert offenders == [], f"task/knowledge routes reach execution: {offenders}"


def test_the_task_store_registers_no_hook_listener_or_event():
    """A write cannot fan out to something else if it never publishes. Belt and
    braces alongside the import guard: no emit, no publish, no enqueue, no
    dispatch anywhere in the authority."""
    source = pathlib.Path("backend/services/projects/tasks_store.py").read_text()
    for forbidden in ("emit(", "publish(", "enqueue(", "dispatch(", "notify(",
                      "subscribe(", "asyncio", "requests.", "httpx"):
        assert forbidden not in source, f"tasks_store contains `{forbidden}`"


# ── 2. runtime proof ─────────────────────────────────────────────────────────

@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)

    from backend.services.projects import store as projects_store
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import (
        decisions_store, observations_store as obs,
    )
    for mod in (projects_store, tasks_store, views_store, decisions_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    projects_store.create_project("uA", name="Fitness App", description="",
                                  project_id="pA")
    app.dependency_overrides[deps.current_user] = lambda: USER_A
    yield {"tasks": tasks_store, "projects": projects_store}
    app.dependency_overrides.clear()


@pytest.fixture()
def tripwires(monkeypatch):
    """Replace every "something happens" entry point with a recorder.

    Each target is (module path, attribute). A target that does not exist in
    this build is skipped rather than silently passing — the assertion below
    checks that we actually armed the ones that matter."""
    import importlib
    fired: list = []
    armed: list = []

    targets = [
        ("backend.services.orchestrator.runs_store", "create_run"),
        ("backend.services.orchestrator.tasks_store", "create_task"),
        ("backend.services.orchestrator.candidate_actions_store",
         "record_candidate_action"),
        ("backend.services.orchestrator.candidate_synthesis",
         "synthesize_candidates"),
        ("backend.services.orchestrator.approvals_store", "record_approval"),
        ("backend.services.orchestrator.execution_policy", "authorize"),
        ("backend.services.orchestrator.decisions_store", "record_decision"),
        ("backend.services.orchestrator.observations_store",
         "record_observation"),
        ("backend.services.connectors.store", "set_binding"),
        ("backend.services.connectors.store", "upsert_authorization"),
        ("backend.services.connectors.store", "update_credentials"),
        ("backend.services.providers.router", "select_provider"),
        ("backend.services.tasks", "enqueue"),
        ("backend.services.memory_plane.client", "create"),
    ]
    for module_path, attr in targets:
        try:
            mod = importlib.import_module(module_path)
        except Exception:                      # pragma: no cover — build variance
            continue
        if not hasattr(mod, attr):
            continue
        name = f"{module_path}.{attr}"

        def _trip(*_a, _name=name, **_kw):
            fired.append(_name)
            raise AssertionError(f"a project-task write reached {_name}")

        monkeypatch.setattr(mod, attr, _trip, raising=False)
        armed.append(name)

    # If the tripwires silently failed to attach, the test would pass for the
    # wrong reason. Pin the ones that must always exist.
    assert "backend.services.orchestrator.runs_store.create_run" in armed
    assert "backend.services.orchestrator.tasks_store.create_task" in armed
    assert ("backend.services.orchestrator.candidate_actions_store"
            ".record_candidate_action") in armed
    return {"fired": fired, "armed": armed}


def test_the_full_http_write_path_touches_no_execution_surface(
        client, env, tripwires):
    """create → rename → move to doing → complete → delete, through the real
    routes, with every execution surface armed."""
    created = client.post("/v2/projects/pA/tasks",
                          json={"title": "Review the pricing page"})
    assert created.status_code == 201
    task_id = created.json()["data"]["task"]["id"]

    assert client.patch(f"/v2/projects/pA/tasks/{task_id}",
                        json={"title": "Review pricing"}).status_code == 200
    assert client.patch(f"/v2/projects/pA/tasks/{task_id}",
                        json={"status": "doing"}).status_code == 200
    assert client.patch(f"/v2/projects/pA/tasks/{task_id}",
                        json={"status": "done"}).status_code == 200
    assert client.get("/v2/projects/pA/tasks").status_code == 200
    assert client.delete(f"/v2/projects/pA/tasks/{task_id}").status_code == 200

    assert tripwires["fired"] == [], (
        f"a project-task write reached execution: {tripwires['fired']}")


def test_a_task_created_from_a_today_recommendation_is_still_inert(
        client, env, tripwires):
    """The riskiest ergonomic path: Today proposes an action and the user
    presses "Create task". The provenance is recorded on the row and changes
    NOTHING about what the write does — accepting a recommendation is still
    just writing a note down."""
    created = client.post(
        "/v2/projects/pA/tasks",
        json={"title": "Investigate the failed production deployment",
              "source": "recommendation", "origin_ref": "cf4f12f67fdf"})
    assert created.status_code == 201
    task = created.json()["data"]["task"]
    assert task["source"] == "recommendation"
    assert task["origin_ref"] == "cf4f12f67fdf"
    assert tripwires["fired"] == []


def test_reading_the_workspace_with_tasks_present_touches_nothing_either(
        client, env, tripwires):
    """The read side, for completeness: a project full of tasks renders without
    reaching any execution surface — including on repeat reads."""
    for i in range(5):
        env["tasks"].create_task(project_id="pA", owner_user_id="uA",
                                 title=f"task {i}", status="doing")
    for _ in range(3):
        assert client.get("/v2/projects/pA/workspace").status_code == 200
    assert tripwires["fired"] == []


def test_the_seen_acknowledgement_touches_no_execution_surface(
        client, env, tripwires):
    """Marking a project viewed is view metadata. It must not become an
    observation, an event or anything the Business Brain can see."""
    assert client.post("/v2/projects/pA/workspace/seen",
                       json={}).status_code == 200
    assert tripwires["fired"] == []
