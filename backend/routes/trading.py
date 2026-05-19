# coding: utf-8
# Phase T1 — Trading routes.
#
# GET /trading/signals?symbols=BTCUSDT,NVDA,TSLA&timeframe=4h
#
# Behind ENABLE_TRADING_SIGNALS=true. When off, the endpoint returns 503 with
# a clear message — /chat and every other route are unaffected.
import os
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.services.trading.assets import (
    SUPPORTED_TIMEFRAMES, supported_assets, asset_category,
)

router = APIRouter(prefix="/trading", tags=["trading"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_TRADING_SIGNALS", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error":    "trading_signals_disabled",
                "message":  "Trading signals service is disabled. Set ENABLE_TRADING_SIGNALS=true to activate.",
                "rollback": "Unset ENABLE_TRADING_SIGNALS (or set to 'false') to disable again.",
            },
        )


# ── Health (always callable; reports flag state) ─────────────────────────

@router.get("/health")
def trading_health() -> dict:
    try:
        from backend.services.trading.signals_service import stats
        s = stats()
    except Exception as exc:
        logger.debug("/trading/health: stats unavailable: %s", exc)
        s = {"error": str(exc)}
    # Additive provider-configuration snapshot (booleans only, no secrets).
    # Single curl to see exactly which provider keys the running process
    # picked up — the most common cause of "no live data" is env-not-applied
    # despite a redeploy, and this makes it visible.
    try:
        from backend.services.market_providers.client import provider_chain_status
        providers_configured = provider_chain_status()
    except Exception as exc:
        logger.debug("/trading/health: provider_chain_status unavailable: %s", exc)
        providers_configured = {"error": str(exc)}
    return {
        "enabled":  _enabled(),
        "phase":    "T1 — live trading signals (market_data-backed, flag-gated)",
        "stats":    s,
        # Additive capability advertisement (new keys; nothing removed).
        "supported_timeframes":  list(SUPPORTED_TIMEFRAMES),
        "supported_assets":      supported_assets(),
        "providers_configured":  providers_configured,
    }


# ── Signals ──────────────────────────────────────────────────────────────

# Allowed timeframes mirror MarketDataTool's accepted set. Anything else
# falls back to "4h" so a frontend typo never crashes the request.
_ALLOWED_TIMEFRAMES = {
    "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "8h", "12h",
    "1d", "3d", "1w", "1M",
}


def _normalize_timeframe(tf: Optional[str]) -> str:
    if not tf:
        return "4h"
    s = tf.strip()
    if s in _ALLOWED_TIMEFRAMES:
        return s
    # case-insensitive nudge for "1H", "4H", etc.
    s_low = s.lower()
    if s_low in _ALLOWED_TIMEFRAMES:
        return s_low
    return "4h"


def _parse_symbols(raw: str) -> list[str]:
    """Comma-separated, deduped, capped at 20."""
    if not raw:
        return []
    parts = [p.strip().upper() for p in raw.split(",") if p and p.strip()]
    return list(dict.fromkeys(parts))[:20]


@router.get("/signals")
async def trading_signals(
    symbols:   str = Query(..., description="Comma-separated tickers, e.g. 'BTCUSDT,NVDA,TSLA'"),
    timeframe: str = Query("4h", description="Candle interval (1m..1M); default 4h"),
) -> dict:
    """
    Live trading signals for the given tickers.

    Returns a JSON object:
      {
        "signals":      [...],     # one entry per requested symbol
        "timeframe":    "4h",
        "is_live":      true,      # true if at least one signal is live
        "count":        N,
        "live_count":   K,
        "generated_at": "<iso8601>",
        "error":        null
      }

    Each signal has the shape documented in TOOLS_ARCHITECTURE.md
    "Trading Signals (Phase T1)". Failed symbols come back with
    is_live=false and a non-null `error` field — no fabricated prices.
    """
    _ensure_enabled()
    parsed = _parse_symbols(symbols)
    if not parsed:
        raise HTTPException(
            status_code=400,
            detail={
                "error":   "empty_symbols",
                "message": "Provide a non-empty `symbols` query parameter (comma-separated).",
            },
        )

    tf = _normalize_timeframe(timeframe)

    # WARN-level entry log so operators can SEE the endpoint is being hit
    # at all (most-asked diagnostic — "are requests even reaching the
    # service?"). WARN bypasses any INFO log-level filter on Railway.
    logger.warning(
        "trading.signals.request | symbols=%s | tf=%s | n=%d",
        ",".join(parsed)[:200], tf, len(parsed),
    )

    try:
        from backend.services.trading.signals_service import signals_for_symbols
    except Exception as exc:
        logger.error("/trading/signals: service import failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail={"error": "service_unavailable", "message": str(exc)},
        )

    result = await signals_for_symbols(parsed, tf)

    # ── Additive enrichment — never removes/renames existing keys ─────────
    # Existing shape (signals/timeframe/is_live/count/live_count/
    # generated_at/error) is returned verbatim by signals_service; we only
    # ADD optional fields the new frontend can use. Defensive: if the
    # service ever returns an unexpected type, pass it straight through.
    if isinstance(result, dict):
        result.setdefault("timeframe", tf)
        result["supported_timeframes"] = list(SUPPORTED_TIMEFRAMES)
        result["supported_assets"] = supported_assets()
        sigs = result.get("signals")
        if isinstance(sigs, list):
            for sig in sigs:
                if isinstance(sig, dict):
                    # setdefault → never overwrite an existing key.
                    sig.setdefault("asset_category", asset_category(sig.get("symbol", "")))

    # WARN-level response summary so operators see exactly what the
    # request produced — top-level is_live + per-symbol error sample
    # (first 5 distinct error strings). Single line per request.
    if isinstance(result, dict):
        sigs_out = result.get("signals") or []
        errs = [s.get("error") for s in sigs_out if isinstance(s, dict) and s.get("error")]
        sample = list(dict.fromkeys(errs))[:5]  # dedupe, first 5
        logger.warning(
            "trading.signals.response | is_live=%s | count=%d | live=%d | errors=%s",
            result.get("is_live"), result.get("count", len(sigs_out)),
            result.get("live_count", 0), sample,
        )
    return result
