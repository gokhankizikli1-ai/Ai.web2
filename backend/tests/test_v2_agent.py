# coding: utf-8
"""
Phase 6d — /v2/agent/execute integration tests.

Goal: exercise the route plumbing without making a real OpenAI call.

When ENABLE_AGENT=false the route returns 400 AGENT_DISABLED.

When ENABLE_AGENT=true but the OpenAI client can't be constructed
(no OPENAI_API_KEY in the test env), `run_agent()` returns a fallback
AgentResponse with `fallback=True` and an empty reply. The route
should surface that as a 200 envelope where data.fallback is True.

These tests don't try to validate the agent's reasoning quality — that
belongs to the agent runtime's own tests. They prove the route's
contract:
  - feature gate behaves
  - request validation rejects malformed input
  - response envelope shape is correct
  - the trace makes it through to metadata.agent_trace
"""
from __future__ import annotations

import pytest


def test_disabled_returns_400(client, monkeypatch):
    monkeypatch.delenv("ENABLE_AGENT", raising=False)
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 400
    detail = (r.json().get("detail") or {})
    assert detail.get("code") == "AGENT_DISABLED"


def test_last_message_must_be_user(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    r = client.post("/v2/agent/execute", json={
        "messages": [
            {"role": "user",      "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ],
    })
    assert r.status_code == 400
    detail = (r.json().get("detail") or {})
    assert detail.get("code") == "BAD_REQUEST"


def test_empty_messages_rejected_by_pydantic(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    r = client.post("/v2/agent/execute", json={"messages": []})
    assert r.status_code == 422   # pydantic validation


def test_runs_and_falls_back_when_no_openai_key(client, monkeypatch):
    """With ENABLE_AGENT=true and no OPENAI_API_KEY, run_agent must
    return a fallback AgentResponse and the route must surface it."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "What is sqrt(144)?"}],
        "mode":     "general",
    })
    assert r.status_code == 200
    body = r.json()
    # Envelope shape
    assert body["success"] is True
    data = body["data"]
    assert data["mode"] == "general"
    assert data["fallback"] is True
    assert data["reply"] == ""
    assert data["tool_calls"] == 0
    # Trace exists and includes the fallback step
    trace = body["metadata"]["agent_trace"]
    assert isinstance(trace, list)
    assert any(step.get("kind") == "fallback" for step in trace)
    # fallback_reason is surfaced through agent_metadata
    meta = body["metadata"]["agent_metadata"]
    assert "fallback_reason" in meta


def test_response_carries_elapsed_ms(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "ping"}],
    })
    assert r.status_code == 200
    assert "elapsed_ms" in r.json()["metadata"]
    assert isinstance(r.json()["metadata"]["elapsed_ms"], int)


def test_oversized_message_rejected(client, monkeypatch):
    """Message content max_length=16_000 — bigger payloads should
    fail pydantic validation BEFORE we attempt to run the agent."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    big = "x" * 16_001
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": big}],
    })
    assert r.status_code == 422


def test_bad_role_rejected_by_pydantic(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "system_user", "content": "hi"}],
    })
    assert r.status_code == 422
