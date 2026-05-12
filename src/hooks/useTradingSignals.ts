import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TradingSignal, TradingSignalsResponse, DataProvider,
  SetupGrade, AssetType, DataQuality,
} from '@/types';

// Canonical Railway backend (per STABLE_CHECKPOINT.md and verified by the
// Phase 5.3 post-deploy workflow on every recent merge to main). Override
// only if the Railway service is renamed AND STABLE_CHECKPOINT.md is updated.
const API_ORIGIN = 'https://worker-production-1345.up.railway.app';

// Default symbol set + timeframe match the brief in PR #14:
// crypto on 4h, stocks/ETFs blended in (yfinance handles 1h/1d under the hood).
const DEFAULT_SYMBOLS   = ['BTCUSDT', 'ETHUSDT', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD'] as const;
const DEFAULT_TIMEFRAME = '4h' as const;

// Auto-refresh cadence — 60s is well above the backend's market-data cache
// TTL (30s for klines), so successive polls hit the cache cheaply.
const REFRESH_INTERVAL_MS = 60_000;
// Per-request abort budget so a slow backend never leaves the panel spinning.
const REQUEST_TIMEOUT_MS  = 12_000;


interface UseTradingSignalsOptions {
  symbols?:   readonly string[];
  timeframe?: string;
  autoRefresh?: boolean;            // default true
}

interface UseTradingSignalsResult {
  signals:     TradingSignal[];
  isLive:      boolean;
  provider:    DataProvider;
  lastUpdated: string | null;
  isLoading:   boolean;
  error:       string | null;
  refresh:     () => void;
}


// ── Provider name canonicalisation (matches backend's _normalize_provider_name) ──
function normalizeProvider(raw: string | undefined | null): DataProvider {
  if (!raw) return 'Unknown';
  const p = String(raw).toLowerCase().trim();
  if (p.includes('binance'))                                 return 'Binance';
  if (p.includes('yahoo'))                                   return 'Yahoo';
  if (p.includes('alpha') || p === 'av')                     return 'AlphaVantage';
  if (p.includes('coingecko') || p.includes('gecko'))        return 'CoinGecko';
  return 'Unknown';
}


// ── Mapping the BACKEND signal shape → frontend TradingSignal ──────────────
//
// Backend (snake_case, /trading/signals):
//   { symbol, name, asset_type, price, change_24h_pct, timeframe,
//     source, provider, timestamp,
//     direction: "LONG"|"SHORT"|"WAIT"|"NO_TRADE",
//     raw_direction, confidence: "low"|"medium"|"high", confidence_pct: 0-100,
//     setup_grade: 0-10 | null,
//     entry, stop_loss, take_profit_1, take_profit_2, risk_reward,
//     volatility_regime, invalidation, data_quality, is_live, error }
//
// `setup_grade`, `confidence_pct`, `entry`, `stop_loss`, `take_profit_*`,
// `risk_reward` and `invalidation` are all `null` when no plan was generated
// (e.g. CoinGecko-fallback rows that only carry a live price). The mapper
// must preserve that distinction so the UI can render "—" for missing
// numbers instead of fabricating "0% / D".

function mapDirection(dir: unknown): TradingSignal['direction'] {
  const d = String(dir ?? '').toUpperCase();
  if (d === 'LONG')     return 'long';
  if (d === 'SHORT')    return 'short';
  if (d === 'NO_TRADE') return 'neutral';
  return 'wait';
}

// Backend `setup_grade` is 0..10 when a plan was generated, else `null`.
// Returning `null` for missing scores lets the UI render "—" instead of
// silently degrading to "D / 0%" for live-but-no-plan rows (e.g. when the
// CoinGecko fallback returned a price but no full Phase 5 plan).
function mapSetupGrade(score: unknown): SetupGrade | null {
  if (score === null || score === undefined || score === '') return null;
  const n = typeof score === 'number' ? score : Number(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 8) return 'A';
  if (n >= 6) return 'B';
  if (n >= 4) return 'C';
  return 'D';
}

function mapAssetType(raw: unknown): AssetType | undefined {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'crypto' || v === 'stock' || v === 'forex' || v === 'unknown') return v;
  return undefined;
}

function mapDataQuality(raw: unknown): DataQuality | undefined {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'full' || v === 'partial' || v === 'fallback' || v === 'unavailable') return v;
  return undefined;
}

function toFiniteNumber(n: unknown): number | undefined {
  if (n === null || n === undefined || n === '') return undefined;
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : undefined;
}

// Collapse the rich backend regime taxonomy (squeeze_pre_breakout / high_volatility
// / overbought / trending_up / choppy / low_volatility / …) into the frontend's
// 3-bucket scale.
function mapVolatility(regime: unknown): TradingSignal['volatility'] {
  const r = String(regime ?? '').toLowerCase();
  if (!r) return 'medium';
  if (r.includes('high') || r === 'overbought' || r === 'oversold') return 'high';
  if (r.includes('low')  || r === 'choppy')                          return 'low';
  return 'medium';
}

function fmtPrice(n: unknown): string | undefined {
  if (n === null || n === undefined) return undefined;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return undefined;
  const abs = Math.abs(v);
  if (abs >= 1000)  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1)     return v.toFixed(2);
  if (abs >= 0.01)  return v.toFixed(4);
  return v.toFixed(6);
}

function mapBackendSignal(raw: Record<string, unknown>, idx: number): TradingSignal {
  const provider   = normalizeProvider((raw.provider as string) ?? (raw.source as string));
  const isLive     = !!raw.is_live;
  const setupGrade = mapSetupGrade(raw.setup_grade);
  // Confidence is null when no plan was generated. Only render a number
  // when the backend gave us one AND the row is live AND a setup grade
  // exists — otherwise "0%" misleadingly looks like a real reading.
  const confRaw    = toFiniteNumber(raw.confidence_pct);
  const confidence =
    isLive && setupGrade !== null && confRaw !== undefined
      ? Math.max(0, Math.min(100, Math.round(confRaw)))
      : null;

  const tsRaw      = (raw.timestamp as string) || new Date().toISOString();
  const errorReason = typeof raw.error === 'string' ? raw.error : undefined;

  // Reasoning is short copy shown inline. Prefer the AI's invalidation
  // (veto condition) when a plan exists; otherwise the backend's error or
  // a status-aware default. Distinguish "no plan yet" (live, no setup)
  // from "lookup failed" so users don't see a single confusing label.
  let reasoning: string;
  if (errorReason) {
    reasoning = errorReason;
  } else if (raw.invalidation) {
    reasoning = String(raw.invalidation);
  } else if (isLive) {
    reasoning = 'Live price — no setup yet on this timeframe.';
  } else {
    reasoning = 'Live data unavailable.';
  }

  return {
    id:           (raw.symbol as string) ? `${raw.symbol}-${idx}` : `sig-${idx}`,
    symbol:       (raw.symbol as string) || '???',
    name:         (raw.name as string) || (raw.symbol as string) || 'Unknown',
    direction:    mapDirection(raw.direction),
    confidence,
    setupGrade,
    volatility:   mapVolatility(raw.volatility_regime),
    price:        fmtPrice(raw.price),
    change24hPct: toFiniteNumber(raw.change_24h_pct),
    entryPrice:   fmtPrice(raw.entry),
    targetPrice:  fmtPrice(raw.take_profit_1),
    stopLoss:     fmtPrice(raw.stop_loss),
    riskReward:   toFiniteNumber(raw.risk_reward),
    timestamp:    new Date(tsRaw),
    reasoning,
    provider,
    isLive,
    assetType:    mapAssetType(raw.asset_type),
    dataQuality:  mapDataQuality(raw.data_quality),
    errorReason,
    // sparkline not provided by the backend — leave undefined so the
    // SignalCard skips rendering it.
    sparkline:    undefined,
  };
}

function normalizeResponse(data: Record<string, unknown>): TradingSignalsResponse {
  const rawSignals = (data.signals as Record<string, unknown>[]) || [];
  const signals    = rawSignals.map(mapBackendSignal);

  // Backend doesn't emit a top-level provider — derive from the first
  // *live* signal so the "data via X" label in the UI matches reality.
  const firstLive = signals.find((_s, i) => (rawSignals[i].is_live as boolean));
  const provider  = firstLive?.provider ?? signals[0]?.provider ?? 'Unknown';

  return {
    is_live:   !!data.is_live,
    provider,
    timestamp: (data.generated_at as string) || (data.timestamp as string) || new Date().toISOString(),
    signals,
  };
}


// ── Friendly error mapping (mirrors the pattern from useChat.ts) ──────────
const NETWORK_ERROR_PATTERNS =
  /load failed|failed to fetch|network ?error|connection (refused|reset)|err_(internet|connection|name_not_resolved)/i;

function friendlyError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'Request timed out.';
  if (err instanceof TypeError)                                  return 'Connection problem. Please retry.';
  const msg = err instanceof Error ? err.message : '';
  if (msg && NETWORK_ERROR_PATTERNS.test(msg)) return 'Connection problem. Please retry.';
  return msg || 'Failed to load trading signals.';
}


export function useTradingSignals(opts: UseTradingSignalsOptions = {}): UseTradingSignalsResult {
  const symbols    = opts.symbols    ?? DEFAULT_SYMBOLS;
  const timeframe  = opts.timeframe  ?? DEFAULT_TIMEFRAME;
  const autoRefresh = opts.autoRefresh ?? true;

  const [signals, setSignals]         = useState<TradingSignal[]>([]);
  const [isLive,  setIsLive]          = useState(false);
  const [provider, setProvider]       = useState<DataProvider>('Unknown');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const [error,   setError]           = useState<string | null>(null);

  // Stabilise the symbols string for cache-key + dep-array purposes.
  const symbolsKey = (symbols as readonly string[]).join(',');
  const inFlightCtrlRef = useRef<AbortController | null>(null);

  const fetchSignals = useCallback(async () => {
    // Cancel any in-flight request before starting a new one.
    if (inFlightCtrlRef.current) {
      try { inFlightCtrlRef.current.abort(); } catch { /* ignore */ }
    }
    const ctrl = new AbortController();
    inFlightCtrlRef.current = ctrl;
    const timeoutId = setTimeout(() => {
      try { ctrl.abort(); } catch { /* ignore */ }
    }, REQUEST_TIMEOUT_MS);

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ symbols: symbolsKey, timeframe });
      const response = await fetch(`${API_ORIGIN}/trading/signals?${params}`, {
        method:  'GET',
        signal:  ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        // 503 = service flag off; 400 = validation; 5xx = backend issue.
        if (response.status === 503) {
          setError('Trading signals service is disabled on the server.');
        } else if (response.status === 429) {
          setError('Too many requests. Wait a few seconds and retry.');
        } else if (response.status >= 500) {
          setError('Server error. The team has been notified.');
        } else {
          setError(`Server responded with ${response.status}.`);
        }
        setIsLive(false);
        return;
      }

      const rawData = await response.json();
      const data    = normalizeResponse(rawData);

      setSignals(data.signals);
      setIsLive(data.is_live);
      setProvider(data.provider);
      setLastUpdated(data.timestamp);

      if (!data.is_live) {
        // Surface the backend's reason if it gave us one (e.g. "market_data
        // tool disabled — set ENABLE_TOOLS=true + ENABLE_MARKET_DATA=true").
        const firstErr = (rawData.signals as Array<Record<string, unknown>> | undefined)?.[0]?.error;
        const reason = (typeof firstErr === 'string' && firstErr) || 'Live data unavailable.';
        setError(reason);
      }
    } catch (err) {
      // Translate browser / abort errors to friendly copy.
      // AbortError from our own ctrl.abort() (e.g. unmount) shouldn't surface.
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Caller cancelled or timed out — let the timeout path handle the message.
        if (!ctrl.signal.aborted) return;
        setError('Request timed out.');
        setIsLive(false);
        return;
      }
      setError(friendlyError(err));
      setIsLive(false);
    } finally {
      clearTimeout(timeoutId);
      if (inFlightCtrlRef.current === ctrl) {
        inFlightCtrlRef.current = null;
      }
      setIsLoading(false);
    }
  }, [symbolsKey, timeframe]);

  useEffect(() => {
    fetchSignals();
    if (!autoRefresh) return;
    const id = setInterval(fetchSignals, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      // Abort any in-flight request when unmounting / params change.
      if (inFlightCtrlRef.current) {
        try { inFlightCtrlRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, [fetchSignals, autoRefresh]);

  const refresh = useCallback(() => { fetchSignals(); }, [fetchSignals]);

  return { signals, isLive, provider, lastUpdated, isLoading, error, refresh };
}
