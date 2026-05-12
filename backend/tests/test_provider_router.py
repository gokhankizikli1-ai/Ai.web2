# coding: utf-8
"""
Phase 6b — provider router tests.

Coverage:
  - select_provider returns DEFAULT_PROVIDER when no mode supplied
  - select_provider("fast") always returns openai (always-on)
  - select_provider for flag-gated modes:
      flag OFF → openai (safe default)
      flag ON  → preferred provider (anthropic / google)
  - unknown / blank / weird-case mode → openai with reason="unknown_mode"
  - describe_routing snapshot structure
  - /v2/health.metadata.routing exposes the table
  - /v2/chat/stream uses router when mode is sent + no explicit provider
  - /v2/chat/stream prefers explicit provider over mode-based selection
  - flag flip is observed dynamically (no module reload needed)
"""
from __future__ import annotations

import pytest

from backend.services.providers.router import (
    DEFAULT_PROVIDER,
    ProviderSelection,
    describe_routing,
    select_provider,
)


# ── Selection logic ──────────────────────────────────────────────────────

def test_no_mode_returns_default(monkeypatch):
    sel = select_provider(None)
    assert sel.provider == DEFAULT_PROVIDER
    assert sel.reason == "default_no_mode"


def test_empty_mode_returns_default(monkeypatch):
    sel = select_provider("")
    assert sel.provider == DEFAULT_PROVIDER
    assert sel.reason == "default_no_mode"


def test_fast_mode_always_routes_to_openai(monkeypatch):
    # No flag involved.
    sel = select_provider("fast")
    assert sel.provider == "openai"
    assert sel.reason == "always"


def test_unknown_mode_falls_back_to_default():
    sel = select_provider("synthwave")
    assert sel.provider == DEFAULT_PROVIDER
    assert sel.reason == "unknown_mode"
    assert sel.mode == "synthwave"


def test_mode_canonicalization_handles_dash_and_case():
    # "Deep-Think" → "deep_think" → routes to anthropic when flag on.
    # We don't set the flag here, so it falls back to openai with
    # reason=flag_off but the mode field reflects the canonical form.
    sel = select_provider("Deep-Think")
    assert sel.mode == "deep_think"


# ── Flag-gated routes ────────────────────────────────────────────────────

@pytest.mark.parametrize("mode,flag,target", [
    ("deep_think", "ENABLE_MODE_ROUTING_DEEP_THINK", "anthropic"),
    ("coding",     "ENABLE_MODE_ROUTING_CODING",     "anthropic"),
    ("research",   "ENABLE_MODE_ROUTING_RESEARCH",   "google"),
    ("creative",   "ENABLE_MODE_ROUTING_CREATIVE",   "anthropic"),
])
def test_flagged_mode_off_routes_to_default(mode, flag, target, monkeypatch):
    monkeypatch.delenv(flag, raising=False)
    sel = select_provider(mode)
    assert sel.provider == DEFAULT_PROVIDER
    assert sel.reason == "flag_off"


@pytest.mark.parametrize("mode,flag,target", [
    ("deep_think", "ENABLE_MODE_ROUTING_DEEP_THINK", "anthropic"),
    ("coding",     "ENABLE_MODE_ROUTING_CODING",     "anthropic"),
    ("research",   "ENABLE_MODE_ROUTING_RESEARCH",   "google"),
    ("creative",   "ENABLE_MODE_ROUTING_CREATIVE",   "anthropic"),
])
def test_flagged_mode_on_routes_to_target(mode, flag, target, monkeypatch):
    monkeypatch.setenv(flag, "true")
    sel = select_provider(mode)
    assert sel.provider == target
    assert sel.reason == "flag_on"


def test_flag_flip_is_observed_without_module_reload(monkeypatch):
    """The router reads env dynamically. Flipping a flag mid-process
    must take effect on the very next call — no app restart."""
    monkeypatch.delenv("ENABLE_MODE_ROUTING_DEEP_THINK", raising=False)
    assert select_provider("deep_think").provider == "openai"
    monkeypatch.setenv("ENABLE_MODE_ROUTING_DEEP_THINK", "true")
    assert select_provider("deep_think").provider == "anthropic"
    monkeypatch.setenv("ENABLE_MODE_ROUTING_DEEP_THINK", "false")
    assert select_provider("deep_think").provider == "openai"


# ── describe_routing snapshot ────────────────────────────────────────────

def test_describe_routing_lists_every_mode(monkeypatch):
    monkeypatch.delenv("ENABLE_MODE_ROUTING_DEEP_THINK", raising=False)
    monkeypatch.delenv("ENABLE_MODE_ROUTING_CODING", raising=False)
    monkeypatch.delenv("ENABLE_MODE_ROUTING_RESEARCH", raising=False)
    monkeypatch.delenv("ENABLE_MODE_ROUTING_CREATIVE", raising=False)

    snap = describe_routing()
    assert snap["default_provider"] == "openai"
    by_mode = {m["mode"]: m for m in snap["modes"]}
    for mode in ("fast", "deep_think", "coding", "research", "creative"):
        assert mode in by_mode

    # With every flag off, every mode resolves to openai except those
    # whose preferred is openai already.
    assert by_mode["fast"]["resolves_to"]       == "openai"
    assert by_mode["fast"]["flag"]               is None
    assert by_mode["fast"]["flag_on"]            is True

    assert by_mode["deep_think"]["resolves_to"] == "openai"   # flag off
    assert by_mode["deep_think"]["preferred"]   == "anthropic"
    assert by_mode["deep_think"]["flag_on"]      is False


def test_describe_routing_reflects_flag_flip(monkeypatch):
    monkeypatch.setenv("ENABLE_MODE_ROUTING_CODING", "true")
    snap = describe_routing()
    by_mode = {m["mode"]: m for m in snap["modes"]}
    assert by_mode["coding"]["resolves_to"] == "anthropic"
    assert by_mode["coding"]["flag_on"]     is True


# ── /v2/health.metadata.routing exposure ─────────────────────────────────

def test_v2_health_includes_routing_block(client):
    body = client.get("/v2/health").json()
    routing = body["metadata"]["routing"]
    assert "modes" in routing
    assert "default_provider" in routing
    assert routing["default_provider"] == "openai"
    mode_names = {m["mode"] for m in routing["modes"]}
    assert {"fast", "deep_think", "coding", "research", "creative"}.issubset(mode_names)


# ── /v2/chat/stream integration ─────────────────────────────────────────
#
# These reuse the FakeStreamingProvider from test_streaming.py by
# registering a fresh fake into the registry under a name we point
# the router at via a monkey-patched route. Simpler: post with an
# explicit provider="fake-stream" and confirm the routing log carries
# the right reason; then post with mode="deep_think" and confirm the
# request lands on openai (flag off) or fails cleanly with
# PROVIDER_NOT_REGISTERED if openai isn't available in the test env.

def test_stream_explicit_provider_takes_precedence(client, monkeypatch):
    """When `provider` is sent, the router is NOT consulted."""
    from backend.services.providers import register_provider
    from backend.services.providers.base import BaseAIProvider
    from backend.services.providers.streaming import (
        ProviderStreamDone, ProviderStreamStart, ProviderStreamToken,
    )
    from backend.services.providers.types import ProviderResult, ProviderUsage

    class FakeRouter(BaseAIProvider):
        name = "fake-router-test"
        default_model = "fake-1"
        supports_streaming = True
        def is_available(self): return True
        async def chat_completion(self, req):
            return ProviderResult(content="", model="fake-1", provider=self.name)
        async def stream_chat_completion(self, req):
            yield ProviderStreamStart(provider=self.name, model=self.default_model)
            yield ProviderStreamToken(delta="hi")
            yield ProviderStreamDone(finish_reason="stop",
                                     usage=ProviderUsage(0, 0, 0),
                                     model=self.default_model)

    register_provider(FakeRouter())
    # Even with mode="deep_think" + flag ON (would normally route to
    # anthropic), the explicit provider wins.
    monkeypatch.setenv("ENABLE_MODE_ROUTING_DEEP_THINK", "true")
    r = client.post("/v2/chat/stream", json={
        "messages": [{"role": "user", "content": "hi"}],
        "provider": "fake-router-test",
        "mode":     "deep_think",
    })
    assert r.status_code == 200
    assert "fake-router-test" in r.text   # ready frame names it


def test_stream_mode_routes_through_router_when_no_explicit_provider(client, monkeypatch):
    """Send only `mode`, let the router pick. With every flag off, every
    mode resolves to openai — which isn't registered in the test env,
    so we expect 400 PROVIDER_NOT_REGISTERED."""
    monkeypatch.delenv("ENABLE_MODE_ROUTING_DEEP_THINK", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    r = client.post("/v2/chat/stream", json={
        "messages": [{"role": "user", "content": "hi"}],
        "mode":     "deep_think",
    })
    # In the test env openai isn't registered (no API key) so the
    # router selects openai → get_provider raises → 400.
    # The IMPORTANT assertion is that the router was consulted: the
    # error payload references mode + reason.
    assert r.status_code == 400
    import json
    payload = r.json()
    detail = payload.get("detail") or payload
    detail_str = json.dumps(detail)
    assert "PROVIDER_NOT_REGISTERED" in detail_str
    assert "deep_think" in detail_str
    assert "flag_off" in detail_str


def test_stream_neither_mode_nor_provider_is_byte_identical(client, monkeypatch):
    """Sending neither `mode` nor `provider` must behave EXACTLY like the
    pre-routing path: default to "openai", reason="default_no_mode"."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    r = client.post("/v2/chat/stream", json={
        "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 400
    import json
    detail = json.dumps(r.json().get("detail") or r.json())
    assert "PROVIDER_NOT_REGISTERED" in detail
    assert "default_no_mode" in detail
