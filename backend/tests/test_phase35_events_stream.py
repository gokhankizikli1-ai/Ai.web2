# coding: utf-8
"""Phase 3.5 — /v2/events/stream SSE route tests.

Covers:
  • Flag gating (ENABLE_REALTIME_EVENTS=false → 503)
  • Health endpoint always callable + content-type signal
  • Subscribers actually receive events published to their scope
  • Wildcard subscribers receive every event
  • Cross-scope isolation (project A doesn't see project B)
  • Disconnect / cancellation cleanly unregisters the bus subscription

Approach:
  - HTTP-level tests use TestClient WITHOUT entering the streaming
    body (those would deadlock — the SSE generator awaits new events
    and TestClient.stream's context manager exit + ASGI cancellation
    don't compose cleanly under pytest's sync runner).
  - Streaming-behaviour tests invoke the route's async generator
    directly via asyncio.run + the StreamingResponse.body_iterator,
    fully under our control. The generator is cancelled explicitly
    when we're done so the bus subscription is unregistered.
"""
import asyncio
import importlib
import json
import os
import sys

import pytest


# ── Fixture: app + sync client for HTTP-level checks ──────────────────

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    for m in ("backend.services.events.bus", "backend.routes.v2_events"):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_events
    app = FastAPI()
    app.include_router(v2_events.router)
    return TestClient(app)


# ── Health / flag gating (HTTP-level, no streaming body) ──────────────

def test_health_reports_enabled(client):
    r = client.get("/v2/events/health")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert "stats" in body


def test_health_callable_when_disabled(monkeypatch):
    monkeypatch.delenv("ENABLE_REALTIME_EVENTS", raising=False)
    if "backend.routes.v2_events" in sys.modules:
        importlib.reload(sys.modules["backend.routes.v2_events"])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_events
    app = FastAPI()
    app.include_router(v2_events.router)
    c = TestClient(app)
    r = c.get("/v2/events/health")
    assert r.status_code == 200
    assert r.json()["enabled"] is False


def test_stream_returns_503_when_disabled(monkeypatch):
    monkeypatch.delenv("ENABLE_REALTIME_EVENTS", raising=False)
    if "backend.routes.v2_events" in sys.modules:
        importlib.reload(sys.modules["backend.routes.v2_events"])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routes import v2_events
    app = FastAPI()
    app.include_router(v2_events.router)
    c = TestClient(app)
    r = c.get("/v2/events/stream?scope=project:abc")
    assert r.status_code == 503
    assert r.json()["detail"]["error"] == "realtime_events_disabled"


# ── Streaming behaviour — direct route invocation ─────────────────────
#
# We call stream() directly to get the StreamingResponse, then iterate
# its body_iterator inside asyncio.run(). This sidesteps TestClient's
# sync-vs-ASGI streaming deadlock and gives us full control over when
# the generator is cancelled (which is what causes the bus to
# unregister the subscription).

async def _consume_stream(
    scope: str,
    *,
    publish_fn=None,
    heartbeat: float = 0.05,
    publish_after: float = 0.02,
    max_frames: int = 6,
    max_seconds: float = 1.5,
) -> list[dict]:
    """Open the route's StreamingResponse, optionally publish events
    from a background coroutine, parse the SSE frames, return the
    parsed list. Always cancels the generator on exit."""
    from backend.routes import v2_events
    from backend.services.events import bus

    # Sprint 1.2: authorization now lives in the HTTP `stream` route; the
    # streaming mechanics live in `_open_stream`. These tests exercise the
    # bus/streaming behaviour, so they drive `_open_stream` directly with an
    # already-authorized scope. HTTP-level scope authorization is covered by
    # the Sprint 1.2 security tests.
    resp = v2_events._open_stream(scope, heartbeat)
    body = resp.body_iterator   # AsyncGenerator[str | bytes, None]

    async def _publisher():
        await asyncio.sleep(publish_after)
        if publish_fn:
            publish_fn(bus)

    pub_task = asyncio.create_task(_publisher())
    collected: list[dict] = []
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
                data_lines: list[str] = []
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
        pub_task.cancel()
        try: await pub_task
        except (asyncio.CancelledError, Exception): pass
        # Cancel the generator so the bus subscription is released.
        await body.aclose()

    return collected


def test_stream_emits_ready_frame_on_open(client, monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    events = asyncio.run(_consume_stream("project:abc", max_frames=1))
    ready = [e for e in events if e.get("event") == "ready"]
    assert ready, f"expected a 'ready' frame; got {events}"
    assert ready[0]["data"]["scope"] == "project:abc"


def test_subscriber_receives_published_event(client, monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    from backend.services.events import ActivityEvent

    def _publish(bus):
        bus.publish(ActivityEvent(
            kind="run.started", scope="project:alpha",
            run_id="r-1", payload={"hello": "world"},
        ))

    events = asyncio.run(_consume_stream(
        "project:alpha", publish_fn=_publish, max_frames=3,
    ))
    run_started = [e for e in events if e.get("event") == "run.started"]
    assert run_started, f"expected run.started; got {events}"
    assert run_started[0]["data"]["payload"] == {"hello": "world"}
    assert run_started[0]["data"]["run_id"] == "r-1"


def test_subscriber_does_not_receive_other_scopes(client, monkeypatch):
    """Project A's stream must NOT receive events scoped to Project B."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    from backend.services.events import ActivityEvent

    def _publish(bus):
        bus.publish(ActivityEvent(
            kind="run.started", scope="project:other",
            run_id="r-x", payload={},
        ))

    events = asyncio.run(_consume_stream(
        "project:alpha", publish_fn=_publish, max_frames=2, max_seconds=0.5,
    ))
    kinds = {e["event"] for e in events if "event" in e}
    assert "run.started" not in kinds   # cross-scope leak would fail this
    # We still expect the 'ready' frame for our requested scope
    assert "ready" in kinds


def test_wildcard_subscriber_receives_all_scopes(client, monkeypatch):
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    from backend.services.events import ActivityEvent

    def _publish(bus):
        for scope in ("project:a", "project:b", "user:u-1"):
            bus.publish(ActivityEvent(
                kind="agent.started", scope=scope,
                agent_id="researcher", payload={},
            ))

    events = asyncio.run(_consume_stream(
        "*", publish_fn=_publish, max_frames=5,
    ))
    agent_starts = [e for e in events if e.get("event") == "agent.started"]
    scopes_seen = {e["data"]["scope"] for e in agent_starts}
    assert scopes_seen >= {"project:a", "project:b", "user:u-1"}, scopes_seen


def test_disconnect_unregisters_from_bus(client, monkeypatch):
    """When the generator is closed (the SSE consumer disconnects),
    the bus's scope index must drop our subscriber. Without this,
    long-running deployments would leak orphan queues per connection."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    from backend.services.events import bus

    scope = "project:cleanup-test"
    asyncio.run(_consume_stream(scope, max_frames=1, max_seconds=0.5))
    # _consume_stream calls body.aclose() at the end, which triggers
    # the route's with-block exit → Subscription.close() → bus._unregister.
    assert scope not in bus.stats()["scopes"], bus.stats()


def test_disabled_flag_bus_dormant(monkeypatch):
    """Critical safety: with the flag off, the bus is dormant. Even
    if some other code path emits an event, publishers see 0 deliveries
    and subscribers get an inert subscription. Protects production
    behaviour while the flag isn't yet flipped on."""
    monkeypatch.delenv("ENABLE_REALTIME_EVENTS", raising=False)
    if "backend.services.events.bus" in sys.modules:
        importlib.reload(sys.modules["backend.services.events.bus"])
    from backend.services.events import bus, ActivityEvent
    sub = bus.subscribe("project:any")
    assert bus.stats()["subscribers"] == 0
    delivered = bus.publish(ActivityEvent(kind="run.started", scope="project:any"))
    assert delivered == 0
    sub.close()
