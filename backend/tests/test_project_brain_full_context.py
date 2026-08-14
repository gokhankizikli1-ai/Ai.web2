# coding: utf-8
"""Project Brain FULL project context (Phase 4 closure).

Before this sprint the Phase 8 ProjectBrain aggregated memories/assets/workflows
and connector observations, but was BLIND to the project's own product state and
conversations: it never read the authoritative goals/decisions stores, the
generated Web/App products (deliverables), or the project's linked chats.

These tests prove the brain now consumes that full project context through the
EXISTING authorities — goals_store, decisions_store, deliverables_store, and the
canonical project↔thread binding + sessions store — while:

  * staying bounded (never the whole history/source tree),
  * carrying build/product REFERENCES only (no duplicated source),
  * and gating every project-scoped authority behind project ownership so one
    user can never surface another user's products/chats/goals/decisions by
    guessing a project_id.

No network, no model calls.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def brain(tmp_path, monkeypatch):
    """A single tmp projects.db shared by every project-scoped authority (that is
    exactly how production co-locates them), plus a tmp sessions.db for chats.
    ENABLE_PROJECT_BRAIN on so the aggregator runs."""
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    monkeypatch.setenv("ENABLE_SESSIONS", "true")

    from backend.services.projects import store as projects_store
    from backend.services.orchestrator import (
        observations_store as obs,
        deliverables_store as dls,
        build_execution_store as bes,
        goals_store, decisions_store,
    )
    from backend.services.sessions import store as sessions_store

    # Point every project-scoped store at the shared tmp projects.db, and the
    # sessions store at the tmp sessions.db.
    for mod in (projects_store, obs, dls, bes, goals_store, decisions_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    obs.init_observations_table()
    dls.init_deliverables_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    sessions_store.init()

    from backend.services.project_brain import client as brain_client
    from backend.services.sessions import client as sessions_client
    return {
        "brain": brain_client, "projects": projects_store, "dls": dls, "bes": bes,
        "goals": goals_store, "decisions": decisions_store, "obs": obs,
        "sessions": sessions_client,
    }


def _owned_project(env, *, owner="uA", name="Fitness App"):
    return env["projects"].create_project(owner, name=name, description="")


def _web_product(env, project_id, *, title="Landing Page", build_type="web",
                 run_id="run-1", status="completed", artifact_ref="artifact://abc"):
    kind = "app_build" if build_type == "app" else "web_build"
    return env["dls"].create_deliverable(
        run_id=run_id, agent_id="builder", node_id="build", kind=kind,
        title=title, project_id=project_id, status=status,
        content={"build_type": build_type, "build_status": status,
                 "artifact_ref": artifact_ref, "build_ref": "build://xyz"},
    )


def _chat(env, project_id, *, owner="uA", title="How do I add pricing?",
          user_msg="please add a pricing page"):
    ws = env["sessions"].ensure_default_workspace(owner)
    th = env["sessions"].create_thread(workspace_id=ws.id, title=title, mode="web_build")
    env["sessions"].append_message(thread_id=th.id, role="user", content=user_msg)
    env["projects"].attach_thread(project_id, th.id)
    return th


# ── Products ─────────────────────────────────────────────────────────────────

def test_brain_surfaces_generated_web_product(brain):
    p = _owned_project(brain)
    _web_product(brain, p.id, title="Landing Page", build_type="web")

    b = brain["brain"].get("uA", p.id)
    assert b is not None
    assert len(b.products) == 1
    prod = b.products[0]
    assert prod["build_type"] == "web"
    assert prod["title"] == "Landing Page"
    assert prod["status"] == "completed"
    # A REFERENCE, not the source tree.
    assert prod["artifact_ref"] == "artifact://abc"
    assert b.counts["products"] == 1


def test_brain_preserves_app_build_provenance(brain):
    p = _owned_project(brain, name="Mobile App")
    _web_product(brain, p.id, title="iOS Shell", build_type="app")

    b = brain["brain"].get("uA", p.id)
    assert b.products[0]["build_type"] == "app"
    assert b.products[0]["title"] == "iOS Shell"


def test_products_render_into_context_block(brain):
    p = _owned_project(brain)
    _web_product(brain, p.id, title="Landing Page", build_type="web")
    block = brain["brain"].build_context("uA", p.id)
    assert block is not None
    assert "Generated products" in block.text
    assert "Landing Page" in block.text
    assert block.metadata.get("products") == 1


# ── Chats ────────────────────────────────────────────────────────────────────

def test_brain_surfaces_project_linked_chats(brain):
    p = _owned_project(brain)
    _chat(brain, p.id, title="Pricing question", user_msg="please add a pricing page")

    b = brain["brain"].get("uA", p.id)
    assert len(b.linked_chats) == 1
    ch = b.linked_chats[0]
    assert ch["title"] == "Pricing question"
    assert ch["mode"] == "web_build"
    assert "pricing page" in ch["last_message"]
    assert b.counts["linked_chats"] == 1


def test_chats_render_into_context_block(brain):
    p = _owned_project(brain)
    _chat(brain, p.id, title="Pricing question")
    block = brain["brain"].build_context("uA", p.id)
    assert "Project chats" in block.text
    assert "Pricing question" in block.text


# ── Goals / decisions from the authoritative stores ──────────────────────────

def test_brain_surfaces_structured_goals_and_decisions(brain):
    p = _owned_project(brain)
    brain["goals"].create_goal(project_id=p.id, user_id="uA",
                               title="Reach 100 paying users", status="active")
    brain["decisions"].record_decision(project_id=p.id, user_id="uA", topic="pricing",
                                       value="$19/mo", source="USER")

    b = brain["brain"].get("uA", p.id)
    assert any("100 paying users" in g for g in b.current_goals)
    assert any("pricing" in d and "$19/mo" in d for d in b.recent_decisions)


# ── Ownership isolation (the security property) ──────────────────────────────

def test_non_owner_gets_no_products_or_chats(brain):
    p = _owned_project(brain, owner="uA")
    _web_product(brain, p.id, title="Secret Product", build_type="web")
    _chat(brain, p.id, owner="uA", title="Secret chat")
    brain["goals"].create_goal(project_id=p.id, user_id="uA",
                               title="Secret goal", status="active")

    other = brain["brain"].get("uB", p.id)
    assert other is not None
    # None of user A's project-scoped state leaks to user B.
    assert other.products == []
    assert other.linked_chats == []
    assert all("Secret goal" not in g for g in other.current_goals)


def test_products_bounded(brain):
    p = _owned_project(brain)
    for i in range(12):
        _web_product(brain, p.id, title=f"Product {i}", run_id=f"run-{i}")
    b = brain["brain"].get("uA", p.id)
    assert len(b.products) <= 6


def test_unowned_project_skips_project_scoped_pulls(brain):
    # A project id with NO canonical record (e.g. localStorage-only) must not
    # blow up and must surface no project-scoped data — fail-closed.
    _web_product(brain, "ghost-project", title="Orphan")
    b = brain["brain"].get("uA", "ghost-project")
    assert b is not None
    assert b.products == []
    assert b.linked_chats == []
