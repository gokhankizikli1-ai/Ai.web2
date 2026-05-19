# coding: utf-8
"""
S1 — /trading error-schema unification.

Proves the additive `code` field is present on /trading error envelopes
and aligned with the shared ErrorCode vocabulary, WITHOUT changing or
removing any pre-existing key (the frontend keys off HTTP status only,
so this is purely additive — these tests guard that contract).
"""
from __future__ import annotations

from backend.core.errors import ErrorCode


def test_disabled_returns_503_with_additive_code(client, monkeypatch):
    monkeypatch.setenv("ENABLE_TRADING_SIGNALS", "false")
    r = client.get("/trading/signals?symbols=BTCUSDT&timeframe=4h")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["code"] == ErrorCode.SERVICE_DISABLED
    assert detail["error"] == "trading_signals_disabled"
    assert "message" in detail
    assert "rollback" in detail


def test_enabled_empty_symbols_returns_400_with_validation_code(client, monkeypatch):
    monkeypatch.setenv("ENABLE_TRADING_SIGNALS", "true")
    r = client.get("/trading/signals?symbols=&timeframe=4h")
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["code"] == ErrorCode.VALIDATION_ERROR
    assert detail["error"] == "empty_symbols"
    assert "message" in detail


def test_health_always_200_shape_preserved(client, monkeypatch):
    monkeypatch.setenv("ENABLE_TRADING_SIGNALS", "false")
    r = client.get("/trading/health")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert "phase" in body
    assert "stats" in body
