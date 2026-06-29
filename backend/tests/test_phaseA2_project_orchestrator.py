# coding: utf-8
"""Phase A.2 — PR #2 — Project Orchestrator tests.

Covers the conductor that turns one user request into a tracked
multi-agent project run. Grouped by concern:

  Templates / catalog        (1–6)   pure, no I/O
  Deliverable registry store (7–9)
  Service composition + e2e  (10–14) full env + real InlineJobRunner +
                                     real DAG runner, fake run_agent
  HTTP routes                (15–20) via TestClient

The agent runtime is faked (`agent_run_kind.run_agent` monkeypatched)
so tests are deterministic + offline; everything ELSE is the real
subsystem (workflows store + DAG runner + job queue + deliverables +
tasks + panels).
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from backend.services.orchestrator import service as orch
from backend.services.orchestrator import agent_run_kind as ark
from backend.services.orchestrator import deliverables_store as dstore
from backend.services.orchestrator import tasks_store as tstore
from backend.services.orchestrator import runs_store as rstore
from backend.services.orchestrator import templates as tmpl
from backend.services.orchestrator.templates.base import (
    ProjectTemplate, TemplateNode, TemplateError,
)


# ──────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────

def _fake_reply(req):
    spec_id = getattr(getattr(req, "spec", None), "id", "agent")
    return SimpleNamespace(
        reply=f"[{spec_id}] result for: {(req.user_message or '')[:50]}",
        trace=[], tool_calls=0,
    )


@pytest.fixture()
def projects_db(tmp_path, monkeypatch):
    """Isolate projects.db (runs + tasks + deliverables all live here)."""
    db_file = tmp_path / "projects-test.db"
    monkeypatch.setenv("PROJECTS_DB_PATH", str(db_file))
    # The three stores cache DB_PATH at import — rewrite each.
    monkeypatch.setattr(rstore, "DB_PATH", str(db_file), raising=False)
    monkeypatch.setattr(tstore, "DB_PATH", str(db_file), raising=False)
    monkeypatch.setattr(dstore, "DB_PATH", str(db_file), raising=False)
    rstore.init_runs_table()
    tstore.init_tasks_table()
    dstore.init_deliverables_table()
    yield db_file


@pytest.fixture()
def po_env(projects_db, tmp_jobs_db, tmp_workflows_db, tmp_panels_db, monkeypatch):
    """Full project-orchestrator environment: orchestrator + workflows +
    runner + job queue + panels all ON, agent runtime faked, fast poll."""
    monkeypatch.setenv("ENABLE_PROJECT_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "true")
    monkeypatch.setenv("WORKFLOW_RUNNER_POLL_INTERVAL_SEC", "0.05")
    monkeypatch.setenv("ENABLE_COORDINATOR", "true")
    # Make sure the job kind survived any prior registry reset.
    ark.ensure_registered()
    # Fake the agent runtime — deterministic + offline.
    monkeypatch.setattr(ark, "run_agent",
                        lambda req: _async_return(_fake_reply(req)))
    yield


def _async_return(value):
    async def _coro():
        return value
    return _coro()


async def _wait_for_run_status(run_id, user_id, targets, *, timeout_s=6.0):
    targets = {targets} if isinstance(targets, str) else set(targets)
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        snap = orch.get_run_snapshot(run_id, user_id=user_id)
        status = (snap or {}).get("status")
        if status in targets:
            return snap
        if asyncio.get_event_loop().time() >= deadline:
            raise AssertionError(
                f"run {run_id} did not reach {targets} within {timeout_s}s "
                f"(current={status})"
            )
        await asyncio.sleep(0.05)


# ──────────────────────────────────────────────────────────────────────────
# 1–6  Templates / catalog
# ──────────────────────────────────────────────────────────────────────────

def test_builtin_templates_registered_and_valid():
    """1. Exactly two built-ins, both valid DAGs."""
    ids = {t.id for t in tmpl.list_templates()}
    assert ids == {"generic_research", "generic_creation"}
    for t in tmpl.list_templates():
        t.validate()  # must not raise


def test_generic_creation_has_parallel_fanout():
    """2. generic_creation: copy ∥ design both depend on brief; assemble
    joins both."""
    t = tmpl.get_template("generic_creation")
    by_key = {n.key: n for n in t.nodes}
    assert by_key["copy"].depends_on == ["brief"]
    assert by_key["design"].depends_on == ["brief"]
    assert set(by_key["assemble"].depends_on) == {"copy", "design"}


def test_template_validate_rejects_cycle():
    """3. A cyclic template is rejected with the stable code."""
    t = ProjectTemplate(
        id="bad", name="bad", description="",
        nodes=[
            TemplateNode("a", "researcher", "A", "k", "do", depends_on=["b"]),
            TemplateNode("b", "researcher", "B", "k", "do", depends_on=["a"]),
        ],
    )
    with pytest.raises(TemplateError) as exc:
        t.validate()
    assert exc.value.code == "project_template_invalid"


def test_template_validate_rejects_unknown_dependency():
    """4. A dependency on an unknown node key is rejected."""
    t = ProjectTemplate(
        id="bad2", name="bad2", description="",
        nodes=[TemplateNode("a", "researcher", "A", "k", "do", depends_on=["ghost"])],
    )
    with pytest.raises(TemplateError):
        t.validate()


def test_build_adhoc_template_from_plan():
    """5. An ad-hoc template is built from a coordinator-style plan,
    preserving dependencies and de-duplicating agents."""
    plan = SimpleNamespace(
        intent="multi_agent",
        agents=[
            SimpleNamespace(agent_id="supervisor", reason="orchestrate", depends_on=[]),
            SimpleNamespace(agent_id="researcher", reason="gather", depends_on=["supervisor"]),
            SimpleNamespace(agent_id="copywriter", reason="write", depends_on=["supervisor"]),
        ],
    )
    t = tmpl.build_adhoc_template(plan, "do a thing")
    assert t.node_keys == ["supervisor", "researcher", "copywriter"]
    by_key = {n.key: n for n in t.nodes}
    assert by_key["researcher"].depends_on == ["supervisor"]
    t.validate()  # must be a valid DAG


def test_choose_template_heuristics():
    """6. choose_template: research vs creation vs default-to-research."""
    assert tmpl.choose_template("research the market", None).id == "generic_research"
    assert tmpl.choose_template("build me a landing page", None).id == "generic_creation"
    # Vague request with no plan → safe default.
    assert tmpl.choose_template("hello there", None).id == "generic_research"


# ──────────────────────────────────────────────────────────────────────────
# 7–9  Deliverable registry store
# ──────────────────────────────────────────────────────────────────────────

def test_deliverable_create_get_list(projects_db):
    """7. Create + read-back + list_for_run."""
    did = dstore.create_deliverable(
        run_id="run-1", agent_id="researcher", node_id="scope",
        kind="research_scope", title="Scope it", project_id="proj-1",
    )
    assert did
    row = dstore.get_deliverable(did)
    assert row["status"] == dstore.STATUS_PENDING
    assert row["agent_id"] == "researcher"
    assert row["version"] == 0
    listed = dstore.list_for_run("run-1")
    assert [d["id"] for d in listed] == [did]


def test_deliverable_status_transitions(projects_db):
    """8. set_status moves through the lifecycle; failed records error."""
    did = dstore.create_deliverable(
        run_id="run-2", agent_id="coder", node_id="x", kind="k",
    )
    assert dstore.set_status(did, dstore.STATUS_IN_PROGRESS)
    assert dstore.get_deliverable(did)["status"] == "in_progress"
    assert dstore.set_status(did, dstore.STATUS_FAILED, error="boom")
    row = dstore.get_deliverable(did)
    assert row["status"] == "failed"
    assert row["error"] == "boom"
    # Unknown status is a no-op.
    assert dstore.set_status(did, "bogus") is False


def test_deliverable_set_content_bumps_version_and_completes(projects_db):
    """9. set_content writes opaque JSON, bumps version, can complete."""
    did = dstore.create_deliverable(
        run_id="run-3", agent_id="copywriter", node_id="copy", kind="copy_draft",
    )
    assert dstore.set_content(did, {"text": "hello"}, status=dstore.STATUS_COMPLETED)
    row = dstore.get_deliverable(did)
    assert row["content"] == {"text": "hello"}
    assert row["version"] == 1
    assert row["status"] == "completed"


# ──────────────────────────────────────────────────────────────────────────
# 10–14  Service composition + end-to-end
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_run_composes_scaffold(po_env):
    """10. start_project_run wires run + workflow + deliverables + tasks
    + panel with the correct user_id, BEFORE any execution finishes."""
    snap = await orch.start_project_run(
        user_id="user-A", user_request="research EVs",
        template_id="generic_research", project_id="proj-A",
    )
    run_id = snap["run_id"]
    assert snap["template_id"] == "generic_research"
    assert snap["workflow"] is not None
    assert snap["panel_id"]  # panels enabled → created
    # 3 deliverables, one per node, all owned by the run.
    dels = dstore.list_for_run(run_id)
    assert len(dels) == 3
    assert {d["node_id"] for d in dels} == {"scope", "gather", "synthesize"}
    # 3 task-graph rows.
    assert snap["task_graph"]["total_count"] == 3
    # Run row carries the right owner + ids.
    run = rstore.get_run(run_id)
    assert run["user_id"] == "user-A"
    assert run["metadata"]["workflow_id"] == snap["workflow"]["id"]


@pytest.mark.asyncio
async def test_end_to_end_linear_run_completes(po_env):
    """11. A linear research run drives to completion: every deliverable
    completed with produced content; run + workflow terminal."""
    snap = await orch.start_project_run(
        user_id="user-B", user_request="research the EV market",
        template_id="generic_research",
    )
    assert snap["runner_started"] is True
    run_id = snap["run_id"]
    final = await _wait_for_run_status(run_id, "user-B", "completed")
    dels = dstore.list_for_run(run_id)
    assert all(d["status"] == "completed" for d in dels)
    assert all(d["content"].get("text") for d in dels)
    assert rstore.get_run(run_id)["status"] == "finished"


@pytest.mark.asyncio
async def test_end_to_end_parallel_run_completes(po_env):
    """12. The parallel-fan-out template completes too (copy ∥ design →
    assemble)."""
    snap = await orch.start_project_run(
        user_id="user-C", user_request="build a campaign",
        template_id="generic_creation",
    )
    run_id = snap["run_id"]
    final = await _wait_for_run_status(run_id, "user-C", "completed")
    dels = {d["node_id"]: d for d in dstore.list_for_run(run_id)}
    assert set(dels) == {"brief", "copy", "design", "assemble"}
    assert all(d["status"] == "completed" for d in dels.values())


@pytest.mark.asyncio
async def test_end_to_end_failure_skips_downstream(po_env, monkeypatch):
    """13. When the agent runtime fails, the workflow fails, the running
    deliverable is failed, and downstream deliverables are skipped; the
    run is errored."""
    async def _boom(req):
        raise RuntimeError("agent boom")
    monkeypatch.setattr(ark, "run_agent", _boom)

    snap = await orch.start_project_run(
        user_id="user-D", user_request="research that explodes",
        template_id="generic_research",
    )
    run_id = snap["run_id"]
    await _wait_for_run_status(run_id, "user-D", {"failed", "errored"})
    dels = {d["node_id"]: d for d in dstore.list_for_run(run_id)}
    # scope ran first and failed; the rest never ran → skipped.
    assert dels["scope"]["status"] == "failed"
    assert dels["gather"]["status"] in {"skipped", "failed"}
    assert dels["synthesize"]["status"] in {"skipped", "failed"}
    assert rstore.get_run(run_id)["status"] == "errored"


@pytest.mark.asyncio
async def test_cancel_run_skips_open_deliverables(po_env, monkeypatch):
    """14. Cancelling a run (runner off so it never drives) cancels the
    workflow, errors the run, and skips the still-open deliverables."""
    # Turn the runner OFF so the scaffold is created but not driven —
    # deterministic, no in-flight jobs to race the cancel.
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "false")
    snap = await orch.start_project_run(
        user_id="user-E", user_request="something",
        template_id="generic_research",
    )
    run_id = snap["run_id"]
    assert snap["runner_started"] is False
    out = orch.cancel_run(run_id, user_id="user-E")
    assert out is not None
    assert rstore.get_run(run_id)["status"] == "errored"
    dels = dstore.list_for_run(run_id)
    assert all(d["status"] == "skipped" for d in dels)
    # Cross-user cancel is hidden.
    assert orch.cancel_run(run_id, user_id="other") is None


# ──────────────────────────────────────────────────────────────────────────
# 15–20  HTTP routes
# ──────────────────────────────────────────────────────────────────────────

def test_health_always_200(client):
    """15. /health is always callable and reports the flags."""
    r = client.get("/v2/orchestrator/health")
    assert r.status_code == 200
    body = r.json()
    assert "flags" in body
    assert "ENABLE_PROJECT_ORCHESTRATOR" in body["flags"]


def test_run_disabled_returns_503(client, monkeypatch):
    """16. With the master flag off, POST /run is a 503 envelope."""
    monkeypatch.setenv("ENABLE_PROJECT_ORCHESTRATOR", "false")
    r = client.post("/v2/orchestrator/run", json={"user_request": "hi"})
    assert r.status_code == 503
    body = r.json()
    assert body["success"] is False
    assert body["metadata"]["code"] == "project_orchestrator_disabled"


def test_templates_route_lists_two(client, po_env):
    """17. /templates returns the two built-ins when enabled."""
    r = client.get("/v2/orchestrator/templates")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert {t["id"] for t in body["data"]["templates"]} == {
        "generic_research", "generic_creation",
    }


def test_unknown_run_returns_404(client, po_env):
    """18. GET an unknown run id → 404 envelope."""
    r = client.get("/v2/orchestrator/runs/does-not-exist")
    assert r.status_code == 404
    assert r.json()["metadata"]["code"] == "orchestrator_run_not_found"


def test_run_unknown_template_returns_404(client, po_env, monkeypatch):
    """19. POST /run with a bogus template_id → 404 envelope."""
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "false")
    r = client.post("/v2/orchestrator/run",
                    json={"user_request": "x", "template_id": "nope"})
    assert r.status_code == 404
    assert r.json()["metadata"]["code"] == "project_template_unknown"


def test_run_then_snapshot_then_cancel_http(client, po_env, monkeypatch):
    """20. Full HTTP happy path (runner off → deterministic): create a
    run, read its snapshot, cancel it."""
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "false")
    r = client.post("/v2/orchestrator/run",
                    json={"user_request": "research", "template_id": "generic_research"})
    assert r.status_code == 200
    data = r.json()["data"]
    run_id = data["run_id"]
    assert len(data["deliverables"]) == 3
    assert all(d["status"] == "pending" for d in data["deliverables"])

    r2 = client.get(f"/v2/orchestrator/runs/{run_id}")
    assert r2.status_code == 200
    assert r2.json()["data"]["run_id"] == run_id

    r3 = client.post(f"/v2/orchestrator/runs/{run_id}/cancel")
    assert r3.status_code == 200
    data3 = r3.json()["data"]
    # Overall status reflects the cancelled workflow; the run row itself
    # is errored.
    assert data3["status"] in {"cancelled", "errored"}
    assert data3["run"]["status"] == "errored"


def test_snapshot_shape_matches_frontend_contract(client, po_env, monkeypatch):
    """21. Phase B FE contract guard. The /v2/orchestrator/run + snapshot
    payload must carry exactly the keys `useProjectOrchestrator.ts`
    (RunSnapshot / DeliverableView / TaskView) reads. If the backend
    shape drifts, the wired ProjectWorkspace panel breaks silently — so
    pin it here next to the route tests."""
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "false")
    r = client.post("/v2/orchestrator/run",
                    json={"user_request": "build a campaign",
                          "template_id": "generic_creation"})
    assert r.status_code == 200
    snap = r.json()["data"]

    # Top-level keys the hook's RunSnapshot type depends on.
    for key in ("run_id", "status", "template_id", "panel_id",
                "workflow", "deliverables", "task_graph"):
        assert key in snap, f"missing snapshot key: {key}"

    # DeliverableView fields used by the checklist UI.
    assert len(snap["deliverables"]) == 4
    d = snap["deliverables"][0]
    for key in ("id", "title", "agent_id", "node_id", "kind", "status", "version"):
        assert key in d, f"missing deliverable key: {key}"
    assert d["status"] in {"pending", "in_progress", "completed", "failed", "skipped"}

    # task_graph shape used for progress.
    tg = snap["task_graph"]
    assert "tasks" in tg and "total_count" in tg
    assert tg["total_count"] == 4
    if tg["tasks"]:
        t = tg["tasks"][0]
        for key in ("id", "title", "assigned_agent", "status", "dependencies"):
            assert key in t, f"missing task key: {key}"


# ──────────────────────────────────────────────────────────────────────────
# 22–26  Phase C — Landing Page vertical (flag-gated template)
# ──────────────────────────────────────────────────────────────────────────

def test_landing_page_hidden_when_flag_off(monkeypatch):
    """22. With ENABLE_LANDING_PAGE_TEMPLATE off, the template is invisible
    in the catalog — list + lookup both exclude it (back-compat)."""
    monkeypatch.delenv("ENABLE_LANDING_PAGE_TEMPLATE", raising=False)
    assert tmpl.get_template("landing_page") is None
    assert "landing_page" not in {t.id for t in tmpl.list_templates()}


def test_landing_page_visible_when_flag_on(monkeypatch):
    """23. Flipped on, the template appears and is a valid DAG matching
    the roadmap: research → [brand ∥ copy] → design(brand) → code(copy+design)."""
    monkeypatch.setenv("ENABLE_LANDING_PAGE_TEMPLATE", "true")
    t = tmpl.get_template("landing_page")
    assert t is not None
    assert "landing_page" in {x.id for x in tmpl.list_templates()}
    t.validate()  # must not raise
    by_key = {n.key: n for n in t.nodes}
    assert set(by_key) == {"research", "brand", "copy", "design", "code"}
    assert by_key["research"].depends_on == []
    assert by_key["brand"].depends_on == ["research"]
    assert by_key["copy"].depends_on == ["research"]
    assert by_key["design"].depends_on == ["brand"]
    assert set(by_key["code"].depends_on) == {"copy", "design"}
    # The Coder's deliverable is the HTML page the FE previews/downloads.
    assert by_key["code"].deliverable_kind == "landing_page_html"


@pytest.mark.asyncio
async def test_landing_page_end_to_end(po_env, monkeypatch):
    """24. Full vertical: a landing-page run drives all 5 specialists to
    completion and produces the landing_page_html deliverable with
    content — the first end-to-end vertical on the existing orchestrator."""
    monkeypatch.setenv("ENABLE_LANDING_PAGE_TEMPLATE", "true")
    snap = await orch.start_project_run(
        user_id="user-LP", user_request="a landing page for my coffee subscription",
        template_id="landing_page",
    )
    assert snap["runner_started"] is True
    run_id = snap["run_id"]
    await _wait_for_run_status(run_id, "user-LP", "completed")
    dels = {d["node_id"]: d for d in dstore.list_for_run(run_id)}
    assert set(dels) == {"research", "brand", "copy", "design", "code"}
    assert all(d["status"] == "completed" for d in dels.values())
    page = dels["code"]
    assert page["kind"] == "landing_page_html"
    assert page["content"].get("text")          # the produced page content


def test_landing_page_route_listing_respects_flag(client, po_env, monkeypatch):
    """25. /v2/orchestrator/templates includes landing_page only when the
    flag is on."""
    monkeypatch.setenv("ENABLE_LANDING_PAGE_TEMPLATE", "false")
    r = client.get("/v2/orchestrator/templates")
    ids = {t["id"] for t in r.json()["data"]["templates"]}
    assert "landing_page" not in ids

    monkeypatch.setenv("ENABLE_LANDING_PAGE_TEMPLATE", "true")
    r2 = client.get("/v2/orchestrator/templates")
    ids2 = {t["id"] for t in r2.json()["data"]["templates"]}
    assert "landing_page" in ids2


@pytest.mark.asyncio
async def test_empty_or_fallback_agent_output_fails_the_run(po_env, monkeypatch):
    """27. Fix A — a provider that yields no output must FAIL the run, not
    fake-succeed with blank deliverables. The OpenAI-only agent runtime
    returns reply='' + fallback=True when it can't reach the model
    (missing OPENAI_API_KEY / non-OpenAI MODEL_*); the agent.run handler
    must surface that as a failed deliverable + errored run."""
    async def _fallback(req):
        return SimpleNamespace(
            reply="", fallback=True,
            metadata={"fallback_reason": "openai_client: OPENAI_API_KEY missing"},
        )
    monkeypatch.setattr(ark, "run_agent", _fallback)

    snap = await orch.start_project_run(
        user_id="user-FB", user_request="anything",
        template_id="generic_research",
    )
    run_id = snap["run_id"]
    await _wait_for_run_status(run_id, "user-FB", {"failed", "errored"})
    dels = {d["node_id"]: d for d in dstore.list_for_run(run_id)}
    assert dels["scope"]["status"] == "failed"
    # actionable error mentioning the provider/config cause
    assert "OPENAI_API_KEY" in (dels["scope"]["error"] or "")
    assert rstore.get_run(run_id)["status"] == "errored"


def test_landing_page_run_404_when_template_flag_off(client, po_env, monkeypatch):
    """26. Requesting the landing_page template while ITS flag is off (even
    though the orchestrator is on) is a clean 404 — not a silent fallback
    to a different template."""
    monkeypatch.setenv("ENABLE_LANDING_PAGE_TEMPLATE", "false")
    monkeypatch.setenv("ENABLE_WORKFLOW_RUNNER", "false")
    r = client.post("/v2/orchestrator/run",
                    json={"user_request": "x", "template_id": "landing_page"})
    assert r.status_code == 404
    assert r.json()["metadata"]["code"] == "project_template_unknown"
