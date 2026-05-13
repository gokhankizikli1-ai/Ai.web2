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


# ── Phase 7a — protected route gating ───────────────────────────────────

def test_require_auth_default_off_anonymous_ok(client, monkeypatch):
    """Default: ENABLE_AGENT_REQUIRE_AUTH off → anonymous calls keep
    working as today (back-compat with Phase 6d clients)."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("ENABLE_AGENT_REQUIRE_AUTH", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 200
    # auth block in metadata signals gating state.
    auth = r.json()["metadata"]["auth"]
    assert auth["required"] is False
    assert auth["user_kind"] == "guest"


def test_require_auth_on_without_middleware_returns_401(client, monkeypatch):
    """ENABLE_AGENT_REQUIRE_AUTH=true but no AuthMiddleware installed
    (ENABLE_AUTH_V2 off) → fail closed with 401. Catches the operator
    mistake of enabling agent auth while leaving global auth off."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.setenv("ENABLE_AGENT_REQUIRE_AUTH", "true")
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 401
    detail = r.json().get("detail") or {}
    assert detail.get("code") == "AGENT_AUTH_REQUIRED"
    assert "ENABLE_AGENT_REQUIRE_AUTH" in detail.get("message", "")


def test_require_auth_on_blocks_before_agent_runs(client, monkeypatch):
    """When auth is required and absent, the agent must NOT run — no
    OpenAI client should be constructed, no fallback envelope returned.
    Validates ordering: auth gate fires before agent execution."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.setenv("ENABLE_AGENT_REQUIRE_AUTH", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "expensive query"}],
    })
    assert r.status_code == 401
    # If the agent had run, body would be a 200 envelope with
    # metadata.agent_trace. A 401 has neither.
    assert "metadata" not in r.json()


def test_agent_disabled_takes_precedence_over_auth_gate(client, monkeypatch):
    """When BOTH gates would reject, ENABLE_AGENT=false wins (400 not
    401). This keeps the disabled-by-default signal loudest for
    callers probing capability."""
    monkeypatch.delenv("ENABLE_AGENT", raising=False)
    monkeypatch.setenv("ENABLE_AGENT_REQUIRE_AUTH", "true")
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 400
    assert (r.json().get("detail") or {}).get("code") == "AGENT_DISABLED"


def test_body_user_id_used_when_unauthenticated(client, monkeypatch):
    """Without auth required and no JWT, the body's user_id flows
    through to the agent (legacy behaviour)."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("ENABLE_AGENT_REQUIRE_AUTH", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/execute", json={
        "messages": [{"role": "user", "content": "hi"}],
        "user_id":  "ext-user-42",
    })
    assert r.status_code == 200
    assert r.json()["metadata"]["auth"]["user_id"] == "ext-user-42"
