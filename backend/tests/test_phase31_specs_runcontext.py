# coding: utf-8
"""Phase 3.1 — Agent specs registry + RunContext tests.

Pure unit tests — no FastAPI, no DB writes outside a temp file.
Covers the contract Phase 3.3 (delegate tool) and Phase 3.5 (event bus)
will depend on:

  • All 6 built-in specs load with id/name/role/tools.
  • Only the Supervisor can_delegate.
  • get_spec() handles unknown ids gracefully (returns None).
  • Custom project agents resolve via get_spec() when ENABLE_PROJECTS=on.
  • RunContext push/pop is per-task — ContextVar reset works on
    exception and on successful return.
  • Nested run_agent calls INHERIT the parent's RunContext rather than
    overwriting it (the orchestrator pattern Phase 3.3 needs).
  • RunContext inherits Phase 2's project_context_block opportunistically.
"""
import asyncio
import os
import sys
import tempfile
import importlib

import pytest


# ══════════════════════════════════════════════════════════════════════
# Built-in specs

def test_all_six_builtins_load():
    from backend.services.agent.specs import list_specs, BUILTIN_AGENT_IDS
    specs = list_specs()
    ids = [s.id for s in specs]
    # Order matches BUILTIN_AGENT_IDS — important for stable UI rendering
    assert ids == list(BUILTIN_AGENT_IDS)
    assert len(specs) == 6


def test_each_builtin_has_required_fields():
    from backend.services.agent.specs import list_specs
    for s in list_specs():
        assert s.id and isinstance(s.id, str)
        assert s.name and isinstance(s.name, str)
        assert s.role and isinstance(s.role, str)
        assert s.system_prompt and len(s.system_prompt) > 50, (
            f"{s.id} has a suspiciously short system prompt"
        )
        assert isinstance(s.allowed_tools, tuple)
        assert s.default_model
        assert s.max_steps >= 1
        assert s.kind == "builtin"
        assert 0.0 <= s.temperature <= 2.0


def test_only_supervisor_can_delegate():
    """The delegate tool (Phase 3.3) must be restricted. This is the
    policy invariant — failing this test would let any spec recurse
    arbitrarily once the delegate tool exists."""
    from backend.services.agent.specs import list_specs
    delegators = [s for s in list_specs() if s.can_delegate]
    assert len(delegators) == 1
    assert delegators[0].id == "supervisor"


def test_get_spec_resolves_builtins_by_id():
    from backend.services.agent.specs import get_spec, BUILTIN_AGENT_IDS
    for aid in BUILTIN_AGENT_IDS:
        spec = get_spec(aid)
        assert spec is not None
        assert spec.id == aid


def test_unknown_agent_returns_none():
    from backend.services.agent.specs import get_spec
    assert get_spec("nonexistent-spec") is None
    assert get_spec("") is None


def test_supervisor_allows_delegate_tool_in_whitelist():
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    assert sv is not None
    assert "delegate" in sv.allowed_tools


def test_register_spec_overwrite_guard():
    from backend.services.agent.specs import register_spec
    from backend.services.agent.specs.types import AgentSpec
    new = AgentSpec(id="researcher", name="Pirate", role="oops", system_prompt="x" * 80)
    with pytest.raises(ValueError):
        register_spec(new)
    # Explicit overwrite works (used by tests / future plugins)
    register_spec(new, overwrite=True)
    from backend.services.agent.specs import get_spec
    assert get_spec("researcher").name == "Pirate"
    # Restore so other tests aren't poisoned
    from backend.services.agent.specs import builtins
    register_spec(builtins.RESEARCHER_SPEC, overwrite=True)


# ══════════════════════════════════════════════════════════════════════
# Custom project agent fallback

def test_custom_project_agent_resolves_via_get_spec(monkeypatch):
    """When ENABLE_PROJECTS=true, get_spec() falls back to the
    project_agents table for unknown ids. Sets up a temp DB so the
    repo's projects.db is never touched."""
    fd, path = tempfile.mkstemp(suffix="-test31.db")
    os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    # Re-import so DB_PATH picks up the new env var
    if "backend.services.projects.store" in sys.modules:
        importlib.reload(sys.modules["backend.services.projects.store"])
    from backend.services.projects import store as ps
    ps.init()
    p = ps.create_project("u-1", name="Test")
    custom = ps.create_agent(
        p.id, name="My Custom Agent", role="custom",
        system_prompt="Hello, I am a custom agent." + " padding" * 10,
        model_hint="gpt-4o-mini",
    )
    # get_spec doesn't know about it in the registry, but should resolve
    # via the project_agents table.
    from backend.services.agent.specs import get_spec
    spec = get_spec(custom.id)
    assert spec is not None
    assert spec.id == custom.id
    assert spec.name == "My Custom Agent"
    assert spec.kind == "custom"
    assert spec.can_delegate is False
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def test_custom_lookup_skipped_when_flag_off(monkeypatch):
    monkeypatch.delenv("ENABLE_PROJECTS", raising=False)
    from backend.services.agent.specs import get_spec
    # Unknown id and flag off → None, never touches the DB.
    assert get_spec("anything-not-registered") is None


# ══════════════════════════════════════════════════════════════════════
# RunContext

def test_no_run_active_outside_start_run():
    from backend.services.agent.run_context import get_current_run
    assert get_current_run() is None


def test_run_context_basic_lifecycle():
    from backend.services.agent.run_context import start_run, get_current_run
    handle = start_run(user_id="u-42", project_id="p-1")
    try:
        ctx = get_current_run()
        assert ctx is not None
        assert ctx.user_id == "u-42"
        assert ctx.project_id == "p-1"
        assert ctx.parent_agent is None
        assert ctx.run_id and len(ctx.run_id) >= 8
        assert isinstance(ctx.scratch, dict) and ctx.scratch == {}
    finally:
        handle.close()
    # After close, the ContextVar is reset.
    assert get_current_run() is None


def test_run_context_with_block_form():
    """The `with` form is the recommended pattern. ContextVar must be
    reset even if the body raises."""
    from backend.services.agent.run_context import start_run, get_current_run
    try:
        with start_run(user_id="u-99"):
            assert get_current_run() is not None
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert get_current_run() is None


def test_run_context_inherits_project_id_explicitly():
    from backend.services.agent.run_context import start_run, get_current_run
    with start_run(user_id="u-1", project_id="proj-explicit"):
        ctx = get_current_run()
        assert ctx.project_id == "proj-explicit"


def test_run_context_picks_up_phase2_project_block(monkeypatch):
    """When chat.py has already set the Phase 2 project context
    ContextVar, start_run() should pick the block up automatically so
    sub-agents inherit cached context without rebuilding it."""
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    from backend.services.projects.context import (
        set_current_project_context, reset_current_project_context,
    )
    from backend.services.agent.run_context import start_run, get_current_run
    tok = set_current_project_context("[Project Context — Test]\nstack: nextjs")
    try:
        with start_run(user_id="u-1"):
            ctx = get_current_run()
            assert "Project Context — Test" in ctx.project_context_block
            assert "stack: nextjs" in ctx.project_context_block
    finally:
        reset_current_project_context(tok)


def test_run_context_run_ids_unique():
    from backend.services.agent.run_context import start_run
    ids = set()
    for _ in range(50):
        with start_run(user_id="u-1") as ctx:
            ids.add(ctx.run_id)
    assert len(ids) == 50


# ══════════════════════════════════════════════════════════════════════
# Runtime integration — RunContext threading through run_agent

def test_run_agent_pushes_run_context_when_none_active(monkeypatch):
    """When no parent RunContext is active, run_agent() pushes its own.
    We stub the body so the call returns immediately — the assertion
    is purely about the ContextVar lifecycle, not the LLM."""
    from backend.services.agent.types import AgentRequest, AgentResponse
    from backend.services.agent import runtime
    from backend.services.agent.run_context import get_current_run

    observed: dict = {}

    async def _stub_body(req):
        observed["run_active"] = get_current_run() is not None
        observed["user_id"]    = get_current_run().user_id
        observed["mode"]       = get_current_run().metadata.get("mode")
        return AgentResponse(reply="ok", mode=req.mode, model=req.model)

    monkeypatch.setattr(runtime, "_run_agent_body", _stub_body)
    asyncio.run(runtime.run_agent(AgentRequest(
        user_message="hi", mode="fast", user_id="u-77", model="gpt-4o-mini",
    )))
    assert observed["run_active"] is True
    assert observed["user_id"] == "u-77"
    assert observed["mode"]    == "fast"
    # After run_agent returns, the ContextVar is reset.
    assert get_current_run() is None


def test_run_agent_inherits_parent_run_context(monkeypatch):
    """If an orchestrator has already started a run, a nested
    run_agent() invocation must INHERIT — not push a new context.
    This is the contract Phase 3.3's delegate tool relies on."""
    from backend.services.agent.types import AgentRequest, AgentResponse
    from backend.services.agent import runtime
    from backend.services.agent.run_context import start_run, get_current_run

    inner_run_id = None

    async def _stub_body(req):
        nonlocal inner_run_id
        ctx = get_current_run()
        inner_run_id = ctx.run_id if ctx else None
        return AgentResponse(reply="ok", mode=req.mode, model=req.model)

    monkeypatch.setattr(runtime, "_run_agent_body", _stub_body)

    async def _orchestrate():
        with start_run(user_id="u-parent", project_id="p-1") as parent_ctx:
            parent_run_id = parent_ctx.run_id
            await runtime.run_agent(AgentRequest(
                user_message="sub-task", mode="fast", user_id="u-parent",
            ))
            return parent_run_id

    parent_run_id = asyncio.run(_orchestrate())
    # Sub-agent saw the parent's run_id, not a new one.
    assert inner_run_id == parent_run_id
    # Parent ContextVar resets cleanly outside the with block.
    assert get_current_run() is None


# ══════════════════════════════════════════════════════════════════════
# Asyncio task isolation — ContextVar must not leak between tasks

def test_run_contexts_are_per_task_isolated():
    """Two concurrent asyncio tasks each push their own RunContext.
    Neither must see the other's ctx. ContextVar guarantees this but
    we assert it explicitly because any future code that uses globals
    instead of ContextVar would silently regress."""
    from backend.services.agent.run_context import start_run, get_current_run

    seen = {}

    async def _drive():
        barrier = asyncio.Event()

        async def worker(label: str, user_id: str):
            with start_run(user_id=user_id) as ctx:
                seen[label] = ctx.run_id
                await barrier.wait()
                assert get_current_run().run_id == ctx.run_id
                assert get_current_run().user_id == user_id

        t1 = asyncio.create_task(worker("a", "u-A"))
        t2 = asyncio.create_task(worker("b", "u-B"))
        await asyncio.sleep(0.01)
        barrier.set()
        await asyncio.gather(t1, t2)

    asyncio.run(_drive())
    assert seen["a"] != seen["b"]


# ══════════════════════════════════════════════════════════════════════
# Spec immutability — frozen dataclass

def test_agent_spec_is_frozen():
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    with pytest.raises((AttributeError, Exception)):
        sv.name = "Hacked"
