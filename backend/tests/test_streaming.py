# coding: utf-8
"""
Phase 4a streaming smoke tests.

Uses a `FakeStreamingProvider` registered into the provider registry
for the duration of each test. The provider yields a known sequence of
events so we can assert on SSE frame shape without needing a real
OpenAI key.

Coverage:
  - happy-path stream produces ready + tokens + done in the right order
  - upstream error becomes a terminal SSE `error` frame
  - unknown provider name returns 400 (NOT an SSE stream)
  - non-streaming provider returns 400
  - validation: empty messages list is rejected
  - validation: invalid role is rejected
  - SSE frame format (event: / data: / blank line)

All run via TestClient — fully synchronous on top of the streaming
generator (TestClient consumes the iterable as bytes).
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import pytest

from backend.services.providers import KNOWN_PROVIDERS, register_provider
from backend.services.providers.base import BaseAIProvider
from backend.services.providers.registry import _reset_for_tests, get_provider
from backend.services.providers.streaming import (
    ProviderStreamDone,
    ProviderStreamError,
    ProviderStreamEvent,
    ProviderStreamStart,
    ProviderStreamToken,
)
from backend.services.providers.types import (
    ProviderRequest,
    ProviderResult,
    ProviderUsage,
)


# ── Synthetic providers (registered per-test) ────────────────────────────

class FakeStreamingProvider(BaseAIProvider):
    """Yields a fixed sequence of events on every stream call."""
    name = "fake-stream"
    default_model = "fake-1"
    supports_streaming = True

    def __init__(self, events: list[ProviderStreamEvent] | None = None):
        self._events = events or [
            ProviderStreamStart(provider=self.name, model=self.default_model),
            ProviderStreamToken(delta="Hello"),
            ProviderStreamToken(delta=" "),
            ProviderStreamToken(delta="world"),
            ProviderStreamDone(
                finish_reason="stop",
                usage=ProviderUsage(prompt_tokens=4, completion_tokens=3, total_tokens=7),
                model=self.default_model,
            ),
        ]

    def is_available(self) -> bool:
        return True

    async def chat_completion(self, request: ProviderRequest) -> ProviderResult:
        # The non-streaming surface isn't exercised by these tests but
        # the abstract base requires it.
        return ProviderResult(
            content="Hello world",
            model=self.default_model,
            provider=self.name,
        )

    async def stream_chat_completion(self, request: ProviderRequest) -> AsyncIterator[ProviderStreamEvent]:
        for ev in self._events:
            yield ev


class FakeErrorProvider(BaseAIProvider):
    name = "fake-error"
    default_model = "fake-err"
    supports_streaming = True

    def is_available(self) -> bool:
        return True

    async def chat_completion(self, request):
        raise NotImplementedError

    async def stream_chat_completion(self, request):
        yield ProviderStreamStart(provider=self.name, model=self.default_model)
        yield ProviderStreamError(
            code="PROVIDER_RATE_LIMITED",
            message="upstream rate limit reached",
            provider=self.name,
        )


class FakeNonStreamingProvider(BaseAIProvider):
    name = "fake-no-stream"
    default_model = "fake-ns"
    supports_streaming = False

    def is_available(self) -> bool:
        return True

    async def chat_completion(self, request):
        return ProviderResult(content="not implemented", model=self.default_model, provider=self.name)


@pytest.fixture()
def stream_provider():
    register_provider(FakeStreamingProvider())
    yield
    # Registry is process-global; leave the fake registered for other
    # tests in the same module — _reset_for_tests would clear OpenAI too.


@pytest.fixture()
def error_provider():
    register_provider(FakeErrorProvider())
    yield


@pytest.fixture()
def non_streaming_provider():
    register_provider(FakeNonStreamingProvider())
    yield


# ── SSE parser used by every test (single-purpose, dependency-free) ──────

def _parse_sse(body: str) -> list[tuple[str, dict]]:
    """Parse an SSE response body into a list of (event_name, data_dict)."""
    out: list[tuple[str, dict]] = []
    current_event = "message"
    current_data: list[str] = []
    for line in body.split("\n"):
        if line == "":
            if current_data:
                payload = "\n".join(current_data)
                try:
                    parsed = json.loads(payload)
                except json.JSONDecodeError:
                    parsed = {"raw": payload}
                out.append((current_event, parsed))
                current_event = "message"
                current_data = []
            continue
        if line.startswith("event:"):
            current_event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            current_data.append(line.split(":", 1)[1].strip())
    return out


# ── Tests ─────────────────────────────────────────────────────────────────

def test_stream_happy_path(client, stream_provider):
    r = client.post(
        "/v2/chat/stream",
        json={
            "messages":  [{"role": "user", "content": "hi"}],
            "provider":  "fake-stream",
        },
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers.get("cache-control") == "no-cache, no-transform"
    assert r.headers.get("x-accel-buffering") == "no"

    events = _parse_sse(r.text)
    assert events[0][0] == "ready"
    assert events[0][1]["provider"] == "fake-stream"
    assert events[0][1]["model"] == "fake-1"

    # Three token events between ready and done.
    tokens = [(name, data) for name, data in events if name == "token"]
    assert len(tokens) == 3
    assert "".join(t[1]["delta"] for t in tokens) == "Hello world"

    # Terminal done with usage.
    last = events[-1]
    assert last[0] == "done"
    assert last[1]["finish_reason"] == "stop"
    assert last[1]["usage"]["total_tokens"] == 7


def test_stream_terminal_error_event(client, error_provider):
    r = client.post(
        "/v2/chat/stream",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "provider": "fake-error",
        },
    )
    # The HTTP connection succeeds (200); error is communicated via the
    # SSE error event, not the HTTP status.
    assert r.status_code == 200
    events = _parse_sse(r.text)
    assert events[0][0] == "ready"
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "PROVIDER_RATE_LIMITED"
    assert "rate limit" in events[-1][1]["message"]


def test_stream_unknown_provider_returns_400(client):
    r = client.post(
        "/v2/chat/stream",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "provider": "does-not-exist",
        },
    )
    assert r.status_code == 400
    body = r.json()
    detail = body.get("detail") or body
    assert "PROVIDER_NOT_REGISTERED" in json.dumps(detail)


def test_stream_non_streaming_provider_returns_400(client, non_streaming_provider):
    r = client.post(
        "/v2/chat/stream",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "provider": "fake-no-stream",
        },
    )
    assert r.status_code == 400
    body = r.json()
    detail = body.get("detail") or body
    assert "PROVIDER_NO_STREAMING" in json.dumps(detail)


def test_stream_validation_empty_messages(client, stream_provider):
    r = client.post(
        "/v2/chat/stream",
        json={"messages": [], "provider": "fake-stream"},
    )
    assert r.status_code == 422   # FastAPI validation


def test_stream_validation_invalid_role(client, stream_provider):
    r = client.post(
        "/v2/chat/stream",
        json={
            "messages": [{"role": "narrator", "content": "hi"}],
            "provider": "fake-stream",
        },
    )
    assert r.status_code == 422


# ── Capability discovery — providers list now exposes supports_streaming ──

def test_provider_capabilities_include_supports_streaming_flag(client):
    body = client.get("/v2/health").json()
    providers = body["metadata"]["providers"]
    for p in providers:
        assert "name" in p
        # Registered providers report supports_streaming; placeholders
        # don't (they're not yet implemented).
        if p["registered"]:
            assert "supports_streaming" in p
