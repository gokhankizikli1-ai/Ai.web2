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

function normalizeProvider(raw: string | undefined): DataProvider {
  if (!raw) return 'Unknown';
  const p = raw.toLowerCase().trim();
  if (p.includes('binance')) return 'Binance';
  if (p.includes('yahoo')) return 'Yahoo';
  if (p.includes('alpha') || p.includes('av')) return 'AlphaVantage';
  if (p.includes('coingecko') || p.includes('coin') || p.includes('gecko')) return 'CoinGecko';
  return 'Unknown';
}

function normalizeResponse(data: Record<string, unknown>): TradingSignalsResponse {
  const rawSignals = (data.signals as Record<string, unknown>[]) || [];
  const provider = normalizeProvider(data.provider as string);

  const signals: TradingSignal[] = rawSignals.map((s, i) => ({
    id: (s.id as string) || `sig-${i}`,
    symbol: (s.symbol as string) || '???',
    name: (s.name as string) || (s.symbol as string) || 'Unknown',
    direction: (s.direction as TradingSignal['direction']) || 'wait',
    confidence: typeof s.confidence === 'number' ? Math.round(s.confidence) : 50,
    setupGrade: (s.setupGrade as TradingSignal['setupGrade']) || 'C',
    volatility: (s.volatility as TradingSignal['volatility']) || 'medium',
    entryPrice: s.entryPrice as string | undefined,
    targetPrice: s.targetPrice as string | undefined,
    stopLoss: s.stopLoss as string | undefined,
    timestamp: new Date((s.timestamp as string) || Date.now()),
    reasoning: (s.reasoning as string) || '',
    provider,
    sparkline: s.sparkline as number[] | undefined,
  }));

  return {
    is_live: !!data.is_live,
    provider,
    timestamp: (data.timestamp as string) || new Date().toISOString(),
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

      if (!data.is_live) {
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
