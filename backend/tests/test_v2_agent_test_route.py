# coding: utf-8
"""
Phase 7c — /v2/agent/test canary route tests.

Goal: verify the route's contract WITHOUT making a real OpenAI call.

Strategy:
  - With ENABLE_AGENT=true and no OPENAI_API_KEY in the test env,
    `run_agent()` falls into its fallback path (reply="", fallback=True,
    trace contains a "fallback" step). This exercises the full request
    pipeline — pydantic validation, route handler, AgentRequest
    construction, agent runtime entry — without burning tokens.
  - For each canary prompt (BTC, NVDA, SPY, calc) we assert:
      * 200 envelope
      * mode == "market" (hard-pinned by the route)
      * data.steps_used <= 4 (hard cap)
      * test_mode marker present in metadata
"""
from __future__ import annotations

import pytest


# ── Gate behaviour ───────────────────────────────────────────────────────

def test_disabled_returns_400(client, monkeypatch):
    monkeypatch.delenv("ENABLE_AGENT", raising=False)
    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": "BTC price"}],
    })
    assert r.status_code == 400
    assert (r.json().get("detail") or {}).get("code") == "AGENT_DISABLED"


def test_last_message_must_be_user(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    r = client.post("/v2/agent/test", json={
        "messages": [
            {"role": "user",      "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ],
    })
    assert r.status_code == 400
    assert (r.json().get("detail") or {}).get("code") == "BAD_REQUEST"


def test_empty_messages_rejected_by_pydantic(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    r = client.post("/v2/agent/test", json={"messages": []})
    assert r.status_code == 422


def test_long_history_rejected_by_pydantic(client, monkeypatch):
    """Hard cap on history length is part of the canary contract."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": f"msg {i}"} for i in range(5)],
    })
    assert r.status_code == 422


def test_auth_required_flag_ignored_by_test_route(client, monkeypatch):
    """ENABLE_AGENT_REQUIRE_AUTH=true should NOT affect /v2/agent/test —
    the canary is meant to work without a token so operators can probe
    it from a deploy hook."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.setenv("ENABLE_AGENT_REQUIRE_AUTH", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": "BTC price"}],
    })
    # 200 (fallback envelope) — not 401.
    assert r.status_code == 200


# ── Canary prompts ───────────────────────────────────────────────────────

@pytest.mark.parametrize("prompt", [
    "What is BTC price?",
    "Analyze NVDA briefly",
    "Quick read on SPY please",
    "Calculate 18% of 2500",
])
def test_canary_prompts_return_safe_envelope(client, monkeypatch, prompt):
    """All four canary prompts go through the same /v2/agent/test path
    and produce the same envelope shape. We don't validate the reply
    text (no real OpenAI in tests) — only the contract."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": prompt}],
    })
    assert r.status_code == 200

    body = r.json()
    data = body["data"]
    meta = body["metadata"]

    # Route contract: hard-pinned mode + steps cap
    assert data["mode"] == "market"
    assert meta["test_mode"]["enabled"] is True
    assert meta["test_mode"]["mode"] == "market"
    assert meta["test_mode"]["max_steps"] == 4

    # Fallback path (no real OpenAI key) — reply empty, fallback flag set
    assert data["fallback"] is True
    assert data["reply"] == ""
    assert data["tool_calls"] == 0

    # Trace + elapsed surface for operators
    assert isinstance(meta["agent_trace"], list)
    assert "elapsed_ms" in meta
    assert any(step.get("kind") == "fallback" for step in meta["agent_trace"])


def test_test_route_does_not_accept_mode_override(client, monkeypatch):
    """Sending a `mode` field in the body must NOT change the route's
    hard-pinned mode. The pydantic model intentionally doesn't include
    a `mode` field, so extras should be silently ignored — the response
    still reports mode='market'."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": "hi"}],
        "mode":     "trading_analyst",   # would-be override
        "model":    "claude-opus",       # would-be override
    })
    assert r.status_code == 200
    assert r.json()["data"]["mode"] == "market"


def test_oversized_message_rejected_by_pydantic(client, monkeypatch):
    monkeypatch.setenv("ENABLE_AGENT", "true")
    big = "x" * 16_001
    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": big}],
    })
    assert r.status_code == 422


# ── Per-request max_steps plumbing (used by /test) ──────────────────────

def test_max_steps_field_threads_through_to_budget(client, monkeypatch):
    """AgentRequest now carries max_steps. /test sets it to 4; the
    response should reflect the cap. Since the test env's run_agent
    falls back before exhausting the budget, steps_used will be 0 —
    but the assertion is that steps_used never exceeds the cap."""
    monkeypatch.setenv("ENABLE_AGENT", "true")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/agent/test", json={
        "messages": [{"role": "user", "content": "test"}],
    })
    assert r.status_code == 200
    assert r.json()["data"]["steps_used"] <= 4
