# coding: utf-8
"""Phase 3.2 — Event Bus + runtime instrumentation tests.

Covers the contract Phase 3.5 (SSE stream) and Phase 3.3 (delegate
tool) will rely on:

  • ActivityEvent shape + EVENT_KINDS whitelist
  • publish/subscribe per-scope routing
  • wildcard subscription
  • subscriber isolation (events go to the right queues only)
  • ENABLE_REALTIME_EVENTS=false → publish + subscribe are no-ops
  • run.started / run.finished / run.errored fire from RunContext
  • agent.started / agent.finished fire around run_agent body
  • tool.called / tool.completed / tool.errored fire around dispatch_many
  • backpressure: full queue drops events but never raises
  • subscription cleanup on close

These tests are deliberately surgical — they use a FRESH
InProcessEventBus instance per test (not the module-level singleton)
so test ordering and parallelism are safe.
"""
import asyncio
import os
import sys
import importlib

import pytest


# ══════════════════════════════════════════════════════════════════════
# ActivityEvent / EVENT_KINDS

def test_event_kinds_whitelist():
    from backend.services.events import EVENT_KINDS
    required = {
        "run.started", "run.finished", "run.errored",
        "agent.started", "agent.finished",
        "tool.called", "tool.completed", "tool.errored",
    }
    assert required.issubset(set(EVENT_KINDS))


def test_activity_event_frozen():
    from backend.services.events import ActivityEvent
    e = ActivityEvent(kind="run.started", scope="*")
    with pytest.raises((AttributeError, Exception)):
        e.kind = "hacked"


def test_activity_event_to_dict_round_trip():
    from backend.services.events import ActivityEvent
    e = ActivityEvent(
        kind="agent.started", scope="project:abc",
        run_id="r-1", agent_id="researcher",
        payload={"mode": "research"},
    )
    d = e.to_dict()
    assert d["kind"] == "agent.started"
    assert d["scope"] == "project:abc"
    assert d["run_id"] == "r-1"
    assert d["agent_id"] == "researcher"
    assert d["payload"] == {"mode": "research"}
    assert d["emitted_at"].endswith("Z")


# ══════════════════════════════════════════════════════════════════════
# publish/subscribe — bus instance behaviour

def _enabled_env(monkeypatch):
    """Helper — turn ENABLE_REALTIME_EVENTS on for the test scope."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")


def test_publish_subscribe_scoped(monkeypatch):
    _enabled_env(monkeypatch)
    from backend.services.events import InProcessEventBus, ActivityEvent

    async def _drive():
        b = InProcessEventBus()
        with b.subscribe("project:abc") as sub:
            assert sub.empty()
            # An event for our scope arrives
            b.publish(ActivityEvent(kind="run.started", scope="project:abc", run_id="r1"))
            got = await asyncio.wait_for(sub.get(), timeout=0.5)
            assert got.kind == "run.started" and got.run_id == "r1"
            # An event for a DIFFERENT scope does not arrive
            b.publish(ActivityEvent(kind="run.started", scope="project:xyz", run_id="r2"))
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(sub.get(), timeout=0.05)

    asyncio.run(_drive())


def test_wildcard_subscriber_receives_everything(monkeypatch):
    _enabled_env(monkeypatch)
    from backend.services.events import InProcessEventBus, ActivityEvent

    async def _drive():
        b = InProcessEventBus()
        with b.subscribe("*") as sub:
            b.publish(ActivityEvent(kind="run.started", scope="project:a"))
            b.publish(ActivityEvent(kind="run.started", scope="user:u"))
            b.publish(ActivityEvent(kind="agent.started", scope="*"))
            got = [await asyncio.wait_for(sub.get(), 0.2) for _ in range(3)]
            assert [g.scope for g in got] == ["project:a", "user:u", "*"]

    asyncio.run(_drive())


def test_subscriber_isolation(monkeypatch):
    """Two scoped subscribers must not see each other's events."""
    _enabled_env(monkeypatch)
    from backend.services.events import InProcessEventBus, ActivityEvent

    async def _drive():
        b = InProcessEventBus()
        with b.subscribe("project:a") as sub_a, b.subscribe("project:b") as sub_b:
            b.publish(ActivityEvent(kind="run.started", scope="project:a", run_id="rA"))
            b.publish(ActivityEvent(kind="run.started", scope="project:b", run_id="rB"))
            got_a = await asyncio.wait_for(sub_a.get(), 0.2)
            got_b = await asyncio.wait_for(sub_b.get(), 0.2)
            assert got_a.run_id == "rA"
            assert got_b.run_id == "rB"
            assert sub_a.empty() and sub_b.empty()

    asyncio.run(_drive())


def test_subscribe_close_unregisters(monkeypatch):
    _enabled_env(monkeypatch)
    from backend.services.events import InProcessEventBus, ActivityEvent

    b = InProcessEventBus()
    sub = b.subscribe("project:close-me")
    assert "project:close-me" in b.stats()["scopes"]
    sub.close()
    assert "project:close-me" not in b.stats()["scopes"]

    # Idempotent — second close is a no-op
    sub.close()
    # Publishing to a now-empty scope is fine, delivers to 0 subscribers
    delivered = b.publish(ActivityEvent(kind="run.started", scope="project:close-me"))
    assert delivered == 0


def test_disabled_flag_publish_is_noop(monkeypatch):
    """When ENABLE_REALTIME_EVENTS is off, publish() returns 0 and
    enqueues nothing. Subscribers receive nothing. This is the
    critical safety property: production behavior is byte-identical
    with the flag off."""
    monkeypatch.delenv("ENABLE_REALTIME_EVENTS", raising=False)
    from backend.services.events import InProcessEventBus, ActivityEvent

    async def _drive():
        b = InProcessEventBus()
        sub = b.subscribe("*")
        delivered = b.publish(ActivityEvent(kind="run.started", scope="*"))
        assert delivered == 0
        assert sub.empty()
        # Stats reflect: nothing published
        assert b.stats()["published"] == 0

    asyncio.run(_drive())


def test_disabled_flag_subscribe_is_inert(monkeypatch):
    """Inert subscriptions never get events but don't crash anything
    either — the SSE endpoint (Phase 3.5) can always subscribe."""
    monkeypatch.delenv("ENABLE_REALTIME_EVENTS", raising=False)
    from backend.services.events import InProcessEventBus
    b = InProcessEventBus()
    sub = b.subscribe("project:nope")
    # No registration occurred — bus has zero subscribers
    assert b.stats()["subscribers"] == 0
    # Close is still safe
    sub.close()


def test_backpressure_drops_events(monkeypatch):
    """A slow consumer (maxsize=2) must not break the bus — extra
    events are dropped and counted, never raised."""
    _enabled_env(monkeypatch)
    from backend.services.events import InProcessEventBus, ActivityEvent

    async def _drive():
        b = InProcessEventBus()
        with b.subscribe("project:slow", maxsize=2) as _sub:
            for i in range(5):
                b.publish(ActivityEvent(
                    kind="run.started", scope="project:slow", run_id=f"r{i}",
                ))
            assert b.stats()["dropped"] >= 3

    asyncio.run(_drive())


# ══════════════════════════════════════════════════════════════════════
# Runtime instrumentation — run.* events fire from RunContext

def _capture_module_bus(monkeypatch):
    """Reset and capture the module-level singleton bus stats.

    Phase 3.2 publishes via the singleton `backend.services.events.bus`.
    Tests that need to assert on emissions subscribe to it directly.
    """
    _enabled_env(monkeypatch)
    # Force a fresh module instance so flag state is consistent.
    from backend.services.events import bus
    return bus


def test_start_run_emits_run_started(monkeypatch):
    bus = _capture_module_bus(monkeypatch)
    from backend.services.agent.run_context import start_run

    async def _drive():
        with bus.subscribe("*") as sub:
            h = start_run(user_id="u-1", project_id="p-1")
            try:
                e = await asyncio.wait_for(sub.get(), 0.5)
                assert e.kind == "run.started"
                assert e.run_id == h.ctx.run_id
                assert e.scope == "project:p-1"
                assert e.payload["parent_agent"] is None
            finally:
                h.close()

    asyncio.run(_drive())


def test_run_handle_close_emits_finished(monkeypatch):
    bus = _capture_module_bus(monkeypatch)
    from backend.services.agent.run_context import start_run

    async def _drive():
        with bus.subscribe("*") as sub:
            h = start_run(user_id="u-1")
            # Discard run.started
            await asyncio.wait_for(sub.get(), 0.5)
            h.close()
            e = await asyncio.wait_for(sub.get(), 0.5)
            assert e.kind == "run.finished"
            assert e.run_id == h.ctx.run_id
            assert e.payload["error"] is None

    asyncio.run(_drive())


def test_run_handle_exit_with_exception_emits_errored(monkeypatch):
    bus = _capture_module_bus(monkeypatch)
    from backend.services.agent.run_context import start_run

    async def _drive():
        with bus.subscribe("*") as sub:
            try:
                with start_run(user_id="u-1") as ctx:
                    # Drop run.started
                    await asyncio.wait_for(sub.get(), 0.5)
                    raise RuntimeError("boom")
            except RuntimeError:
                pass
            e = await asyncio.wait_for(sub.get(), 0.5)
            assert e.kind == "run.errored"
            assert "boom" in (e.payload["error"] or "")

    asyncio.run(_drive())


# ══════════════════════════════════════════════════════════════════════
# Runtime instrumentation — agent.* + tool.* via stubbed body

def test_run_agent_emits_agent_started_and_finished(monkeypatch):
    bus = _capture_module_bus(monkeypatch)
    from backend.services.agent.types import AgentRequest, AgentResponse
    from backend.services.agent import runtime

    async def _stub_inner(req):
        return AgentResponse(reply="ok", mode=req.mode, model=req.model, steps_used=1)

    monkeypatch.setattr(runtime, "_run_agent_inner", _stub_inner)

    async def _drive():
        with bus.subscribe("*") as sub:
            await runtime.run_agent(AgentRequest(
                user_message="hi", mode="fast", user_id="u-77",
            ))
            kinds = []
            for _ in range(4):
                try:
                    e = await asyncio.wait_for(sub.get(), 0.3)
                    kinds.append(e.kind)
                except asyncio.TimeoutError:
                    break
            # Expect run.started + agent.started + agent.finished + run.finished
            assert "run.started"     in kinds
            assert "agent.started"   in kinds
            assert "agent.finished"  in kinds
            assert "run.finished"    in kinds

    asyncio.run(_drive())


def test_tool_called_and_completed_emit_in_order(monkeypatch):
    """Verifies the dispatch_many wrapping in runtime.py emits a
    paired tool.called → tool.completed for a successful call, and
    tool.errored when ok=false."""
    _enabled_env(monkeypatch)
    from backend.services.agent.runtime import _emit_tool_called, _emit_tool_result
    from backend.services.events import bus

    async def _drive():
        with bus.subscribe("*") as sub:
            # Success path
            _emit_tool_called({"name": "calculator", "tool_call_id": "tc-1", "args": {"a": 1, "b": 2}})
            _emit_tool_result(
                {"name": "calculator", "tool_call_id": "tc-1"},
                {"name": "calculator", "tool_call_id": "tc-1", "ok": True, "output": {"sum": 3}},
            )
            # Error path
            _emit_tool_called({"name": "stock_market", "tool_call_id": "tc-2", "args": {"symbol": "X"}})
            _emit_tool_result(
                {"name": "stock_market", "tool_call_id": "tc-2"},
                {"name": "stock_market", "tool_call_id": "tc-2", "ok": False, "error": "rate limit"},
            )

            events = []
            for _ in range(4):
                try:
                    events.append(await asyncio.wait_for(sub.get(), 0.3))
                except asyncio.TimeoutError:
                    break
            kinds = [e.kind for e in events]
            assert kinds == ["tool.called", "tool.completed", "tool.called", "tool.errored"]
            # Error event carries the message (truncated)
            assert "rate limit" in (events[3].payload["error"] or "")

    asyncio.run(_drive())


def test_event_payload_arg_summary_truncates(monkeypatch):
    _enabled_env(monkeypatch)
    from backend.services.agent.runtime import _summarize_args

    out = _summarize_args({
        "long":  "x" * 200,
        "short": "ok",
        "list":  list(range(50)),
        "dict":  {"nested": True, "k": 1},
        "num":   42,
        "bool":  True,
        "none":  None,
        "extra": "data",
        "ignored_after_8": "z",  # would be the 9th key
    })
    assert len(out["long"]) <= 81  # 80 chars + ellipsis
    assert out["short"] == "ok"
    assert out["list"]  == "<list[50]>"
    assert out["dict"]  == "<dict[2]>"
    assert out["num"]   == 42
    # 9th key is truncated by the cap
    assert "ignored_after_8" not in out


# ══════════════════════════════════════════════════════════════════════
# Bus singleton — verifying the module-level instance behaves correctly
# under the flag-on path. This is the bus that runtime code publishes to
# in production.

def test_module_singleton_publish_path(monkeypatch):
    _enabled_env(monkeypatch)
    from backend.services.events import bus, emit
    with bus.subscribe("user:tested") as sub:
        emit("agent.started", user_id="tested", agent_id="researcher", payload={"x": 1})

        async def _drive():
            return await asyncio.wait_for(sub.get(), 0.3)

        e = asyncio.run(_drive())
        assert e.kind == "agent.started"
        # user_id is encoded in scope, not a separate event field
        assert e.scope == "user:tested"
        assert e.agent_id == "researcher"
        assert e.payload == {"x": 1}


def test_full_run_agent_cycle_disabled_flag_emits_nothing(monkeypatch):
    """The critical safety test: with the flag OFF, a complete run_agent
    invocation must not enqueue a single event onto a subscriber.
    Otherwise we'd silently leak events when the bus is supposed to be
    dormant."""
    monkeypatch.delenv("ENABLE_REALTIME_EVENTS", raising=False)
    from backend.services.events import bus
    from backend.services.agent.types import AgentRequest, AgentResponse
    from backend.services.agent import runtime

    async def _stub_inner(req):
        return AgentResponse(reply="ok", mode=req.mode, model=req.model)

    monkeypatch.setattr(runtime, "_run_agent_inner", _stub_inner)

    async def _drive():
        with bus.subscribe("*") as sub:
            await runtime.run_agent(AgentRequest(
                user_message="hi", mode="fast", user_id="u-x",
            ))
            # Sleep a tick to make sure any async emission would have happened.
            await asyncio.sleep(0.05)
            assert sub.empty()

    asyncio.run(_drive())
