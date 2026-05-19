# coding: utf-8
"""
Phase T2 — trading asset universe + timeframe advertisement + optional
chat language preference. All additive & backward-compatible.

No network / OpenAI: pure helpers + /trading/health only (signals &
/chat are not hit here — they need market data / a model key).
"""
from __future__ import annotations

from backend.routes.trading import _normalize_timeframe
from backend.routes.chat import ChatRequest, _language_directive, _with_language
from backend.services.trading import assets


# ── Timeframe validation (safe fallback, no removal of legacy set) ────────

def test_timeframe_valid_values_pass_through():
    for tf in ("15m", "1h", "4h", "1d"):
        assert _normalize_timeframe(tf) == tf


def test_timeframe_missing_or_invalid_defaults_to_4h():
    assert _normalize_timeframe(None) == "4h"      # missing → existing behaviour
    assert _normalize_timeframe("") == "4h"
    assert _normalize_timeframe("bogus") == "4h"   # invalid → safe default
    assert _normalize_timeframe("1H") == "1h"      # case nudge still works
    assert _normalize_timeframe("1w") == "1w"      # legacy set NOT shrunk


# ── Asset catalog ─────────────────────────────────────────────────────────

def test_asset_category_lookup():
    assert assets.asset_category("AAPL") == "stock"
    assert assets.asset_category("nvda") == "stock"     # case-insensitive
    assert assets.asset_category("BTCUSD") == "crypto"
    assert assets.asset_category("SOLUSD") == "crypto"
    assert assets.asset_category("SPY") == "etf"
    assert assets.asset_category("QQQ") == "etf"
    assert assets.asset_category("NOPE") == "unknown"   # safe, never raises
    assert assets.asset_category("") == "unknown"


def test_supported_assets_and_timeframes():
    sa = assets.supported_assets()
    assert {"stocks", "crypto", "etf"} <= set(sa)
    assert "NVDA" in sa["stocks"] and "TSLA" in sa["stocks"]
    assert "ETHUSD" in sa["crypto"] and "TONUSD" in sa["crypto"]
    assert "VOO" in sa["etf"]
    assert assets.SUPPORTED_TIMEFRAMES == ["15m", "1h", "4h", "1d"]


# ── /trading/health additive fields (existing keys preserved) ─────────────

def test_health_advertises_capabilities_without_breaking_shape(client):
    r = client.get("/trading/health")
    assert r.status_code == 200
    body = r.json()
    # pre-existing keys still present (regression guard)
    assert "enabled" in body and "phase" in body and "stats" in body
    # additive keys
    assert body["supported_timeframes"] == ["15m", "1h", "4h", "1d"]
    assert "stocks" in body["supported_assets"]
    assert "AAPL" in body["supported_assets"]["stocks"]


# ── Chat language preference (optional, backward-compatible) ──────────────

def test_old_chat_request_without_language_still_valid():
    req = ChatRequest(user_id="u1", message="hi")
    assert req.language is None          # omitted → None → existing behaviour
    assert req.mode is None


def test_chat_request_accepts_language():
    req = ChatRequest(user_id="u1", message="hi", language="tr")
    assert req.language == "tr"


def test_language_directive_safe_fallback():
    assert _language_directive(None) == ""        # missing → no hint
    assert _language_directive("") == ""
    assert _language_directive("xx") == ""        # unknown → safe, no hint
    d = _language_directive("tr")
    assert "Turkish" in d
    assert "English" in _language_directive("en")


def test_with_language_is_additive_only():
    base = "Cevap stili: net. Talimat: kisa yaz."
    # No language → style_prompt unchanged (byte-identical existing path)
    assert _with_language(base, None) == base
    assert _with_language(base, "zzz") == base
    out = _with_language(base, "de")
    assert out.startswith(base) and "German" in out
    # Empty base + language → directive only, no leading newline
    only = _with_language("", "fr")
    assert only and not only.startswith("\n") and "French" in only
