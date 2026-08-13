# coding: utf-8
"""Phase 2 — task-scoped upstream context projection.

Pins the guarantees of build_upstream_context: downstream tasks receive
their direct dependencies' real outputs, bounded and provenance-tagged,
with no cross-task / cross-project contamination and no fabricated results
for failed dependencies.
"""
from __future__ import annotations

import importlib

import pytest

from backend.services.orchestrator.context_projection import (
    build_upstream_context,
    TOTAL_CHAR_BUDGET,
)


def _deliverable(node_id, *, status="completed", text="", kind="markdown",
                 did=None, title=None, content=None):
    return {
        "id": did or f"d_{node_id}",
        "node_id": node_id,
        "status": status,
        "kind": kind,
        "title": title or node_id,
        "content": content if content is not None else {"text": text},
    }


def test_A_downstream_receives_upstream_result():
    """Research → Product: the Product task receives the research finding."""
    deliverables = [
        _deliverable("research", text="Target customer: independent restaurants"),
    ]
    block = build_upstream_context("run1", ["research"], deliverables=deliverables)
    assert "Target customer: independent restaurants" in block
    assert "UPSTREAM RESULT" in block
    assert "node=research" in block


def test_B_unrelated_history_not_injected():
    """A completed deliverable from a node that is NOT a declared
    dependency must never appear."""
    deliverables = [
        _deliverable("research", text="relevant finding"),
        _deliverable("some_old_unrelated_node", text="LEAKED HISTORY"),
    ]
    block = build_upstream_context("run1", ["research"], deliverables=deliverables)
    assert "relevant finding" in block
    assert "LEAKED HISTORY" not in block


def test_C_two_dependencies_both_projected_and_bounded():
    deliverables = [
        _deliverable("research", text="market: SMB restaurants"),
        _deliverable("brand", text="brand: warm, trustworthy, local"),
    ]
    block = build_upstream_context("run1", ["research", "brand"], deliverables=deliverables)
    assert "market: SMB restaurants" in block
    assert "brand: warm, trustworthy, local" in block
    assert block.count("[UPSTREAM RESULT]") == 2
    assert len(block) <= TOTAL_CHAR_BUDGET


def test_D_huge_deliverable_referenced_not_inlined():
    huge = "<div>" + ("x" * 50_000) + "</div>"
    deliverables = [
        _deliverable("page", kind="html", did="deliv_page_123",
                     content={"text": huge, "artifact": {"type": "html"}}),
    ]
    block = build_upstream_context("run1", ["page"], deliverables=deliverables)
    # The whole 50k blob must NOT be inlined; it is referenced + excerpted.
    assert len(block) <= TOTAL_CHAR_BUDGET
    assert "deliv_page_123" in block            # artifact reference present
    assert "referenced, not inlined" in block
    assert huge not in block


def test_E_failed_dependency_yields_no_fake_result():
    deliverables = [
        _deliverable("research", status="failed", text="should not appear"),
    ]
    block = build_upstream_context("run1", ["research"], deliverables=deliverables)
    assert block == ""


def test_E2_pending_and_skipped_excluded():
    deliverables = [
        _deliverable("a", status="pending", text="nope"),
        _deliverable("b", status="skipped", text="nope"),
        _deliverable("c", status="completed", text="yes"),
    ]
    block = build_upstream_context("run1", ["a", "b", "c"], deliverables=deliverables)
    assert "yes" in block
    assert "nope" not in block
    assert block.count("[UPSTREAM RESULT]") == 1


def test_no_dependencies_returns_empty():
    assert build_upstream_context("run1", [], deliverables=[]) == ""
    assert build_upstream_context("run1", None, deliverables=[]) == ""


def test_dependency_count_capped():
    deps = [f"n{i}" for i in range(10)]
    deliverables = [_deliverable(f"n{i}", text=f"finding {i}") for i in range(10)]
    block = build_upstream_context("run1", deps, deliverables=deliverables)
    # Capped at MAX_DEPENDENCIES (4).
    assert block.count("[UPSTREAM RESULT]") <= 4


def test_F_cross_project_isolation_via_store(tmp_path, monkeypatch):
    """End-to-end through the real store: two runs (two projects) each have
    a 'research' deliverable. Projecting for run A must only ever see run
    A's deliverables — scoping by run_id makes cross-project leakage
    structurally impossible."""
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import deliverables_store as dstore
    importlib.reload(dstore)
    dstore.init_deliverables_table()

    # Project A / run A
    da = dstore.create_deliverable(
        run_id="runA", agent_id="researcher", node_id="research",
        kind="markdown", project_id="projA",
    )
    dstore.set_content(da, {"text": "PROJECT A SECRET: restaurants"}, status="completed")
    # Project B / run B
    db = dstore.create_deliverable(
        run_id="runB", agent_id="researcher", node_id="research",
        kind="markdown", project_id="projB",
    )
    dstore.set_content(db, {"text": "PROJECT B SECRET: dentists"}, status="completed")

    block_a = build_upstream_context("runA", ["research"])
    assert "PROJECT A SECRET: restaurants" in block_a
    assert "PROJECT B SECRET" not in block_a

    block_b = build_upstream_context("runB", ["research"])
    assert "PROJECT B SECRET: dentists" in block_b
    assert "PROJECT A SECRET" not in block_b


@pytest.mark.asyncio
async def test_agent_run_handler_injects_upstream_context(tmp_path, monkeypatch):
    """End-to-end: the agent.run handler resolves its declared upstream
    deliverables and injects them into the agent's user_message. This is
    the Phase 2 exit gate — a downstream task genuinely builds on upstream
    output."""
    from types import SimpleNamespace

    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import deliverables_store as dstore
    importlib.reload(dstore)
    dstore.init_deliverables_table()

    # An upstream 'research' deliverable, completed, in run "runX".
    d = dstore.create_deliverable(
        run_id="runX", agent_id="researcher", node_id="research",
        kind="markdown", project_id="projX",
    )
    dstore.set_content(
        d, {"text": "Target customer: independent restaurants"},
        status="completed",
    )

    from backend.services.orchestrator import agent_run_kind as ark
    from backend.services.jobs.registry import JobContext

    captured: dict = {}

    async def _capture(req):
        captured["user_message"] = req.user_message
        return SimpleNamespace(reply="ok", fallback=False, metadata={})

    monkeypatch.setattr(ark, "run_agent", _capture)

    async def _report(pct, label=None):
        return None

    async def _cancelled():
        return False

    record = SimpleNamespace(
        id="job1",
        user_id="userX",
        payload={
            "assigned_agent_id": "product",
            "task_description": "Define the product",
            "run_id": "runX",
            "node_id": "product",
            "deliverable_id": None,
            "task_id": None,
            "project_id": "projX",
            "depends_on": ["research"],
            "deliverable_kind": "markdown",
            "node_title": "Product",
        },
    )
    ctx = JobContext(record=record, report_progress=_report,
                     is_cancelled=_cancelled)

    await ark._agent_run_handler(ctx)

    assert "user_message" in captured, "run_agent was not invoked"
    assert "Target customer: independent restaurants" in captured["user_message"]
    assert "UPSTREAM RESULT" in captured["user_message"]
