# coding: utf-8
"""
Owner orchestration policy tests.

Coverage:

  Composer
    test_composer_noop_for_non_owner
    test_composer_layers_authorisation_and_guardrail_for_owner
    test_composer_includes_safe_cyber_addendum_for_security_request
    test_composer_safety_block_phrase_present_in_owner_prompt

  Capabilities list
    test_orchestration_capabilities_complete
    test_owner_capabilities_extends_with_orchestration

  RunContext threading
    test_run_context_carries_owner_flag
    test_run_event_emits_owner_signal

  Orchestrator route integration
    test_orchestrate_emits_owner_session_payload_for_token
    test_orchestrate_emits_no_owner_session_for_regular_user
    test_orchestrate_injects_authorisation_into_supervisor_prompt
    test_orchestrate_keeps_safety_guardrail_intact_for_owner

  Owner-Agent uses composer
    test_owner_agent_uses_composer_authorisation
"""
from __future__ import annotations

import importlib
import os
from typing import Tuple

import pytest
from fastapi.testclient import TestClient


# ──────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────

_OWNER_TOKEN = "z" * 40  # >16 chars


@pytest.fixture()
def admin_env(tmp_path, monkeypatch):
    """Admin mode + orchestrator on + token unlock available."""
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("ENABLE_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "false")  # quiet logs
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_TOKEN", _OWNER_TOKEN)
    monkeypatch.setenv("ADMIN_AUDIT_DB_PATH", str(tmp_path / "audit.db"))
    from backend.core import config as _cfg
    importlib.reload(_cfg)
    from backend.services.admin import audit as _aud
    _aud._reset_for_tests()
    yield
    importlib.reload(_cfg)
    _aud._reset_for_tests()


def _fresh_app() -> Tuple[TestClient, "object"]:
    """Re-import the app so route table reflects the current env."""
    import sys
    for m in ("backend.api", "backend.main"):
        if m in sys.modules:
            del sys.modules[m]
    from backend.api import app as fresh_app
    return TestClient(fresh_app, raise_server_exceptions=False), fresh_app


# ──────────────────────────────────────────────────────────────────────────
# Composer
# ──────────────────────────────────────────────────────────────────────────

def test_composer_noop_for_non_owner():
    from backend.services.admin.orchestration import compose_system_prompt
    base = "You are a helpful assistant."
    out = compose_system_prompt(base, is_owner=False, user_message="hello")
    assert out == base  # untouched


def test_composer_layers_authorisation_and_guardrail_for_owner():
    from backend.services.admin.orchestration import compose_system_prompt
    base = "You are the supervisor."
    out = compose_system_prompt(
        base, is_owner=True,
        user_message="please refactor my login component",
    )
    # Base prompt is at the top, owner authorisation block in the
    # middle, safety footer at the bottom.
    assert "You are the supervisor." in out
    assert "OWNER SESSION ACTIVE" in out
    assert "OWNER SESSION SAFETY (NON-NEGOTIABLE)" in out
    assert out.index("OWNER SESSION ACTIVE") < out.index("OWNER SESSION SAFETY")
    # The authorisation MUST mention the specific dev capabilities the
    # owner asked for in the requirement spec.
    for phrase in (
        "frontend components",
        "Refactoring the frontend architecture",
        "Creating new pages",
        "Modifying project structure",
        "internal orchestration tools",
        "Autonomous execution",
    ):
        assert phrase in out, f"missing authorisation phrase: {phrase!r}"


def test_composer_includes_safe_cyber_addendum_for_security_request():
    from backend.services.admin.orchestration import compose_system_prompt
    out = compose_system_prompt(
        "Base.", is_owner=True,
        user_message="run a code audit and harden our auth flow",
    )
    # safe_cyber_addendum text comes from safety.py
    assert "SECURITY WORK" in out


def test_composer_safety_block_phrase_present_in_owner_prompt():
    """The whole point of owner-orchestration is dev-time unlock —
    NOT a relaxation of safety. The composed prompt MUST still tell
    the model to refuse malware / credential theft / etc."""
    from backend.services.admin.orchestration import compose_system_prompt
    out = compose_system_prompt("Base.", is_owner=True)
    for must in (
        "malware", "ransomware", "credential theft",
        "exploit", "DDoS", "Illegal intrusion",
    ):
        assert must.lower() in out.lower(), f"safety phrase missing: {must!r}"


# ──────────────────────────────────────────────────────────────────────────
# Capabilities list
# ──────────────────────────────────────────────────────────────────────────

def test_orchestration_capabilities_complete():
    from backend.services.admin.orchestration import orchestration_capabilities
    caps = set(orchestration_capabilities())
    expected = {
        "frontend_modification",
        "ui_layout_styles",
        "frontend_refactor",
        "page_component_crud",
        "project_structure_changes",
        "internal_orchestration_tools",
        "autonomous_architectural_edits",
        "reduced_confirmation_friction",
    }
    assert expected.issubset(caps)


def test_owner_capabilities_extends_with_orchestration(admin_env):
    """`/v2/admin/status` data.capabilities must include both the
    classic admin caps AND the new orchestration caps so the FE
    shows a single complete list."""
    from backend.services.admin.owner import owner_capabilities
    from backend.services.auth.identity import User
    guest = User(id="g", kind="guest", external_id="guest:g")
    caps = owner_capabilities(guest, owner_token=_OWNER_TOKEN)
    assert caps["is_owner"] is True
    cap_set = set(caps["capabilities"])
    assert "owner_agent" in cap_set                      # classic
    assert "frontend_modification" in cap_set            # new
    assert "autonomous_architectural_edits" in cap_set


# ──────────────────────────────────────────────────────────────────────────
# RunContext threading
# ──────────────────────────────────────────────────────────────────────────

def test_run_context_carries_owner_flag(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "false")
    from backend.services.agent.run_context import start_run, get_current_run
    with start_run(
        user_id="u", is_owner=True, owner_source="token",
    ) as ctx:
        assert ctx.is_owner is True
        assert ctx.owner_source == "token"
        live = get_current_run()
        assert live is not None and live.is_owner is True


def test_run_event_emits_owner_signal(monkeypatch):
    """The run.started event payload must carry is_owner so the FE
    activity feed can render the Owner Session Active chip."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "false")
    captured = []
    # Capture by monkeypatching the events.emit shim before start_run runs.
    import backend.services.events as events_mod
    monkeypatch.setattr(events_mod, "emit", lambda *a, **kw: captured.append((a, kw)))
    from backend.services.agent.run_context import start_run
    with start_run(user_id="u", is_owner=True, owner_source="identity"):
        pass
    # The first emit() should be run.started with is_owner=True in payload.
    assert captured, "no events emitted"
    started = [c for c in captured if c[0] and c[0][0] == "run.started"]
    assert started, "no run.started event captured"
    payload = started[0][1].get("payload", {})
    assert payload.get("is_owner") is True
    assert payload.get("owner_source") == "identity"


# ──────────────────────────────────────────────────────────────────────────
# Orchestrator route integration
# ──────────────────────────────────────────────────────────────────────────

def test_orchestrate_emits_owner_session_payload_for_token(admin_env, monkeypatch):
    """End-to-end: POST /v2/orchestrate with X-Korvix-Owner-Token must
    come back with metadata.owner_session.is_owner=true."""
    # Stub run_agent so we don't need an OpenAI key. The orchestrator
    # route imports run_agent at module level then re-exports it as
    # backend.routes.v2_orchestrate.run_agent.
    async def _fake_run_agent(req):
        from backend.services.agent.types import AgentResponse
        return AgentResponse(
            reply="ok", mode="supervisor", model="test-model", provider="test",
            trace=[], steps_used=1, tool_calls=0,
            elapsed_ms=1, partial=False, fallback=False,
        )
    import backend.routes.v2_orchestrate as vo
    monkeypatch.setattr(vo, "run_agent", _fake_run_agent)

    client, app = _fresh_app()
    # Re-stub after the fresh import (the new module is a different
    # object than the one we just monkeypatched).
    import backend.routes.v2_orchestrate as vo2
    monkeypatch.setattr(vo2, "run_agent", _fake_run_agent)

    r = client.post(
        "/v2/orchestrate",
        headers={"X-Korvix-Owner-Token": _OWNER_TOKEN},
        json={"user_id": "u1", "message": "make the login button purple"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    owner_session = (body.get("metadata") or {}).get("owner_session") or {}
    assert owner_session.get("is_owner") is True
    assert owner_session.get("source") == "token"
    assert "frontend_modification" in owner_session.get("capabilities", [])


def test_orchestrate_emits_no_owner_session_for_regular_user(admin_env, monkeypatch):
    async def _fake_run_agent(req):
        from backend.services.agent.types import AgentResponse
        return AgentResponse(
            reply="ok", mode="supervisor", model="test-model", provider="test",
            trace=[], steps_used=1, tool_calls=0,
            elapsed_ms=1, partial=False, fallback=False,
        )
    client, app = _fresh_app()
    import backend.routes.v2_orchestrate as vo2
    monkeypatch.setattr(vo2, "run_agent", _fake_run_agent)

    r = client.post(
        "/v2/orchestrate",
        json={"user_id": "u1", "message": "hi"},
    )
    assert r.status_code == 200, r.text
    owner_session = (r.json().get("metadata") or {}).get("owner_session") or {}
    assert owner_session.get("is_owner") is False
    assert owner_session.get("capabilities") == []


def test_orchestrate_injects_authorisation_into_supervisor_prompt(admin_env, monkeypatch):
    """Verify the assembled system prompt the supervisor receives
    contains the OWNER SESSION ACTIVE block."""
    captured = {}

    async def _capturing_run_agent(req):
        captured["system_prompt"] = req.system_prompt
        from backend.services.agent.types import AgentResponse
        return AgentResponse(
            reply="ok", mode="supervisor", model="test-model", provider="test",
            trace=[], steps_used=1, tool_calls=0,
            elapsed_ms=1, partial=False, fallback=False,
        )

    client, app = _fresh_app()
    import backend.routes.v2_orchestrate as vo2
    monkeypatch.setattr(vo2, "run_agent", _capturing_run_agent)

    r = client.post(
        "/v2/orchestrate",
        headers={"X-Korvix-Owner-Token": _OWNER_TOKEN},
        json={"user_id": "u1", "message": "refactor the auth flow"},
    )
    assert r.status_code == 200, r.text
    prompt = captured.get("system_prompt", "")
    assert "OWNER SESSION ACTIVE" in prompt
    assert "OWNER SESSION SAFETY (NON-NEGOTIABLE)" in prompt
    # And the supervisor's actual content is still at the top
    assert "Supervisor" in prompt or "supervisor" in prompt.lower()


def test_orchestrate_keeps_safety_guardrail_intact_for_owner(admin_env, monkeypatch):
    """Even when the request comes from the owner, the assembled
    prompt must still tell the model to refuse malware authoring.
    Owner mode unlocks dev-time work, NOT cyber abuse."""
    captured = {}

    async def _capturing_run_agent(req):
        captured["system_prompt"] = req.system_prompt
        from backend.services.agent.types import AgentResponse
        return AgentResponse(
            reply="ok", mode="supervisor", model="test-model", provider="test",
            trace=[], steps_used=1, tool_calls=0,
            elapsed_ms=1, partial=False, fallback=False,
        )

    client, app = _fresh_app()
    import backend.routes.v2_orchestrate as vo2
    monkeypatch.setattr(vo2, "run_agent", _capturing_run_agent)

    r = client.post(
        "/v2/orchestrate",
        headers={"X-Korvix-Owner-Token": _OWNER_TOKEN},
        json={"user_id": "u1", "message": "redesign the homepage hero"},
    )
    assert r.status_code == 200, r.text
    prompt = captured.get("system_prompt", "").lower()
    # Safety guardrails MUST be present alongside the unlock.
    for must in ("malware", "credential theft", "exploit"):
        assert must in prompt, f"safety phrase missing for owner: {must!r}"


# ──────────────────────────────────────────────────────────────────────────
# Owner-Agent uses composer
# ──────────────────────────────────────────────────────────────────────────

def test_owner_agent_uses_composer_authorisation(admin_env, monkeypatch):
    """The standalone /v2/admin/owner-agent endpoint must build its
    system prompt through the unified composer so the owner gets the
    same posture as on /v2/orchestrate."""
    import asyncio
    from backend.services.admin import owner_agent, safety

    # Capture the prompt the AI client receives by monkeypatching
    # ask_ai. The owner_agent imports it locally inside run().
    captured_prompts = []

    async def _fake_ask_ai(message, system_prompt, history, model=None):
        captured_prompts.append(system_prompt)
        return "ok"

    # ai_client is imported lazily inside owner_agent.run(); rather
    # than installing in sys.modules, monkeypatch the importable
    # symbol directly.
    import sys
    fake_module = type(sys)("ai_client")
    fake_module.ask_ai = _fake_ask_ai
    monkeypatch.setitem(sys.modules, "ai_client", fake_module)

    resp = asyncio.run(owner_agent.run(owner_agent.OwnerAgentRequest(
        message="refactor the button component to use the new design tokens",
        capability="refactoring",
    )))
    assert resp.blocked is False
    assert captured_prompts, "ask_ai never invoked"
    assembled = captured_prompts[0]
    # The composer's authorisation block must be present.
    assert "OWNER SESSION ACTIVE" in assembled
    # And the safety footer must follow.
    assert "OWNER SESSION SAFETY (NON-NEGOTIABLE)" in assembled
    # And the capability-specific role line must still be there.
    assert "refactor" in assembled.lower()
