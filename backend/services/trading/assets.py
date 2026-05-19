# coding: utf-8
"""
Trading asset catalog + capability constants — Phase T2 (additive).

Pure data + pure helpers. Imported only by routes/trading.py to ADD
optional response fields (supported_timeframes, supported_assets,
asset_category). It does NOT touch signal generation
(signals_service.resolve_asset_type stays the source of truth for
provider routing) — so existing behaviour and response keys are
unchanged; everything here is additive metadata.
"""
from __future__ import annotations

from typing import Dict, List

# Canonical timeframes the frontend should offer. The backend's
# /trading/signals still ACCEPTS the broader legacy set
# (routes.trading._ALLOWED_TIMEFRAMES) and still defaults to "4h" when
# missing/invalid — this list is only advertised, it does not restrict.
SUPPORTED_TIMEFRAMES: List[str] = ["15m", "1h", "4h", "1d"]

STOCKS: List[str] = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD",
    "NFLX", "PLTR", "SOFI", "COIN", "MSTR", "HOOD", "SMCI", "AVGO",
]

CRYPTO: List[str] = [
    "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "DOGEUSD",
    "ADAUSD", "AVAXUSD", "LINKUSD", "TONUSD",
]

ETF: List[str] = ["SPY", "QQQ", "DIA", "IWM", "VOO", "VTI"]

_BY_SYMBOL: Dict[str, str] = {}
for _s in STOCKS:
    _BY_SYMBOL[_s] = "stock"
for _s in CRYPTO:
    _BY_SYMBOL[_s] = "crypto"
for _s in ETF:
    _BY_SYMBOL[_s] = "etf"


def asset_category(symbol: str) -> str:
    """'stock' | 'crypto' | 'etf' | 'unknown'.

    Catalog lookup only — never raises, never guesses. 'unknown' for any
    symbol not in the catalog (still fully tradable via the existing
    signals path; this field is advisory metadata only)."""
    if not symbol:
        return "unknown"
    return _BY_SYMBOL.get(symbol.strip().upper(), "unknown")


def supported_assets() -> Dict[str, List[str]]:
    """Capability advertisement consumed by the frontend asset picker."""
    return {
        "stocks": list(STOCKS),
        "crypto": list(CRYPTO),
        "etf":    list(ETF),
    }


__all__ = [
    "SUPPORTED_TIMEFRAMES",
    "STOCKS", "CRYPTO", "ETF",
    "asset_category", "supported_assets",
]
