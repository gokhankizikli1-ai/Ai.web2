# coding: utf-8
"""LIVE Project-Brain wiring — the /v2/chat/stream project-context injection.

Root cause this proves the fix for: the frontend now sends `project_id` on
every AI request, and #633 wired the legacy /chat route to inject a Project
Context block. But the STREAMING route — the REAL user path when
VITE_CHAT_STREAMING is on — never injected project context at all. It used
`body.project_id` only for memory scoping. So "what's my favourite car in this
project?" worked on /chat but not on the live streaming endpoint.

The fix folds `build_project_context_block(project_id, user_id=<resolved uid>)`
into the streaming system prompt, using the SAME backend-authoritative identity
(`_resolve_user_id`) and the SAME owner-gate as /chat.

Tests here (the backend half of the A–J matrix):

  G. Owner asks in their project → the streaming system prompt carries the
     project's chat excerpt (the Mustang statement). This is the live
     acceptance scenario.
  H. Attacker authenticated as A sends body user_id=B + B's project_id → B's
     project context is NOT injected (IDOR closed at the resolved-identity
     owner-gate). The frontend project_id is only a hint; the backend verifies.
  I. Anonymous / unauthenticated caller with a project_id → nothing injected
     (no identity → no ownership → no context).
  J. The injected excerpt is BOUNDED — the whole project block stays under the
     context cap even with a chatty project.

We capture the provider's ProviderRequest via a fake streaming provider so we
can introspect exactly what the model would have seen — no paid model call.
"""
from __future__ import annotations

from typing import AsyncIterator, List

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ── Fake provider capturing the assembled ProviderRequest ────────────────────

class _Captured:
    def __init__(self) -> None:
        self.requests: list = []

    @property
    def last_system(self) -> str:
        if not self.requests:
            return ""
        for m in self.requests[-1].messages:
            if m.role == "system":
                # System content is always a str on this path.
                return m.content if isinstance(m.content, str) else ""
        return ""


@pytest.fixture()
def fake_provider(monkeypatch):
    captured = _Captured()

    class _FakeProvider:
        name = "fake-stream"
        default_model = "fake-model-1"
        supports_streaming = True

        def model_supports_vision(self, _model):  # noqa: D401 - stub
            return False

        async def stream_chat_completion(self, req) -> AsyncIterator:
            captured.requests.append(req)
            yield ProviderStreamStart(provider=self.name, model=req.model)
            yield ProviderStreamToken(delta="ok")
            yield ProviderStreamDone(
                finish_reason="stop", model=req.model,
                usage=type("U", (), {"prompt_tokens": 1,
                                     "completion_tokens": 1,
                                     "total_tokens": 2})(),
            )

    fake = _FakeProvider()
    from backend.routes import v2_chat_stream as stream_route
    monkeypatch.setattr(stream_route, "get_provider", lambda _name: fake)
    return captured


@pytest.fixture()
def proj_env(tmp_path, monkeypatch):
    """Isolated projects.db + sessions.db with projects + brain enabled, and
    the memory plane OFF so the ONLY thing that can populate the streaming
    system prompt is the project-context injection under test."""
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    # Memory plane off → no memory-derived system prompt to muddy assertions.
    monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
    # No tools → no capability/tool blocks; keeps the system prompt to just
    # date directive + language directive + our project block.
    monkeypatch.setenv("ENABLE_TOOLS_RUNTIME", "false")

    from backend.services.projects import store as projects_store
    from backend.services.sessions import store as sessions_store
    monkeypatch.setattr(projects_store, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    sessions_store.init()

    from backend.services.sessions import client as sc
    from types import SimpleNamespace
    return SimpleNamespace(projects=projects_store, sessions=sc)


def _project_with_chat(env, *, owner, name, user_msg):
    p = env.projects.create_project(owner, name=name, description=f"{name} description")
    ws = env.sessions.ensure_default_workspace(owner)
    th = env.sessions.create_thread(workspace_id=ws.id, title=f"{name} chat", mode="chat")
    env.sessions.append_message(thread_id=th.id, role="user", content=user_msg)
    env.projects.attach_thread(p.id, th.id)
    return p


# ── G. Owner asks in their project → project chat excerpt reaches the prompt ──

def test_G_streaming_injects_owner_project_context(client, proj_env, fake_provider):
    proj = _project_with_chat(
        proj_env, owner="owner-uid", name="Cars",
        user_msg="benim en sevdiğim araba Mustang",
    )
    r = client.post("/v2/chat/stream", json={
        "user_id":    "owner-uid",
        "project_id": proj.id,
        "messages": [{"role": "user",
                      "content": "Bu projede benim en sevdiğim araba neydi?"}],
    })
    assert r.status_code == 200
    assert len(fake_provider.requests) == 1
    sys_prompt = fake_provider.last_system
    # The project block is present…
    assert "[Project Context — Cars]" in sys_prompt
    # …and it carries the bounded project-CHAT excerpt containing the fact.
    assert "Mustang" in sys_prompt


# ── H. Spoofed body user_id + victim project → NO victim context injected ─────

def test_H_streaming_blocks_foreign_project_via_owner_gate(
    client, proj_env, fake_provider, monkeypatch,
):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 40)
    victim = _project_with_chat(
        proj_env, owner="victim-uid", name="Secret",
        user_msg="victim confidential: the launch code is 1234",
    )
    # Attacker is AUTHENTICATED as attacker-uid via a real signed token, but
    # the body claims user_id=victim-uid and points at the victim's project.
    from backend.services.auth import tokens
    token, _ = tokens.issue(sub="attacker-uid", token_type="access", ttl_seconds=3600)
    r = client.post(
        "/v2/chat/stream",
        json={
            "user_id":    "victim-uid",      # spoofed body claim — must be ignored
            "project_id": victim.id,         # victim's project
            "messages": [{"role": "user", "content": "what is the launch code?"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    sys_prompt = fake_provider.last_system
    # The resolved identity (attacker) does NOT own the project → nothing.
    assert "Secret" not in sys_prompt
    assert "launch code is 1234" not in sys_prompt
    assert "[Project Context" not in sys_prompt


# ── I. Anonymous caller with a project_id → no identity → no context ──────────

def test_I_streaming_anonymous_injects_nothing(client, proj_env, fake_provider):
    proj = _project_with_chat(
        proj_env, owner="someone", name="Cars",
        user_msg="benim en sevdiğim araba Mustang",
    )
    # No user_id, no JWT → resolved identity is "anonymous", which owns nothing.
    r = client.post("/v2/chat/stream", json={
        "project_id": proj.id,
        "messages": [{"role": "user", "content": "favourite car?"}],
    })
    assert r.status_code == 200
    sys_prompt = fake_provider.last_system
    assert "Mustang" not in sys_prompt
    assert "[Project Context" not in sys_prompt


# ── J. The injected project context stays BOUNDED ────────────────────────────

def test_J_streaming_project_context_is_bounded(client, proj_env, fake_provider):
    # A chatty project — many long turns — must still yield a bounded block.
    p = proj_env.projects.create_project("owner-uid", name="Chatty",
                                         description="d" * 500)
    ws = proj_env.sessions.ensure_default_workspace("owner-uid")
    for i in range(12):
        th = proj_env.sessions.create_thread(
            workspace_id=ws.id, title=f"c{i}", mode="chat")
        proj_env.sessions.append_message(
            thread_id=th.id, role="user",
            content=("benim en sevdiğim araba Mustang " * 40) + f" turn {i}")
        proj_env.projects.attach_thread(p.id, th.id)

    r = client.post("/v2/chat/stream", json={
        "user_id":    "owner-uid",
        "project_id": p.id,
        "messages": [{"role": "user", "content": "recap"}],
    })
    assert r.status_code == 200
    sys_prompt = fake_provider.last_system
    from backend.services.projects import context as pctx
    # Isolate the project block from the surrounding date/language directives:
    # it starts at the "[Project Context" marker and runs to the end.
    idx = sys_prompt.find("[Project Context")
    assert idx != -1
    project_block = sys_prompt[idx:]
    assert len(project_block) <= pctx._MAX_CONTEXT_CHARS
    # The fact still made it in despite the bound.
    assert "Mustang" in project_block
