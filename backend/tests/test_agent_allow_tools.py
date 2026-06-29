# coding: utf-8
"""Bug-2 regression — `allow_tools=False` exposes NO tools to the model.

The project-run path sets allow_tools=False so the model never emits
tool_calls — sidestepping the OpenAI "assistant message with tool_calls
must be followed by tool messages responding to each tool_call_id"
contract error that the runtime's truncating tool loop can trigger.

These tests stub the OpenAI client + tools_for_spec so they're offline
and don't depend on the tool registry / ENABLE_TOOLS flags.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import backend.services.agent.runtime as rt
from backend.services.agent.types import AgentRequest


def _spec():
    return SimpleNamespace(
        id="researcher", allowed_tools=["x"], can_delegate=False,
        system_prompt="", temperature=0.4, max_steps=2,
        default_model="gpt-4o-mini", kind="specialist",
    )


def _install_fakes(monkeypatch, captured):
    # tools_for_spec would normally return a non-empty tool list.
    monkeypatch.setattr(
        rt, "tools_for_spec",
        lambda spec: [{"type": "function",
                       "function": {"name": "x", "parameters": {}}}],
    )

    class _Msg:
        content = "a non-empty reply"
        tool_calls = None

    class _Choice:
        message = _Msg()
        finish_reason = "stop"

    class _Completion:
        choices = [_Choice()]

    class _Chat:
        class completions:
            @staticmethod
            async def create(**kw):
                captured.update(kw)
                return _Completion()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr(rt, "_openai_client", lambda: _Client())


@pytest.mark.asyncio
async def test_allow_tools_false_sends_no_tools(monkeypatch):
    captured: dict = {}
    _install_fakes(monkeypatch, captured)
    resp = await rt.run_agent(AgentRequest(
        user_message="hi", mode="researcher", user_id="u",
        spec=_spec(), allow_tools=False, max_steps=2,
    ))
    # No tools handed to OpenAI → no tool_calls round → no contract error.
    assert captured.get("tools") is None
    assert captured.get("tool_choice") is None
    assert resp.reply  # non-empty deliverable content


@pytest.mark.asyncio
async def test_allow_tools_true_still_sends_tools(monkeypatch):
    """Control: default behaviour (/chat + /v2/orchestrate) is unchanged —
    tools are still exposed when allow_tools is left at its default."""
    captured: dict = {}
    _install_fakes(monkeypatch, captured)
    resp = await rt.run_agent(AgentRequest(
        user_message="hi", mode="researcher", user_id="u",
        spec=_spec(), max_steps=2,   # allow_tools defaults True
    ))
    assert captured.get("tools") is not None
    assert resp.reply
