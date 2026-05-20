import { useState, useEffect, useCallback } from 'react';
import type { TradingSignal, TradingSignalsResponse, DataProvider } from '@/types';

const API_URL = 'https://worker-production-2a49.up.railway.app/trading/signals';

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
   Handles FINNHUB, COINGECKO, Binance, etc.
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
   LONG | SHORT | WAIT | NO_TRADE | NEUTRAL
   ═══════════════════════════════════════════ */
function extractDirection(s: Record<string, unknown>): TradingSignal['direction'] {
  const raw = ((s.direction as string) || (s.raw_direction as string) || '').toUpperCase().trim();
  if (raw === 'LONG') return 'long';
  if (raw === 'SHORT') return 'short';
  if (raw === 'WAIT') return 'wait';
  if (raw === 'NO_TRADE' || raw === 'NO TRADE' || raw === 'NEUTRAL' || raw === 'HOLD') return 'neutral';
  // Fallback to intel object
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
  // Numeric grade 1-4 mapping
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
function normalizeResponse(data: Record<string, unknown>): TradingSignalsResponse {
  const rawSignals = (data.signals as Record<string, unknown>[]) || [];
  const provider = normalizeProvider(data.provider as string);
  const isLive = !!(data.is_live === true || data.live_count && (data.live_count as number) > 0);

  const signals: TradingSignal[] = rawSignals.map((s, i) => ({
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
    provider,
    sparkline: s.sparkline as number[] | undefined,
  }));

  return {
    is_live: isLive,
    provider,
    timestamp: (data.timestamp as string) || (data.last_updated as string) || new Date().toISOString(),
    signals,
  };
}

export function useTradingSignals(): UseTradingSignalsResult {
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [provider, setProvider] = useState<DataProvider>('Unknown');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const rawData = await response.json();
      const data = normalizeResponse(rawData);

      setIsLive(data.is_live);
      setProvider(data.provider);
      setSignals(data.signals);
      setLastUpdated(data.timestamp);

      if (!data.is_live && data.signals.length === 0) {
        setError('Live data unavailable');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trading signals');
      setIsLive(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const refresh = useCallback(() => {
    fetchSignals();
  }, [fetchSignals]);

  return { signals, isLive, provider, lastUpdated, isLoading, error, refresh };
}
