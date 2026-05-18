import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TradingSignal, TradingSignalsResponse, DataProvider, SignalDirection, AssetType,
} from '@/types';

/**
 * Trading-signals backend hook.
 *
 * Same base-URL resolution as src/hooks/useChat.ts (Phase 8i): read
 * VITE_API_URL at build time, fall back to the live Railway host.
 *
 * IMPORTANT: do NOT hardcode the dead "worker-production-*.up.railway.app".
 * fetch() against it raises TypeError, surfaced as "Sunucuya ulaşılamadı".
 *
 * Phase 8n: the endpoint REQUIRES a `symbols` query param — calling it
 * bare returns 422. The hook now takes the symbols + timeframe, builds
 * the query string, and normalises the REAL backend signal schema
 * (LONG/SHORT/WAIT/NO_TRADE, confidence_pct, setup_grade 0-10, numeric
 * entry/stop/take_profit). When no symbols are given it stays idle and
 * never calls the network.
 */
const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

const REQUEST_TIMEOUT_MS = 15_000;

interface UseTradingSignalsResult {
  signals: TradingSignal[];
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
  if (p.includes('finnhub')) return 'Finnhub';
  if (p.includes('twelve')) return 'TwelveData';
  if (p.includes('alpha') || p.includes('av')) return 'AlphaVantage';
  if (p.includes('coin') || p.includes('gecko')) return 'CoinGecko';
  return 'Unknown';
}

function mapDirection(raw: unknown): SignalDirection {
  switch (String(raw || '').toUpperCase()) {
    case 'LONG': return 'long';
    case 'SHORT': return 'short';
    case 'NO_TRADE': return 'neutral';
    default: return 'wait'; // WAIT / REVERSAL_WATCH / unknown
  }
}

function mapGrade(g: unknown): TradingSignal['setupGrade'] {
  const n = typeof g === 'number' ? g : Number(g);
  if (!Number.isFinite(n)) return 'D';
  if (n >= 8) return 'A';
  if (n >= 6) return 'B';
  if (n >= 4) return 'C';
  return 'D';
}

function mapConfidence(s: Record<string, unknown>): number {
  const pct = Number(s.confidence_pct);
  if (Number.isFinite(pct) && pct > 0) return Math.round(pct);
  switch (String(s.confidence || '').toLowerCase()) {
    case 'high': return 85;
    case 'medium': return 60;
    case 'low': return 30;
    default: return 0;
  }
}

function mapVolatility(regime: unknown): TradingSignal['volatility'] {
  const r = String(regime || '').toLowerCase();
  if (r.includes('high') || r.includes('breakout')) return 'high';
  if (r.includes('low') || r.includes('squeeze')) return 'low';
  return 'medium';
}

function num(v: unknown): number | undefined {
  // Absent → undefined, NEVER 0. The backend sends JSON null for an
  // unavailable price/entry/stop/tp; `Number(null)` is 0 and
  // `Number("")`/`Number(" ")` are 0 too, which would render a
  // fabricated "$0.00" in a trading panel (Bugbot Medium eff5d8d2).
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string' && v.trim() === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function priceStr(v: unknown): string | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 6 : 2 });
}

function buildReasoning(s: Record<string, unknown>, isLive: boolean): string {
  if (!isLive) {
    const err = String(s.error || '').trim();
    return err
      ? `Live data unavailable (${err}).`
      : 'Live market data unavailable for this symbol.';
  }
  const bits: string[] = [];
  if (s.volatility_regime) bits.push(`Regime: ${s.volatility_regime}`);
  if (s.risk_reward != null) bits.push(`R:R ${s.risk_reward}`);
  if (s.invalidation) bits.push(String(s.invalidation));
  return bits.join(' · ') || 'Live signal.';
}

function normalizeResponse(data: Record<string, unknown>): TradingSignalsResponse {
  const rawSignals = Array.isArray(data?.signals)
    ? (data.signals as Record<string, unknown>[])
    : [];

  const signals: TradingSignal[] = rawSignals.map((s, i) => {
    const live = !!s.is_live;
    return {
      id: (s.symbol as string) ? `sig-${s.symbol}-${i}` : `sig-${i}`,
      symbol: (s.symbol as string) || '???',
      name: (s.name as string) || (s.symbol as string) || 'Unknown',
      direction: mapDirection(s.direction),
      confidence: mapConfidence(s),
      setupGrade: mapGrade(s.setup_grade),
      volatility: mapVolatility(s.volatility_regime),
      entryPrice: priceStr(s.entry),
      targetPrice: priceStr(s.take_profit_1),
      stopLoss: priceStr(s.stop_loss),
      timestamp: new Date((s.timestamp as string) || Date.now()),
      reasoning: buildReasoning(s, live),
      provider: normalizeProvider((s.provider as string) || (s.source as string)),
      price: num(s.price),
      changePercent: num(s.change_24h_pct),
      assetType: (String(s.asset_type || 'unknown').toLowerCase() as AssetType),
      isLive: live,
    };
  });

  return {
    provider: normalizeProvider(data.provider as string),
    timestamp: (data.timestamp as string) || (data.generated_at as string) ||
      new Date().toISOString(),
    signals,
  };
}

export function useTradingSignals(
  symbols: string[],
  timeframe: string = '4h',
): UseTradingSignalsResult {
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [provider, setProvider] = useState<DataProvider>('Unknown');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Start in loading when there ARE symbols to fetch (the production
  // path) so the panel never flashes the "unavailable" empty state for
  // one paint before the effect fires (Bugbot Medium 0db614d5). Stays
  // false for the idle/empty-symbols case (no request happens).
  const [isLoading, setIsLoading] = useState(symbols.length > 0);
  const [error, setError] = useState<string | null>(null);

  const symbolsKey = symbols.join(',').toUpperCase();
  // Keep the latest key in a ref so refresh() always uses current symbols.
  const keyRef = useRef(symbolsKey);
  keyRef.current = symbolsKey;

  const fetchSignals = useCallback(async () => {
    const key = keyRef.current;
    if (!key) {
      setSignals([]); setIsLoading(false); setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = `${API_BASE}/trading/signals?symbols=${
        encodeURIComponent(key)
      }&timeframe=${encodeURIComponent(timeframe)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      const rawText = await response.text();
      let rawData: Record<string, unknown> | null = null;
      try {
        rawData = rawText ? JSON.parse(rawText) : null;
      } catch {
        rawData = { _raw: rawText };
      }

      if (!response.ok) {
        // Graceful (no throw), but a real server failure must be
        // DISTINGUISHABLE from "healthy but no signals" — previously
        // setError(null) made a 503/500 look identical to an empty
        // result, hiding outages and the disabled-flag case from the
        // user (Bugbot Medium e59fa085).
        setSignals([]);
        setProvider('Unknown');
        setLastUpdated(new Date().toISOString());
        let msg = `Sunucu hatası (HTTP ${response.status}). Tekrar dene.`;
        if (response.status === 503) {
          msg = 'Trading signals are disabled on the server '
              + '(set ENABLE_TRADING_SIGNALS=true).';
        } else if (response.status === 400 || response.status === 422) {
          msg = 'Geçersiz istek (symbols/timeframe). Tekrar dene.';
        } else if (response.status >= 500) {
          msg = `Sunucu hatası (HTTP ${response.status}). Lütfen sonra tekrar dene.`;
        }
        setError(msg);
        return;
      }

      const norm = normalizeResponse(rawData || {});
      setProvider(norm.provider);
      setSignals(norm.signals);
      setLastUpdated(norm.timestamp);
      setError(null);
    } catch (err) {
      setSignals([]);
      setProvider('Unknown');

      let friendly = 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';
      if (err instanceof DOMException && err.name === 'AbortError') {
        friendly = 'İstek zaman aşımına uğradı. Tekrar dene.';
      } else if (err instanceof TypeError) {
        friendly = 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
      } else if (err instanceof SyntaxError) {
        friendly = 'Yanıt anlaşılamadı. Tekrar dene.';
      } else if (err instanceof Error && err.message) {
        friendly = err.message;
      }
      setError(friendly);
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    fetchSignals();
    // Re-fetch whenever the symbol set or timeframe changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, timeframe]);

  const refresh = useCallback(() => {
    fetchSignals();
  }, [fetchSignals]);

  return { signals, provider, lastUpdated, isLoading, error, refresh };
}
