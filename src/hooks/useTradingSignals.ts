import { useState, useEffect, useCallback } from 'react';
import type { TradingSignal, TradingSignalsResponse, DataProvider } from '@/types';

const API_BASE = 'https://worker-production-1345.up.railway.app/trading/signals';

interface UseTradingSignalsOptions {
  symbols?: string;
  timeframe?: string;
}

interface UseTradingSignalsResult {
  signals: TradingSignal[];
  isLive: boolean;
  provider: DataProvider;
  lastUpdated: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/* ═══════════════════════════════════════════
   PROVIDER NORMALIZATION
   ═══════════════════════════════════════════ */
function normalizeProvider(raw: string | undefined): DataProvider {
  if (!raw) return 'Unknown';
  const p = raw.toUpperCase().trim();
  if (p.includes('FINN')) return 'Finnhub';
  if (p.includes('GECKO') || p.includes('COIN')) return 'CoinGecko';
  if (p.includes('BINANCE')) return 'Binance';
  if (p.includes('YAHOO')) return 'Yahoo';
  if (p.includes('ALPHA') || p.includes('AV')) return 'AlphaVantage';
  return 'Unknown';
}

/* ═══════════════════════════════════════════
   CONFIDENCE — cascade through all possible fields
   ═══════════════════════════════════════════ */
function extractConfidence(s: Record<string, unknown>): number {
  if (typeof s.confidence_pct === 'number') return Math.round(s.confidence_pct);
  if (typeof s.confidence === 'number') return Math.round(s.confidence);
  const intel = s.intel as Record<string, unknown> | undefined;
  if (typeof intel?.confidence_pct === 'number') return Math.round(intel.confidence_pct);
  if (typeof intel?.confidence === 'number') return Math.round(intel.confidence);
  return 0;
}

/* ═══════════════════════════════════════════
   DIRECTION — normalize backend values
   ═══════════════════════════════════════════ */
function extractDirection(s: Record<string, unknown>): TradingSignal['direction'] {
  const raw = ((s.direction as string) || (s.raw_direction as string) || '').toUpperCase().trim();
  if (raw === 'LONG') return 'long';
  if (raw === 'SHORT') return 'short';
  if (raw === 'WAIT') return 'wait';
  if (raw === 'NO_TRADE' || raw === 'NO TRADE' || raw === 'NEUTRAL' || raw === 'HOLD') return 'neutral';
  const intelDir = ((s.intel as Record<string, unknown>)?.direction as string)?.toUpperCase().trim();
  if (intelDir === 'LONG') return 'long';
  if (intelDir === 'SHORT') return 'short';
  if (intelDir === 'WAIT') return 'wait';
  if (intelDir === 'NO_TRADE' || intelDir === 'NO TRADE' || intelDir === 'NEUTRAL' || intelDir === 'HOLD') return 'neutral';
  return 'wait';
}

/* ═══════════════════════════════════════════
   GRADE — setup_grade / grade / setupGrade
   ═══════════════════════════════════════════ */
function extractGrade(s: Record<string, unknown>): TradingSignal['setupGrade'] {
  const grade = ((s.setup_grade as string) || (s.grade as string) || (s.setupGrade as string) || '').toUpperCase().trim();
  if (grade === 'A' || grade === 'A+') return 'A';
  if (grade === 'B' || grade === 'B+' || grade === 'B-') return 'B';
  if (grade === 'C' || grade === 'C+' || grade === 'C-') return 'C';
  if (grade === 'D' || grade === 'D+' || grade === 'D-') return 'D';
  const numeric = typeof s.setup_grade === 'number' ? s.setup_grade : typeof s.grade === 'number' ? s.grade : undefined;
  if (numeric === 1) return 'A';
  if (numeric === 2) return 'B';
  if (numeric === 3) return 'C';
  if (numeric === 4) return 'D';
  return 'C';
}

/* ═══════════════════════════════════════════
   PRICE FIELDS — snake_case + camelCase + intel
   ═══════════════════════════════════════════ */
function extractString(s: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof s[key] === 'string' && s[key]) return s[key] as string;
    if (typeof s[key] === 'number') return String(s[key]);
  }
  const intel = s.intel as Record<string, unknown> | undefined;
  if (intel) {
    for (const key of keys) {
      if (typeof intel[key] === 'string' && intel[key]) return intel[key] as string;
      if (typeof intel[key] === 'number') return String(intel[key]);
    }
  }
  return undefined;
}

/* ═══════════════════════════════════════════
   RESPONSE NORMALIZER
   ═══════════════════════════════════════════ */
function normalizeResponse(raw: unknown): TradingSignalsResponse {
  console.log('[useTradingSignals] raw API response:', raw);

  // Tolerate ALL shapes the backend (or a future variant) might return:
  //   - direct array:                   [ {…}, {…} ]
  //   - object with signals key:        { signals: [ {…} ], … }
  //   - nested wrapper:                 { data: { signals: [ {…} ] }, … }
  // Anything else degrades to an empty list — never throws.
  let rawSignals: Record<string, unknown>[] = [];
  let data: Record<string, unknown> = {};
  if (Array.isArray(raw)) {
    rawSignals = raw as Record<string, unknown>[];
    console.log('[useTradingSignals] response shape: direct array', { length: rawSignals.length });
  } else if (raw && typeof raw === 'object') {
    data = raw as Record<string, unknown>;
    if (Array.isArray(data.signals)) {
      rawSignals = data.signals as Record<string, unknown>[];
      console.log('[useTradingSignals] response shape: object.signals[]', { length: rawSignals.length });
    } else if (data.data && typeof data.data === 'object' && Array.isArray((data.data as Record<string, unknown>).signals)) {
      data = data.data as Record<string, unknown>;
      rawSignals = data.signals as Record<string, unknown>[];
      console.log('[useTradingSignals] response shape: object.data.signals[]', { length: rawSignals.length });
    } else {
      console.log('[useTradingSignals] response shape: object without signals[] — degrading to []');
    }
  } else {
    console.log('[useTradingSignals] response shape: unrecognised — degrading to []');
  }

  const provider = normalizeProvider((data.provider as string) || (data.source as string));

  // Live detection — response-level, count, OR per-signal. Per user spec:
  // "If signals.length > 0, render them" — so a non-empty list is enough
  // to flip isLive=true and prevent the panel from getting stuck on
  // 'reconnecting' when the backend returned valid data.
  const responseIsLive = data.is_live === true;
  const hasLiveCount = typeof data.live_count === 'number' && (data.live_count as number) > 0;
  const anySignalLive = rawSignals.some((s) => s.is_live === true);
  const hasAnySignals = rawSignals.length > 0;
  const isLive = responseIsLive || hasLiveCount || anySignalLive || hasAnySignals;

  console.log('[useTradingSignals] live check:', {
    responseIsLive, hasLiveCount, anySignalLive, hasAnySignals, isLive,
  });

  const signals: TradingSignal[] = rawSignals.map((s, i) => {
    const sig: TradingSignal = {
      id: extractString(s, 'id') || `sig-${i}`,
      symbol: extractString(s, 'symbol', 'ticker') || '???',
      name: extractString(s, 'name') || extractString(s, 'symbol', 'ticker') || 'Unknown',
      direction: extractDirection(s),
      confidence: extractConfidence(s),
      setupGrade: extractGrade(s),
      volatility: ((s.volatility as string) || 'medium').toLowerCase() as TradingSignal['volatility'],
      entryPrice: extractString(s, 'entry', 'entryPrice', 'price'),
      targetPrice: extractString(s, 'take_profit_1', 'target', 'targetPrice', 'tp1'),
      stopLoss: extractString(s, 'stop_loss', 'stopLoss', 'sl'),
      timestamp: new Date((s.timestamp as string) || Date.now()),
      reasoning: extractString(s, 'reasoning', 'rationale', 'note') || '',
      provider: normalizeProvider((s.provider as string) || (s.source as string)),
      sparkline: s.sparkline as number[] | undefined,
    };
    return sig;
  });

  const result: TradingSignalsResponse = {
    is_live: isLive,
    provider,
    timestamp: (data.timestamp as string) || (data.last_updated as string) || new Date().toISOString(),
    signals,
  };

  console.log('[useTradingSignals] normalized:', { isLive, provider, signalCount: signals.length });
  return result;
}

export function useTradingSignals(options?: UseTradingSignalsOptions): UseTradingSignalsResult {
  const { symbols = 'AAPL,NVDA,BTCUSDT', timeframe = '1d' } = options || {};

  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [provider, setProvider] = useState<DataProvider>('Unknown');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const url = new URL(API_BASE);
    url.searchParams.set('symbols', symbols);
    url.searchParams.set('timeframe', timeframe);

    console.log('[useTradingSignals] fetching:', url.toString());

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      console.log('[useTradingSignals] response status:', response.status);

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const rawData = await response.json();
      const data = normalizeResponse(rawData);

      console.log('[useTradingSignals] hasLiveSignals:', data.is_live);
      console.log('[useTradingSignals] signals count:', data.signals.length);

      setIsLive(data.is_live);
      setProvider(data.provider);
      setSignals(data.signals);
      setLastUpdated(data.timestamp);

      // Only flag "Live data unavailable" when we genuinely have nothing
      // to show. If signals.length > 0 the panel must render them and
      // must NOT stay stuck on the reconnecting state.
      if (data.signals.length === 0) {
        setError('Live data unavailable');
      } else {
        setError(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load trading signals';
      const isCors = msg.includes('CORS') || msg.includes('Failed to fetch') || msg.includes('NetworkError');
      console.error('[useTradingSignals] fetch error:', msg, isCors ? '(likely CORS)' : '');
      setError(isCors ? 'CORS_BLOCKED' : msg);
      setIsLive(false);
    } finally {
      setIsLoading(false);
    }
  }, [symbols, timeframe]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const refresh = useCallback(() => {
    fetchSignals();
  }, [fetchSignals]);

  return { signals, isLive, provider, lastUpdated, isLoading, error, refresh };
}
