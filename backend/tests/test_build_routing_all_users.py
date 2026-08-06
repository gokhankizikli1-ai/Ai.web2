# coding: utf-8
"""
Tests for Web Build planning-provider PARITY: normal ENTITLED users get the same
Claude planning the owner gets (the `all_users` routing mode), while owner_only
stays owner-gated and disabled/shadow keep everyone on OpenAI.

No network: the Anthropic attempt and the OpenAI planner are both injected/mocked,
so these assert the routing/eligibility/fallback/call-count invariants only.
"""
from __future__ import annotations

import asyncio
import types as pytypes

import pytest

from backend.services.build_routing import policy, execution
from backend.services.build_routing.types import (
    MODE_DISABLED, MODE_SHADOW, MODE_OWNER_ONLY, MODE_ALL_USERS,
    PROVIDER_OPENAI, PROVIDER_ANTHROPIC,
)


def _run(coro):
    return asyncio.run(coro)


def _openai_planner(counter):
    async def _p():
        counter["n"] += 1
        return pytypes.SimpleNamespace(model="gpt-4o", latency_ms=10, fallback_used=False, ok=True, text="openai-plan")
    return _p


def _plan(owner_eligible, counter):
    return execution.execute_website_planning(
        message="m", system="s", model="gpt-4o", max_output_tokens=1000, temperature=0.6,
        owner_eligible=owner_eligible, openai_planner=_openai_planner(counter),
    )


# ── Pure eligibility policy ────────────────────────────────────────────────────
@pytest.mark.parametrize("mode,owner,expected", [
    (MODE_DISABLED, True, "none"), (MODE_DISABLED, False, "none"),
    (MODE_SHADOW, True, "none"), (MODE_SHADOW, False, "none"),
    (MODE_OWNER_ONLY, True, "owner"), (MODE_OWNER_ONLY, False, "none"),
    (MODE_ALL_USERS, True, "all_users"), (MODE_ALL_USERS, False, "all_users"),
])
def test_claude_planning_eligibility(mode, owner, expected):
    assert policy.claude_planning_eligible(mode, owner) == expected


# ── all_users: a NORMAL (non-owner) user gets Claude — the parity fix ──────────
def test_all_users_non_owner_executes_claude(monkeypatch):
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_ALL_USERS)

    async def fake_anthropic(**kw):
        return pytypes.SimpleNamespace(ok=True, text="claude-plan", model="claude-x", latency_ms=5)
    monkeypatch.setattr(execution, "_anthropic_website_plan", fake_anthropic)

    counter = {"n": 0}
    res, meta = _run(_plan(owner_eligible=False, counter=counter))
    assert res.text == "claude-plan"                      # normal user got the SAME Claude planner
    assert counter["n"] == 0                               # OpenAI NOT called (single Anthropic call)
    assert meta["executed_provider"] == PROVIDER_ANTHROPIC
    assert meta["routing_eligibility"] == "all_users"
    assert meta["owner_eligible"] is False                 # not owner-gated — parity path
    assert meta["fallback_used"] is False


# ── owner_only: a non-owner still stays on OpenAI (unchanged legacy behavior) ──
def test_owner_only_non_owner_stays_openai(monkeypatch):
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_OWNER_ONLY)

    async def boom(**kw):
        raise AssertionError("Anthropic must not run for a non-owner in owner_only mode")
    monkeypatch.setattr(execution, "_anthropic_website_plan", boom)

    counter = {"n": 0}
    res, meta = _run(_plan(owner_eligible=False, counter=counter))
    assert counter["n"] == 1
    assert meta["executed_provider"] == PROVIDER_OPENAI
    assert meta["routing_eligibility"] == "none"


# ── owner_only: an owner still gets Claude (no owner regression) ──────────────
def test_owner_only_owner_executes_claude(monkeypatch):
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_OWNER_ONLY)

    async def fake_anthropic(**kw):
        return pytypes.SimpleNamespace(ok=True, text="claude-plan", model="claude-x", latency_ms=5)
    monkeypatch.setattr(execution, "_anthropic_website_plan", fake_anthropic)

    counter = {"n": 0}
    res, meta = _run(_plan(owner_eligible=True, counter=counter))
    assert res.text == "claude-plan"
    assert counter["n"] == 0
    assert meta["routing_eligibility"] == "owner"
    assert meta["owner_eligible"] is True


# ── disabled: everyone (even an owner) stays on OpenAI ────────────────────────
def test_disabled_keeps_everyone_on_openai(monkeypatch):
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_DISABLED)

    async def boom(**kw):
        raise AssertionError("Anthropic must never run in disabled mode")
    monkeypatch.setattr(execution, "_anthropic_website_plan", boom)

    counter = {"n": 0}
    res, meta = _run(_plan(owner_eligible=True, counter=counter))
    assert counter["n"] == 1
    assert meta["executed_provider"] == PROVIDER_OPENAI
    assert meta["routing_eligibility"] == "none"


# ── all_users + Anthropic failure → EXACTLY ONE OpenAI fallback (fail-open) ────
def test_all_users_anthropic_failure_single_fallback(monkeypatch):
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_ALL_USERS)

    async def fail_anthropic(**kw):
        return pytypes.SimpleNamespace(ok=False, text="", model="claude-x", latency_ms=5, error_kind="timeout")
    monkeypatch.setattr(execution, "_anthropic_website_plan", fail_anthropic)

    counter = {"n": 0}
    res, meta = _run(_plan(owner_eligible=False, counter=counter))
    assert counter["n"] == 1                               # exactly one OpenAI fallback call
    assert meta["executed_provider"] == PROVIDER_OPENAI
    assert meta["fallback_used"] is True
    assert getattr(res, "fallback_used", False) is True
    assert meta["routing_eligibility"] == "all_users"
    assert meta["error_kind"] == "timeout"


# ── Real anthropic provider genuinely unavailable (no key) → fallback, no raise ─
def test_all_users_provider_unavailable_falls_back(monkeypatch):
    # Do NOT mock _anthropic_website_plan — let it hit the real (unregistered) provider
    # path, which must classify as unavailable and fall back to OpenAI exactly once.
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_ALL_USERS)
    counter = {"n": 0}
    res, meta = _run(_plan(owner_eligible=False, counter=counter))
    assert counter["n"] == 1
    assert meta["executed_provider"] == PROVIDER_OPENAI
    assert meta["fallback_used"] is True


# ── Readiness view reflects all_users and leaks no secrets ────────────────────
def test_readiness_reflects_all_users(monkeypatch):
    monkeypatch.setattr(policy, "routing_mode", lambda: MODE_ALL_USERS)
    r = policy.describe_readiness()
    assert r["routing_mode"] == MODE_ALL_USERS
    assert r["executes_anthropic"] is True
    assert r["targets"]["web_build.planning"]["real_execution"] == "anthropic_for_all_entitled_users"
    # Never exposes a raw key — only a boolean.
    assert isinstance(r["anthropic_provider_configured"], bool)
