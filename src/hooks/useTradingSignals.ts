import { useState, useEffect, useCallback } from 'react';
import type { TradingSignal, TradingSignalsResponse, DataProvider } from '@/types';

/**
 * Trading-signals backend URL.
 *
 * Same resolution pattern as src/hooks/useChat.ts (Phase 8i): read from
 * VITE_API_URL at build time, fall back to the current live Railway host.
 *
 * IMPORTANT: do NOT hardcode the older "worker-production-*.up.railway.app"
 * — that's the dead hostname from a prior deployment. fetch() against it
 * raises TypeError("Failed to fetch"), which iOS Safari surfaces as
 * "Load failed" / "Sunucuya ulaşılamadı" in the UI.
 */
const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_URL = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}/trading/signals`;

const REQUEST_TIMEOUT_MS = 15_000;

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
  // Defensive: accept the safe-empty shape from
  // backend/services/trading/safety.py safe_empty_response() — when the
  // backend returns is_live=false (+ optional fallback_mode), surface
  // it as an empty signals list with is_live=false. NEVER fabricate.
  const rawSignals = Array.isArray(data?.signals)
    ? (data.signals as Record<string, unknown>[])
    : [];
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

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      // text() first, then JSON.parse in a try block. Survives an
      // HTML error page from a CDN without crashing on .json().
      const rawText = await response.text();
      let rawData: Record<string, unknown> | null = null;
      try {
        rawData = rawText ? JSON.parse(rawText) : null;
      } catch {
        rawData = { _raw: rawText };
      }

      // eslint-disable-next-line no-console
      console.log('TRADING_SIGNALS_RESPONSE', { status: response.status, data: rawData });

      if (!response.ok) {
        // Treat HTTP errors as the same graceful "live data unavailable"
        // state instead of a generic Error. The TradingPanel already
        // knows how to render this (Phase 8d safety contract).
        setIsLive(false);
        setSignals([]);
        setProvider('Unknown');
        setLastUpdated(new Date().toISOString());
        setError('Live market data temporarily unavailable');
        return;
      }

      const data = normalizeResponse(rawData || {});
      setIsLive(data.is_live);
      setProvider(data.provider);
      setSignals(data.signals);
      setLastUpdated(data.timestamp);

      // Phase 8j — when the backend says is_live=false (or fallback_mode
      // is set), surface a clean fallback message rather than the raw
      // "Live data unavailable" string. The panel already shows the same
      // copy; the error state just suppresses noisy toasts.
      if (!data.is_live) {
        setError(null);   // not a real error — it's a known fallback state
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('TRADING_SIGNALS_ERROR', err);
      setIsLive(false);
      setSignals([]);
      setProvider('Unknown');

      // Match the Phase 8i friendly-toast policy: no raw "Load failed"
      // / "Failed to fetch" should ever reach the user.
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('İstek zaman aşımına uğradı. Tekrar dene.');
      } else if (err instanceof TypeError) {
        setError('Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.');
      } else if (err instanceof SyntaxError) {
        setError('Yanıt anlaşılamadı. Tekrar dene.');
      } else if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError('Live market data temporarily unavailable');
      }
    } finally {
      window.clearTimeout(timeoutId);
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
