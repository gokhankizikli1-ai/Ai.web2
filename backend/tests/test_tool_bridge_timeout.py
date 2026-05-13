# coding: utf-8
"""
Phase 7b — verify tool_bridge.dispatch_one honours the per-tool
`timeout_seconds` declared on BaseTool subclasses.

Specifically:
  - When a tool sets a tighter timeout than the caller's default,
    dispatch_one uses the tighter one.
  - When no tool-level timeout is declared (legacy), the caller's
    default is used.
  - A slow tool whose run() exceeds the effective timeout returns a
    `tool_timeout_<n>s` error envelope — never raises.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.agent import tool_bridge
from backend.services.tools.base_tool import BaseTool


# Note: tool_bridge.dispatch_one queries the tool_registry through
# `is_enabled()` + `get_tool()`. We don't go through the registry here
# — we monkeypatch those two helpers so a fake tool is "registered"
# without polluting the real package state.


def _install_fake(monkeypatch, tool):
    """Make tool_bridge see `tool` as registered + enabled."""
    monkeypatch.setattr(
        "backend.services.tools.tool_registry.is_enabled",
        lambda name: name == tool.name,
        raising=True,
    )
    monkeypatch.setattr(
        "backend.services.tools.tool_registry.get_tool",
        lambda name: tool if name == tool.name else None,
        raising=True,
    )


class _FastTool(BaseTool):
    name = "fast_tool"
    description = "test"
    timeout_seconds = 0.05  # 50 ms

    async def run(self, query="", context=None):
        # Sleeps longer than its declared timeout so we can prove the
        # per-tool ceiling is what fires, not the caller default.
        await asyncio.sleep(0.5)
        return self._ok({"ran": True})


class _LegacyTool(BaseTool):
    """No timeout_seconds override — falls through to caller default."""
    name = "legacy_tool"
    description = "test"

    async def run(self, query="", context=None):
        return self._ok({"ran": True})


def test_per_tool_timeout_fires_before_caller_default(monkeypatch):
    """Caller passes timeout=2s, tool declares 0.05s. The tool wins."""
    _install_fake(monkeypatch, _FastTool())
    result = asyncio.run(tool_bridge.dispatch_one("fast_tool", {}, timeout=2.0))
    assert result["ok"] is False
    assert result["error"].startswith("tool_timeout_")
    # The tighter (per-tool) value should appear in the error string.
    assert "0.1s" in result["error"] or "0.0s" in result["error"]


def test_no_per_tool_timeout_uses_caller_default(monkeypatch):
    """timeout_seconds=12.0 (BaseTool default). Caller default of 5s is
    tighter, so 5s should be used. Since legacy_tool returns instantly
    nothing actually fires — the test just proves no regression."""
    _install_fake(monkeypatch, _LegacyTool())
    result = asyncio.run(tool_bridge.dispatch_one("legacy_tool", {}, timeout=5.0))
    assert result["ok"] is True
    assert result["error"] is None


def test_caller_timeout_wins_when_tighter(monkeypatch):
    """When the caller's timeout is tighter than the tool's, caller wins."""
    class _SlowDeclared(BaseTool):
        name = "slow_decl"
        description = "test"
        timeout_seconds = 10.0
        async def run(self, query="", context=None):
            await asyncio.sleep(0.3)
            return self._ok({"ran": True})

    _install_fake(monkeypatch, _SlowDeclared())
    # 0.05s caller default < 10s tool default → 0.05s wins → timeout fires.
    result = asyncio.run(tool_bridge.dispatch_one("slow_decl", {}, timeout=0.05))
    assert result["ok"] is False
    assert result["error"].startswith("tool_timeout_")
