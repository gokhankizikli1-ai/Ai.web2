import { useState, useEffect, useCallback, useRef } from 'react';
import type { TradingSignal, TradingSignalsResponse, DataProvider } from '@/types';

// Live backend (Railway). GET /trading/signals REQUIRES ?symbols= — calling
// it bare returns 422, which is the regression that made the panel fall back
// to demo. We always send symbols + timeframe.
const API_BASE = 'https://worker-production-1345.up.railway.app/trading/signals';

// Sensible liquid default set if a caller doesn't pass symbols.
const DEFAULT_SYMBOLS = [
  'AAPL', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'AMZN', 'META', 'GOOGL',
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'SPY', 'QQQ',
];

interface UseTradingSignalsResult {
  signals: TradingSignal[];
  isLive: boolean;
  provider: DataProvider;
  lastUpdated: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

function normalizeProvider(raw: unknown): DataProvider {
  const p = String(raw ?? '').toLowerCase().trim();
  if (!p) return 'Unknown';
  if (p.includes('finnhub')) return 'Finnhub';
  if (p.includes('twelve')) return 'TwelveData';
  if (p.includes('yfinance')) return 'YFinance';
  if (p.includes('yahoo')) return 'Yahoo';
  if (p.includes('binance')) return 'Binance';
  if (p.includes('alpha') || p === 'av') return 'AlphaVantage';
  if (p.includes('coingecko') || p.includes('coin') || p.includes('gecko')) return 'CoinGecko';
  return 'Unknown';
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function priceStr(v: unknown): string | undefined {
  const n = num(v);
  return n === undefined ? undefined : String(n);
}

function mapDirection(raw: unknown): TradingSignal['direction'] {
  const d = String(raw ?? '').toLowerCase().trim();
  if (d === 'long' || d === 'buy') return 'long';
  if (d === 'short' || d === 'sell') return 'short';
  if (d === 'neutral' || d === 'no_trade' || d === 'none') return 'neutral';
  if (d === 'wait' || d === 'hold') return 'wait';
  return 'wait';
}

function mapGrade(raw: unknown): TradingSignal['setupGrade'] {
  if (typeof raw === 'string' && ['A', 'B', 'C', 'D'].includes(raw.toUpperCase())) {
    return raw.toUpperCase() as TradingSignal['setupGrade'];
  }
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return 'C';
  if (n >= 8) return 'A';
  if (n >= 6) return 'B';
  if (n >= 4) return 'C';
  return 'D';
}

function mapVolatility(raw: unknown): TradingSignal['volatility'] {
  const v = String(raw ?? '').toLowerCase();
  if (v.includes('high') || v.includes('breakout') || v.includes('expansion')) return 'high';
  if (v.includes('low') || v.includes('contraction') || v.includes('quiet')) return 'low';
  return 'medium';
}

/**
 * Map the REAL backend /trading/signals schema (snake_case:
 * confidence_pct, setup_grade 0-10, direction long/short/wait/neutral,
 * entry/take_profit_1/stop_loss, is_live, provider) to the frontend
 * TradingSignal type. Tolerant of missing fields; never throws.
 */
function normalizeResponse(data: Record<string, unknown>): TradingSignalsResponse {
  const rawSignals = Array.isArray(data?.signals)
    ? (data.signals as Record<string, unknown>[])
    : [];

  const signals: TradingSignal[] = rawSignals.map((s, i) => {
    const symbol = String(s.symbol ?? s.ticker ?? '???');
    return {
      id: String(s.id ?? `sig-${symbol}-${i}`),
      symbol,
      name: String(s.name ?? symbol),
      direction: mapDirection(s.direction ?? s.side ?? s.action),
      confidence:
        typeof s.confidence_pct === 'number'
          ? Math.round(s.confidence_pct as number)
          : typeof s.confidence === 'number'
            ? Math.round(s.confidence as number)
            : 50,
      setupGrade: mapGrade(s.setup_grade ?? s.setupGrade ?? s.grade),
      volatility: mapVolatility(s.volatility_regime ?? s.volatility),
      entryPrice: priceStr(s.entry ?? s.entryPrice ?? s.entry_price),
      targetPrice: priceStr(s.take_profit_1 ?? s.targetPrice ?? s.target ?? s.tp1),
      stopLoss: priceStr(s.stop_loss ?? s.stopLoss ?? s.sl),
      timestamp: new Date(
        String(s.timestamp ?? data.generated_at ?? data.timestamp ?? Date.now()),
      ),
      reasoning: String(s.reasoning ?? s.thesis ?? s.rationale ?? ''),
      provider: normalizeProvider(s.provider ?? data.provider),
      // Per-signal liveness — only true when the backend marked this row
      // as live. Lets the UI label individual cards correctly without
      // changing the demo-fallback behavior at the response level.
      is_live: !!(s.is_live ?? (s as Record<string, unknown>).isLive),
      sparkline: Array.isArray(s.sparkline) ? (s.sparkline as number[]) : undefined,
    };
  });

  return {
    is_live: !!(data.is_live ?? (data as Record<string, unknown>).isLive),
    provider: normalizeProvider(data.provider),
    timestamp: String(data.generated_at ?? data.timestamp ?? new Date().toISOString()),
    signals,
  };
}

export function useTradingSignals(
  symbols: string[] = DEFAULT_SYMBOLS,
  timeframe: string = '1d',
): UseTradingSignalsResult {
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [provider, setProvider] = useState<DataProvider>('Unknown');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id — only the latest in-flight request may commit
  // state. Fixes out-of-order responses and stale data on rapid
  // timeframe/symbol changes.
  const reqIdRef = useRef(0);

  const symbolsKey = symbols.join(',');

  const fetchSignals = useCallback(async () => {
    const myId = ++reqIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}?symbols=${encodeURIComponent(symbolsKey)}&timeframe=${encodeURIComponent(timeframe)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const rawData = await response.json();
      const data = normalizeResponse(rawData);

      if (myId !== reqIdRef.current) return; // superseded by a newer fetch
      setProvider(data.provider);
      setSignals(data.signals);
      setLastUpdated(data.timestamp);
      setIsLive(data.is_live);
      if (!data.is_live || data.signals.length === 0) {
        setError('Live data unavailable');
      }
    } catch (err) {
      if (myId !== reqIdRef.current) return; // superseded by a newer fetch
      setError(err instanceof Error ? err.message : 'Failed to load trading signals');
      setIsLive(false);
    } finally {
      if (myId === reqIdRef.current) setIsLoading(false);
    }
  }, [symbolsKey, timeframe]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const refresh = useCallback(() => {
    fetchSignals();
  }, [fetchSignals]);

  return { signals, isLive, provider, lastUpdated, isLoading, error, refresh };
}
