# coding: utf-8
"""
Phase B smoke tests.

Coverage map (each test is single-purpose and runs in <100ms):

  Envelope shape
    test_ok_envelope_keys
    test_err_envelope_keys
    test_dual_emit_preserves_legacy_and_adds_envelope

  /v2 routes
    test_v2_health_envelope_and_required_fields
    test_v2_health_lists_capability_flags
    test_v2_health_providers_block_present
    test_v2_echo_round_trips_token
    test_v2_demo_error_returns_failure_envelope

  Legacy routes still mounted (no regression from Phase B)
    test_legacy_chat_route_registered
    test_legacy_health_route_returns_200
    test_legacy_trading_signals_route_registered

  Provider registry
    test_provider_capabilities_lists_known_providers
    test_provider_capabilities_marks_unregistered_as_unavailable
    test_get_provider_raises_for_unknown_name

  Version constant
    test_backend_version_constant_is_set
    test_uptime_seconds_is_non_negative

  Middleware off-by-default
    test_request_id_header_absent_without_flag
    test_response_time_header_absent_without_flag

These tests use TestClient — no network, no real provider call, no
Railway. Run with: `pytest backend/tests/`
"""
from __future__ import annotations

import re

import pytest


# ──────────────────────────────────────────────────────────────────────────
# Envelope helpers (pure functions)
# ──────────────────────────────────────────────────────────────────────────

def test_ok_envelope_keys():
    from backend.core.responses import ok
    r = ok({"x": 1}, version="v1")
    assert set(r.keys()) == {"success", "data", "error", "metadata", "timestamp"}
    assert r["success"] is True
    assert r["data"] == {"x": 1}
    assert r["error"] is None
    assert r["metadata"] == {"version": "v1"}
    assert isinstance(r["timestamp"], str) and "T" in r["timestamp"]


def test_err_envelope_keys():
    from backend.core.responses import err
    r = err("boom", code="X")
    assert r["success"] is False
    assert r["data"] is None
    assert r["error"] == "boom"
    assert r["metadata"] == {"code": "X"}


def test_dual_emit_preserves_legacy_and_adds_envelope():
    from backend.core.responses import dual_emit
    out = dual_emit({"reply": "hi", "intent": "normal"})
    # Legacy fields preserved at top level
    assert out["reply"] == "hi"
    assert out["intent"] == "normal"
    # Envelope keys added
    assert out["success"] is True
    assert out["data"] == {"reply": "hi", "intent": "normal"}
    assert out["error"] is None
    assert "timestamp" in out


# ──────────────────────────────────────────────────────────────────────────
# /v2/* routes
# ──────────────────────────────────────────────────────────────────────────

def test_v2_health_envelope_and_required_fields(client):
    r = client.get("/v2/health")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["status"] == "ok"
    assert body["data"]["service"] == "korvixai-backend"
    assert isinstance(body["data"]["version"], str) and body["data"]["version"]
    assert isinstance(body["data"]["uptime_seconds"], int)
    assert body["data"]["uptime_seconds"] >= 0
    assert "python_version" in body["data"]
    assert "timestamp" in body
    assert "metadata" in body


def test_v2_health_lists_capability_flags(client):
    meta = client.get("/v2/health").json()["metadata"]
    for flag in [
        "sessions_enabled", "trading_signals_enabled", "tools_enabled",
        "market_data_enabled", "new_memory_enabled", "agent_enabled",
        "web_research_enabled",
        # Phase-B middleware flags
        "request_id_middleware", "timing_middleware", "auth_placeholder",
        "v2_error_handlers",
        # Phase 3a auth
        "auth_v2",
    ]:
        assert flag in meta, f"missing capability flag: {flag}"
        assert isinstance(meta[flag], bool)


def test_v2_health_providers_block_present(client):
    meta = client.get("/v2/health").json()["metadata"]
    assert "providers" in meta
    providers = meta["providers"]
    assert isinstance(providers, list)
    # At minimum, the KNOWN_PROVIDERS placeholders are listed.
    names = {p["name"] for p in providers}
    for known in ("openai", "anthropic", "google", "deepseek"):
        assert known in names, f"missing provider placeholder: {known}"
    # Every entry has the required descriptor fields.
    for p in providers:
        assert "name" in p and "available" in p and "registered" in p


def test_v2_echo_round_trips_token(client):
    r = client.get("/v2/echo/hello")
    body = r.json()
    assert body["success"] is True
    assert body["data"] == {"token": "hello"}
    assert body["metadata"] == {"length": 5}


def test_v2_demo_error_returns_failure_envelope(client):
    body = client.get("/v2/_demo/error").json()
    assert body["success"] is False
    assert body["data"] is None
    assert "envelope" in body["error"].lower()
    assert body["metadata"]["code"] == "DEMO_ERROR"


# ──────────────────────────────────────────────────────────────────────────
# Legacy routes (regression check — Phase B must not break them)
# ──────────────────────────────────────────────────────────────────────────

def test_legacy_chat_route_registered(app):
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/chat" in paths, "/chat route missing — DEMO-BLOCKING REGRESSION"


def test_legacy_health_route_returns_200(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"


def test_legacy_trading_signals_route_registered(app):
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/trading/signals" in paths


# ──────────────────────────────────────────────────────────────────────────
# Provider registry
# ──────────────────────────────────────────────────────────────────────────

def test_provider_capabilities_lists_known_providers():
    from backend.services.providers import provider_capabilities, KNOWN_PROVIDERS
    caps = provider_capabilities()
    names = {c["name"] for c in caps}
    for k in KNOWN_PROVIDERS:
        assert k in names


def test_provider_capabilities_marks_unregistered_as_unavailable():
    from backend.services.providers import provider_capabilities
    caps = {c["name"]: c for c in provider_capabilities()}
    # Google / DeepSeek still have no implementations. Anthropic landed
    # in Phase 6a — it registers when ANTHROPIC_API_KEY is set and
    # appears as a placeholder otherwise. We don't assert its
    # registered state here (depends on env state); we only verify the
    # remaining placeholders.
    for placeholder in ("google", "deepseek"):
        assert caps[placeholder]["registered"] is False
        assert caps[placeholder]["available"] is False


def test_get_provider_raises_for_unknown_name():
    from backend.services.providers import get_provider, ProviderUnavailableError
    with pytest.raises(ProviderUnavailableError) as exc_info:
        get_provider("does-not-exist")
    assert exc_info.value.status_code == 503


# ──────────────────────────────────────────────────────────────────────────
# Version constant
# ──────────────────────────────────────────────────────────────────────────

def test_backend_version_constant_is_set():
    from backend.core.version import BACKEND_VERSION
    assert isinstance(BACKEND_VERSION, str)
    assert re.match(r"^[a-z0-9\-]+$", BACKEND_VERSION), f"bad version slug: {BACKEND_VERSION}"


def test_uptime_seconds_is_non_negative():
    from backend.core.version import uptime_seconds
    u = uptime_seconds()
    assert isinstance(u, int) and u >= 0


# ──────────────────────────────────────────────────────────────────────────
# Middleware OFF by default — regression guard
# ──────────────────────────────────────────────────────────────────────────

def test_request_id_header_absent_without_flag(client, monkeypatch):
    # Make sure the env var is NOT set in this test environment.
    monkeypatch.delenv("ENABLE_REQUEST_ID_MIDDLEWARE", raising=False)
    r = client.get("/v2/health")
    # When the middleware isn't installed, no X-Request-Id is set.
    # (It might be set by Railway's proxy in production, but the test
    # client has no proxy — so absence proves the middleware is off.)
    assert "X-Request-Id" not in r.headers


def test_response_time_header_absent_without_flag(client, monkeypatch):
    monkeypatch.delenv("ENABLE_TIMING_MIDDLEWARE", raising=False)
    r = client.get("/v2/health")
    assert "X-Response-Time-ms" not in r.headers
