# coding: utf-8
"""
Market-data provider abstraction (Phase 8e).

Public types shared by every provider, cache, and route. Pure
dataclasses — no I/O, no Pydantic dependency. The shape matches the
Phase 8d safety contract: every result carries `is_live`, `source`,
and `timestamp` so the consumer can refuse to display prices unless
they're verified live.

When a provider succeeds → MarketQuote with is_live=True.
When ALL providers fail → MarketQuote with is_live=False and
error="market_data_unavailable". NEVER fabricated.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


# Canonical error code returned in every failure envelope.
ERR_UNAVAILABLE = "market_data_unavailable"


@dataclass(frozen=True)
class MarketQuote:
    """One quote — the only success/failure shape the public client
    returns. Frozen so consumers can't mutate after the chain has
    decided 'is_live=True'.

    Top-level fields (every consumer can rely on these):
      symbol, asset_type, price, change_percent, currency, timestamp,
      source, is_live, error, high, low, volume.

    Provider-specific extras live in the `extra` dict and aren't part
    of the public contract."""
    symbol:         str
    asset_type:     str                       # "stock" | "crypto"
    price:          Optional[float]           # None when is_live=False
    change_percent: Optional[float]           # None when unavailable
    currency:       str = "USD"
    timestamp:      str = ""                  # ISO 8601 UTC
    source:         str = ""                  # provider name, e.g. "finnhub"
    is_live:        bool = False
    error:          Optional[str] = None      # set on failure, e.g. ERR_UNAVAILABLE
    # Phase 8f — promoted from extra{} so consumers don't have to
    # destructure. All Optional because some providers (e.g. CoinGecko
    # /simple/price) don't return them.
    high:           Optional[float] = None
    low:            Optional[float] = None
    volume:         Optional[float] = None
    extra:          dict = field(default_factory=dict)  # provider-specific fields

    def to_dict(self) -> dict:
        return asdict(self)


def make_unavailable(
    symbol: str,
    asset_type: str,
    *,
    error: str = ERR_UNAVAILABLE,
) -> MarketQuote:
    """Canonical 'no live data' shape every layer can return without
    having to remember which fields to null out."""
    from datetime import datetime, timezone
    return MarketQuote(
        symbol=symbol,
        asset_type=asset_type,
        price=None,
        change_percent=None,
        timestamp=datetime.now(timezone.utc).isoformat(),
        source="",
        is_live=False,
        error=error,
    )


__all__ = [
    "MarketQuote",
    "ERR_UNAVAILABLE",
    "make_unavailable",
]
