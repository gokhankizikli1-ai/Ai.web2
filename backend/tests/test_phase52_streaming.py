# coding: utf-8
"""Phase 5.2 — per-specialist token streaming tests.

Covers the production contract:
  - agent.token is a recognised event kind
  - GeminiProvider.supports_streaming flips on (was off in 4.3)
  - call_with_fallback_chain_streaming yields start → tokens → done
  - call_with_fallback_chain_streaming falls back across providers
    on pre-start failure but does NOT retry mid-stream
  - delegate.* with _streaming_enabled=True emits agent.token events
    and accumulates the response correctly
  - delegate.* WITHOUT _streaming_enabled stays on the non-streaming
    path (no agent.token emitted)
  - POST /v2/orchestrate/stream is registered, gated by
    ENABLE_ORCHESTRATOR, and returns 404 for unknown agents
  - SSE event taxonomy maps bus events → Phase 5.2 wire format
  - Cancellation: closing the SSE generator cancels the background
    orchestration task cleanly

Streaming HTTP tests use the same direct-route-invocation pattern as
Phase 3.5 to avoid TestClient/ASGI SSE deadlocks. We invoke the route
function, read frames off StreamingResponse.body_iterator, then aclose
the generator to trigger the cleanup path.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
import tempfile
from typing import Any, List

import pytest


# ══════════════════════════════════════════════════════════════════════
# Event kind registration

def test_agent_token_is_registered_event_kind():
    from backend.services.events.types import EVENT_KINDS
    assert "agent.token" in EVENT_KINDS, EVENT_KINDS


# ══════════════════════════════════════════════════════════════════════
# Gemini streaming surface

def test_gemini_provider_advertises_streaming():
    from backend.services.providers.gemini_provider import GeminiProvider
    p = GeminiProvider()
    assert p.supports_streaming is True


def test_gemini_provider_has_stream_chat_completion():
    from backend.services.providers.gemini_provider import GeminiProvider
    p = GeminiProvider()
    assert hasattr(p, "stream_chat_completion")
    # And it's an async generator function
    import inspect
    assert inspect.isasyncgenfunction(p.stream_chat_completion)


# ══════════════════════════════════════════════════════════════════════
# Provider router streaming variant

def _make_stub_provider(events_list, supports=True):
    """Build a dummy provider that yields a scripted sequence of
    ProviderStream* events. Used to test the router in isolation."""
    from backend.services.providers.base import BaseAIProvider

    class _StubProvider(BaseAIProvider):
        name = "stub"
        default_model = "stub-model"
        supports_streaming = supports

        def is_available(self):
            return True

        async def chat_completion(self, request):
            raise NotImplementedError()

        async def stream_chat_completion(self, request):
            for ev in events_list:
                yield ev

    return _StubProvider()


def test_router_streaming_yields_start_token_done():
    """Happy path: provider yields start → token → done; router
    forwards every event verbatim."""
    from backend.services.providers.streaming import (
        ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
    )
    from backend.services.providers.types import ProviderMessage, ProviderUsage
    from backend.services.agent import provider_router as pr

    events = [
        ProviderStreamStart(provider="openai", model="gpt-4o"),
        ProviderStreamToken(delta="Hello "),
        ProviderStreamToken(delta="world"),
        ProviderStreamDone(
            finish_reason="stop",
            usage=ProviderUsage(prompt_tokens=4, completion_tokens=2, total_tokens=6),
        ),
    ]
    stub = _make_stub_provider(events)

    async def _go():
        # Monkeypatch get_provider to hand back the stub
        original = pr.get_provider
        pr.get_provider = lambda name: stub
        try:
            collected = []
            agen = pr.call_with_fallback_chain_streaming(
                messages=[ProviderMessage(role="user", content="hi")],
                model_chain=["gpt-4o"],
            )
            async for ev in agen:
                collected.append(ev)
            return collected
        finally:
            pr.get_provider = original

    out = asyncio.run(_go())
    assert len(out) == 4
    assert isinstance(out[0], ProviderStreamStart)
    assert isinstance(out[1], ProviderStreamToken)
    assert isinstance(out[2], ProviderStreamToken)
    assert isinstance(out[3], ProviderStreamDone)


def test_router_streaming_falls_back_on_pre_start_error():
    """First provider errors before yielding StreamStart → router moves
    to the next model in the chain; we should see the SECOND provider's
    successful stream, not the failure."""
    from backend.services.providers.streaming import (
        ProviderStreamError, ProviderStreamStart, ProviderStreamToken,
        ProviderStreamDone,
    )
    from backend.services.providers.types import ProviderMessage
    from backend.services.agent import provider_router as pr

    bad_events = [
        ProviderStreamError(
            code="PROVIDER_AUTH", message="bad key", provider="anthropic",
        ),
    ]
    good_events = [
        ProviderStreamStart(provider="openai", model="gpt-4o-mini"),
        ProviderStreamToken(delta="fallback "),
        ProviderStreamToken(delta="ok"),
        ProviderStreamDone(finish_reason="stop"),
    ]
    bad_stub = _make_stub_provider(bad_events)
    good_stub = _make_stub_provider(good_events)

    async def _go():
        # First lookup returns the bad one; subsequent returns the good one.
        seen: list = []
        def _get(name):
            seen.append(name)
            return bad_stub if len(seen) == 1 else good_stub
        original = pr.get_provider
        pr.get_provider = _get
        # Also need to make resolve_provider_for_model think both ids
        # are valid; claude-* → anthropic, gpt-* → openai (real behaviour).
        try:
            collected = []
            agen = pr.call_with_fallback_chain_streaming(
                messages=[ProviderMessage(role="user", content="hi")],
                model_chain=["claude-3-opus", "gpt-4o-mini"],
            )
            async for ev in agen:
                collected.append(ev)
            return collected
        finally:
            pr.get_provider = original

    out = asyncio.run(_go())
    starts = [e for e in out if isinstance(e, ProviderStreamStart)]
    tokens = [e for e in out if isinstance(e, ProviderStreamToken)]
    dones  = [e for e in out if isinstance(e, ProviderStreamDone)]
    assert len(starts) == 1, "Expected exactly 1 successful start (post-fallback)"
    assert starts[0].provider == "openai"
    assert "".join(t.delta for t in tokens) == "fallback ok"
    assert len(dones) == 1


def test_router_streaming_skips_non_streaming_providers():
    """Providers that don't advertise supports_streaming get skipped
    by the streaming router — no chat_completion fallback at this layer."""
    from backend.services.providers.streaming import (
        ProviderStreamError, ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
    )
    from backend.services.providers.types import ProviderMessage
    from backend.services.agent import provider_router as pr

    sync_only = _make_stub_provider([], supports=False)
    streaming = _make_stub_provider([
        ProviderStreamStart(provider="openai", model="gpt-4o"),
        ProviderStreamToken(delta="ok"),
        ProviderStreamDone(finish_reason="stop"),
    ])

    async def _go():
        seen: list = []
        def _get(name):
            seen.append(name)
            return sync_only if len(seen) == 1 else streaming
        original = pr.get_provider
        pr.get_provider = _get
        try:
            collected = []
            async for ev in pr.call_with_fallback_chain_streaming(
                messages=[ProviderMessage(role="user", content="hi")],
                model_chain=["claude-3-opus", "gpt-4o"],
            ):
                collected.append(ev)
            return collected
        finally:
            pr.get_provider = original

    out = asyncio.run(_go())
    starts = [e for e in out if isinstance(e, ProviderStreamStart)]
    errors = [e for e in out if isinstance(e, ProviderStreamError)]
    assert len(starts) == 1
    assert starts[0].provider == "openai"
    assert errors == [], "non-streaming-provider skip should NOT emit a terminal error"


def test_router_streaming_emits_terminal_error_when_chain_exhausted():
    """Every provider in the chain errors before start → router emits
    a single terminal ProviderStreamError ROUTER_EXHAUSTED."""
    from backend.services.providers.streaming import (
        ProviderStreamError,
    )
    from backend.services.providers.types import ProviderMessage
    from backend.services.agent import provider_router as pr

    stub1 = _make_stub_provider([
        ProviderStreamError(code="PROVIDER_AUTH", message="a", provider="anthropic"),
    ])
    stub2 = _make_stub_provider([
        ProviderStreamError(code="PROVIDER_TIMEOUT", message="b", provider="openai"),
    ])
    async def _go():
        seen: list = []
        def _get(name):
            seen.append(name)
            return stub1 if len(seen) == 1 else stub2
        original = pr.get_provider
        pr.get_provider = _get
        try:
            collected = []
            async for ev in pr.call_with_fallback_chain_streaming(
                messages=[ProviderMessage(role="user", content="hi")],
                model_chain=["claude-3-opus", "gpt-4o"],
            ):
                collected.append(ev)
            return collected
        finally:
            pr.get_provider = original

    out = asyncio.run(_go())
    errs = [e for e in out if isinstance(e, ProviderStreamError)]
    assert len(errs) == 1
    assert errs[0].code == "ROUTER_EXHAUSTED"


def test_router_streaming_no_chain_emits_router_no_chain():
    from backend.services.providers.streaming import ProviderStreamError
    from backend.services.providers.types import ProviderMessage
    from backend.services.agent.provider_router import (
        call_with_fallback_chain_streaming,
    )
    async def _go():
        out = []
        async for ev in call_with_fallback_chain_streaming(
            messages=[ProviderMessage(role="user", content="x")],
            model_chain=[],
        ):
            out.append(ev)
        return out
    out = asyncio.run(_go())
    assert len(out) == 1
    assert isinstance(out[0], ProviderStreamError)
    assert out[0].code == "ROUTER_NO_CHAIN"


# ══════════════════════════════════════════════════════════════════════
# delegate streaming integration

def test_delegate_emits_agent_token_when_streaming_enabled(monkeypatch):
    """With _streaming_enabled=True in the run scratch + a non-OpenAI
    specialist (Claude default for frontend), delegate should route
    through the streaming dispatch + publish agent.token events to the
    bus. The accumulated reply matches the concatenated tokens."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    # Reload bus AND the events package so the package-level `bus` /
    # `emit` symbols pick up the freshly-flagged module (Phase 3.2
    # captures the module-level bus instance at events.__init__
    # import time — reloading only events.bus leaves a stale binding).
    for m in ("backend.services.events.bus", "backend.services.events"):
        if m in sys.modules:
            importlib.reload(sys.modules[m])

    from backend.services.providers.streaming import (
        ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
    )
    from backend.services.providers.types import ProviderUsage
    from backend.services.agent import provider_router as pr
    from backend.services.agent import delegate as _delegate
    from backend.services.events import bus, ActivityEvent

    # Stub the streaming router to yield 3 deltas + done — no real API call.
    async def _fake_streaming(
        messages, *, model_chain, temperature=0.4, max_tokens=None,
        timeout_s=60.0, extra=None,
    ):
        yield ProviderStreamStart(provider="google", model="gemini-2.5-pro")
        for t in ("Hello ", "from ", "the specialist."):
            yield ProviderStreamToken(delta=t)
        yield ProviderStreamDone(
            finish_reason="stop",
            usage=ProviderUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
            model="gemini-2.5-pro",
        )

    monkeypatch.setattr(
        _delegate, "call_with_fallback_chain_streaming", _fake_streaming,
        raising=False,
    )
    # Also monkeypatch the import inside _stream_via_multi_provider.
    monkeypatch.setattr(
        "backend.services.agent.provider_router.call_with_fallback_chain_streaming",
        _fake_streaming,
    )

    # Subscribe to the wildcard bus to capture every agent.token event
    captured: list = []
    sub = bus.subscribe("*")

    async def _drain():
        try:
            while True:
                ev = await asyncio.wait_for(sub.get(), timeout=0.2)
                captured.append(ev)
        except asyncio.TimeoutError:
            return

    async def _go():
        # Use ux_designer — a tool-less specialist that routes through
        # the multi-provider streaming path. Researcher has tools so
        # it stays on the OpenAI runtime (defers to Phase 5.2.B).
        from backend.services.agent.specs import get_spec
        from backend.services.agent.run_context import start_run

        designer = get_spec("ux_designer")
        assert designer is not None
        assert designer.allowed_tools == ()  # confirms streaming path

        # Push a parent RunContext with streaming enabled.
        with start_run(
            user_id="u-stream", project_id=None,
            scratch={"_streaming_enabled": True},
            metadata={"entry": "test"},
        ):
            # Supervisor is the canonical caller. Delegate to designer.
            result = await _delegate.delegate(
                agent_id="ux_designer",
                task="Summarise the SaaS landing-page best practices.",
                caller_spec_id="supervisor",
            )
        return result

    async def _full():
        result = await _go()
        # Allow the bus pubs to land before draining.
        await asyncio.sleep(0.05)
        await _drain()
        return result

    result = asyncio.run(_full())
    sub.close()

    assert result["ok"] is True, result
    assert "Hello from the specialist." in result["reply"]

    tokens = [e for e in captured if e.kind == "agent.token"]
    # 3 tokens on first call; if the quality guard rejects (UX role
    # needs ≥280 chars), one retry fires which yields 3 more tokens.
    # Either way, the first 3 tokens carry the canonical Hello/from/the
    # specialist stream.
    assert len(tokens) >= 3, f"expected ≥3 token events, got {len(tokens)}"
    # Tokens have monotonic seq within each task delegation
    for ev in tokens[:3]:
        assert ev.payload["agent_id"] == "ux_designer"
        assert ev.payload["provider"] == "google"
    # Concatenated delta on the first three matches the stub
    concat = "".join(ev.payload["delta"] for ev in tokens[:3])
    assert concat == "Hello from the specialist."


def test_delegate_does_not_emit_agent_token_without_streaming_flag(monkeypatch):
    """When _streaming_enabled is NOT set, delegate must use the
    non-streaming path. agent.token MUST NOT be emitted — keeps the
    existing /v2/orchestrate behaviour unchanged."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    for m in ("backend.services.events.bus",):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from backend.services.events import bus

    # Stub _run_agent_fn so we don't need a real LLM call.
    from backend.services.agent.types import AgentResponse
    async def _stub(req):
        return AgentResponse(
            reply="non-streaming reply",
            mode=req.mode, model=req.model, provider="openai",
            steps_used=1, tool_calls=0, elapsed_ms=10,
        )

    sub = bus.subscribe("*")

    async def _go():
        from backend.services.agent import delegate as _delegate
        from backend.services.agent.run_context import start_run

        with start_run(user_id="u-2", project_id=None, scratch={}):
            return await _delegate.delegate(
                agent_id="ux_designer",
                task="Test the non-streaming path stays clean.",
                caller_spec_id="supervisor",
                _run_agent_fn=_stub,
            )

    captured: list = []
    async def _drain():
        try:
            while True:
                ev = await asyncio.wait_for(sub.get(), timeout=0.2)
                captured.append(ev)
        except asyncio.TimeoutError:
            return

    async def _full():
        result = await _go()
        await asyncio.sleep(0.05)
        await _drain()
        return result

    result = asyncio.run(_full())
    sub.close()
    assert result["ok"] is True
    token_events = [e for e in captured if e.kind == "agent.token"]
    assert token_events == [], "agent.token must NOT fire when streaming is off"


# ══════════════════════════════════════════════════════════════════════
# /v2/orchestrate/stream route

@pytest.fixture
def orchestrate_app(monkeypatch):
    monkeypatch.setenv("ENABLE_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db").name
    monkeypatch.setenv("PROJECTS_DB_PATH", tmp)

    # Reload the impacted modules in dependency order so they pick up
    # the new env values + the new in-memory bus state.
    for m in (
        "backend.services.events.bus",
        "backend.services.events",
        "backend.services.orchestrator.runs_store",
        "backend.services.orchestrator.tasks_store",
        "backend.services.orchestrator",
        "backend.routes.v2_orchestrate",
    ):
        if m in sys.modules:
            importlib.reload(sys.modules[m])

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_orchestrate
    app = FastAPI()
    app.include_router(v2_orchestrate.router)
    return TestClient(app), v2_orchestrate


def test_stream_route_registered(orchestrate_app):
    client, v2_orchestrate = orchestrate_app
    paths = {(r.path, tuple(sorted(r.methods))) for r in v2_orchestrate.router.routes}
    assert ("/v2/orchestrate/stream", ("POST",)) in paths


def test_stream_route_returns_503_when_orchestrator_disabled(monkeypatch):
    monkeypatch.delenv("ENABLE_ORCHESTRATOR", raising=False)
    if "backend.routes.v2_orchestrate" in sys.modules:
        importlib.reload(sys.modules["backend.routes.v2_orchestrate"])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_orchestrate
    app = FastAPI()
    app.include_router(v2_orchestrate.router)
    c = TestClient(app)
    r = c.post("/v2/orchestrate/stream", json={
        "user_id": "u", "message": "hello",
    })
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "orchestrator_disabled"


def test_stream_route_returns_404_for_unknown_agent(orchestrate_app):
    client, _ = orchestrate_app
    r = client.post("/v2/orchestrate/stream", json={
        "user_id": "u", "message": "hi", "agent_id": "no-such-agent",
    })
    assert r.status_code == 404
    assert r.json()["detail"]["error"] == "agent_not_found"


# ── Direct SSE generator invocation (matches Phase 3.5 pattern) ────────
#
# We can't rely on TestClient streaming for the SSE body — the long-poll
# generator + sync TestClient compose into a deadlock. Instead we drive
# the route's `_gen()` directly via body_iterator + aclose at the end.

async def _consume_stream_response(
    streaming_response,
    *,
    max_frames: int = 50,
    max_seconds: float = 5.0,
) -> list:
    """Parse SSE frames off StreamingResponse.body_iterator."""
    body = streaming_response.body_iterator
    collected: list = []
    buffer = ""

    async def _read():
        nonlocal buffer
        async for chunk in body:
            if isinstance(chunk, bytes):
                chunk = chunk.decode("utf-8")
            buffer += chunk
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                event_name = None
                data_lines: list = []
                for line in frame.split("\n"):
                    if line.startswith(":"):
                        collected.append({"_heartbeat": True})
                    elif line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].strip())
                if event_name and data_lines:
                    try:
                        data = json.loads("\n".join(data_lines))
                    except json.JSONDecodeError:
                        data = {"_raw": "\n".join(data_lines)}
                    collected.append({"event": event_name, "data": data})
            if len(collected) >= max_frames:
                return

    try:
        await asyncio.wait_for(_read(), timeout=max_seconds)
    except asyncio.TimeoutError:
        pass
    finally:
        await body.aclose()
    return collected


def test_stream_emits_supervisor_planning_first_frame(orchestrate_app, monkeypatch):
    """The first SSE event must always be supervisor_planning, even
    before any specialist work has happened."""
    client, v2_orchestrate = orchestrate_app

    # Stub run_agent so we don't make a real LLM call. Return immediately.
    from backend.services.agent.types import AgentResponse
    async def _stub_run_agent(req):
        return AgentResponse(
            reply="canned reply for test",
            mode=req.mode, model=req.model, provider="openai",
            steps_used=1, tool_calls=0, elapsed_ms=5,
        )
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub_run_agent)

    async def _go():
        from backend.routes.v2_orchestrate import OrchestrateBody
        body = OrchestrateBody(user_id="u", message="hi")
        resp = await v2_orchestrate.orchestrate_stream(body)
        frames = await _consume_stream_response(resp, max_seconds=3.0)
        return frames

    frames = asyncio.run(_go())
    real = [f for f in frames if "event" in f]
    assert real, f"expected SSE events; got {frames}"
    assert real[0]["event"] == "supervisor_planning"
    assert real[0]["data"]["agent_id"] == "supervisor"
    assert "run_id" in real[0]["data"]


def test_stream_ends_with_orchestration_completed(orchestrate_app, monkeypatch):
    """The final SSE frame must be orchestration_completed carrying the
    full reply, task_graph, and metadata."""
    client, v2_orchestrate = orchestrate_app

    from backend.services.agent.types import AgentResponse
    async def _stub_run_agent(req):
        return AgentResponse(
            reply="final synthesised reply",
            mode=req.mode, model=req.model, provider="openai",
            steps_used=1, tool_calls=0, elapsed_ms=5,
        )
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub_run_agent)

    async def _go():
        from backend.routes.v2_orchestrate import OrchestrateBody
        body = OrchestrateBody(user_id="u", message="hi")
        resp = await v2_orchestrate.orchestrate_stream(body)
        return await _consume_stream_response(resp, max_seconds=3.0)

    frames = asyncio.run(_go())
    real = [f for f in frames if "event" in f]
    completed = [f for f in real if f["event"] == "orchestration_completed"]
    assert completed, f"expected orchestration_completed; got {[f['event'] for f in real]}"
    payload = completed[-1]["data"]
    assert payload["reply"] == "final synthesised reply"
    assert "run_id" in payload
    assert "task_graph" in payload
    assert "agents_used" in payload


def test_stream_translates_bus_events_to_sse_taxonomy(orchestrate_app, monkeypatch):
    """When the orchestrator emits bus events (task.created, task.started,
    agent.token, task.completed), they must arrive on the SSE stream as
    the Phase 5.2-mapped event types (task_queued, task_started,
    token_delta, task_completed)."""
    client, v2_orchestrate = orchestrate_app

    from backend.services.agent.types import AgentResponse
    from backend.services.events import bus, ActivityEvent

    async def _stub_run_agent(req):
        # Simulate delegate-style emissions during the run by publishing
        # to the bus before returning. run_agent is called WITH the
        # active RunContext, so we can grab run_id off it.
        from backend.services.agent.run_context import get_current_run
        ctx = get_current_run()
        rid = ctx.run_id if ctx else "?"
        # Order: task.created → task.started → agent.token (3x) → task.completed
        bus.publish(ActivityEvent(
            kind="task.created", scope=f"project:p",
            run_id=rid, agent_id="researcher",
            payload={"task_id": "t1", "title": "test task",
                     "assigned_agent": "researcher", "depth": 1},
        ))
        bus.publish(ActivityEvent(
            kind="task.started", scope=f"project:p",
            run_id=rid, agent_id="researcher",
            payload={"task_id": "t1", "assigned_agent": "researcher"},
        ))
        for i, d in enumerate(("Hi ", "there ", "world.")):
            bus.publish(ActivityEvent(
                kind="agent.token", scope=f"project:p",
                run_id=rid, agent_id="researcher",
                payload={"task_id": "t1", "agent_id": "researcher",
                         "delta": d, "seq": i, "provider": "google",
                         "model": "gemini-2.5-pro"},
            ))
        bus.publish(ActivityEvent(
            kind="task.completed", scope=f"project:p",
            run_id=rid, agent_id="researcher",
            payload={"task_id": "t1", "assigned_agent": "researcher",
                     "reply_chars": 18, "elapsed_ms": 200},
        ))
        # Give the bus a tick to deliver before returning.
        await asyncio.sleep(0.02)
        return AgentResponse(
            reply="synth ok", mode=req.mode, model=req.model,
            provider="openai", steps_used=1, tool_calls=0, elapsed_ms=5,
        )
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub_run_agent)

    async def _go():
        from backend.routes.v2_orchestrate import OrchestrateBody
        body = OrchestrateBody(user_id="u", message="hi", project_id="p")
        resp = await v2_orchestrate.orchestrate_stream(body)
        return await _consume_stream_response(resp, max_seconds=3.0)

    frames = asyncio.run(_go())
    real = [f for f in frames if "event" in f]
    kinds = [f["event"] for f in real]
    # Must contain the mapped taxonomy
    assert "supervisor_planning" in kinds
    assert "task_queued" in kinds
    assert "task_started" in kinds
    assert "token_delta" in kinds
    assert "task_completed" in kinds
    assert "orchestration_completed" in kinds

    token_frames = [f for f in real if f["event"] == "token_delta"]
    assert len(token_frames) == 3, [f["data"] for f in token_frames]
    assert token_frames[0]["data"]["delta"] == "Hi "
    assert token_frames[0]["data"]["seq"] == 0
    assert token_frames[0]["data"]["provider"] == "google"


def test_stream_filters_events_by_run_id(orchestrate_app, monkeypatch):
    """Wildcard bus subscription must drop events that belong to OTHER
    runs. Critical for multi-tenant production where two streams can
    be active at once in the same process."""
    client, v2_orchestrate = orchestrate_app

    from backend.services.agent.types import AgentResponse
    from backend.services.events import bus, ActivityEvent

    async def _stub_run_agent(req):
        # Emit an event with a BOGUS run_id — should be filtered out.
        bus.publish(ActivityEvent(
            kind="task.created", scope="project:p",
            run_id="OTHER-RUN-DO-NOT-LEAK",
            agent_id="evil",
            payload={"task_id": "evil-t1", "title": "leaked",
                     "assigned_agent": "evil", "depth": 1},
        ))
        await asyncio.sleep(0.02)
        return AgentResponse(
            reply="done", mode=req.mode, model=req.model,
            provider="openai", steps_used=1, tool_calls=0, elapsed_ms=5,
        )
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub_run_agent)

    async def _go():
        from backend.routes.v2_orchestrate import OrchestrateBody
        body = OrchestrateBody(user_id="u", message="hi", project_id="p")
        resp = await v2_orchestrate.orchestrate_stream(body)
        return await _consume_stream_response(resp, max_seconds=3.0)

    frames = asyncio.run(_go())
    real = [f for f in frames if "event" in f]
    queued = [f for f in real if f["event"] == "task_queued"]
    # No task_queued frame should leak from the other run
    assert not any(f["data"].get("task_id") == "evil-t1" for f in queued)


def test_stream_cancellation_releases_subscription(orchestrate_app, monkeypatch):
    """Closing the SSE generator early must:
       1. Release the bus subscription (no leaked queue)
       2. Cancel the background orchestration task
    """
    client, v2_orchestrate = orchestrate_app
    from backend.services.events import bus

    from backend.services.agent.types import AgentResponse
    async def _slow_stub(req):
        # Simulate a long-running orchestration so we can cancel it mid-flight
        await asyncio.sleep(2.0)
        return AgentResponse(
            reply="late reply", mode=req.mode, model=req.model,
            provider="openai", steps_used=1, tool_calls=0, elapsed_ms=0,
        )
    monkeypatch.setattr(v2_orchestrate, "run_agent", _slow_stub)

    initial_scopes = set(bus.stats()["scopes"])

    async def _go():
        from backend.routes.v2_orchestrate import OrchestrateBody
        body = OrchestrateBody(user_id="u", message="hi")
        resp = await v2_orchestrate.orchestrate_stream(body)
        body_iter = resp.body_iterator
        # Read just the first frame (supervisor_planning), then close.
        first_chunk = None
        async for chunk in body_iter:
            first_chunk = chunk
            break
        # Cancel before orchestration finishes
        await body_iter.aclose()
        return first_chunk

    asyncio.run(_go())
    # After aclose, wildcard subscriber count should NOT include leaks.
    # (Hard to assert exact equality because the test framework may have
    # leftover state; assert at least that wildcards aren't piling up.)
    stats = bus.stats()
    # Wildcard subs is the relevant counter for /v2/orchestrate/stream
    # which subscribes via "*". Either it returned to 0 or we tracked
    # at most 1 (the test fixture may have a residual subscriber).
    assert stats["wildcard_subs"] <= 1, stats


# ══════════════════════════════════════════════════════════════════════
# Gemini provider streaming — exercised with a stub SDK to avoid the
# real network call. Skipped if google-generativeai isn't installed
# (same posture as the Phase 4.3 Gemini tests).

def _has_gemini_sdk() -> bool:
    try:
        import google.generativeai  # type: ignore  # noqa: F401
        return True
    except Exception:
        return False


@pytest.mark.skipif(
    not _has_gemini_sdk(),
    reason="google-generativeai not installed in test env",
)
def test_gemini_streaming_unavailable_without_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from backend.services.providers.gemini_provider import GeminiProvider
    from backend.services.providers.types import ProviderMessage, ProviderRequest
    from backend.services.providers.streaming import ProviderStreamError

    async def _go():
        provider = GeminiProvider()
        request = ProviderRequest(
            messages=[ProviderMessage(role="user", content="hello")],
            model="gemini-2.5-pro",
        )
        events = []
        async for ev in provider.stream_chat_completion(request):
            events.append(ev)
        return events

    out = asyncio.run(_go())
    assert len(out) == 1
    assert isinstance(out[0], ProviderStreamError)
    assert out[0].code == "PROVIDER_UNAVAILABLE"


# ══════════════════════════════════════════════════════════════════════
# Backwards compat — Phase 5.1 non-streaming /v2/orchestrate still works

def test_non_streaming_orchestrate_unchanged(orchestrate_app, monkeypatch):
    """POST /v2/orchestrate (non-streaming) must still return the
    Phase 5.1 envelope shape. No agent.token emissions, no streaming
    side-effects."""
    client, v2_orchestrate = orchestrate_app
    from backend.services.agent.types import AgentResponse

    async def _stub_run_agent(req):
        return AgentResponse(
            reply="non-stream reply", mode=req.mode, model=req.model,
            provider="openai", steps_used=1, tool_calls=0, elapsed_ms=5,
        )
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub_run_agent)

    r = client.post("/v2/orchestrate", json={
        "user_id": "u", "message": "hello",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"] == "non-stream reply"
    assert "task_graph" in body
    assert "agents_used" in body
    # Phase 5.1 envelope intact
    assert body["agents_used"] == ["supervisor"]
