import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TradingSignal, TradingSignalsResponse, DataProvider, SignalDirection, AssetType,
  SignalBreakdown, SignalScenarios, SignalFactor,
  SignalIntel, SignalIntelFactor, SignalAnalytics,
  MtfEngine, MtfBias, MtfTfRow, SignalVolume,
  SignalConfidence, ConfidenceFactor,
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

function mapFactors(raw: unknown): SignalFactor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      factor: String(f.factor ?? ''),
      detail: String(f.detail ?? ''),
      weight: Number(f.weight) || 0,
    }));
}

function mapBreakdown(raw: unknown): SignalBreakdown | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  return {
    available: !!b.available,
    unavailableReason: (b.unavailable_reason as string | null) ?? null,
    bullishFactors: mapFactors(b.bullish_factors),
    bearishFactors: mapFactors(b.bearish_factors),
    neutralFactors: mapFactors(b.neutral_factors),
    strongestReason: (b.strongest_reason as string | null) ?? null,
    weakestPoint: (b.weakest_point as string | null) ?? null,
    invalidation: (b.invalidation as string | null) ?? null,
    confirmationNeeded: (b.confirmation_needed as string | null) ?? null,
  };
}

function mapScenarios(raw: unknown): SignalScenarios | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const kl = s.key_levels;
  const keyLevels: Record<string, number> = {};
  if (kl && typeof kl === 'object') {
    for (const [k, v] of Object.entries(kl as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) keyLevels[k] = n;
    }
  }
  return {
    available: !!s.available,
    unavailableReason: (s.unavailable_reason as string | null) ?? null,
    bullish: String(s.bullish_scenario ?? ''),
    bearish: String(s.bearish_scenario ?? ''),
    sideways: String(s.sideways_scenario ?? ''),
    keyLevels,
    doNotTradeIf: String(s.do_not_trade_if ?? ''),
  };
}

function mapIntel(raw: unknown): SignalIntel | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const x = raw as Record<string, unknown>;
  const grade = String(x.grade ?? 'D');
  const factors: SignalIntelFactor[] = Array.isArray(x.factors)
    ? x.factors
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => {
          const side = String(f.side ?? 'neutral');
          return {
            factor: String(f.factor ?? ''),
            side: side === 'bull' || side === 'bear' ? side : 'neutral',
            weight: Number(f.weight) || 0,
          };
        })
    : [];
  return {
    available: !!x.available,
    unavailableReason: (x.unavailable_reason as string | null) ?? null,
    direction: mapDirection(x.direction),
    confidence: Number(x.confidence_pct) || 0,
    grade: (grade === 'A' || grade === 'B' || grade === 'C' ? grade : 'D'),
    score: Number(x.score) || 0,
    bullWeight: Number(x.bull_weight) || 0,
    bearWeight: Number(x.bear_weight) || 0,
    factors,
    invalidation: (x.invalidation as string | null) ?? null,
    rationale: String(x.rationale ?? ''),
  };
}

function _numOrNull(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
}

function mapAnalytics(raw: unknown): SignalAnalytics | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const sub = (k: string) =>
    (a[k] && typeof a[k] === 'object' ? (a[k] as Record<string, unknown>) : null);

  const macdR = sub('macd');
  const momR = sub('momentum');
  const tsR = sub('trend_strength');
  const mtfR = sub('mtf');
  const tfRaw = a.timeframes;

  return {
    available: !!a.available,
    unavailableReason: (a.unavailable_reason as string | null) ?? null,
    regime: (a.regime as string | null) ?? null,
    trend: (a.trend as string | null) ?? null,
    rsi14: _numOrNull(a.rsi_14),
    ema20: _numOrNull(a.ema20),
    ema50: _numOrNull(a.ema50),
    bos: (a.bos as string | null) ?? null,
    volumeTrend: (a.volume_trend as string | null) ?? null,
    atr14: _numOrNull(a.atr_14),
    volatilityPct: _numOrNull(a.volatility_pct),
    macd: macdR ? {
      macd: _numOrNull(macdR.macd),
      signal: _numOrNull(macdR.signal),
      hist: _numOrNull(macdR.hist),
      state: String(macdR.state ?? 'insufficient_data'),
    } : null,
    momentum: momR ? {
      rocPct: _numOrNull(momR.roc_pct),
      state: String(momR.state ?? 'insufficient_data'),
    } : null,
    trendStrength: tsR ? {
      adx: _numOrNull(tsR.adx),
      label: String(tsR.label ?? 'insufficient_data'),
    } : null,
    mtf: mtfR ? {
      alignment: String(mtfR.alignment ?? 'unknown'),
      up: Number(mtfR.up) || 0,
      down: Number(mtfR.down) || 0,
      side: Number(mtfR.side) || 0,
      divergences: Array.isArray(mtfR.divergences)
        ? mtfR.divergences.map((d) => String(d)) : [],
    } : null,
    timeframes: Array.isArray(tfRaw)
      ? tfRaw
          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
          .map((r) => ({
            tf: String(r.tf ?? ''),
            trend: String(r.trend ?? '—'),
            rsi: _numOrNull(r.rsi),
          }))
      : null,
  };
}

function mapMtf(raw: unknown): MtfEngine | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const validBias: MtfBias[] = ['bullish', 'bearish', 'neutral', 'unavailable'];
  const tfs: MtfTfRow[] = Array.isArray(m.timeframes)
    ? m.timeframes
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => {
          const b = String(r.bias ?? 'unavailable');
          return {
            tf: String(r.tf ?? ''),
            bias: (validBias.includes(b as MtfBias) ? b : 'unavailable') as MtfBias,
            rsi: _numOrNull(r.rsi),
          };
        })
    : [];
  return {
    available: !!m.available,
    unavailableReason: (m.unavailable_reason as string | null) ?? null,
    timeframes: tfs,
    alignment: (m.alignment as string | null) ?? null,
    agreementPct: _numOrNull(m.agreement_pct),
    score: Number(m.score) || 0,
    conflict: !!m.conflict,
    summary: (m.summary as string | null) ?? null,
  };
}

function mapVolume(raw: unknown): SignalVolume | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  return {
    available: !!v.available,
    unavailableReason: (v.unavailable_reason as string | null) ?? null,
    volumeTrend: (v.volume_trend as string | null) ?? null,
    participation: String(v.participation ?? 'unknown'),
    participationNote: String(v.participation_note ?? ''),
    anomalies: Array.isArray(v.anomalies) ? v.anomalies.map((a) => String(a)) : [],
    breakoutQuality: (v.breakout_quality as string | null) ?? null,
    breakoutNote: String(v.breakout_note ?? ''),
    liquiditySweepRisk: String(v.liquidity_sweep_risk ?? 'unknown'),
    liquidityNote: String(v.liquidity_note ?? ''),
    volumeConfidence: Number(v.volume_confidence) || 0,
    summary: (v.summary as string | null) ?? null,
  };
}

function mapConfidence(raw: unknown): SignalConfidence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const g = String(c.grade ?? 'D');
  const factors: ConfidenceFactor[] = Array.isArray(c.factors)
    ? c.factors
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({
          name: String(f.name ?? ''),
          impact: Number(f.impact) || 0,
          state: String(f.state ?? ''),
          note: String(f.note ?? ''),
        }))
    : [];
  return {
    available: !!c.available,
    unavailableReason: (c.unavailable_reason as string | null) ?? null,
    confidence: Number(c.confidence) || 0,
    conviction: String(c.conviction ?? 'very_low'),
    grade: (g === 'A' || g === 'B' || g === 'C' ? g : 'D'),
    factors,
    explanation: String(c.explanation ?? ''),
  };
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
      // Structured extras for the detail drawer — only when present.
      takeProfit2: priceStr(s.take_profit_2),
      riskReward: num(s.risk_reward),
      invalidation: s.invalidation ? String(s.invalidation) : undefined,
      volatilityRegime: s.volatility_regime ? String(s.volatility_regime) : undefined,
      timeframe: s.timeframe ? String(s.timeframe) : undefined,
      dataQuality: s.data_quality ? String(s.data_quality) : undefined,
      rawDirection: s.raw_direction ? String(s.raw_direction) : undefined,
      breakdown: mapBreakdown(s.breakdown),
      scenarios: mapScenarios(s.scenarios),
      intel: mapIntel(s.intel),
      analytics: mapAnalytics(s.analytics),
      mtf: mapMtf(s.mtf),
      volume: mapVolume(s.volume),
      confidenceEngine: mapConfidence(s.confidence_engine),
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
  // Opt-in auto-refresh. 0 = disabled (default, unchanged behaviour).
  // Recommended 30_000–60_000ms. Ticks are skipped while the tab is
  // hidden so a backgrounded panel never spams the backend.
  pollMs: number = 0,
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

  // Abort the previous in-flight request and ignore stale responses, so a
  // slow earlier fetch can't overwrite newer data when the symbol set or
  // timeframe changes (Bugbot Medium 4ab072bd).
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  const fetchSignals = useCallback(async () => {
    abortRef.current?.abort();              // supersede any in-flight call
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++reqIdRef.current;
    const isStale = () => myId !== reqIdRef.current;

    if (!symbolsKey) {
      setSignals([]); setIsLoading(false); setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);

    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const url = `${API_BASE}/trading/signals?symbols=${
        encodeURIComponent(symbolsKey)
      }&timeframe=${encodeURIComponent(timeframe)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      const rawText = await response.text();
      if (isStale()) return;                // a newer request took over
      let rawData: Record<string, unknown> | null = null;
      try {
        rawData = rawText ? JSON.parse(rawText) : null;
      } catch {
        rawData = { _raw: rawText };
      }

      if (!response.ok) {
        // Graceful (no throw), but a real server failure must be
        // DISTINGUISHABLE from "healthy but no signals" — a 503/500
        // looking identical to an empty result hid outages and the
        // disabled-flag case from the user (Bugbot Medium e59fa085).
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
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Genuine 15s timeout → inform the user. Abort caused by a
        // superseding request / unmount → drop SILENTLY so it never
        // clobbers the newer request's state.
        if (timedOut && !isStale()) {
          setSignals([]);
          setProvider('Unknown');
          setError('İstek zaman aşımına uğradı. Tekrar dene.');
        }
        return;
      }
      if (isStale()) return;
      setSignals([]);
      setProvider('Unknown');
      let friendly = 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';
      if (err instanceof TypeError) {
        friendly = 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
      } else if (err instanceof SyntaxError) {
        friendly = 'Yanıt anlaşılamadı. Tekrar dene.';
      } else if (err instanceof Error && err.message) {
        friendly = err.message;
      }
      setError(friendly);
    } finally {
      window.clearTimeout(timeoutId);
      if (!isStale()) setIsLoading(false);
    }
  }, [symbolsKey, timeframe]);

  useEffect(() => {
    fetchSignals();
    return () => abortRef.current?.abort();   // cancel on unmount / change
  }, [fetchSignals]);

  // Auto-refresh. fetchSignals already aborts any in-flight request and
  // ignores stale responses, so an overlapping tick is safe; we still
  // skip ticks while the tab is hidden to avoid background spamming.
  useEffect(() => {
    if (!pollMs || pollMs <= 0 || !symbolsKey) return;
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchSignals();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, symbolsKey, fetchSignals]);

  const refresh = useCallback(() => {
    fetchSignals();
  }, [fetchSignals]);

  return { signals, provider, lastUpdated, isLoading, error, refresh };
}
