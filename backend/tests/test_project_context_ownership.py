# coding: utf-8
"""Adversarial ownership tests for the LIVE project-context injection seam.

Bugbot found (and this proves the fix for) an IDOR: the live Project Brain
injection in chat.py passed the CLIENT-SUPPLIED `req.user_id` as the ownership
identity. A logged-in attacker could send body user_id=<victim> +
project_id=<victim's project> and have the victim's project/chat context folded
into the attacker's system prompt.

The fix: chat.py passes the BACKEND-AUTHORITATIVE resolved uid
(`_resolve_authoritative_uid`), and `build_project_context_block` owner-gates the
whole block. These tests reproduce chat.py's exact composition —
    resolved = resolve_authoritative_uid(request, body_user_id)
    block    = build_project_context_block(project_id, user_id=resolved)
— and assert no cross-user leakage.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    monkeypatch.setenv("ENABLE_SESSIONS", "true")

    from backend.services.projects import store as projects_store
    from backend.services.sessions import store as sessions_store
    monkeypatch.setattr(projects_store, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    sessions_store.init()

    from backend.services.projects import context as pctx
    from backend.services.sessions import client as sc
    from backend.core.deps import resolve_authoritative_uid
    return SimpleNamespace(projects=projects_store, sessions=sc, pctx=pctx,
                           resolve=resolve_authoritative_uid)


def _authed_request(user_id: str):
    """A request whose backend-authoritative identity (AuthMiddleware state) is
    `user_id` — resolve_uid_and_source returns it immediately, ignoring the body."""
    return SimpleNamespace(state=SimpleNamespace(user_id=user_id))


def _project_with_chat(env, *, owner, name, user_msg):
    p = env.projects.create_project(owner, name=name, description=f"{name} description")
    ws = env.sessions.ensure_default_workspace(owner)
    th = env.sessions.create_thread(workspace_id=ws.id, title=f"{name} chat", mode="chat")
    env.sessions.append_message(thread_id=th.id, role="user", content=user_msg)
    env.projects.attach_thread(p.id, th.id)
    return p


def _live_block(env, request, body_user_id, project_id):
    """Exactly what chat.py composes at the security boundary."""
    resolved = env.resolve(request, body_user_id, log_prefix="TEST")
    return env.pctx.build_project_context_block(project_id, user_id=str(resolved) if resolved else None), resolved


# ── Core auth property: body identity is ignored ─────────────────────────────

def test_resolved_identity_ignores_spoofed_body(env):
    resolved = env.resolve(_authed_request("A"), "B", log_prefix="TEST")
    assert resolved == "A"   # authenticated A wins; body "B" is not trusted


# ── A. spoofed body user_id=B + B's project → B context NOT injected ─────────

def test_A_spoofed_body_does_not_inject_victim_context(env):
    b_proj = _project_with_chat(env, owner="B", name="Victim", user_msg="B secret requirement")
    # Attacker A, body claims user_id=B, targets B's project.
    block, resolved = _live_block(env, _authed_request("A"), "B", b_proj.id)
    assert resolved == "A"
    assert block is None                      # nothing injected for a non-owned project
    assert "B secret requirement" not in (block or "")
    assert "Victim" not in (block or "")


# ── B. authenticated A, body user_id=A, own project → context works ──────────

def test_B_own_identity_injects_own_context(env):
    a_proj = _project_with_chat(env, owner="A", name="Mine", user_msg="A wants dark mode")
    block, resolved = _live_block(env, _authed_request("A"), "A", a_proj.id)
    assert resolved == "A"
    assert block is not None
    assert "A wants dark mode" in block       # D: legit chat context reaches the live seam
    assert "Project chat excerpts" in block


# ── C. A references B's project (no spoof) → no B brain/chat excerpts ─────────

def test_C_referencing_foreign_project_yields_no_victim_excerpts(env):
    b_proj = _project_with_chat(env, owner="B", name="Victim", user_msg="B private plan")
    # Even with body user_id="" (honest), the resolved A must not read B's project.
    block, resolved = _live_block(env, _authed_request("A"), "", b_proj.id)
    assert resolved == "A"
    assert block is None
    assert "B private plan" not in (block or "")


# ── D. legitimate project chat context reaches the live seam (explicit) ──────

def test_D_legitimate_context_reaches_live_seam(env):
    a_proj = _project_with_chat(env, owner="A", name="Mine", user_msg="ship SSO next")
    block, _ = _live_block(env, _authed_request("A"), "A", a_proj.id)
    assert block is not None
    assert "ship SSO next" in block
    # And it stays bounded.
    assert len(block) <= env.pctx._MAX_CONTEXT_CHARS


# ── Direct owner-gate on the context builder (defense-in-depth) ──────────────

def test_context_builder_owner_gate_blocks_non_owner(env):
    b_proj = _project_with_chat(env, owner="B", name="Victim", user_msg="nope")
    # Wrong identity → None; correct identity → content.
    assert env.pctx.build_project_context_block(b_proj.id, user_id="A") is None
    assert env.pctx.build_project_context_block(b_proj.id, user_id="B") is not None
