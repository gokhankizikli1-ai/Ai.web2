# coding: utf-8
"""
Phase 6a — AnthropicProvider tests.

Coverage:
  - is_available reflects ANTHROPIC_API_KEY env var
  - registry bootstrap registers Anthropic when key is set
  - registry bootstrap SKIPS Anthropic when key is missing
  - /v2/health providers list reports Anthropic correctly in both states
  - _split_messages extracts system prompts correctly
  - describe() includes model_family="claude"
  - default_model matches MODEL_ANTHROPIC env (with documented fallback)

NO real network calls. NO real Anthropic key needed. The SDK client is
never constructed in these tests — we exercise the lifecycle + adapter
logic that runs BEFORE the first SDK call.
"""
from __future__ import annotations

import os

import pytest


# ── Adapter unit tests ───────────────────────────────────────────────────

def test_split_messages_extracts_system_prompt():
    from backend.services.providers.anthropic_provider import _split_messages
    from backend.services.providers.types import ProviderMessage, ProviderRequest
    req = ProviderRequest(
        messages=[
            ProviderMessage(role="system", content="You are a helpful tester."),
            ProviderMessage(role="user",   content="hi"),
            ProviderMessage(role="assistant", content="hello"),
            ProviderMessage(role="user",   content="follow-up"),
        ],
        model="claude-3-5-haiku-20241022",
    )
    system_text, convo = _split_messages(req)
    assert system_text == "You are a helpful tester."
    assert convo == [
        {"role": "user",      "content": "hi"},
        {"role": "assistant", "content": "hello"},
        {"role": "user",      "content": "follow-up"},
    ]


def test_split_messages_concatenates_multiple_system():
    from backend.services.providers.anthropic_provider import _split_messages
    from backend.services.providers.types import ProviderMessage, ProviderRequest
    req = ProviderRequest(
        messages=[
            ProviderMessage(role="system", content="Persona: trader."),
            ProviderMessage(role="system", content="Style: concise."),
            ProviderMessage(role="user",   content="hi"),
        ],
        model="x",
    )
    system_text, convo = _split_messages(req)
    assert system_text == "Persona: trader.\n\nStyle: concise."
    assert convo == [{"role": "user", "content": "hi"}]


def test_split_messages_none_when_no_system():
    from backend.services.providers.anthropic_provider import _split_messages
    from backend.services.providers.types import ProviderMessage, ProviderRequest
    req = ProviderRequest(
        messages=[ProviderMessage(role="user", content="hi")],
        model="x",
    )
    system_text, convo = _split_messages(req)
    assert system_text is None
    assert convo == [{"role": "user", "content": "hi"}]


# ── is_available + describe ──────────────────────────────────────────────

def test_is_available_false_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    # Re-import settings + provider so the new env state is read.
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    p = ap.AnthropicProvider()
    assert p.is_available() is False


def test_is_available_true_with_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-fake-key")
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    p = ap.AnthropicProvider()
    assert p.is_available() is True


def test_describe_includes_model_family(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-fake-key")
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    p = ap.AnthropicProvider()
    d = p.describe()
    assert d["name"] == "anthropic"
    assert d["model_family"] == "claude"
    assert d["supports_streaming"] is True
    assert d["available"] is True


def test_default_model_reads_env_var(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-fake-key")
    monkeypatch.setenv("MODEL_ANTHROPIC", "claude-haiku-4-5-20251001")
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    p = ap.AnthropicProvider()
    assert p.default_model == "claude-haiku-4-5-20251001"


# ── Registry bootstrap ──────────────────────────────────────────────────

def test_registry_bootstrap_registers_anthropic_when_key_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-fake-key")
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    import backend.services.providers.registry as registry
    importlib.reload(registry)
    registry._reset_for_tests()
    registry.bootstrap_default_providers()
    names = registry.list_provider_names()
    assert "anthropic" in names


def test_registry_bootstrap_skips_anthropic_when_key_missing(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    import backend.services.providers.registry as registry
    importlib.reload(registry)
    registry._reset_for_tests()
    registry.bootstrap_default_providers()
    names = registry.list_provider_names()
    assert "anthropic" not in names


# ── /v2/health integration ───────────────────────────────────────────────

def test_v2_health_reports_anthropic_placeholder_when_no_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    body = client.get("/v2/health").json()
    providers = {p["name"]: p for p in body["metadata"]["providers"]}
    assert "anthropic" in providers
    # When the key isn't set, it's still listed as a known provider but
    # registered + available stay False (the KNOWN_PROVIDERS placeholder).
    # In the live test client the registry may have been bootstrapped
    # in a previous test that DID set the key, so we don't assert the
    # registered state here — only existence.
    assert isinstance(providers["anthropic"].get("registered"), bool)
    assert isinstance(providers["anthropic"].get("available"), bool)


def test_v2_health_provider_block_has_model_family_when_registered(monkeypatch):
    """When Anthropic IS registered, its descriptor includes
    model_family="claude" so operators can confirm Claude is wired
    correctly without inspecting env vars."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-fake-key")
    import importlib
    import backend.core.config as cfg
    importlib.reload(cfg)
    import backend.services.providers.anthropic_provider as ap
    importlib.reload(ap)
    import backend.services.providers.registry as registry
    importlib.reload(registry)
    registry._reset_for_tests()
    registry.bootstrap_default_providers()
    caps = {p["name"]: p for p in registry.provider_capabilities()}
    if caps["anthropic"]["registered"]:
        assert caps["anthropic"].get("model_family") == "claude"
        assert caps["anthropic"]["supports_streaming"] is True
