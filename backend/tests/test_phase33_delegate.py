# coding: utf-8
"""Phase 3.3 — Supervisor + delegate tool tests.

Covers every safety invariant the delegate tool must uphold:
  - Only can_delegate=True specs may delegate
  - Target must exist + must NOT itself be can_delegate (no recursive
    supervisors)
  - ORCHESTRATOR_MAX_DEPTH enforced
  - ORCHESTRATOR_MAX_PARALLEL enforced
  - ORCHESTRATOR_TOTAL_TOKEN_BUDGET enforced
  - Sub-agent inherits run_id, project_id, user_id, project context
    block, parent_agent, AND the shared scratchpad (by reference, so
    sibling sub-agents can communicate via scratch)
  - delegate.started / delegate.returned / delegate.errored fire
    correctly to the Phase 3.2 event bus
  - In-flight counter releases cleanly on success and on exception
  - Recovery: a budget reject does NOT consume a parallel slot

Tests stub `_run_agent_fn` to avoid touching the real LLM. The stub
runs in the sub-agent's RunContext so inheritance can be inspected
directly.
"""
import asyncio
import os

import pytest


# ══════════════════════════════════════════════════════════════════════
# Test fixtures

@pytest.fixture(autouse=True)
def _enable_events(monkeypatch):
    """Phase 3.2 events default off; flip on so emission tests work
    AND so emit() exercises the real publish path during every test."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")


def _make_stub_runner(captured: dict):
    """Build a stub run_agent that records the AgentRequest + the
    RunContext it sees at execution time, then returns a fake reply."""
    from backend.services.agent.types import AgentResponse
    from backend.services.agent.run_context import get_current_run

    async def _stub(req):
        ctx = get_current_run()
        captured.setdefault("calls", []).append({
            "mode":           req.mode,
            "user_id":        req.user_id,
            "model":          req.model,
            "system_prompt":  req.system_prompt,
            "user_message":   req.user_message,
            "ctx_run_id":     ctx.run_id if ctx else None,
            "ctx_project_id": ctx.project_id if ctx else None,
            "ctx_parent":     ctx.parent_agent if ctx else None,
            "ctx_depth":      ctx.depth if ctx else None,
            "ctx_block":      ctx.project_context_block if ctx else None,
            "ctx_scratch":    ctx.scratch if ctx else None,
        })
        return AgentResponse(
            reply=f"[stub from {req.mode}] task acknowledged",
            mode=req.mode, model=req.model,
            steps_used=1, tool_calls=0, elapsed_ms=10,
        )
    return _stub


# ══════════════════════════════════════════════════════════════════════
# Authorization: only Supervisor can delegate

def test_non_supervisor_caller_is_rejected():
    from backend.services.agent.delegate import delegate

    async def _drive():
        result = await delegate(
            agent_id="coder",
            task="write a fizzbuzz",
            caller_spec_id="researcher",  # researcher can_delegate=False
            _run_agent_fn=_make_stub_runner({}),
        )
        return result

    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "DELEGATE_FORBIDDEN"


def test_unknown_caller_is_rejected():
    from backend.services.agent.delegate import delegate

    async def _drive():
        return await delegate(
            agent_id="coder", task="x",
            caller_spec_id="bogus-spec-id",
            _run_agent_fn=_make_stub_runner({}),
        )

    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "DELEGATE_FORBIDDEN"


def test_supervisor_can_delegate_to_researcher():
    from backend.services.agent.delegate import delegate
    captured = {}

    async def _drive():
        return await delegate(
            agent_id="researcher",
            task="What's the TAM for headless commerce in EU?",
            caller_spec_id="supervisor",
            _run_agent_fn=_make_stub_runner(captured),
        )

    res = asyncio.run(_drive())
    assert res["ok"] is True
    assert res["agent_id"] == "researcher"
    assert "[stub from researcher]" in res["reply"]
    # Sub-agent ran with the researcher's spec
    call = captured["calls"][0]
    assert call["mode"]  == "researcher"
    assert "Research Analyst" in call["system_prompt"]


# ══════════════════════════════════════════════════════════════════════
# Target validation

def test_unknown_target_returns_error():
    from backend.services.agent.delegate import delegate

    async def _drive():
        return await delegate(
            agent_id="non-existent-spec",
            task="x",
            caller_spec_id="supervisor",
            _run_agent_fn=_make_stub_runner({}),
        )

    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "AGENT_NOT_FOUND"


def test_supervisor_cannot_delegate_to_another_delegating_spec():
    """Recursive supervisors are blocked: target must be can_delegate=False.
    Today only Supervisor can_delegate=True, so the only way to trigger
    this is by registering a custom delegator spec."""
    from backend.services.agent.specs import register_spec
    from backend.services.agent.specs.types import AgentSpec
    from backend.services.agent.delegate import delegate

    sub_super = AgentSpec(
        id="rogue-supervisor",
        name="Rogue Supervisor",
        role="orchestrator",
        system_prompt="This spec should not be delegatable to. " + "padding " * 10,
        allowed_tools=("delegate",),
        can_delegate=True,  # intentional misconfig for this test
    )
    register_spec(sub_super, overwrite=True)
    try:
        async def _drive():
            return await delegate(
                agent_id="rogue-supervisor",
                task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )
        res = asyncio.run(_drive())
        assert res["ok"] is False
        assert res["code"] == "DELEGATE_TO_DELEGATOR_BLOCKED"
    finally:
        # Clean up so we don't poison the registry for later tests
        from backend.services.agent.specs.registry import _REGISTRY
        _REGISTRY.pop("rogue-supervisor", None)


# ══════════════════════════════════════════════════════════════════════
# Child context inheritance — the central invariant

def test_child_inherits_run_id_project_id_user_block():
    from backend.services.agent.delegate import delegate
    from backend.services.agent.run_context import start_run

    captured = {}
    stub = _make_stub_runner(captured)

    async def _drive():
        with start_run(
            user_id="u-parent", project_id="proj-7",
            project_context_block="[Project Context — Sample]\nstack: nextjs",
        ) as parent_ctx:
            await delegate(
                agent_id="coder", task="write a hello world",
                caller_spec_id="supervisor", _run_agent_fn=stub,
            )
            return parent_ctx.run_id

    parent_run_id = asyncio.run(_drive())
    c = captured["calls"][0]
    assert c["ctx_run_id"]     == parent_run_id           # inherits
    assert c["ctx_project_id"] == "proj-7"
    assert c["ctx_parent"]     == "supervisor"            # parent_agent updated
    assert c["ctx_depth"]      == 1                       # depth incremented
    assert "Sample" in c["ctx_block"]
    assert c["user_id"]        == "u-parent"


def test_child_scratch_is_shared_with_parent_by_reference():
    """Sibling sub-agents must be able to communicate via shared scratch.
    Verify: the child sees the parent's scratch dict by identity, and
    writes from the child are visible to the parent after the call."""
    from backend.services.agent.delegate import delegate
    from backend.services.agent.run_context import start_run, get_current_run
    from backend.services.agent.types import AgentResponse

    async def _writer_stub(req):
        ctx = get_current_run()
        ctx.scratch["from_subagent"] = "researcher result"
        return AgentResponse(reply="done", mode=req.mode, model=req.model)

    async def _drive():
        with start_run(user_id="u-1") as parent_ctx:
            parent_ctx.scratch["from_parent"] = "supervisor data"
            await delegate(
                agent_id="researcher", task="x",
                caller_spec_id="supervisor", _run_agent_fn=_writer_stub,
            )
            return parent_ctx.scratch

    scratch = asyncio.run(_drive())
    assert scratch["from_parent"]    == "supervisor data"
    assert scratch["from_subagent"]  == "researcher result"


# ══════════════════════════════════════════════════════════════════════
# Depth limit

def test_depth_limit_blocks_when_exceeded(monkeypatch):
    """With MAX_DEPTH=1, a delegate at depth=1 must reject (child
    would be depth=2)."""
    monkeypatch.setenv("ORCHESTRATOR_MAX_DEPTH", "1")
    from backend.services.agent.delegate import delegate
    from backend.services.agent.run_context import start_run

    async def _drive():
        # Simulate "we're already a depth=1 sub-agent" by starting the
        # run at depth=1 directly.
        with start_run(user_id="u-1", depth=1):
            return await delegate(
                agent_id="coder", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )

    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "DEPTH_LIMIT_EXCEEDED"


def test_depth_limit_allows_when_within(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MAX_DEPTH", "2")
    from backend.services.agent.delegate import delegate
    from backend.services.agent.run_context import start_run

    async def _drive():
        # Already a depth=1 sub-agent; delegate would create depth=2 OK.
        with start_run(user_id="u-1", depth=1):
            return await delegate(
                agent_id="coder", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )

    res = asyncio.run(_drive())
    # NOTE: in production, non-supervisors can't call delegate, so this
    # path is hypothetical. We're testing the depth check in isolation.
    assert res["ok"] is True


# ══════════════════════════════════════════════════════════════════════
# Parallel limit

def test_parallel_limit_rejects_when_in_flight_at_cap(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MAX_PARALLEL", "2")
    from backend.services.agent.delegate import delegate, _SCRATCH_IN_FLIGHT
    from backend.services.agent.run_context import start_run

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            # Pretend two delegations are already in flight
            ctx.scratch[_SCRATCH_IN_FLIGHT] = 2
            return await delegate(
                agent_id="coder", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )

    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "PARALLEL_LIMIT_EXCEEDED"


def test_parallel_slot_released_after_success():
    from backend.services.agent.delegate import delegate, _SCRATCH_IN_FLIGHT
    from backend.services.agent.run_context import start_run

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            assert ctx.scratch.get(_SCRATCH_IN_FLIGHT, 0) == 0
            await delegate(
                agent_id="coder", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )
            # After delegate returns, the slot is released to 0
            assert ctx.scratch.get(_SCRATCH_IN_FLIGHT, 0) == 0
            # And we can delegate again
            await delegate(
                agent_id="researcher", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )
            assert ctx.scratch.get(_SCRATCH_IN_FLIGHT, 0) == 0

    asyncio.run(_drive())


def test_parallel_slot_released_on_runtime_exception():
    """If the stubbed runtime raises, the in-flight counter must
    still decrement so future delegations aren't permanently blocked."""
    from backend.services.agent.delegate import delegate, _SCRATCH_IN_FLIGHT
    from backend.services.agent.run_context import start_run

    async def _exploding_stub(req):
        raise RuntimeError("simulated runtime failure")

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            await delegate(
                agent_id="coder", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_exploding_stub,
            )
            assert ctx.scratch.get(_SCRATCH_IN_FLIGHT, 0) == 0

    asyncio.run(_drive())


# ══════════════════════════════════════════════════════════════════════
# Token-budget cap

def test_token_budget_rejects_when_exceeded(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "1000")
    from backend.services.agent.delegate import delegate, _SCRATCH_TOKENS_USED
    from backend.services.agent.run_context import start_run

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            ctx.scratch[_SCRATCH_TOKENS_USED] = 1500   # already over
            return await delegate(
                agent_id="coder", task="x",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )

    res = asyncio.run(_drive())
    assert res["ok"] is False
    assert res["code"] == "TOKEN_BUDGET_EXCEEDED"


def test_successful_delegate_increments_token_estimate():
    from backend.services.agent.delegate import delegate, _SCRATCH_TOKENS_USED
    from backend.services.agent.run_context import start_run

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            await delegate(
                agent_id="coder",
                task="x" * 400,    # ~100 tokens
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )
            return ctx.scratch.get(_SCRATCH_TOKENS_USED, 0)

    used = asyncio.run(_drive())
    assert used > 0


# ══════════════════════════════════════════════════════════════════════
# delegate.started / delegate.returned / delegate.errored events

def test_delegate_emits_started_and_returned():
    from backend.services.events import bus
    from backend.services.agent.delegate import delegate
    from backend.services.agent.run_context import start_run

    async def _drive():
        with bus.subscribe("*") as sub:
            with start_run(user_id="u-1", project_id="proj-evt"):
                await delegate(
                    agent_id="researcher",
                    task="quick lookup",
                    caller_spec_id="supervisor",
                    _run_agent_fn=_make_stub_runner({}),
                )
            kinds = []
            # Phase 5.1 pushed event-per-delegate from ~5 → ~9 (added
            # task.created / task.started / task.completed). Drain a
            # large window so future event additions don't regress
            # the read loop.
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
    # Order: run.started < delegate.started < ... < delegate.returned < run.finished
    assert kinds.index("delegate.started") < kinds.index("delegate.returned")


def test_delegate_emits_errored_on_policy_reject():
    from backend.services.events import bus
    from backend.services.agent.delegate import delegate
    from backend.services.agent.run_context import start_run

    async def _drive():
        with bus.subscribe("*") as sub:
            with start_run(user_id="u-1"):
                await delegate(
                    agent_id="non-existent",
                    task="x",
                    caller_spec_id="supervisor",
                    _run_agent_fn=_make_stub_runner({}),
                )
            kinds = []
            for _ in range(20):
                try:
                    e = await asyncio.wait_for(sub.get(), 0.2)
                    kinds.append((e.kind, e.payload.get("code")))
                except asyncio.TimeoutError:
                    break
            return kinds

    seen = asyncio.run(_drive())
    assert ("delegate.errored", "AGENT_NOT_FOUND") in seen


# ══════════════════════════════════════════════════════════════════════
# Run-level isolation: delegate from outside a parent run still works

def test_delegate_with_no_parent_run_synthesizes_root_context():
    """A test or callsite that invokes delegate without first wrapping
    in start_run() must still work — delegate synthesizes a root
    context anchored to the sub-agent's run."""
    from backend.services.agent.delegate import delegate
    captured = {}

    async def _drive():
        return await delegate(
            agent_id="coder", task="x",
            caller_spec_id="supervisor",
            _run_agent_fn=_make_stub_runner(captured),
        )

    res = asyncio.run(_drive())
    assert res["ok"] is True
    c = captured["calls"][0]
    assert c["ctx_parent"] == "supervisor"
    assert c["ctx_depth"]  == 1


# ══════════════════════════════════════════════════════════════════════
# Delegation history accumulates in scratch

def test_delegation_history_accumulates_in_shared_scratch():
    from backend.services.agent.delegate import delegate, _SCRATCH_DELEGATION_LOG
    from backend.services.agent.run_context import start_run

    async def _drive():
        with start_run(user_id="u-1") as ctx:
            await delegate(
                agent_id="researcher", task="step 1",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )
            await delegate(
                agent_id="coder", task="step 2",
                caller_spec_id="supervisor",
                _run_agent_fn=_make_stub_runner({}),
            )
            return ctx.scratch.get(_SCRATCH_DELEGATION_LOG, [])

    history = asyncio.run(_drive())
    assert len(history) == 2
    assert history[0]["to"] == "researcher"
    assert history[1]["to"] == "coder"
    assert all(h["from"] == "supervisor" for h in history)
    assert all(h["depth"] == 1 for h in history)
