# coding: utf-8
"""Phase 4.1 — autonomous orchestration tests.

Locks in:
  - 4 new built-in panel specialists (ux/brand/copy/product) load
  - Supervisor prompt: plan-first via ## Sub-tasks + panel-sizing
    heuristic + new agents in routing rules
  - spawn_specialist tool descriptor present + only on can_delegate=True specs
  - Ephemeral spec construction works + carries persona summary
  - spawn_and_delegate routes through the SAME execution pipeline as
    delegate (budget, depth, parallel, event invariants identical)
  - dispatch_with_orchestration routes both delegate AND
    spawn_specialist tool calls correctly
  - Raised budget defaults (max_parallel=5, total_token_budget=80000)
  - Backwards compat: single-agent solo routing path still works for
    narrow asks (validated via prompt language + non-deleted code paths)
"""
import asyncio
import os

import pytest


# ══════════════════════════════════════════════════════════════════════
# 4 new built-in specs

@pytest.fixture(autouse=True)
def _enable_events(monkeypatch):
    """Most tests need ENABLE_REALTIME_EVENTS to see emission asserts."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")


def test_four_new_panel_specs_load():
    from backend.services.agent.specs import list_specs, BUILTIN_AGENT_IDS
    ids = [s.id for s in list_specs()]
    for new in ("ux_designer", "brand_designer", "copywriter", "product_strategist"):
        assert new in ids, f"Phase 4.1 spec {new} missing from list_specs"
        assert new in BUILTIN_AGENT_IDS
    # Total roster is now 10
    assert len(ids) == 10


def test_each_new_spec_has_strong_role_prompt():
    from backend.services.agent.specs import get_spec
    for sid, contract_keywords in (
        ("ux_designer",        ["## Audience", "## Information hierarchy", "## Microcopy", "## Handoff"]),
        ("brand_designer",     ["## Brand direction", "## Colour system", "## Typography", "## Motion vocabulary", "## Voice"]),
        ("copywriter",         ["## Hero", "## Primary CTA", "## Section copy", "## Microcopy", "## Voice notes"]),
        ("product_strategist", ["## v1 scope", "## Sitemap", "## Activation metric", "## Deferred"]),
    ):
        spec = get_spec(sid)
        assert spec is not None and len(spec.system_prompt) >= 800, f"{sid} prompt too short"
        for header in contract_keywords:
            assert header in spec.system_prompt, f"{sid} missing required section: {header!r}"
        # Each must also explicitly forbid generic / hedging output
        # (the central anti-pattern of Phase 4)
        assert "NEVER" in spec.system_prompt


def test_new_specs_cannot_delegate():
    """Recursion guard: only Supervisor can_delegate. The Phase 4.1
    additions must keep can_delegate=False (otherwise the depth limit
    in Phase 3.3 / 4.1 could blow up)."""
    from backend.services.agent.specs import get_spec
    for sid in ("ux_designer", "brand_designer", "copywriter", "product_strategist"):
        assert get_spec(sid).can_delegate is False


# ══════════════════════════════════════════════════════════════════════
# Supervisor prompt — plan-first + panel sizing + spawn tool

def test_supervisor_prompt_plan_first_section_required():
    """The `## Sub-tasks` section makes the orchestration FEEL
    autonomous — the user sees the plan before agents fire."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    assert "## Sub-tasks" in p
    # And the supervisor must be told to emit it BEFORE delegating
    lower = p.lower()
    assert "plan-first" in lower or "before any delegate" in lower or "before delegating" in lower


def test_supervisor_prompt_panel_sizing_heuristic():
    """Phase 4.1 introduces explicit panel sizing — solo for narrow
    asks (backwards compat), 3-5 agents for multi-domain builds."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    assert "PANEL SIZE" in p or "panel size" in p.lower()
    # Multi-domain build language present
    lower = p.lower()
    assert "multi-domain build" in lower or "autonomous panel" in lower
    # Solo path preserved for narrow asks (backwards compat)
    assert "solo" in lower or "narrow" in lower
    # Conversational reply path preserved
    assert "conversational" in lower or "trivial" in lower


def test_supervisor_prompt_lists_all_ten_specialists():
    """The supervisor must know its full roster — 6 original + 4 Phase 4.1."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    for sid in ("researcher", "coder", "trader", "marketer", "strategist",
                "ux_designer", "brand_designer", "copywriter", "product_strategist"):
        assert sid in p, f"supervisor prompt missing roster entry: {sid}"


def test_supervisor_has_spawn_specialist_tool_listed():
    """The supervisor must know spawn_specialist exists so the LLM
    can pick it for roles not in the built-in roster."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    assert "spawn_specialist" in p
    # Must include concrete example role(s) outside the roster
    lower = p.lower()
    assert any(role in lower for role in
                ("security_auditor", "ml_engineer", "devops", "illustrator"))


def test_supervisor_allowed_tools_includes_both_orchestration_tools():
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    assert "delegate" in sv.allowed_tools
    assert "spawn_specialist" in sv.allowed_tools


# ══════════════════════════════════════════════════════════════════════
# spawn_specialist tool descriptor

def test_spawn_specialist_descriptor_has_role_enum_and_required_args():
    from backend.services.agent.tool_bridge import _spawn_specialist_tool_descriptor
    desc = _spawn_specialist_tool_descriptor()
    fn = desc["function"]
    assert fn["name"] == "spawn_specialist"
    params = fn["parameters"]["properties"]
    # Role is enum-constrained to known templates
    assert "role" in params
    assert isinstance(params["role"]["enum"], list)
    assert "frontend" in params["role"]["enum"]
    assert "ux" in params["role"]["enum"]
    assert "brand" in params["role"]["enum"]
    # All three required args present
    for arg in ("role", "persona_summary", "task"):
        assert arg in fn["parameters"]["required"]


def test_tools_for_spec_exposes_spawn_specialist_only_when_can_delegate():
    """Both orchestration tools (delegate + spawn_specialist) are
    matched pairs — only the supervisor (can_delegate=True) gets them.
    Specialists (can_delegate=False) get NEITHER."""
    from backend.services.agent.specs import get_spec
    from backend.services.agent.tool_bridge import tools_for_spec

    sv_tools = tools_for_spec(get_spec("supervisor"))
    tool_names = [t["function"]["name"] for t in sv_tools]
    assert "delegate" in tool_names
    assert "spawn_specialist" in tool_names

    # Specialist agents do NOT get either orchestration tool
    for sid in ("researcher", "coder", "ux_designer", "brand_designer"):
        tools = tools_for_spec(get_spec(sid))
        names = [t["function"]["name"] for t in tools]
        assert "delegate" not in names, f"{sid} must NOT have delegate"
        assert "spawn_specialist" not in names, f"{sid} must NOT have spawn_specialist"


def test_tools_for_spec_does_not_double_list_spawn_specialist():
    """If a spec accidentally lists both 'delegate' AND 'spawn_specialist'
    in allowed_tools, the descriptor should appear exactly once."""
    from backend.services.agent.specs.types import AgentSpec
    from backend.services.agent.tool_bridge import tools_for_spec
    explicit_both = AgentSpec(
        id="test-explicit-both", name="x", role="orchestrator",
        system_prompt="x" * 100,
        allowed_tools=("delegate", "spawn_specialist"),
        can_delegate=True,
    )
    tools = tools_for_spec(explicit_both)
    names = [t["function"]["name"] for t in tools]
    assert names.count("spawn_specialist") == 1
    assert names.count("delegate") == 1


# ══════════════════════════════════════════════════════════════════════
# Ephemeral spec construction

def test_build_ephemeral_spec_inherits_role_template():
    from backend.services.agent.delegate import _build_ephemeral_spec
    spec = _build_ephemeral_spec(
        role="ux",
        persona_summary="Senior UX architect focused on B2B SaaS dashboards",
    )
    # Inherits the ux role template's structured output requirements
    assert "## Audience" in spec.system_prompt
    assert "## Information hierarchy" in spec.system_prompt
    # And carries the persona summary
    assert "Senior UX architect" in spec.system_prompt
    # Marked as ephemeral so observability can distinguish
    assert spec.kind == "ephemeral"
    assert spec.can_delegate is False    # never recursive
    # ID is unique and namespaced
    assert spec.id.startswith("ephemeral-ux-")


def test_build_ephemeral_spec_unknown_role_falls_back_to_custom():
    from backend.services.agent.delegate import _build_ephemeral_spec
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    spec = _build_ephemeral_spec(
        role="totally_made_up_role",
        persona_summary="Whatever",
    )
    # Falls back to 'custom' template body — preserves anti-pattern guards
    assert ROLE_SYSTEM_PROMPTS["custom"] in spec.system_prompt
    assert spec.kind == "ephemeral"


def test_build_ephemeral_spec_handles_empty_persona():
    from backend.services.agent.delegate import _build_ephemeral_spec
    spec = _build_ephemeral_spec(role="frontend", persona_summary="")
    # When no persona, the prompt is JUST the role template — no
    # "PERSONA HINT:" preface to confuse the LLM with empty content
    assert "PERSONA HINT" not in spec.system_prompt
    assert "Frontend" in spec.name or "frontend" in spec.role


# ══════════════════════════════════════════════════════════════════════
# spawn_and_delegate uses same pipeline as delegate (auth + budget)

def _stub_runner():
    """Stub run_agent that records the AgentRequest it sees."""
    from backend.services.agent.types import AgentResponse
    captured: dict = {}

    async def _stub(req):
        captured.setdefault("calls", []).append({
            "mode":          req.mode,
            "system_prompt": req.system_prompt,
            "user_message":  req.user_message,
        })
        return AgentResponse(
            reply=f"[stub from {req.mode}] done",
            mode=req.mode, model=req.model,
            steps_used=1, tool_calls=0, elapsed_ms=8,
        )
    return _stub, captured


def test_spawn_and_delegate_rejects_non_supervisor_caller():
    """Same authz rule as delegate(): only can_delegate=True specs may
    spawn ephemerals."""
    from backend.services.agent.delegate import spawn_and_delegate
    stub, _ = _stub_runner()

    async def _drive():
        return await spawn_and_delegate(
            role="frontend",
            persona_summary="Senior FE",
            task="build a hero",
            caller_spec_id="researcher",     # not can_delegate
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "DELEGATE_FORBIDDEN"


def test_spawn_and_delegate_happy_path_runs_ephemeral():
    from backend.services.agent.delegate import spawn_and_delegate
    stub, captured = _stub_runner()

    async def _drive():
        return await spawn_and_delegate(
            role="ux",
            persona_summary="Mobile UX architect with 5 years on consumer apps",
            task="Outline the IA for a 4-screen onboarding",
            caller_spec_id="supervisor",
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive())
    assert res["ok"] is True
    # The sub-agent ran with the ephemeral system prompt that combined
    # the role template + persona summary
    call = captured["calls"][0]
    assert "Mobile UX architect" in call["system_prompt"]
    assert "## Audience" in call["system_prompt"]    # ux template's section
    # Mode is the ephemeral id, runtime sees a non-recognised mode →
    # gets no built-in tools (correct, ephemerals are LLM-only)
    assert call["mode"].startswith("ephemeral-ux-")


def test_spawn_and_delegate_respects_parallel_limit(monkeypatch):
    """Both delegate AND spawn_and_delegate share the same in-flight
    counter — verifying the budget is unified across both tools."""
    monkeypatch.setenv("ORCHESTRATOR_MAX_PARALLEL", "2")
    from backend.services.agent.delegate import (
        spawn_and_delegate, _SCRATCH_IN_FLIGHT,
    )
    from backend.services.agent.run_context import start_run
    stub, _ = _stub_runner()

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            ctx.scratch[_SCRATCH_IN_FLIGHT] = 2     # at the cap
            return await spawn_and_delegate(
                role="frontend",
                persona_summary="x",
                task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=stub,
            )
    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "PARALLEL_LIMIT_EXCEEDED"


def test_spawn_and_delegate_emits_delegate_started_event():
    """The Phase 3.2 event bus contract is preserved — spawn fires the
    SAME delegate.started/.returned events as delegate (so the
    frontend timeline labels them via humanAgentName).

    Test-order hardening: the Phase 3.5 suite reloads
    `backend.services.events.bus` to test the dormant-flag path. After
    that reload, `events.__init__.bus`/`emit` still point at the OLD
    submodule's symbols while `events.bus.bus` is the new instance.
    We reload both submodule + package init so the bus the test
    subscribes to is the SAME bus that delegate.py + run_context.py
    publish into, regardless of test-suite ordering."""
    import importlib, sys
    for m in ("backend.services.events.bus", "backend.services.events"):
        if m in sys.modules:
            importlib.reload(sys.modules[m])

    from backend.services.events import bus
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.agent.run_context import start_run
    stub, _ = _stub_runner()

    async def _drive():
        with bus.subscribe("*") as sub:
            with start_run(user_id="u-1", project_id="p-evt"):
                await spawn_and_delegate(
                    role="brand",
                    persona_summary="Brand designer for fintech",
                    task="palette",
                    caller_spec_id="supervisor",
                    _run_agent_fn=stub,
                )
            kinds = []
            # Phase 5.1 added 3 task.* events per delegation — drain
            # a larger window so we capture delegate.returned reliably.
            for _ in range(20):
                try:
                    e = await asyncio.wait_for(sub.get(), 0.2)
                    kinds.append(e.kind)
                except asyncio.TimeoutError:
                    break
            return kinds

    kinds = asyncio.run(_drive())
    assert "delegate.started" in kinds
    assert "delegate.returned" in kinds


# ══════════════════════════════════════════════════════════════════════
# dispatch_with_orchestration routes both tools

def test_dispatch_routes_spawn_specialist_through_spawn_fn(monkeypatch):
    """The runtime's dispatcher must call into spawn_and_delegate for
    `spawn_specialist` tool calls, and into delegate for `delegate`
    calls — preserving original input ordering."""
    from backend.services.agent.tool_bridge import dispatch_with_orchestration
    from backend.services.agent import tool_bridge

    async def _stub_dispatch_many(calls, *, timeout=12.0):
        return [
            {"ok": True, "name": c["name"], "tool_call_id": c.get("tool_call_id"),
             "output": {"echo": c.get("name")}, "error": None,
             "truncated": False, "raw_chars": 0}
            for c in calls
        ]
    monkeypatch.setattr(tool_bridge, "dispatch_many", _stub_dispatch_many)

    import backend.services.agent.delegate as _dlg
    spawn_calls: list = []
    delegate_calls: list = []

    async def _stub_delegate(*, agent_id, task, context_hint="", caller_spec_id="supervisor"):
        delegate_calls.append((agent_id, task))
        return {"ok": True, "reply": f"sub:{agent_id}", "agent_id": agent_id, "run_id": "r"}

    async def _stub_spawn(*, role, persona_summary, task, context_hint="", caller_spec_id="supervisor"):
        spawn_calls.append((role, persona_summary, task))
        return {"ok": True, "reply": f"new:{role}",
                "agent_id": f"ephemeral-{role}-aaaaaa", "run_id": "r"}

    monkeypatch.setattr(_dlg, "delegate", _stub_delegate)
    monkeypatch.setattr(_dlg, "spawn_and_delegate", _stub_spawn)

    pending = [
        {"name": "calculator", "tool_call_id": "t1", "args": {}},
        {"name": "delegate",   "tool_call_id": "t2",
         "args": {"agent_id": "coder", "task": "write a function"}},
        {"name": "spawn_specialist", "tool_call_id": "t3",
         "args": {"role": "ux", "persona_summary": "UX architect",
                  "task": "outline IA"}},
        {"name": "current_time", "tool_call_id": "t4", "args": {}},
    ]
    results = asyncio.run(dispatch_with_orchestration(pending, caller_spec_id="supervisor"))
    assert len(results) == 4
    # Order preserved
    assert results[0]["name"] == "calculator"
    assert results[1]["name"] == "delegate"
    assert results[2]["name"] == "spawn_specialist"
    assert results[3]["name"] == "current_time"
    # Each orchestration tool reached its handler exactly once
    assert delegate_calls == [("coder", "write a function")]
    assert spawn_calls == [("ux", "UX architect", "outline IA")]


def test_spawn_specialist_missing_args_returns_clean_error():
    """If the LLM emits spawn_specialist without all 3 required args,
    the dispatcher returns an error envelope rather than crashing."""
    from backend.services.agent.tool_bridge import dispatch_with_orchestration

    pending = [
        {"name": "spawn_specialist", "tool_call_id": "t-bad",
         "args": {"role": "ux", "persona_summary": "", "task": ""}},
    ]
    results = asyncio.run(dispatch_with_orchestration(pending, caller_spec_id="supervisor"))
    assert results[0]["ok"] is False
    assert "spawn_specialist requires" in results[0]["error"]


# ══════════════════════════════════════════════════════════════════════
# Budget defaults raised

def test_phase41_raised_default_caps():
    """Architecture quality > token optimization → defaults bumped."""
    from backend.services.agent.delegate import (
        _max_parallel, _total_token_budget, _max_depth,
    )
    # Phase 3.3 defaults: 3 / 40k. Phase 4.1: 5 / 80k.
    assert _max_parallel() == 5
    assert _total_token_budget() == 80000
    # Depth UNCHANGED at 2 — still want a flat call tree
    assert _max_depth() == 2


# ══════════════════════════════════════════════════════════════════════
# Backwards compatibility — solo specialist path still intact

def test_backwards_compat_solo_delegate_still_works():
    """The Phase 3.3 delegate() entry point + its solo-specialist
    behaviour must not regress. A simple delegate to coder should
    still spawn a coder run with the coder spec."""
    from backend.services.agent.delegate import delegate
    stub, captured = _stub_runner()

    async def _drive():
        return await delegate(
            agent_id="coder",
            task="write a fizzbuzz",
            caller_spec_id="supervisor",
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive())
    assert res["ok"] is True
    assert res["agent_id"] == "coder"
    assert captured["calls"][0]["mode"] == "coder"


def test_no_regression_in_existing_tests():
    """Existing Phase 3.3 invariants still hold after the 4.1 refactor."""
    from backend.services.agent.delegate import delegate
    stub, _ = _stub_runner()

    async def _drive_unknown():
        return await delegate(
            agent_id="bogus-agent",
            task="x",
            caller_spec_id="supervisor",
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive_unknown())
    assert res["ok"] is False
    assert res["code"] == "AGENT_NOT_FOUND"


# ══════════════════════════════════════════════════════════════════════
# AgentRequest contract unchanged

def test_chat_request_without_spec_field_still_defaults_to_none():
    """Phase 4.1 didn't change AgentRequest's shape. /chat path unchanged."""
    from backend.services.agent.types import AgentRequest
    req = AgentRequest(user_message="hi", mode="fast", user_id="u-1")
    assert getattr(req, "spec", "MISSING") is None
