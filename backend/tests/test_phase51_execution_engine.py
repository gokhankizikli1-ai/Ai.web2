# coding: utf-8
"""Phase 5.1 — execution engine + task graph tests.

Covers:
  - tasks_store: CRUD + lifecycle transitions (queued → started → completed/failed)
  - ExecutionGraph + Task: row → typed object → JSON envelope
  - truncate_for_summary preserves paragraph + sentence boundaries
  - delegate() creates tasks, transitions them, persists them
  - delegate() failure marks task=failed (not orphan-queued)
  - Shared scratch carries task results across sibling sub-agents
  - 4 new event kinds (task.created/started/completed/failed) emit
    at the right moments with task_id in payload
  - /v2/orchestrate response envelope grows a task_graph key
  - /v2/orchestrate/runs/{run_id}/tasks returns the graph
  - Backwards compat: empty task_graph for older runs; AgentRequest /
    /chat unchanged
"""
import asyncio
import importlib
import os
import sys
import tempfile

import pytest


# ══════════════════════════════════════════════════════════════════════
# Fresh tasks_store per test (isolated SQLite)

@pytest.fixture
def temp_db(monkeypatch):
    fd, path = tempfile.mkstemp(suffix="-phase51.db")
    os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    # Reload modules that captured DB_PATH at import time
    for m in (
        "backend.services.orchestrator.runs_store",
        "backend.services.orchestrator.tasks_store",
        "backend.services.orchestrator.execution_graph",
        "backend.services.orchestrator",
    ):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from backend.services.orchestrator import init_runs_table, init_tasks_table
    init_runs_table()
    init_tasks_table()
    yield path
    try: os.unlink(path)
    except FileNotFoundError: pass


# ══════════════════════════════════════════════════════════════════════
# tasks_store CRUD + lifecycle

def test_init_tasks_table_idempotent(temp_db):
    """Calling init twice is safe — no error, no duplicate schema."""
    from backend.services.orchestrator import init_tasks_table
    init_tasks_table()
    init_tasks_table()


def test_create_task_returns_id(temp_db):
    from backend.services.orchestrator import create_task, get_task
    tid = create_task(
        run_id="run-x", title="Research the market",
        assigned_agent="researcher",
    )
    assert tid and len(tid) >= 8
    row = get_task(tid)
    assert row["status"] == "queued"
    assert row["title"]  == "Research the market"
    assert row["assigned_agent"] == "researcher"
    assert row["dependencies"]   == []
    assert row["result_summary"] == ""


def test_create_task_with_custom_id_preserved(temp_db):
    from backend.services.orchestrator import create_task, get_task
    tid = create_task(
        run_id="run-x", title="x", assigned_agent="coder",
        task_id="my-stable-task-id",
    )
    assert tid == "my-stable-task-id"
    assert get_task("my-stable-task-id") is not None


def test_create_task_captures_dependencies(temp_db):
    from backend.services.orchestrator import create_task, get_task
    tid = create_task(
        run_id="run-x", title="Synthesise findings", assigned_agent="coder",
        dependencies=["task-1", "task-2"],
    )
    row = get_task(tid)
    assert row["dependencies"] == ["task-1", "task-2"]


def test_mark_started_transitions_from_queued(temp_db):
    from backend.services.orchestrator import create_task, mark_started, get_task
    tid = create_task(run_id="r", title="t", assigned_agent="ux_designer")
    assert mark_started(tid) is True
    row = get_task(tid)
    assert row["status"] == "running"
    assert row["started_at"] is not None


def test_mark_started_no_op_when_already_completed(temp_db):
    """Transition guard: once completed, the row stays completed
    even if mark_started is replayed."""
    from backend.services.orchestrator import (
        create_task, mark_started, mark_completed, get_task,
    )
    tid = create_task(run_id="r", title="t", assigned_agent="coder")
    mark_started(tid)
    mark_completed(tid, result_summary="done")
    assert mark_started(tid) is True   # returns True (row exists) but...
    assert get_task(tid)["status"] == "completed"   # ...status unchanged


def test_mark_completed_persists_result_summary(temp_db):
    from backend.services.orchestrator import (
        create_task, mark_started, mark_completed, get_task,
    )
    tid = create_task(run_id="r", title="t", assigned_agent="brand_designer")
    mark_started(tid)
    long_reply = "Brand palette:\n\n" + ("# Section\nDetail.\n\n" * 50)
    assert mark_completed(tid, result_summary=long_reply) is True
    row = get_task(tid)
    assert row["status"] == "completed"
    assert row["completed_at"] is not None
    assert row["result_summary"]
    assert len(row["result_summary"]) <= 600   # column cap


def test_mark_failed_records_error(temp_db):
    from backend.services.orchestrator import create_task, mark_failed, get_task
    tid = create_task(run_id="r", title="t", assigned_agent="coder")
    assert mark_failed(tid, error="Provider exhausted: all fallbacks failed") is True
    row = get_task(tid)
    assert row["status"] == "failed"
    assert "Provider exhausted" in (row["error"] or "")
    assert row["completed_at"] is not None


def test_mark_unknown_task_returns_false(temp_db):
    from backend.services.orchestrator import mark_started, mark_completed, mark_failed
    assert mark_started("nonexistent-id")   is False
    assert mark_completed("nonexistent-id") is False
    assert mark_failed("nonexistent-id")    is False


def test_list_tasks_for_run_returns_chronological(temp_db):
    """Tasks for a run come back in creation order so the UI renders
    them as the supervisor's planning sequence."""
    from backend.services.orchestrator import create_task, list_tasks_for_run
    t1 = create_task(run_id="r", title="First",  assigned_agent="researcher")
    t2 = create_task(run_id="r", title="Second", assigned_agent="ux_designer")
    t3 = create_task(run_id="r", title="Third",  assigned_agent="coder")
    rows = list_tasks_for_run("r")
    assert [r["id"] for r in rows] == [t1, t2, t3]


def test_list_tasks_for_project_filters_correctly(temp_db):
    from backend.services.orchestrator import (
        create_task, list_tasks_for_project,
    )
    create_task(run_id="r1", project_id="p-A", title="t", assigned_agent="a")
    create_task(run_id="r2", project_id="p-A", title="t", assigned_agent="a")
    create_task(run_id="r3", project_id="p-B", title="t", assigned_agent="a")
    a_tasks = list_tasks_for_project("p-A")
    b_tasks = list_tasks_for_project("p-B")
    assert len(a_tasks) == 2
    assert len(b_tasks) == 1


# ══════════════════════════════════════════════════════════════════════
# ExecutionGraph + Task

def test_task_from_row_round_trip(temp_db):
    from backend.services.orchestrator import (
        create_task, mark_started, mark_completed, get_task, Task,
    )
    tid = create_task(run_id="r", title="The task",
                      assigned_agent="copywriter", project_id="p")
    mark_started(tid)
    mark_completed(tid, result_summary="brief preview")
    task = Task.from_row(get_task(tid))
    assert task.id              == tid
    assert task.run_id          == "r"
    assert task.project_id      == "p"
    assert task.assigned_agent  == "copywriter"
    assert task.status          == "completed"
    assert task.started_at  and task.completed_at
    assert task.duration_ms is not None and task.duration_ms >= 0


def test_task_duration_ms_handles_missing_timestamps(temp_db):
    from backend.services.orchestrator import create_task, get_task, Task
    tid = create_task(run_id="r", title="t", assigned_agent="a")
    task = Task.from_row(get_task(tid))     # queued, no started_at
    assert task.duration_ms is None


def test_execution_graph_envelope_contains_full_state(temp_db):
    """The to_envelope() output is what gets returned from
    /v2/orchestrate — verify it carries everything the frontend needs."""
    from backend.services.orchestrator import (
        create_task, mark_started, mark_completed, ExecutionGraph,
    )
    t1 = create_task(run_id="r1", title="One",
                      assigned_agent="researcher", project_id="p")
    mark_started(t1)
    mark_completed(t1, result_summary="research findings")
    t2 = create_task(run_id="r1", title="Two",
                      assigned_agent="coder", project_id="p")
    mark_started(t2)

    graph = ExecutionGraph.for_run("r1")
    env = graph.to_envelope()
    assert env["run_id"] == "r1"
    assert env["total_count"] == 2
    assert env["counts"]["completed"] == 1
    assert env["counts"]["running"]   == 1
    assert len(env["tasks"]) == 2
    # Each task dict carries the fields the UI needs to render
    for td in env["tasks"]:
        assert "id" in td and "title" in td and "assigned_agent" in td
        assert "status" in td and "dependencies" in td


def test_execution_graph_empty_for_unknown_run(temp_db):
    from backend.services.orchestrator import ExecutionGraph
    env = ExecutionGraph.for_run("ghost-run-id").to_envelope()
    assert env["tasks"] == [] and env["total_count"] == 0


# ══════════════════════════════════════════════════════════════════════
# truncate_for_summary heuristic

def test_truncate_for_summary_passes_short_text():
    from backend.services.orchestrator import truncate_for_summary
    assert truncate_for_summary("short text") == "short text"


def test_truncate_for_summary_prefers_paragraph_boundary():
    from backend.services.orchestrator import truncate_for_summary
    text = "First paragraph.\n\n" + ("Filler. " * 200)
    out = truncate_for_summary(text, max_chars=120)
    # Cut should happen at the paragraph break, not mid-sentence
    assert out.endswith("…")
    assert "First paragraph." in out


def test_truncate_for_summary_falls_back_to_sentence():
    from backend.services.orchestrator import truncate_for_summary
    text = "Sentence one. Sentence two. " + ("filler " * 200)
    out = truncate_for_summary(text, max_chars=80)
    assert "Sentence one." in out


def test_truncate_for_summary_handles_empty():
    from backend.services.orchestrator import truncate_for_summary
    assert truncate_for_summary("") == ""
    assert truncate_for_summary(None) == ""


# ══════════════════════════════════════════════════════════════════════
# delegate() integration — creates + transitions tasks

def _stub_reply_for(role: str) -> str:
    """Minimum reply that satisfies the Phase 4.2 quality guard for
    the given role, so delegate's success path runs end-to-end."""
    if role == "frontend":
        return (
            "## Intent\nLand it.\n\n## Component architecture\n- <App>\n\n"
            "## File structure\n```\nsrc/App.tsx\n```\n\n"
            "## Implementation plan\n1. mobile-first sm/md.\n"
            "2. framer-motion stagger.\n3. CTA. 4. Ship. 5. Polish.\n\n"
            "## Code skeleton\n```tsx\nexport const App = () => null;\n```\n\n"
            "## Design direction\nClean.\n\n## Next actions\n- Ship\n- Polish\n- Iterate\n"
        )
    return "## Section\nGeneric stub reply that's long enough to satisfy length checks. " * 5


@pytest.fixture
def orchestrate_test_env(monkeypatch, temp_db):
    """Combine temp_db + orchestrator/events enabled."""
    monkeypatch.setenv("ENABLE_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    # Force re-import of route + events module so the singleton bus
    # has fresh state for tests that subscribe.
    for m in (
        "backend.services.events.bus",
        "backend.services.events",
        "backend.routes.v2_orchestrate",
        "backend.services.projects.store",
        "backend.routes.projects",
    ):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    yield


def test_delegate_creates_task_row(orchestrate_test_env):
    """delegate() persists a row in the tasks table for each call."""
    from backend.services.agent.types import AgentResponse
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.orchestrator import list_tasks_for_run
    from backend.services.agent.run_context import start_run

    async def _stub(req):
        return AgentResponse(reply=_stub_reply_for("frontend"),
                              mode=req.mode, model=req.model, steps_used=1, elapsed_ms=42)

    async def _drive():
        with start_run(user_id="u-1", project_id="p-task-test") as ctx:
            res = await spawn_and_delegate(
                role="frontend", persona_summary="Senior FE",
                task="Build the hero", caller_spec_id="supervisor",
                _run_agent_fn=_stub,
            )
            return ctx.run_id, res

    run_id, res = asyncio.run(_drive())
    assert res["ok"] is True
    rows = list_tasks_for_run(run_id)
    assert len(rows) == 1
    row = rows[0]
    assert row["status"]          == "completed"
    assert row["assigned_agent"].startswith("ephemeral-")
    assert row["result_summary"]
    assert row["started_at"]   and row["completed_at"]


def test_delegate_failed_path_marks_task_failed(orchestrate_test_env):
    """If the runtime raises, the task row transitions to 'failed'
    with the error message, NOT abandoned in 'queued'/'running'."""
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.orchestrator import list_tasks_for_run
    from backend.services.agent.run_context import start_run

    async def _crashing(req):
        raise RuntimeError("simulated runtime crash")

    async def _drive():
        with start_run(user_id="u-1", project_id="p-fail") as ctx:
            await spawn_and_delegate(
                role="frontend", persona_summary="x",
                task="x", caller_spec_id="supervisor",
                _run_agent_fn=_crashing,
            )
            return ctx.run_id

    run_id = asyncio.run(_drive())
    rows = list_tasks_for_run(run_id)
    assert len(rows) == 1
    assert rows[0]["status"] == "failed"
    assert "simulated runtime crash" in (rows[0]["error"] or "")
    assert rows[0]["completed_at"] is not None    # failure stamped too


def test_delegate_emits_phase51_task_events(orchestrate_test_env):
    """The 4 new event kinds fire at the right points + carry task_id
    in their payload so the UI can correlate them with delegate.* events."""
    # Re-bind module references for the bus singleton dance
    import importlib as _il
    for m in ("backend.services.events.bus", "backend.services.events"):
        if m in sys.modules:
            _il.reload(sys.modules[m])
    from backend.services.events import bus
    from backend.services.agent.types import AgentResponse
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.agent.run_context import start_run

    async def _stub(req):
        return AgentResponse(reply=_stub_reply_for("frontend"),
                              mode=req.mode, model=req.model, steps_used=1, elapsed_ms=11)

    async def _drive():
        with bus.subscribe("*") as sub:
            with start_run(user_id="u-1", project_id="p-evt"):
                await spawn_and_delegate(
                    role="frontend", persona_summary="x",
                    task="x", caller_spec_id="supervisor",
                    _run_agent_fn=_stub,
                )
            seen = []
            for _ in range(30):     # roomy drain so the test never flakes
                try:
                    e = await asyncio.wait_for(sub.get(), 0.2)
                    seen.append(e)
                except asyncio.TimeoutError:
                    break
            return seen

    events = asyncio.run(_drive())
    kinds = [e.kind for e in events]
    # All 3 happy-path task events fire (failed only on errors)
    assert "task.created"   in kinds
    assert "task.started"   in kinds
    assert "task.completed" in kinds
    # Order: created < started < completed
    assert kinds.index("task.created") < kinds.index("task.started") < kinds.index("task.completed")
    # task_id carried in payloads + same across the 3 events
    task_ids = {
        e.payload.get("task_id") for e in events
        if e.kind in ("task.created", "task.started", "task.completed")
    }
    assert len(task_ids) == 1 and "" not in task_ids and None not in task_ids


def test_delegate_failure_emits_task_failed(orchestrate_test_env):
    import importlib as _il
    for m in ("backend.services.events.bus", "backend.services.events"):
        if m in sys.modules:
            _il.reload(sys.modules[m])
    from backend.services.events import bus
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.agent.run_context import start_run

    async def _crashing(req):
        raise RuntimeError("boom")

    async def _drive():
        with bus.subscribe("*") as sub:
            with start_run(user_id="u-1"):
                await spawn_and_delegate(
                    role="frontend", persona_summary="x",
                    task="x", caller_spec_id="supervisor",
                    _run_agent_fn=_crashing,
                )
            kinds = []
            for _ in range(20):
                try:
                    e = await asyncio.wait_for(sub.get(), 0.2)
                    kinds.append(e.kind)
                except asyncio.TimeoutError:
                    break
            return kinds

    kinds = asyncio.run(_drive())
    assert "task.failed" in kinds
    # Should NOT emit task.completed on a failed run
    assert "task.completed" not in kinds


def test_shared_scratch_carries_task_results_across_siblings(orchestrate_test_env):
    """Phase 5.1 — task results land in scratch['_task_results'] so a
    later specialist can read what an earlier one produced (the
    shared memory bus contract)."""
    from backend.services.agent.types import AgentResponse
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.agent.run_context import start_run

    async def _stub(req):
        return AgentResponse(reply=_stub_reply_for("frontend"),
                              mode=req.mode, model=req.model, steps_used=1, elapsed_ms=10)

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            # First delegation
            await spawn_and_delegate(
                role="frontend", persona_summary="FE",
                task="t1", caller_spec_id="supervisor",
                _run_agent_fn=_stub,
            )
            # Second delegation — should see the first's result in scratch
            await spawn_and_delegate(
                role="backend", persona_summary="BE",
                task="t2", caller_spec_id="supervisor",
                _run_agent_fn=_stub,
            )
            return ctx.scratch

    scratch = asyncio.run(_drive())
    results = scratch.get("_task_results", {})
    assert len(results) == 2
    for tid, info in results.items():
        assert info["agent_id"].startswith("ephemeral-")
        assert info["agent_name"]
        assert info["summary"]


# ══════════════════════════════════════════════════════════════════════
# /v2/orchestrate response envelope + new routes

@pytest.fixture
def orchestrate_client(monkeypatch, orchestrate_test_env):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import projects as p_route
    from backend.routes import v2_orchestrate as o_route
    app = FastAPI()
    app.include_router(p_route.router)
    app.include_router(o_route.router)
    return TestClient(app)


def test_orchestrate_response_envelope_includes_task_graph(
    orchestrate_client, monkeypatch,
):
    """Response envelope gains a task_graph key. Even when no tasks
    were created (older path / no delegation), the key exists with an
    empty graph — shape stability."""
    from backend.routes import v2_orchestrate
    from backend.services.agent.types import AgentResponse

    async def _stub(req):
        return AgentResponse(reply="solo reply, no delegation",
                              mode=req.mode, model=req.model, steps_used=0)
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-shape", "message": "hi",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert "task_graph" in body
    graph = body["task_graph"]
    assert graph["run_id"]      == body["run_id"]
    assert graph["total_count"] == 0
    assert graph["tasks"]       == []


def test_get_run_tasks_route_returns_persisted_graph(
    orchestrate_client, temp_db,
):
    """GET /v2/orchestrate/runs/{run_id}/tasks returns whatever's in
    the store for that run_id. Used by the frontend to backfill on
    tab reload."""
    from backend.services.orchestrator import (
        create_task, mark_started, mark_completed,
    )
    t1 = create_task(run_id="r-backfill", title="Task A", assigned_agent="ux_designer")
    mark_started(t1); mark_completed(t1, result_summary="a result")
    t2 = create_task(run_id="r-backfill", title="Task B", assigned_agent="copywriter")
    mark_started(t2)

    r = orchestrate_client.get("/v2/orchestrate/runs/r-backfill/tasks")
    assert r.status_code == 200
    body = r.json()
    assert body["run_id"]      == "r-backfill"
    assert body["total_count"] == 2
    assert body["counts"]["completed"] == 1
    assert body["counts"]["running"]   == 1


def test_get_project_tasks_route_filters_by_project(
    orchestrate_client, temp_db,
):
    from backend.services.orchestrator import create_task
    create_task(run_id="r1", project_id="p-X", title="t", assigned_agent="a")
    create_task(run_id="r2", project_id="p-X", title="t", assigned_agent="a")
    create_task(run_id="r3", project_id="p-Y", title="t", assigned_agent="a")

    r = orchestrate_client.get("/v2/orchestrate/projects/p-X/tasks")
    assert r.status_code == 200
    assert len(r.json()["tasks"]) == 2

    r = orchestrate_client.get("/v2/orchestrate/projects/p-Y/tasks")
    assert len(r.json()["tasks"]) == 1


# ══════════════════════════════════════════════════════════════════════
# Backwards compat + canonicalisation

def test_event_kinds_extended_canonically():
    """The 4 new task.* kinds must appear in EVENT_KINDS so docs +
    other subscribers can rely on them being canonical."""
    from backend.services.events import EVENT_KINDS
    for k in ("task.created", "task.started", "task.completed", "task.failed"):
        assert k in EVENT_KINDS, f"{k} missing from EVENT_KINDS"


def test_chat_request_path_unchanged_phase51():
    """Phase 5.1 didn't touch /chat. AgentRequest.spec still defaults
    to None; no task graph applied to that path."""
    from backend.services.agent.types import AgentRequest
    req = AgentRequest(user_message="hi", mode="fast", user_id="u-1")
    assert getattr(req, "spec", "MISSING") is None


def test_response_envelope_backwards_compat(orchestrate_client, monkeypatch):
    """All pre-5.1 envelope fields are still present + correct."""
    from backend.routes import v2_orchestrate
    from backend.services.agent.types import AgentResponse

    async def _stub(req):
        return AgentResponse(reply="ok", mode=req.mode, model=req.model)
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-bc", "message": "hi",
    })
    body = r.json()
    # Phase 3.4 + 4.1 + 4.2 fields all still present
    for field in ("run_id", "reply", "agent_id", "agents_used",
                  "trace", "metadata", "task_graph"):
        assert field in body, f"envelope missing pre-existing field: {field}"
    for field in ("max_depth", "max_parallel", "total_token_budget"):
        assert field in body["metadata"], f"metadata missing pre-existing field: {field}"


def test_tasks_stats_surfaces_counters(temp_db):
    from backend.services.orchestrator import (
        create_task, mark_started, mark_completed, mark_failed, tasks_stats,
    )
    t1 = create_task(run_id="r", title="t", assigned_agent="a")
    t2 = create_task(run_id="r", title="t", assigned_agent="a")
    mark_started(t1); mark_completed(t1)
    mark_started(t2); mark_failed(t2, error="x")
    s = tasks_stats()
    assert s["tasks_created"]   >= 2
    assert s["tasks_completed"] >= 1
    assert s["tasks_failed"]    >= 1
