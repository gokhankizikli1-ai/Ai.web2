# coding: utf-8
"""
Phase 8e — live market-data provider tests.

Strategy: mock the HTTP layer (urllib.request.urlopen) so no real
network call is made. Cover the public-client contract end-to-end:

  - Happy path: first available provider serves; quote has is_live=True.
  - Fallover: first provider raises → second provider succeeds.
  - All providers down → make_unavailable shape (is_live=False,
    error="market_data_unavailable"). NEVER a fabricated price.
  - Unconfigured providers (no API key) skip themselves cleanly.
  - Cache: same symbol within TTL → cache_hit, providers NOT called.
  - Invalid symbol input → make_unavailable("", ...) without panic.
  - Strict no-fabrication: even when one provider returns price=0 or
    bogus shape, the client refuses to mark it live.
"""
from __future__ import annotations

import io
import json
from unittest.mock import patch

import pytest

from backend.services.market_providers import (
    ERR_UNAVAILABLE,
    MarketQuote,
    get_crypto_price,
    get_crypto_quote,
    get_stock_price,
    get_stock_quote,
)
from backend.services.market_providers import cache as mp_cache
from backend.services.market_providers import providers as mp_providers
from backend.services.market_providers.providers import (
    BinanceProvider,
    CoinGeckoProvider,
    FinnhubProvider,
    ProviderError,
    TwelveDataProvider,
    YFinanceProvider,
)


@pytest.fixture(autouse=True)
def _reset_cache():
    mp_cache._reset_for_tests()
    yield
    mp_cache._reset_for_tests()


# ── Helpers ──────────────────────────────────────────────────────────────

class _FakeResp:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status = status

    def read(self):
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _patch_urlopen(payload):
    """Patch the urlopen used inside providers.py."""
    def _fake_urlopen(req, timeout=None):
        return _FakeResp(payload)
    return patch.object(mp_providers.urllib.request, "urlopen", _fake_urlopen)


# ── Provider unit tests ────────────────────────────────────────────────

class TestFinnhubProvider:

    def test_unavailable_without_key(self, monkeypatch):
        monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
        assert FinnhubProvider().is_available() is False

    def test_available_with_key(self, monkeypatch):
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        assert FinnhubProvider().is_available() is True

    def test_happy_path(self, monkeypatch):
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        payload = {"c": 900.12, "d": 10.62, "dp": 1.19, "h": 912.3,
                   "l": 893.1, "o": 895.4, "pc": 889.5, "t": 1234567890}
        with _patch_urlopen(payload):
            q = FinnhubProvider().fetch("NVDA")
        assert q.is_live is True
        assert q.source == "finnhub"
        assert q.price == 900.12
        assert q.change_percent == 1.19
        assert q.timestamp

    def test_zero_price_raises_provider_error(self, monkeypatch):
        """Finnhub returns c=0 for unknown symbols — must NOT be treated
        as a live quote."""
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        with _patch_urlopen({"c": 0, "d": None, "dp": None}):
            with pytest.raises(ProviderError):
                FinnhubProvider().fetch("ZZZZ")


class TestCoinGeckoProvider:

    def test_always_available(self):
        assert CoinGeckoProvider().is_available() is True

    def test_unknown_symbol_raises(self):
        with pytest.raises(ProviderError):
            CoinGeckoProvider().fetch("FAKE_TOKEN")

    def test_happy_path(self):
        payload = {"bitcoin": {"usd": 70000.5, "usd_24h_change": 1.234}}
        with _patch_urlopen(payload):
            q = CoinGeckoProvider().fetch("BTC")
        assert q.is_live is True
        assert q.source == "coingecko"
        assert q.price == 70000.5
        assert q.change_percent == pytest.approx(1.234)
        assert q.asset_type == "crypto"


class TestTwelveDataProvider:
    """Phase 8h — env-var name regression. The canonical name (per the
    Phase 8h brief and the Railway env) is TWELVE_DATA_API_KEY with an
    underscore between 'Twelve' and 'Data'. The original Phase 8e code
    looked at TWELVEDATA_API_KEY (no underscore), which silently never
    matched Railway and caused the provider to be skipped in production.
    Both names are now accepted."""

    def test_unavailable_without_any_key(self, monkeypatch):
        monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
        monkeypatch.delenv("TWELVEDATA_API_KEY",  raising=False)
        assert TwelveDataProvider().is_available() is False

    def test_available_with_canonical_name(self, monkeypatch):
        """The Phase 8h canonical name with the underscore must work."""
        monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
        monkeypatch.setenv("TWELVE_DATA_API_KEY", "k-canonical")
        assert TwelveDataProvider().is_available() is True

    def test_available_with_legacy_name(self, monkeypatch):
        """The Phase 8e legacy name without underscore must still work."""
        monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
        monkeypatch.setenv("TWELVEDATA_API_KEY", "k-legacy")
        assert TwelveDataProvider().is_available() is True

    def test_canonical_takes_precedence(self, monkeypatch):
        """When both env vars are set, the canonical (underscore) name
        wins — matches the spec direction."""
        monkeypatch.setenv("TWELVE_DATA_API_KEY", "k-canonical")
        monkeypatch.setenv("TWELVEDATA_API_KEY",  "k-legacy")
        # Capture which key was sent by patching the urlopen.
        captured = {}
        def _fake(req, timeout=None):
            captured["url"] = req.full_url if hasattr(req, "full_url") else str(req)
            return _FakeResp({"price": "900.0", "status": "ok"})
        with patch.object(mp_providers.urllib.request, "urlopen", _fake):
            q = TwelveDataProvider().fetch("NVDA")
        assert q.is_live is True
        # The actual key value never appears in the redacted URL; verify the
        # canonical name was the source by reading the function's read order.
        # (Behaviour is unit-tested directly via _twelvedata_api_key.)
        from backend.services.market_providers.providers import _twelvedata_api_key
        assert _twelvedata_api_key() == "k-canonical"

    def test_happy_path(self, monkeypatch):
        monkeypatch.setenv("TWELVE_DATA_API_KEY", "k")
        payload = {
            "symbol":         "NVDA", "name":           "NVIDIA Corp",
            "price":          "900.5", "close":         "900.5",
            "percent_change": "1.20",
            "high":           "910.0", "low":           "895.0",
            "volume":         "12345678", "currency":   "USD",
            "exchange":       "NMS",
        }
        with _patch_urlopen(payload):
            q = TwelveDataProvider().fetch("NVDA")
        assert q.is_live is True
        assert q.source == "twelvedata"
        assert q.price == 900.5
        assert q.change_percent == 1.20
        assert q.high   == 910.0
        assert q.low    == 895.0
        assert q.volume == 12345678.0
        assert q.currency == "USD"

    def test_error_response_raises(self, monkeypatch):
        """TwelveData returns {'status':'error','code':429,'message':'...'}
        for rate-limits / bad symbols. Must raise ProviderError so the
        chain falls over — never fabricate."""
        monkeypatch.setenv("TWELVE_DATA_API_KEY", "k")
        payload = {"status": "error", "code": 429, "message": "rate limit"}
        with _patch_urlopen(payload):
            with pytest.raises(ProviderError):
                TwelveDataProvider().fetch("NVDA")


class TestUrlRedaction:
    """Logging must never leak API keys. The redactor strips apikey /
    token / api_key / key query params before the URL is logged."""

    def test_redacts_apikey_param(self):
        from backend.services.market_providers.providers import _redact_url
        u = "https://api.twelvedata.com/quote?symbol=NVDA&apikey=SECRET"
        assert "SECRET" not in _redact_url(u)
        assert "apikey=%2A%2A%2A" in _redact_url(u) or "apikey=***" in _redact_url(u)

    def test_redacts_token_param(self):
        from backend.services.market_providers.providers import _redact_url
        u = "https://finnhub.io/api/v1/quote?symbol=NVDA&token=SECRET"
        assert "SECRET" not in _redact_url(u)


class TestBinanceProvider:

    def test_happy_path(self):
        payload = {"symbol": "BTCUSDT", "lastPrice": "70000.5", "priceChangePercent": "1.5"}
        with _patch_urlopen(payload):
            q = BinanceProvider().fetch("BTC")
        assert q.is_live is True
        assert q.source == "binance"
        assert q.price == 70000.5
        assert q.symbol == "BTC"   # USDT suffix stripped

    def test_no_price_raises(self):
        with _patch_urlopen({"symbol": "BTCUSDT", "lastPrice": "0"}):
            with pytest.raises(ProviderError):
                BinanceProvider().fetch("BTC")


# ── Client chain — stocks ───────────────────────────────────────────────

class TestStockChain:

    def test_no_providers_configured_returns_unavailable(self, monkeypatch):
        """No keys set AND we monkeypatch the yfinance fallback to fail.
        The chain must return make_unavailable, not fabricate a price."""
        monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
        monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
        monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)

        def _fail(self, symbol):
            raise ProviderError("yfinance disabled in test")
        monkeypatch.setattr(YFinanceProvider, "fetch", _fail)

        q = get_stock_price("NVDA")
        assert q.is_live is False
        assert q.price is None
        assert q.error == ERR_UNAVAILABLE
        assert q.symbol == "NVDA"
        assert q.asset_type == "stock"

    def test_finnhub_wins_first(self, monkeypatch):
        """Finnhub is configured AND succeeds — TwelveData / yfinance
        must NOT be hit (we monkeypatch them to raise so the test
        fails if they're touched)."""
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        monkeypatch.setenv("TWELVEDATA_API_KEY", "k2")

        def _no(self, symbol):
            raise AssertionError(f"{self.name} should not be called when finnhub wins")
        monkeypatch.setattr(TwelveDataProvider, "fetch", _no)
        monkeypatch.setattr(YFinanceProvider,    "fetch", _no)

        payload = {"c": 900.0, "d": 1, "dp": 1.0}
        with _patch_urlopen(payload):
            q = get_stock_price("NVDA")
        assert q.is_live is True
        assert q.source == "finnhub"
        assert q.price == 900.0

    def test_falls_over_to_next_provider(self, monkeypatch):
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        monkeypatch.setenv("TWELVEDATA_API_KEY", "k2")

        def _finnhub_fails(self, symbol):
            raise ProviderError("finnhub rate-limited")
        monkeypatch.setattr(FinnhubProvider, "fetch", _finnhub_fails)

        def _twelvedata_ok(self, symbol):
            return MarketQuote(
                symbol=symbol.upper(),
                asset_type="stock",
                price=901.5,
                change_percent=0.5,
                timestamp="2026-05-13T...",
                source="twelvedata",
                is_live=True,
            )
        monkeypatch.setattr(TwelveDataProvider, "fetch", _twelvedata_ok)

        q = get_stock_price("NVDA")
        assert q.is_live is True
        assert q.source == "twelvedata"
        assert q.price == 901.5

    def test_invalid_symbol_returns_unavailable_without_provider_call(self, monkeypatch):
        called = {"any": False}
        def _wrap(self, symbol):
            called["any"] = True
            raise ProviderError("never")
        monkeypatch.setattr(FinnhubProvider,    "fetch", _wrap)
        monkeypatch.setattr(TwelveDataProvider, "fetch", _wrap)
        monkeypatch.setattr(YFinanceProvider,   "fetch", _wrap)

        for bad in ("", "   ", "x" * 50):
            q = get_stock_price(bad)
            assert q.is_live is False
            assert q.error in (ERR_UNAVAILABLE, "invalid_symbol")
        assert called["any"] is False


# ── Client chain — crypto ───────────────────────────────────────────────

class TestCryptoChain:

    def test_coingecko_first(self, monkeypatch):
        def _binance_never(self, symbol):
            raise AssertionError("binance should not be hit when coingecko wins")
        monkeypatch.setattr(BinanceProvider, "fetch", _binance_never)

        payload = {"bitcoin": {"usd": 70000, "usd_24h_change": 1.5}}
        with _patch_urlopen(payload):
            q = get_crypto_price("BTC")
        assert q.is_live is True
        assert q.source == "coingecko"

    def test_fallover_to_binance(self, monkeypatch):
        def _cg_fail(self, symbol):
            raise ProviderError("coingecko down")
        def _bn_ok(self, symbol):
            return MarketQuote(
                symbol="BTC", asset_type="crypto", price=70010.0,
                change_percent=1.2, source="binance", is_live=True,
                timestamp="t",
            )
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _cg_fail)
        monkeypatch.setattr(BinanceProvider,   "fetch", _bn_ok)

        q = get_crypto_price("BTC")
        assert q.is_live is True
        assert q.source == "binance"

    def test_all_crypto_providers_down(self, monkeypatch):
        def _down(self, symbol):
            raise ProviderError("down")
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _down)
        monkeypatch.setattr(BinanceProvider,   "fetch", _down)

        q = get_crypto_price("BTC")
        assert q.is_live is False
        assert q.error == ERR_UNAVAILABLE
        assert q.price is None


# ── Cache ───────────────────────────────────────────────────────────────

class TestCache:

    def test_cache_hit_skips_providers(self, monkeypatch):
        """Second call to same symbol within TTL must NOT hit the
        provider chain. We assert by monkeypatching every provider to
        raise AssertionError if invoked after the first call."""
        # First call — providers succeed:
        def _cg_ok(self, symbol):
            return MarketQuote(
                symbol="BTC", asset_type="crypto", price=70000.0,
                change_percent=1.0, source="coingecko", is_live=True,
                timestamp="t",
            )
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _cg_ok)
        first = get_crypto_price("BTC")
        assert first.is_live is True

        # Now wedge all providers to fail loudly if hit:
        def _never(self, symbol):
            raise AssertionError("cache hit should have prevented this call")
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _never)
        monkeypatch.setattr(BinanceProvider,   "fetch", _never)

        # Second call — should come from cache.
        second = get_crypto_price("BTC")
        assert second.is_live is True
        assert second.source == "coingecko"
        assert second.price == 70000.0

    def test_failure_is_not_cached(self, monkeypatch):
        """A make_unavailable result must NOT be cached — the next
        call should try the providers fresh."""
        calls = {"n": 0}
        def _cg(self, symbol):
            calls["n"] += 1
            if calls["n"] == 1:
                raise ProviderError("first attempt down")
            return MarketQuote(
                symbol="BTC", asset_type="crypto", price=70000.0,
                change_percent=1.0, source="coingecko", is_live=True,
                timestamp="t",
            )
        def _bn_down(self, symbol):
            raise ProviderError("binance down")

        monkeypatch.setattr(CoinGeckoProvider, "fetch", _cg)
        monkeypatch.setattr(BinanceProvider,   "fetch", _bn_down)

        first = get_crypto_price("BTC")
        assert first.is_live is False        # both providers down on first round

        # Second call: coingecko succeeds. Proves the failure wasn't cached.
        second = get_crypto_price("BTC")
        assert second.is_live is True
        assert calls["n"] == 2

    def test_zero_ttl_disables_cache(self, monkeypatch):
        """MARKET_QUOTE_CRYPTO_CACHE_TTL=0 must skip caching entirely.
        The provider should be called every time."""
        monkeypatch.setenv("MARKET_QUOTE_CRYPTO_CACHE_TTL", "0")
        calls = {"n": 0}
        def _cg(self, symbol):
            calls["n"] += 1
            return MarketQuote(
                symbol="BTC", asset_type="crypto", price=70000.0,
                change_percent=1.0, source="coingecko", is_live=True,
                timestamp="t",
            )
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _cg)
        get_crypto_price("BTC")
        get_crypto_price("BTC")
        get_crypto_price("BTC")
        assert calls["n"] == 3


# ── /market/quote route ─────────────────────────────────────────────────

class TestMarketQuoteRoute:

    def test_disabled_returns_503(self, client, monkeypatch):
        monkeypatch.delenv("ENABLE_MARKET_QUOTE", raising=False)
        r = client.get("/market/quote/NVDA")
        assert r.status_code == 503
        assert (r.json().get("detail") or {}).get("code") == "MARKET_QUOTE_DISABLED"

    def test_enabled_returns_canonical_shape_on_success(self, client, monkeypatch):
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        payload = {"c": 900.0, "d": 1, "dp": 1.0}
        with _patch_urlopen(payload):
            r = client.get("/market/quote/NVDA")
        assert r.status_code == 200
        body = r.json()
        assert body["is_live"]   is True
        assert body["symbol"]    == "NVDA"
        assert body["asset_type"] == "stock"
        assert body["price"]     == 900.0
        assert body["source"]    == "finnhub"

    def test_unavailable_returns_200_with_is_live_false(self, client, monkeypatch):
        """Critical: the route returns 200 with is_live=false when
        providers fail. NEVER a 4xx (which would conflict with the
        safety contract) and NEVER a fabricated price."""
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        monkeypatch.delenv("FINNHUB_API_KEY",    raising=False)
        monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
        monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
        def _yf_fail(self, symbol):
            raise ProviderError("yfinance disabled in test")
        monkeypatch.setattr(YFinanceProvider, "fetch", _yf_fail)

        r = client.get("/market/quote/NVDA")
        assert r.status_code == 200
        body = r.json()
        assert body["is_live"] is False
        assert body["price"]   is None
        assert body["error"]   == "market_data_unavailable"
        assert body["symbol"]  == "NVDA"

    def test_crypto_detection_from_known_symbol(self, client, monkeypatch):
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        payload = {"bitcoin": {"usd": 70000, "usd_24h_change": 1.5}}
        with _patch_urlopen(payload):
            r = client.get("/market/quote/BTC")
        body = r.json()
        assert body["asset_type"] == "crypto"
        assert body["is_live"]    is True
        assert body["source"]     == "coingecko"

    def test_explicit_type_override(self, client, monkeypatch):
        """An ambiguous symbol with ?type=crypto should be sent to the
        crypto chain even though the heuristic would otherwise pick
        stock."""
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        payload = {"bitcoin": {"usd": 70000, "usd_24h_change": 1.5}}
        with _patch_urlopen(payload):
            r = client.get("/market/quote/BTC?type=crypto")
        assert r.status_code == 200
        assert r.json()["asset_type"] == "crypto"

    def test_invalid_symbol_400(self, client, monkeypatch):
        """Pydantic / FastAPI Path validator rejects symbols with
        suspicious characters BEFORE the route runs."""
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        r = client.get("/market/quote/<script>")
        assert r.status_code in (404, 422)   # FastAPI returns 422 on Path validation


# ── Phase 8f additions ──────────────────────────────────────────────────

class TestSpecCanonicalAliases:
    """Per the Phase 8f brief the canonical names are `_quote`. Old
    `_price` names remain as back-compat shims pointing at the same
    impl."""

    def test_aliases_share_implementation(self, monkeypatch):
        # Wedge providers to a deterministic answer.
        def _cg(self, symbol):
            return MarketQuote(
                symbol="BTC", asset_type="crypto", price=70000.0,
                change_percent=1.0, source="coingecko", is_live=True,
                timestamp="t",
            )
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _cg)
        # Each public name must return an equivalent quote.
        q1 = get_crypto_price("BTC")
        mp_cache._reset_for_tests()
        q2 = get_crypto_quote("BTC")
        assert q1.is_live is True and q2.is_live is True
        assert q1.price == q2.price == 70000.0

    def test_stock_aliases_match(self, monkeypatch):
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        payload = {"c": 900.0, "d": 1, "dp": 1.0, "h": 905, "l": 895}
        with _patch_urlopen(payload):
            q1 = get_stock_price("NVDA")
        mp_cache._reset_for_tests()
        with _patch_urlopen(payload):
            q2 = get_stock_quote("NVDA")
        assert q1.is_live is True and q2.is_live is True
        assert q1.price == q2.price == 900.0
        assert q1.source == q2.source == "finnhub"


class TestTopLevelHighLowVolume:
    """Phase 8f — high / low / volume promoted from extra{} to top-level
    MarketQuote fields per the brief's required response schema."""

    def test_finnhub_populates_high_low(self, monkeypatch):
        monkeypatch.setenv("FINNHUB_API_KEY", "k")
        payload = {"c": 900.0, "d": 1, "dp": 1.0, "h": 910.5, "l": 893.2,
                   "o": 895, "pc": 889}
        with _patch_urlopen(payload):
            q = FinnhubProvider().fetch("NVDA")
        assert q.high == 910.5
        assert q.low  == 893.2
        # Finnhub /quote doesn't supply volume — must be None, not 0.
        assert q.volume is None

    def test_binance_populates_high_low_volume(self):
        payload = {
            "symbol": "BTCUSDT", "lastPrice": "70000.0",
            "priceChangePercent": "1.5", "highPrice": "70500.0",
            "lowPrice":  "69500.0", "volume": "12345.6",
        }
        with _patch_urlopen(payload):
            q = BinanceProvider().fetch("BTC")
        assert q.high   == 70500.0
        assert q.low    == 69500.0
        assert q.volume == pytest.approx(12345.6)

    def test_unavailable_keeps_high_low_volume_none(self):
        """When the chain fails, every numeric field must be None — never
        a stale value, never a zero, never a fabrication."""
        from backend.services.market_providers.types import make_unavailable
        u = make_unavailable("NVDA", "stock")
        assert u.high   is None
        assert u.low    is None
        assert u.volume is None
        assert u.price  is None
        assert u.is_live is False
        assert u.error  == ERR_UNAVAILABLE


class TestMarketCryptoRoute:
    """Phase 8f — explicit /market/crypto/{symbol} endpoint. Same
    provider chain as the auto-detecting /market/quote route would
    pick for a crypto symbol, but the path saves callers from having
    to know the heuristic rules."""

    def test_disabled_returns_503(self, client, monkeypatch):
        monkeypatch.delenv("ENABLE_MARKET_QUOTE", raising=False)
        r = client.get("/market/crypto/BTC")
        assert r.status_code == 503
        assert (r.json().get("detail") or {}).get("code") == "MARKET_QUOTE_DISABLED"

    def test_enabled_dispatches_to_crypto_chain(self, client, monkeypatch):
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        payload = {"bitcoin": {"usd": 70000, "usd_24h_change": 1.5, "usd_24h_vol": 50e9}}
        with _patch_urlopen(payload):
            r = client.get("/market/crypto/BTC")
        assert r.status_code == 200
        body = r.json()
        assert body["asset_type"] == "crypto"
        assert body["is_live"]    is True
        assert body["source"]     == "coingecko"

    def test_unavailable_returns_200_with_is_live_false(self, client, monkeypatch):
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        def _down(self, symbol):
            raise ProviderError("test down")
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _down)
        monkeypatch.setattr(BinanceProvider,   "fetch", _down)
        r = client.get("/market/crypto/BTC")
        assert r.status_code == 200
        body = r.json()
        assert body["is_live"] is False
        assert body["price"]   is None
        assert body["error"]   == ERR_UNAVAILABLE

    def test_response_carries_all_required_fields(self, client, monkeypatch):
        """The required Phase 8f response schema lists symbol, price,
        change_percent, high, low, volume, timestamp, source, is_live.
        Pin them all here."""
        monkeypatch.setenv("ENABLE_MARKET_QUOTE", "true")
        payload = {
            "symbol": "BTCUSDT", "lastPrice": "70000.0",
            "priceChangePercent": "1.5", "highPrice": "70500.0",
            "lowPrice":  "69500.0", "volume": "12345.6",
        }
        # Force the chain to use Binance by failing CoinGecko first.
        def _cg_fail(self, symbol):
            raise ProviderError("test")
        monkeypatch.setattr(CoinGeckoProvider, "fetch", _cg_fail)
        with _patch_urlopen(payload):
            r = client.get("/market/crypto/BTC")
        body = r.json()
        for required in (
            "symbol", "asset_type", "price", "change_percent",
            "high", "low", "volume", "timestamp", "source", "is_live",
        ):
            assert required in body, f"missing required field: {required}"
        assert body["source"] == "binance"
        assert body["high"]   == 70500.0
        assert body["low"]    == 69500.0
        assert body["volume"] == pytest.approx(12345.6)


def test_no_simulated_prices_anywhere():
    """Audit: confirm no module in the providers package ships with a
    hardcoded NVDA/AAPL/TSLA price or similar simulated value. The only
    string occurrences of these symbols anywhere in the package should
    be in routing logic and test fixtures — not in price defaults."""
    import inspect
    from backend.services import market_providers as pkg
    from backend.services.market_providers import (
        cache, client, providers as prov_mod, types,
    )
    # Read the source of each runtime module and scan for suspicious
    # patterns: a known ticker assigned to a numeric literal.
    suspicious_patterns = [
        "NVDA = 9", "NVDA=9", "AAPL = 1", "AAPL=1",
        "TSLA = 2", "TSLA=2", "BTC = 7", "BTC=7",
    ]
    for module in (cache, client, prov_mod, types):
        src = inspect.getsource(module)
        for pat in suspicious_patterns:
            assert pat not in src, (
                f"Suspicious hardcoded price assignment found in "
                f"{module.__name__}: {pat!r}"
            )


def test_coingecko_query_includes_volume_param():
    """Regression for Bugbot Medium 71ded634 — CoinGecko's
    /simple/price endpoint defaults include_24hr_vol to false, so the
    URL the provider builds MUST opt in. Otherwise the top-level
    volume field is always None in production."""
    captured = {}
    def _fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url if hasattr(req, "full_url") else str(req)
        return _FakeResp({"bitcoin": {"usd": 70000, "usd_24h_change": 1.5, "usd_24h_vol": 50e9}})
    with patch.object(mp_providers.urllib.request, "urlopen", _fake_urlopen):
        q = CoinGeckoProvider().fetch("BTC")
    assert "include_24hr_vol=true" in captured["url"], (
        f"CoinGecko URL missing include_24hr_vol=true: {captured['url']}"
    )
    assert q.is_live is True
    assert q.volume == pytest.approx(50e9)


def test_yfinance_slow_path_populates_high_low_volume():
    """Regression for Bugbot Medium 83046447 — when fast_info has no
    price, the provider falls through to ticker.info (slow path). The
    new high/low/volume extraction must consult slow info in that
    branch, otherwise these fields are silently None even though slow
    info carries them under dayHigh / dayLow / regularMarketVolume."""

    class _EmptyFastInfo(dict):
        """Mimics fast_info: behaves like an empty dict so the price
        lookup returns None and the slow path kicks in."""

    class _FakeTicker:
        def __init__(self, symbol):
            self.symbol = symbol
            self.fast_info = _EmptyFastInfo()
            # Slow info has the data the fast path didn't.
            self.info = {
                "regularMarketPrice":         900.0,
                "regularMarketPreviousClose": 889.5,
                "dayHigh":                    910.0,
                "dayLow":                     893.0,
                "regularMarketVolume":        12345678,
            }

    class _FakeYf:
        Ticker = _FakeTicker

    import sys
    monkey = sys.modules.get("yfinance")
    sys.modules["yfinance"] = _FakeYf()
    try:
        q = YFinanceProvider().fetch("NVDA")
    finally:
        if monkey is None:
            sys.modules.pop("yfinance", None)
        else:
            sys.modules["yfinance"] = monkey

    assert q.is_live is True
    assert q.price == 900.0
    # The whole point: high/low/volume must come through via slow info.
    assert q.high   == 910.0
    assert q.low    == 893.0
    assert q.volume == 12345678
