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
          user_msg="please add a pricing page", assistant_msg=None, mode="chat",
          attach=True):
    ws = env["sessions"].ensure_default_workspace(owner)
    th = env["sessions"].create_thread(workspace_id=ws.id, title=title, mode=mode)
    if user_msg:
        env["sessions"].append_message(thread_id=th.id, role="user", content=user_msg)
    if assistant_msg:
        env["sessions"].append_message(thread_id=th.id, role="assistant", content=assistant_msg)
    if attach:
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
    assert ch["mode"] == "chat"
    assert "pricing page" in ch["last_message"]
    assert b.counts["linked_chats"] == 1


def test_chats_render_into_context_block(brain):
    p = _owned_project(brain)
    _chat(brain, p.id, title="Pricing question")
    block = brain["brain"].build_context("uA", p.id)
    assert "Project chat excerpts" in block.text
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


# ── Phase 1: bounded project-CHAT CONTENT reaches the brain (A–H) ─────────────

def _thread_content_lines(brain_obj) -> str:
    """Flatten the recent-turn content of all linked chats for assertions."""
    out = []
    for ch in brain_obj.linked_chats:
        for turn in (ch.get("recent") or []):
            out.append(f'{turn["role"]}: {turn["content"]}')
    return "\n".join(out)


def test_A_brain_receives_content_from_bound_chat(brain):
    p = _owned_project(brain)
    _chat(brain, p.id, title="Reqs", user_msg="we need dark mode and Stripe",
          assistant_msg="Got it — dark mode + Stripe checkout.")
    b = brain["brain"].get("uA", p.id)
    recent = b.linked_chats[0]["recent"]
    assert [t["role"] for t in recent] == ["user", "assistant"]
    assert "dark mode and Stripe" in recent[0]["content"]
    assert "Stripe checkout" in recent[1]["content"]
    # H — the bounded evidence is rendered into the injectable context block.
    block = brain["brain"].build_context("uA", p.id)
    assert "Project chat excerpts" in block.text
    assert "user: we need dark mode and Stripe" in block.text
    assert "assistant: Got it" in block.text


def test_B_unbound_chat_is_not_received(brain):
    p = _owned_project(brain)
    # A chat the user owns but NEVER attached to the project.
    _chat(brain, p.id, title="Unrelated", user_msg="secret unbound note", attach=False)
    b = brain["brain"].get("uA", p.id)
    assert b.linked_chats == []
    assert "secret unbound note" not in _thread_content_lines(b)


def test_C_removed_chat_content_disappears(brain):
    p = _owned_project(brain)
    th = _chat(brain, p.id, title="Temp", user_msg="ephemeral requirement X")
    assert "ephemeral requirement X" in _thread_content_lines(brain["brain"].get("uA", p.id))
    # Unbind via the canonical authority → recomputed brain no longer sees it.
    brain["projects"].detach_thread(p.id, th.id)
    after = brain["brain"].get("uA", p.id)
    assert after.linked_chats == []
    assert "ephemeral requirement X" not in _thread_content_lines(after)


def test_D_moved_chat_content_moves_with_binding(brain):
    a = _owned_project(brain, name="Project A")
    b = _owned_project(brain, name="Project B")
    th = _chat(brain, a.id, title="Shared", user_msg="move me between projects")
    assert "move me between projects" in _thread_content_lines(brain["brain"].get("uA", a.id))
    # Move A → B (single binding).
    brain["projects"].detach_thread(a.id, th.id)
    brain["projects"].attach_thread(b.id, th.id)
    assert "move me between projects" not in _thread_content_lines(brain["brain"].get("uA", a.id))
    assert "move me between projects" in _thread_content_lines(brain["brain"].get("uA", b.id))


def test_E_cross_user_cannot_read_chat_content(brain):
    p = _owned_project(brain, owner="uA")
    _chat(brain, p.id, owner="uA", title="Private", user_msg="confidential plan")
    other = brain["brain"].get("uB", p.id)   # different user, same project id
    assert other.linked_chats == []
    assert "confidential plan" not in _thread_content_lines(other)


def test_F_long_history_is_bounded_deterministically(brain):
    from backend.services.project_brain.client import _MAX_CHAT_TURNS, _MAX_CHAT_TURN_CHARS
    p = _owned_project(brain)
    ws = brain["sessions"].ensure_default_workspace("uA")
    th = brain["sessions"].create_thread(workspace_id=ws.id, title="Long", mode="chat")
    for i in range(40):
        brain["sessions"].append_message(thread_id=th.id, role="user", content=f"msg {i}")
    brain["projects"].attach_thread(p.id, th.id)

    b = brain["brain"].get("uA", p.id)
    recent = b.linked_chats[0]["recent"]
    assert len(recent) <= _MAX_CHAT_TURNS          # bounded turn count
    # It is the RECENT tail, not the oldest window.
    assert recent[-1]["content"] == "msg 39"
    # Per-turn content is also bounded.
    assert all(len(t["content"]) <= _MAX_CHAT_TURN_CHARS for t in recent)


def test_G_build_tool_chats_are_not_dumped(brain):
    p = _owned_project(brain)
    # A build session bound to the project — its payload/transcript must NOT be
    # dumped as chat content (products represent it instead).
    _chat(brain, p.id, title="Build session", mode="web_build",
          user_msg="GIANT BUILD PAYLOAD should not leak")
    b = brain["brain"].get("uA", p.id)
    # It may be listed, but carries NO extracted content.
    for ch in b.linked_chats:
        assert ch.get("recent") == []
    assert "GIANT BUILD PAYLOAD" not in _thread_content_lines(b)
    assert "GIANT BUILD PAYLOAD" not in (brain["brain"].build_context("uA", p.id) or
                                         type("x", (), {"text": ""})()).text


# ── Phase 3: the LIVE chat context seam folds the brain chat evidence ─────────

def test_live_context_seam_folds_project_chat_evidence(brain, monkeypatch):
    # `projects.context.build_project_context_block` is the block chat.py injects
    # into the LIVE system prompt (via a ContextVar ask_ai reads). It must now
    # carry the bounded project-chat evidence for the owner — and nothing for a
    # different user (ownership enforced inside the brain).
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    from backend.services.projects import context as pctx
    p = _owned_project(brain)
    _chat(brain, p.id, title="Reqs", user_msg="must support SSO login",
          assistant_msg="Understood: add SSO.")

    block = pctx.build_project_context_block(p.id, user_id="uA")
    assert block is not None
    assert "Project chat excerpts" in block
    assert "must support SSO login" in block          # actual chat content reaches the live seam

    # Cross-user: the same seam yields no A content for user B.
    block_b = pctx.build_project_context_block(p.id, user_id="uB")
    assert not block_b or "must support SSO login" not in block_b

    # Bounded: the whole injected block respects the hard cap.
    assert len(block) <= pctx._MAX_CONTEXT_CHARS
