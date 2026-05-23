# coding: utf-8
"""Phase 3.6 — specialist behaviour + orchestrator routing tests.

Locks in the behavioural contract Phase 3.6 promises:
  - Supervisor's system prompt encourages "show your work" structured
    output (Plan / Specialist sections / Recommendation).
  - The Coder spec is explicitly anti-Wix and produces structured
    architecture+code output.
  - Role-template defaults exist for every AGENT_ROLES id used by the
    frontend, including the 'custom' fallback.
  - spec_from_project_agent uses a role template when the stored
    system_prompt is empty (the "Frontend Agent suggests Wix" fix).
  - All role-template prompts forbid no-code-builder recommendations.
  - /v2/orchestrate augments the supervisor's system prompt with
    "PROJECT AGENTS AVAILABLE" when project_id is set and the project
    has user-created agents.
  - normal /chat (no project_id, no spec) is unaffected.
"""
import importlib
import json
import os
import sys
import tempfile

import pytest


# ══════════════════════════════════════════════════════════════════════
# Role templates exist + forbid no-code answers

def test_role_templates_exist_for_every_frontend_role():
    """Every AGENT_ROLES id used by src/stores/projectStore.ts must
    have a backend template. Adding a new frontend role without a
    backend template would silently regress to the 'custom' fallback."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS

    # These MUST match AGENT_ROLES[].id in src/stores/projectStore.ts
    required = {
        "frontend", "backend", "research", "startup",
        "ecommerce", "trading", "design", "custom",
    }
    assert required.issubset(set(ROLE_SYSTEM_PROMPTS.keys())), (
        f"missing role templates: {required - set(ROLE_SYSTEM_PROMPTS.keys())}"
    )


def test_every_role_template_is_non_trivial():
    """Each template must be substantive — at minimum mention an
    output format or strict rule. Otherwise the agent regresses to
    generic-LLM behaviour."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    for role, prompt in ROLE_SYSTEM_PROMPTS.items():
        assert len(prompt) >= 300, f"{role} template too short"
        # Each must structure its output
        assert "##" in prompt or "OUTPUT FORMAT" in prompt, (
            f"{role} template lacks structured output instructions"
        )


def test_frontend_and_backend_templates_forbid_nocode():
    """The central regression Phase 3.6 fixes: a Frontend Agent must
    NEVER recommend Wix / WordPress / Squarespace etc. The system
    prompt is the only barrier — if this assertion fails, the agent's
    behaviour can quietly drift back to generic."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS

    forbidden_in_frontend = ("Wix", "WordPress", "Squarespace", "Webflow")
    fe = ROLE_SYSTEM_PROMPTS["frontend"]
    # The forbidden words appear in the prompt as the EXAMPLES OF WHAT
    # NOT TO RECOMMEND. The prompt must explicitly call them out so the
    # LLM has an unambiguous instruction.
    for word in forbidden_in_frontend:
        assert word in fe, f"frontend template must mention {word!r} as a forbidden recommendation"
    # It must also explicitly say NEVER
    assert "NEVER" in fe

    # Same for backend's BaaS guidance
    be = ROLE_SYSTEM_PROMPTS["backend"]
    assert "NEVER" in be


def test_default_system_prompt_for_role_handles_aliases():
    from backend.services.agent.specs.role_templates import default_system_prompt_for_role
    # Canonical id
    a = default_system_prompt_for_role("frontend")
    # Display label
    b = default_system_prompt_for_role("Frontend Engineer")
    # Casing variant
    c = default_system_prompt_for_role("front-end engineer")
    assert a == b == c
    assert "NEVER" in a


def test_default_system_prompt_falls_back_to_custom():
    from backend.services.agent.specs.role_templates import (
        default_system_prompt_for_role, ROLE_SYSTEM_PROMPTS,
    )
    out = default_system_prompt_for_role("totally-unknown-role")
    assert out == ROLE_SYSTEM_PROMPTS["custom"]


# ══════════════════════════════════════════════════════════════════════
# Supervisor spec — structured "show your work" output

def test_supervisor_prompt_requires_structured_output():
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    assert sv is not None
    p = sv.system_prompt
    # Section headers the synthesis MUST emit
    for section in ("## Plan", "## Recommendation"):
        assert section in p, f"supervisor prompt missing required section: {section}"
    # And the supervisor must be told never to recommend outsourcing
    assert "website builder" in p.lower() or "no-code" in p.lower()
    # It must explicitly mention that project agents take priority
    assert "PROJECT AGENTS AVAILABLE" in p or "project agents" in p.lower()


def test_coder_prompt_is_action_oriented():
    """Coder must produce real code, not 'try Wix' or 'it depends'."""
    from backend.services.agent.specs import get_spec
    coder = get_spec("coder")
    assert coder is not None
    p = coder.system_prompt
    # Forbidden recommendations are named so the LLM has unambiguous
    # negative examples.
    for word in ("Wix", "WordPress", "Squarespace", "Webflow", "Bubble"):
        assert word in p, f"coder prompt missing forbidden-builder mention: {word}"
    # Must require structured output
    assert "## Architecture" in p
    assert "## Implementation" in p
    assert "## Next steps" in p


# ══════════════════════════════════════════════════════════════════════
# spec_from_project_agent — role-template fallback

def test_spec_from_project_agent_uses_role_template_when_prompt_empty():
    """The legacy case: an existing project_agents row with an empty
    system_prompt (created by an older frontend) must get a strong
    role-based prompt at spec-build time. Otherwise the agent reverts
    to generic LLM behaviour."""
    from backend.services.agent.specs.types import spec_from_project_agent

    row = {
        "id":            "agent-legacy-1",
        "project_id":    "p-1",
        "name":          "Frontend Agent",
        "role":          "Frontend Engineer",
        "system_prompt": "",     # legacy empty
        "model_hint":    "",
        "metadata":      {},
    }
    spec = spec_from_project_agent(row)
    assert spec.system_prompt   # non-empty
    assert "Frontend Engineer" in spec.system_prompt or "Wix" in spec.system_prompt
    assert "NEVER" in spec.system_prompt


def test_spec_from_project_agent_preserves_explicit_prompt():
    """When the row already has a system_prompt, the template fallback
    must NOT overwrite it. The user-supplied prompt wins."""
    from backend.services.agent.specs.types import spec_from_project_agent

    row = {
        "id":            "agent-custom-1",
        "project_id":    "p-1",
        "name":          "My Agent",
        "role":          "Frontend Engineer",
        "system_prompt": "You are a custom snowflake. Reply only in haiku.",
        "model_hint":    "",
        "metadata":      {},
    }
    spec = spec_from_project_agent(row)
    assert "haiku" in spec.system_prompt


def test_spec_from_project_agent_unknown_role_uses_custom_template():
    """Unknown role + empty prompt → 'custom' template (still strong,
    just not role-specialised)."""
    from backend.services.agent.specs.types import spec_from_project_agent
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS

    spec = spec_from_project_agent({
        "id":            "agent-x",
        "project_id":    "p-1",
        "name":          "Mystery",
        "role":          "Time Traveller",
        "system_prompt": "",
        "model_hint":    "",
        "metadata":      {},
    })
    assert spec.system_prompt == ROLE_SYSTEM_PROMPTS["custom"]


# ══════════════════════════════════════════════════════════════════════
# /v2/orchestrate augments supervisor prompt with project agents

@pytest.fixture
def orchestrate_client(monkeypatch):
    """Spin up a FastAPI app with /v2/orchestrate + /projects wired
    against a temp projects.db. Used by the augmentation tests below."""
    fd, path = tempfile.mkstemp(suffix="-phase36.db")
    os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    for m in (
        "backend.services.projects.store",
        "backend.services.projects.context",
        "backend.services.orchestrator.runs_store",
        "backend.routes.projects",
        "backend.routes.v2_orchestrate",
    ):
        if m in sys.modules:
            importlib.reload(sys.modules[m])

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.services.projects import store as pstore
    from backend.services.orchestrator import init_runs_table
    pstore.init()
    init_runs_table()

    from backend.routes import projects as p_route
    from backend.routes import v2_orchestrate as o_route
    app = FastAPI()
    app.include_router(p_route.router)
    app.include_router(o_route.router)
    yield TestClient(app)
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_supervisor_prompt_augmented_with_project_agents(orchestrate_client, monkeypatch):
    """When the orchestrator is invoked with a project that has
    user-created agents, the supervisor's effective_system_prompt
    must list them under PROJECT AGENTS AVAILABLE. Verified by
    inspecting the AgentRequest the route builds via a stub."""
    from backend.services.projects import store as pstore
    p = pstore.create_project("u-1", name="My SaaS",
                                description="A project for testing")
    a1 = pstore.create_agent(p.id, name="Frontend Agent", role="Frontend Engineer")
    a2 = pstore.create_agent(p.id, name="Backend Agent",  role="Backend Engineer")

    captured = {}
    from backend.services.agent.types import AgentResponse
    async def _stub(req):
        captured["system_prompt"] = req.system_prompt
        captured["spec_id"]       = getattr(req.spec, "id", None) if req.spec else None
        return AgentResponse(reply="stub reply", mode=req.mode, model=req.model)

    from backend.routes import v2_orchestrate
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-1", "message": "What's our stack?", "project_id": p.id,
    })
    assert r.status_code == 200, r.text
    prompt = captured["system_prompt"]
    assert "PROJECT AGENTS AVAILABLE" in prompt
    assert a1.id in prompt
    assert a2.id in prompt
    assert "Frontend Engineer" in prompt
    assert "Backend Engineer" in prompt


def test_supervisor_prompt_not_augmented_without_project_id(orchestrate_client, monkeypatch):
    """When no project_id is sent, the supervisor prompt stays as the
    static built-in — no PROJECT AGENTS AVAILABLE section."""
    captured = {}
    from backend.services.agent.types import AgentResponse
    async def _stub(req):
        captured["system_prompt"] = req.system_prompt
        return AgentResponse(reply="x", mode=req.mode, model=req.model)

    from backend.routes import v2_orchestrate
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-1", "message": "hi",
    })
    assert r.status_code == 200
    # The static prompt still mentions project_agents in general but
    # not the specific augmentation header that's only added at runtime.
    assert "PROJECT AGENTS AVAILABLE (prefer over built-ins" not in captured["system_prompt"]


def test_supervisor_prompt_not_augmented_when_project_has_no_agents(orchestrate_client, monkeypatch):
    """A project with zero user-created agents → no augmentation
    (would be a no-op with a misleading empty list)."""
    from backend.services.projects import store as pstore
    p = pstore.create_project("u-1", name="Empty Project")

    captured = {}
    from backend.services.agent.types import AgentResponse
    async def _stub(req):
        captured["system_prompt"] = req.system_prompt
        return AgentResponse(reply="x", mode=req.mode, model=req.model)

    from backend.routes import v2_orchestrate
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-1", "message": "hi", "project_id": p.id,
    })
    assert r.status_code == 200
    # Phase 4.1: the static Supervisor prompt now mentions the literal
    # phrase "PROJECT AGENTS AVAILABLE" as documentation (telling the
    # LLM what that section means when injected). We check for the
    # v2_orchestrate-injected wrapper specifically, matching the same
    # specificity used in test_supervisor_prompt_not_augmented_without_project_id.
    assert "PROJECT AGENTS AVAILABLE (prefer over built-ins" not in captured["system_prompt"]


# ══════════════════════════════════════════════════════════════════════
# Normal /chat is unchanged

def test_chat_request_without_spec_field_still_works():
    """The Phase 3.4 AgentRequest.spec defaults to None. Phase 3.6
    didn't add new required fields. Verify a minimal AgentRequest
    still constructs cleanly without spec."""
    from backend.services.agent.types import AgentRequest
    req = AgentRequest(user_message="hi", mode="fast", user_id="u-1")
    assert getattr(req, "spec", "MISSING") is None
    assert req.system_prompt == ""


def test_runtime_inspection_no_normal_chat_regression():
    """Source-level check that the legacy /chat path still calls
    tools_for_mode + dispatch_many when no spec is attached. This
    guards against accidental "always use orchestrator" regression
    in the runtime selector."""
    import inspect
    from backend.services.agent import runtime as _rt
    src = inspect.getsource(_rt._run_agent_inner)
    assert "tools_for_mode" in src
    assert "_spec is not None" in src
    # The legacy dispatcher must still be referenced
    assert "dispatch_many" in src
