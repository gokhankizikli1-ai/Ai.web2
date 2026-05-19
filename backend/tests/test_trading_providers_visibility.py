# coding: utf-8
"""
Phase T3 — provider visibility on /trading/health.

Asserts the additive `providers_configured` field is present, booleans
only, and reflects the running process's env (Railway-propagation
verification). Pre-existing keys preserved (regression guard).
No network / OpenAI / market data calls.
"""
from __future__ import annotations


def test_health_exposes_providers_configured_shape(client, monkeypatch):
    # Start from a clean env so the assertion is deterministic regardless
    # of where pytest runs.
    for k in (
        "FINNHUB_API_KEY",
        "TWELVE_DATA_API_KEY",
        "TWELVEDATA_API_KEY",
        "ALPHAVANTAGE_API_KEY",
        "COINGECKO_API_KEY",
    ):
        monkeypatch.delenv(k, raising=False)

    r = client.get("/trading/health")
    assert r.status_code == 200
    body = r.json()

    # Regression guard — pre-existing keys still present and unchanged.
    assert "enabled" in body and "phase" in body and "stats" in body
    assert "supported_timeframes" in body and "supported_assets" in body

    # Additive field — shape + types.
    pc = body["providers_configured"]
    assert isinstance(pc, dict)
    assert set(["stock", "crypto", "any_stock_provider", "any_crypto_provider"]) <= set(pc)
    for chain_name in ("stock", "crypto"):
        chain = pc[chain_name]
        assert isinstance(chain, dict) and chain  # non-empty
        for provider, configured in chain.items():
            assert isinstance(provider, str)
            assert isinstance(configured, bool)
    assert isinstance(pc["any_stock_provider"], bool)
    assert isinstance(pc["any_crypto_provider"], bool)


def test_finnhub_key_reflected_in_health(client, monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-finnhub-key-123")
    r = client.get("/trading/health")
    assert r.status_code == 200
    pc = r.json()["providers_configured"]
    assert pc["stock"].get("finnhub") is True
    assert pc["any_stock_provider"] is True


def test_no_keys_when_unset(client, monkeypatch):
    for k in (
        "FINNHUB_API_KEY",
        "TWELVE_DATA_API_KEY",
        "TWELVEDATA_API_KEY",
    ):
        monkeypatch.delenv(k, raising=False)
    r = client.get("/trading/health")
    assert r.status_code == 200
    pc = r.json()["providers_configured"]
    assert pc["stock"].get("finnhub") is False
    assert pc["stock"].get("twelvedata") is False
    # yfinance availability depends on lib import, so don't assert its value
    # — just that it's a boolean and the snapshot is well-formed.
    assert isinstance(pc["stock"].get("yfinance"), bool)
