import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TradingSignal, TradingSignalsResponse, DataProvider,
  SetupGrade, AssetType, DataQuality,
} from '@/types';

// Canonical Railway backend (per STABLE_CHECKPOINT.md and verified by the
// Phase 5.3 post-deploy workflow on every recent merge to main). The
// 2a49 host that appears in earlier history is a typo — DNS does not
// resolve, every fetch from it throws TypeError: Load failed (Safari) /
// Failed to fetch (Chromium).
const API_ORIGIN = 'https://worker-production-1345.up.railway.app';

const DEFAULT_SYMBOLS   = ['BTCUSDT', 'ETHUSDT', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD'] as const;
const DEFAULT_TIMEFRAME = '4h' as const;
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS  = 12_000;


interface UseTradingSignalsOptions {
  symbols?:    readonly string[];
  timeframe?:  string;
  autoRefresh?: boolean;
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


// ── Provider name canonicalisation ─────────────────────────────────────────
function normalizeProvider(raw: string | undefined | null): DataProvider {
  if (!raw) return 'Unknown';
  const p = String(raw).toLowerCase().trim();
  if (p.includes('binance'))                                 return 'Binance';
  if (p.includes('yahoo'))                                   return 'Yahoo';
  if (p.includes('alpha') || p === 'av')                     return 'AlphaVantage';
  if (p.includes('coingecko') || p.includes('gecko'))        return 'CoinGecko';
  return 'Unknown';
}


// ── Backend snake_case → frontend TradingSignal ────────────────────────────
//
// Backend (/trading/signals) per-signal shape:
//   { symbol, name, asset_type, price, change_24h_pct, timeframe,
//     source, provider, timestamp,
//     direction: "LONG"|"SHORT"|"WAIT"|"NO_TRADE",
//     confidence_pct: 0-100 | null, setup_grade: 0-10 | null,
//     entry, stop_loss, take_profit_1, take_profit_2, risk_reward,
//     volatility_regime, invalidation, data_quality, is_live, error }
//
// `setup_grade` / `confidence_pct` / price levels are all `null` when no
// plan was generated. The mapper preserves that distinction so the UI can
// render "—" instead of fabricating "0% / D" — that fake reading was the
// regression PR #17 fixed and we're restoring here.

function mapDirection(dir: unknown): TradingSignal['direction'] {
  const d = String(dir ?? '').toUpperCase();
  if (d === 'LONG')     return 'long';
  if (d === 'SHORT')    return 'short';
  if (d === 'NO_TRADE') return 'neutral';
  return 'wait';
}

// 0..10 → A/B/C/D, null when missing. 0 is a valid worst-case grade.
function mapSetupGrade(score: unknown): SetupGrade | null {
  if (score === null || score === undefined || score === '') return null;
  const n = typeof score === 'number' ? score : Number(score);
  if (!Number.isFinite(n) || n < 0) return null;
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

// Backend `_classify_data_quality` emits one of: full | degraded | fallback.
function mapDataQuality(raw: unknown): DataQuality | undefined {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'full' || v === 'degraded' || v === 'fallback' || v === 'unavailable') return v;
  return undefined;
}

function toFiniteNumber(n: unknown): number | undefined {
  if (n === null || n === undefined || n === '') return undefined;
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : undefined;
}

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
  const confRaw    = toFiniteNumber(raw.confidence_pct);
  // Confidence is null unless the row is live AND a setup grade exists —
  // otherwise "0%" misleadingly looks like a real reading.
  const confidence =
    isLive && setupGrade !== null && confRaw !== undefined
      ? Math.max(0, Math.min(100, Math.round(confRaw)))
      : null;

  const tsRaw       = (raw.timestamp as string) || new Date().toISOString();
  const errorReason = typeof raw.error === 'string' && raw.error ? raw.error : undefined;

  // Inline copy shown in the expanded card. Prefer the AI's invalidation
  // string. When a plan exists but no veto string was emitted, leave the
  // copy empty so the levels + badges speak for themselves. When the row
  // failed, leave empty too — the amber error row in the card carries the
  // error text already.
  let reasoning: string;
  if (raw.invalidation) {
    reasoning = String(raw.invalidation);
  } else if (isLive && setupGrade === null) {
    reasoning = 'Live price — no setup yet on this timeframe.';
  } else if (isLive) {
    reasoning = '';
  } else if (errorReason) {
    reasoning = '';
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
    sparkline:    undefined,
  };
}

function normalizeResponse(data: Record<string, unknown>): TradingSignalsResponse {
  const rawSignals = (data.signals as Record<string, unknown>[]) || [];
  const signals    = rawSignals.map(mapBackendSignal);
  // Backend doesn't emit a top-level provider — derive from the first
  // *live* signal so the "data via X" label in the UI matches reality.
  const firstLive  = signals.find((_s, i) => !!(rawSignals[i].is_live));
  const provider   = firstLive?.provider ?? signals[0]?.provider ?? 'Unknown';
  return {
    is_live:   !!data.is_live,
    provider,
    timestamp: (data.generated_at as string) || (data.timestamp as string) || new Date().toISOString(),
    signals,
  };
}


// ── Friendly error mapping (same pattern as useChat) ──────────────────────
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

  const symbolsKey = (symbols as readonly string[]).join(',');
  const inFlightCtrlRef = useRef<AbortController | null>(null);

  const fetchSignals = useCallback(async () => {
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
        const firstErr = (rawData.signals as Array<Record<string, unknown>> | undefined)?.[0]?.error;
        const reason = (typeof firstErr === 'string' && firstErr) || 'Live data unavailable.';
        setError(reason);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
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
      if (inFlightCtrlRef.current) {
        try { inFlightCtrlRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, [fetchSignals, autoRefresh]);

  const refresh = useCallback(() => { fetchSignals(); }, [fetchSignals]);

  return { signals, isLive, provider, lastUpdated, isLoading, error, refresh };
}
