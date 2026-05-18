import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  TradingSignal, SignalFactor, SignalAnalytics, MtfBias,
} from '@/types';
import { useToast } from '@/hooks/useToast';
import { useTradingSignals } from '@/hooks/useTradingSignals';
import KorvixOrb from './KorvixOrb';
import {
  TrendingUp, TrendingDown, Activity, Zap,
  RefreshCw, Search, Clock, Star, ChevronRight,
  ArrowUpRight, ArrowDownRight,
  AlertTriangle, Plus, X, Sparkles,
  ShieldAlert, Info, MessageSquare, Gauge,
  Layers, BarChart3, Scale, Crosshair, Radar,
} from 'lucide-react';

// Default symbol sets the panel requests from /trading/signals (backend
// caps at 20). Watchlist + favorites persist in localStorage.
const SIGNAL_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'NVDA', 'AAPL', 'TSLA', 'MSFT'];
const DEFAULT_WATCH = ['AAPL', 'NVDA', 'TSLA', 'BTCUSDT', 'ETHUSDT', 'MSFT'];
const WATCH_LS_KEY = 'korvix.watchlist.v1';
const FAV_LS_KEY = 'korvix.favorites.v1';
// Auto-refresh cadence. The hook skips ticks while the tab is hidden and
// aborts overlapping requests, so this never spams the backend.
const POLL_MS = 45_000;

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  isFavorite: boolean;
  type: 'stock' | 'crypto';
}

/* ═══════════════════════════════════════════
   DERIVED PRESENTATION (computed from REAL signal
   fields only — never fabricated data)
   ═══════════════════════════════════════════ */

type Tone = { text: string; bg: string; border: string; badge: string; glow: string };

const DIR_TONE: Record<string, Tone> = {
  long:    { text: 'text-emerald-400', bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/15', badge: 'bg-emerald-500/[0.1] text-emerald-400', glow: 'shadow-[0_0_24px_-10px_rgba(52,211,153,0.45)]' },
  short:   { text: 'text-red-400',     bg: 'bg-red-500/[0.04]',     border: 'border-red-500/15',     badge: 'bg-red-500/[0.1] text-red-400',         glow: 'shadow-[0_0_24px_-10px_rgba(248,113,113,0.45)]' },
  wait:    { text: 'text-amber-400',   bg: 'bg-amber-500/[0.04]',   border: 'border-amber-500/15',   badge: 'bg-amber-500/[0.1] text-amber-400',     glow: 'shadow-[0_0_24px_-12px_rgba(251,191,36,0.4)]' },
  neutral: { text: 'text-slate-400',   bg: 'bg-slate-500/[0.04]',   border: 'border-slate-500/12',   badge: 'bg-slate-500/[0.1] text-slate-400',     glow: 'shadow-[0_0_20px_-12px_rgba(148,163,184,0.35)]' },
};
const tone = (d: string): Tone => DIR_TONE[d] || DIR_TONE.neutral;

const GRADE_BADGE: Record<string, string> = {
  A: 'bg-emerald-500/[0.1] text-emerald-400',
  B: 'bg-amber-500/[0.1] text-amber-400',
  C: 'bg-slate-500/[0.1] text-slate-400',
  D: 'bg-slate-500/[0.08] text-slate-500',
};

const MTF_PILL: Record<MtfBias, { arrow: string; text: string; bg: string; border: string }> = {
  bullish:     { arrow: '↑', text: 'text-emerald-400', bg: 'bg-emerald-500/[0.05]', border: 'border-emerald-500/15' },
  bearish:     { arrow: '↓', text: 'text-red-400',     bg: 'bg-red-500/[0.05]',     border: 'border-red-500/15' },
  neutral:     { arrow: '→', text: 'text-amber-400',   bg: 'bg-amber-500/[0.04]',   border: 'border-amber-500/12' },
  unavailable: { arrow: '✕', text: 'text-slate-600',   bg: 'bg-white/[0.015]',      border: 'border-white/[0.05]' },
};

type RiskLabel = 'Low' | 'Medium' | 'High';
function riskLevel(s: TradingSignal): { label: RiskLabel; cls: string } {
  let score = 0;
  if (s.volatility === 'high') score += 2;
  else if (s.volatility === 'medium') score += 1;
  if (s.confidence < 50) score += 2;
  else if (s.confidence < 70) score += 1;
  if (s.setupGrade === 'D') score += 2;
  else if (s.setupGrade === 'C') score += 1;
  if (typeof s.riskReward === 'number' && s.riskReward < 1.5) score += 1;
  if (score >= 4) return { label: 'High', cls: 'text-red-400 bg-red-500/[0.08]' };
  if (score >= 2) return { label: 'Medium', cls: 'text-amber-400 bg-amber-500/[0.08]' };
  return { label: 'Low', cls: 'text-emerald-400 bg-emerald-500/[0.08]' };
}

function scenarios(s: TradingSignal): { bull: string; bear: string } {
  const e = s.entryPrice, t = s.targetPrice, sl = s.stopLoss;
  if ((s.direction === 'long' || s.direction === 'short') && e && t && sl) {
    if (s.direction === 'long') {
      return {
        bull: `Holding above the $${e} entry keeps the long valid — measured move targets $${t}.`,
        bear: `A decisive break below the $${sl} stop invalidates the long; expect downside continuation.`,
      };
    }
    return {
      bull: `Reclaiming and holding above the $${sl} stop invalidates the short; squeeze risk increases.`,
      bear: `Rejection from the $${e} entry keeps the short valid — measured move targets $${t}.`,
    };
  }
  return {
    bull: 'Defined entry/target/stop not provided for this setup — treat as watch-only.',
    bear: 'Defined entry/target/stop not provided for this setup — treat as watch-only.',
  };
}

function fmtTime(d?: Date): string {
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildExplainPrompt(s: TradingSignal): string {
  const L = (k: string, v: unknown) =>
    v === undefined || v === null || v === '' ? null : `${k}: ${v}`;
  const i = s.intel;
  const a = s.analytics;
  const m = s.mtf;
  const topBull = s.breakdown?.bullishFactors?.[0];
  const topBear = s.breakdown?.bearishFactors?.[0];

  const data = [
    L('Symbol', s.symbol),
    L('Asset', s.assetType),
    L('Timeframe', s.timeframe),
    L('Engine bias', i?.available ? `${i.direction.toUpperCase()} @ ${i.confidence}% (grade ${i.grade}, score ${i.score})` : `${s.direction.toUpperCase()} @ ${s.confidence}% (legacy heuristic)`),
    L('Last price', typeof s.price === 'number' ? s.price : undefined),
    L('Entry / Stop / Target', `${s.entryPrice ?? '—'} / ${s.stopLoss ?? '—'} / ${s.targetPrice ?? '—'}`),
    L('Risk:Reward', s.riskReward),
    L('Strongest bullish factor', topBull ? `${topBull.factor} — ${topBull.detail}` : (s.breakdown?.strongestReason ?? undefined)),
    L('Strongest bearish factor', topBear ? `${topBear.factor} — ${topBear.detail}` : (s.breakdown?.weakestPoint ?? undefined)),
    L('Trend strength', a?.trendStrength ? `ADX ${a.trendStrength.adx ?? '—'} (${a.trendStrength.label})` : undefined),
    L('MACD', a?.macd && a.macd.state !== 'insufficient_data' ? a.macd.state : undefined),
    L('Momentum', a?.momentum && a.momentum.state !== 'insufficient_data' ? `${a.momentum.state} (${a.momentum.rocPct ?? '—'}%)` : undefined),
    L('Volatility regime', a?.regime || s.volatilityRegime || s.volatility),
    L('Multi-timeframe', m?.available ? `${m.alignment} ${m.agreementPct ?? 0}% agreement${m.conflict ? ' — CONFLICT' : ''}; ${m.summary ?? ''}` : undefined),
    L('Invalidation', s.breakdown?.invalidation || i?.invalidation || s.invalidation),
    L('Confirmation needed', s.breakdown?.confirmationNeeded),
  ].filter(Boolean).join('\n');

  return (
    `You are a senior trading-desk strategist. Brief me on this signal in a concise, professional desk style — short labelled sections, no filler, no generic disclaimers padding. Analysis only: this is NOT financial advice and you must NOT place or execute any trade.\n\n` +
    `SIGNAL DATA (only what was actually measured — do not invent numbers; if a field is missing say "not in feed"):\n${data}\n\n` +
    `Cover, as tight bullet sections:\n` +
    `1) Thesis — why the bias is ${(i?.available ? i.direction : s.direction).toUpperCase()} in one or two lines.\n` +
    `2) Strongest bullish factor and strongest bearish factor.\n` +
    `3) Invalidation — the specific condition/level that breaks this setup.\n` +
    `4) Volatility & risk read (use the trend-strength/regime/R:R above).\n` +
    `5) Confidence reasoning — what is driving the ${i?.available ? i.confidence + '%' : 'stated'} conviction, and what would raise or lower it.\n` +
    `6) What confirmation you'd want before acting.\n` +
    `Keep it grounded strictly in the data above.`
  );
}

/* ═══════════════════════════════════════════
   SKELETONS
   ═══════════════════════════════════════════ */

function SkeletonPulse({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-white/[0.02] ${className}`}>
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
        animate={{ x: ['-100%', '100%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

function SignalCardSkeleton() {
  return (
    <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01] space-y-3">
      <div className="flex items-center gap-3">
        <SkeletonPulse className="h-4 w-16" />
        <SkeletonPulse className="h-4 w-10" />
        <SkeletonPulse className="h-4 w-14 ml-auto" />
      </div>
      <SkeletonPulse className="h-3 w-3/4" />
      <div className="grid grid-cols-3 gap-2">
        <SkeletonPulse className="h-10" />
        <SkeletonPulse className="h-10" />
        <SkeletonPulse className="h-10" />
      </div>
    </div>
  );
}

function WatchlistSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01]">
          <SkeletonPulse className="h-4 w-4 rounded-full" />
          <SkeletonPulse className="h-4 w-12" />
          <div className="flex-1" />
          <SkeletonPulse className="h-4 w-16" />
          <SkeletonPulse className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   EMPTY / UNAVAILABLE STATES
   ═══════════════════════════════════════════ */

function LiveDataUnavailable({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <div className="relative p-8 rounded-2xl border border-white/[0.04] bg-white/[0.015] backdrop-blur-sm max-w-sm w-full">
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-24 h-24 bg-cyan-500/[0.03] rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col items-center">
          <KorvixOrb size="md" variant="idle" className="mb-5" />
          <p className="text-[14px] font-medium text-slate-300 mb-2">Live market data unavailable</p>
          <p className="text-[12px] text-slate-600 mb-6 leading-relaxed">
            {message || 'Trading signals require a live market data connection. It will populate as soon as data is available.'}
          </p>
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px] text-slate-400 hover:text-white hover:bg-white/[0.05] hover:border-white/[0.1] transition-all shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry Connection
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Honest "coming soon" — explains the missing data source, no fake values.
function ComingSoon({ title, what, source }: { title: string; what: string; source: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-14 px-6 text-center"
    >
      <div className="relative p-8 rounded-2xl border border-indigo-500/10 bg-indigo-500/[0.02] backdrop-blur-sm max-w-md w-full">
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-24 h-24 bg-indigo-500/[0.04] rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col items-center">
          <div className="h-12 w-12 rounded-2xl bg-indigo-500/[0.06] border border-indigo-500/15 flex items-center justify-center mb-4">
            <Sparkles className="h-5 w-5 text-indigo-400/80" />
          </div>
          <p className="text-[14px] font-medium text-slate-200 mb-1.5">{title}</p>
          <p className="text-[12px] text-slate-500 leading-relaxed mb-4">{what}</p>
          <div className="w-full flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] text-left">
            <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <span className="text-slate-400">Needs:</span> {source}. We won&apos;t show simulated numbers here.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Non-blocking "couldn't refresh — showing last update" banner.
function StaleBanner({ at, onRetry }: { at: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-xl bg-amber-500/[0.05] border border-amber-500/10">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
      <span className="text-[11px] text-amber-400/80 flex-1">
        Couldn&apos;t refresh — showing last known data ({at}).
      </span>
      <button onClick={onRetry} className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2">
        Retry
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SIGNAL CARD
   ═══════════════════════════════════════════ */

function SignalCard({ signal, onOpen }: { signal: TradingSignal; onOpen: () => void }) {
  const c = tone(signal.direction);
  const risk = riskLevel(signal);
  const change = signal.changePercent;
  const changePos = typeof change === 'number' && change >= 0;

  return (
    <motion.button
      layout
      onClick={onOpen}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className={`w-full text-left rounded-2xl border ${c.border} ${c.bg} ${c.glow} overflow-hidden hover:border-opacity-30 transition-all duration-200`}
    >
      <div className="p-4">
        {/* Row 1: identity */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold text-white">{signal.symbol}</span>
          <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/[0.05] text-slate-400">
            {signal.assetType === 'crypto' ? 'Crypto' : signal.assetType === 'stock' ? 'Stock' : signal.assetType || '—'}
          </span>
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${c.badge}`}>
            {signal.direction.toUpperCase()}
          </span>
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${GRADE_BADGE[signal.setupGrade]}`}>
            Grade {signal.setupGrade}
          </span>
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${risk.cls}`}>
            {risk.label} risk
          </span>
          <ChevronRight className="w-4 h-4 text-slate-600 ml-auto shrink-0" />
        </div>

        {/* Row 2: live price + confidence/vol */}
        <div className="flex items-center gap-3 mt-2">
          {typeof signal.price === 'number' && (
            <span className="text-[13px] font-medium text-white">
              ${signal.price.toLocaleString('en-US', { maximumFractionDigits: signal.price < 10 ? 6 : 2 })}
            </span>
          )}
          {typeof change === 'number' && (
            <span className={`flex items-center gap-0.5 text-[11px] font-medium ${changePos ? 'text-emerald-400' : 'text-red-400'}`}>
              {changePos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {changePos ? '+' : ''}{change.toFixed(2)}%
            </span>
          )}
          <span className="text-[11px] text-slate-500">{signal.confidence}% conf</span>
          <span className="text-[11px] text-slate-600 capitalize">{signal.volatility} vol</span>
        </div>

        {/* Row 3: entry / target / stop */}
        {(signal.entryPrice || signal.targetPrice || signal.stopLoss) && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="p-2 rounded-lg bg-white/[0.02]">
              <p className="text-[9px] text-slate-600">Entry</p>
              <p className="text-[12px] font-medium text-white">{signal.entryPrice ? `$${signal.entryPrice}` : '—'}</p>
            </div>
            <div className="p-2 rounded-lg bg-emerald-500/[0.04]">
              <p className="text-[9px] text-emerald-400/60">Target</p>
              <p className="text-[12px] font-medium text-emerald-400">{signal.targetPrice ? `$${signal.targetPrice}` : '—'}</p>
            </div>
            <div className="p-2 rounded-lg bg-red-500/[0.04]">
              <p className="text-[9px] text-red-400/60">Stop</p>
              <p className="text-[12px] font-medium text-red-400">{signal.stopLoss ? `$${signal.stopLoss}` : '—'}</p>
            </div>
          </div>
        )}

        {/* Row 4: reason + updated */}
        <p className="text-[12px] text-slate-400 leading-relaxed mt-3 line-clamp-2">{signal.reasoning}</p>
        <div className="flex items-center gap-1 mt-2 text-[10px] text-slate-600">
          <Clock className="w-3 h-3" /> Updated {fmtTime(signal.timestamp)}
        </div>
      </div>
    </motion.button>
  );
}

/* ═══════════════════════════════════════════
   SIGNAL DETAIL DRAWER
   ═══════════════════════════════════════════ */

function DrawerSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-slate-500">{icon}</span>
        <h4 className="text-[12px] font-medium text-slate-300">{title}</h4>
      </div>
      {children}
    </div>
  );
}

const REGIME_NOTE: Record<string, string> = {
  trending_up: 'Trending up — momentum/continuation favoured.',
  trending_down: 'Trending down — momentum/continuation favoured.',
  squeeze_pre_breakout: 'Volatility squeeze — breakout pending, direction unconfirmed.',
  high_volatility: 'High volatility — size down, wider stops.',
  low_volatility: 'Low volatility — moves may be muted.',
  choppy: 'Choppy / range — trend strategies unreliable, fade extremes.',
  overbought: 'Overbought — pullback risk.',
  oversold: 'Oversold — bounce risk.',
  neutral: 'Neutral regime — no strong edge.',
  insufficient_data: 'Insufficient data to classify the regime.',
};

function fmtN(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(n) < 10 ? Math.max(dp, 4) : dp,
  });
}

function Unavailable({ reason }: { reason?: string | null }) {
  return (
    <p className="text-[11px] text-slate-500 leading-relaxed">
      {reason || 'Not available from the current data feed for this symbol.'}
    </p>
  );
}

function Stat({ label, value, tone: t = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-white/[0.02]">
      <p className="text-[9px] text-slate-600">{label}</p>
      <p className={`text-[12px] font-medium ${t}`}>{value}</p>
    </div>
  );
}

function FactorList({ title, items, textCls, pipCls }: {
  title: string; items: SignalFactor[]; textCls: string; pipCls: string;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`text-[10px] font-semibold mb-1.5 ${textCls}`}>{title} ({items.length})</p>
      <ul className="space-y-1.5">
        {items.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
            <span className="mt-1 shrink-0 inline-flex gap-px">
              {Array.from({ length: Math.max(1, Math.min(3, f.weight || 1)) }).map((_, j) => (
                <span key={j} className={`w-1 h-3 rounded-sm ${pipCls}`} />
              ))}
            </span>
            <span><span className="text-slate-300">{f.factor}:</span> {f.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignalDetailDrawer({
  signal, onClose, onExplain,
}: {
  signal: TradingSignal;
  onClose: () => void;
  onExplain?: (prompt: string) => void;
}) {
  const intel = signal.intel;
  const bd = signal.breakdown;
  const an: SignalAnalytics | undefined = signal.analytics;
  const scn = signal.scenarios;
  const mtfE = signal.mtf;
  const vol = signal.volume;

  // Decision = the multi-factor engine when available, else the legacy
  // heuristic (clearly labelled). Never fabricated.
  const decisionDir = intel?.available ? intel.direction : signal.direction;
  const c = tone(decisionDir);
  const conf = intel?.available ? intel.confidence : signal.confidence;
  const grade = intel?.available ? intel.grade : signal.setupGrade;
  const risk = riskLevel(signal);
  const legacySc = scenarios(signal);

  const bullW = intel?.bullWeight ?? 0;
  const bearW = intel?.bearWeight ?? 0;
  const total = Math.max(1, bullW + bearW);
  const bullPct = Math.round((bullW / total) * 100);

  const invalidation = bd?.invalidation || intel?.invalidation || signal.invalidation || null;

  return (
    <motion.aside
      key="drawer"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] max-w-[100vw] bg-[#0b0b0c]/95 backdrop-blur-xl border-l border-white/[0.06] shadow-[0_0_60px_-15px_rgba(0,0,0,0.8)] flex flex-col"
    >
      {/* Header */}
      <div className={`shrink-0 p-4 border-b border-white/[0.05] ${c.bg}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[16px] font-semibold text-white">{signal.symbol}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.badge}`}>
                {decisionDir.toUpperCase()}
              </span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${GRADE_BADGE[grade]}`}>
                Grade {grade}
              </span>
              <span className="text-[10px] text-slate-500">{conf}% confidence</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {signal.name}{signal.timeframe ? ` · ${signal.timeframe}` : ''} · updated {fmtTime(signal.timestamp)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 hover:text-white hover:bg-white/[0.05] transition-all"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* AI decision */}
        <DrawerSection icon={<Crosshair className="w-3.5 h-3.5" />} title="AI decision">
          {intel?.available ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`text-[20px] font-semibold ${c.text}`}>{intel.direction.toUpperCase()}</span>
                <span className="text-[12px] text-slate-400">{intel.confidence}% · grade {intel.grade} · score {intel.score >= 0 ? '+' : ''}{intel.score}</span>
              </div>
              <div className="mt-2.5">
                <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.05]">
                  <div className="bg-emerald-500/60" style={{ width: `${bullPct}%` }} />
                  <div className="bg-red-500/60" style={{ width: `${100 - bullPct}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px]">
                  <span className="text-emerald-400">Bull weight {bullW}</span>
                  <span className="text-red-400">Bear weight {bearW}</span>
                </div>
              </div>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-2.5">{intel.rationale}</p>
            </>
          ) : (
            <>
              <Unavailable reason={intel?.unavailableReason} />
              <p className="text-[12px] text-slate-400 leading-relaxed mt-2">
                Legacy heuristic bias: <span className={c.text}>{signal.direction.toUpperCase()}</span>{' '}
                at {signal.confidence}% (grade {signal.setupGrade}).
              </p>
            </>
          )}
          {onExplain && (
            <button
              onClick={() => onExplain(buildExplainPrompt(signal))}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500/[0.08] border border-indigo-500/20 text-[12px] font-medium text-indigo-300 hover:bg-indigo-500/[0.14] hover:border-indigo-500/30 transition-all"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Explain this signal with KorvixAI
            </button>
          )}
        </DrawerSection>

        {/* Price snapshot */}
        <DrawerSection icon={<Gauge className="w-3.5 h-3.5" />} title="Price snapshot">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Last price" value={typeof signal.price === 'number' ? `$${fmtN(signal.price)}` : '—'} />
            <Stat
              label="Change"
              value={typeof signal.changePercent === 'number' ? `${signal.changePercent >= 0 ? '+' : ''}${signal.changePercent.toFixed(2)}%` : '—'}
              tone={typeof signal.changePercent === 'number' && signal.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <Stat label="Entry" value={signal.entryPrice ? `$${signal.entryPrice}` : '—'} tone="text-emerald-400" />
            <Stat label="Stop" value={signal.stopLoss ? `$${signal.stopLoss}` : '—'} tone="text-red-400" />
            <Stat label="Target 1" value={signal.targetPrice ? `$${signal.targetPrice}` : '—'} />
            <Stat label="Target 2" value={signal.takeProfit2 ? `$${signal.takeProfit2}` : '—'} />
          </div>
        </DrawerSection>

        {/* Weighted factor breakdown */}
        <DrawerSection icon={<BarChart3 className="w-3.5 h-3.5" />} title="Weighted factor breakdown">
          {bd?.available ? (
            <div className="space-y-3">
              <FactorList title="Bullish" items={bd.bullishFactors} textCls="text-emerald-400" pipCls="bg-emerald-400/50" />
              <FactorList title="Bearish" items={bd.bearishFactors} textCls="text-red-400" pipCls="bg-red-400/50" />
              <FactorList title="Neutral / caution" items={bd.neutralFactors} textCls="text-slate-400" pipCls="bg-slate-400/50" />
              {bd.bullishFactors.length === 0 && bd.bearishFactors.length === 0 && bd.neutralFactors.length === 0 && (
                <Unavailable reason="No directional factors detected." />
              )}
            </div>
          ) : (
            <Unavailable reason={bd?.unavailableReason} />
          )}
        </DrawerSection>

        {/* Strongest / weakest */}
        {bd?.available && (bd.strongestReason || bd.weakestPoint) && (
          <div className="grid grid-cols-1 gap-2">
            {bd.strongestReason && (
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <h4 className="text-[11px] font-semibold text-emerald-400">Strongest reason</h4>
                </div>
                <p className="text-[12px] text-slate-400 leading-relaxed">{bd.strongestReason}</p>
              </div>
            )}
            {bd.weakestPoint && (
              <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                  <h4 className="text-[11px] font-semibold text-amber-400">Weakest point</h4>
                </div>
                <p className="text-[12px] text-slate-400 leading-relaxed">{bd.weakestPoint}</p>
              </div>
            )}
          </div>
        )}

        {/* Multi-timeframe alignment */}
        <DrawerSection icon={<Layers className="w-3.5 h-3.5" />} title="Multi-timeframe alignment">
          {mtfE && mtfE.timeframes.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {mtfE.timeframes.map((r) => {
                  const m = MTF_PILL[r.bias];
                  return (
                    <div key={r.tf} className={`rounded-lg border ${m.border} ${m.bg} px-2 py-2 text-center`}>
                      <p className="text-[10px] text-slate-500 uppercase">{r.tf}</p>
                      <p className={`text-[14px] font-semibold leading-tight ${m.text}`}>{m.arrow}</p>
                      <p className={`text-[9px] ${m.text}`}>{r.bias === 'unavailable' ? 'n/a' : r.bias}</p>
                    </div>
                  );
                })}
              </div>
              {mtfE.available ? (
                <>
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-400 capitalize">{mtfE.alignment} alignment</span>
                      <span className="text-slate-300">{mtfE.agreementPct ?? 0}% agreement</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${mtfE.alignment === 'bullish' ? 'bg-emerald-500/60' : mtfE.alignment === 'bearish' ? 'bg-red-500/60' : 'bg-amber-500/50'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${mtfE.agreementPct ?? 0}%` }}
                        transition={{ duration: 0.6 }}
                      />
                    </div>
                  </div>
                  <p className={`text-[11px] leading-relaxed ${mtfE.conflict ? 'text-amber-400/90' : 'text-slate-400'}`}>
                    {mtfE.conflict && <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" />}
                    {mtfE.summary}
                  </p>
                </>
              ) : (
                <Unavailable reason={mtfE.unavailableReason || 'Multi-timeframe data unavailable.'} />
              )}
            </div>
          ) : (
            <Unavailable reason={mtfE?.unavailableReason || 'Multi-timeframe data unavailable.'} />
          )}
        </DrawerSection>

        {/* Momentum & volatility */}
        <DrawerSection icon={<Activity className="w-3.5 h-3.5" />} title="Momentum & volatility">
          {an?.available ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="RSI (14)" value={an.rsi14 === null || an.rsi14 === undefined ? '—' : an.rsi14.toFixed(1)} />
              <Stat
                label="MACD"
                value={an.macd && an.macd.state !== 'insufficient_data' ? `${an.macd.state.replace(/_/g, ' ')} (${fmtN(an.macd.hist)})` : '—'}
              />
              <Stat
                label="Momentum"
                value={an.momentum && an.momentum.state !== 'insufficient_data' ? `${an.momentum.state.replace(/_/g, ' ')} (${an.momentum.rocPct === null ? '—' : an.momentum.rocPct + '%'})` : '—'}
              />
              <Stat label="Volume trend" value={an.volumeTrend ? an.volumeTrend : '—'} />
              <Stat label="ATR (14)" value={an.atr14 === null || an.atr14 === undefined ? '—' : fmtN(an.atr14)} />
              <Stat label="Volatility" value={an.volatilityPct === null || an.volatilityPct === undefined ? '—' : `${an.volatilityPct}%`} />
            </div>
          ) : (
            <Unavailable reason={an?.unavailableReason} />
          )}
        </DrawerSection>

        {/* Trend strength & regime */}
        <DrawerSection icon={<Gauge className="w-3.5 h-3.5" />} title="Trend strength & market regime">
          {an?.available ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-[12px]">
                <span className="text-slate-300">
                  ADX {an.trendStrength && an.trendStrength.adx !== null ? an.trendStrength.adx.toFixed(0) : '—'}
                </span>
                <span className="text-slate-500 capitalize">
                  {an.trendStrength ? an.trendStrength.label.replace(/_/g, ' ') : '—'}
                </span>
                {an.trend && <span className="text-slate-500 capitalize">· {an.trend.replace(/_/g, ' ')}</span>}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {an.regime ? (REGIME_NOTE[an.regime] || `Regime: ${an.regime.replace(/_/g, ' ')}.`) : 'Regime not classified.'}
                {an.trendStrength && (an.trendStrength.label === 'no_trend' || an.trendStrength.label === 'weak')
                  ? ' Weak/no trend — prefer range tactics or stand aside.'
                  : an.trendStrength && (an.trendStrength.label === 'strong' || an.trendStrength.label === 'very_strong')
                    ? ' Strong directional trend — pullbacks favoured over reversals.'
                    : ''}
              </p>
            </div>
          ) : (
            <Unavailable reason={an?.unavailableReason} />
          )}
        </DrawerSection>

        {/* Volume & liquidity */}
        <DrawerSection icon={<BarChart3 className="w-3.5 h-3.5" />} title="Volume & liquidity">
          {vol?.available ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Volume trend" value={vol.volumeTrend ?? '—'} />
                <Stat
                  label="Participation"
                  value={vol.participation}
                  tone={vol.participation === 'expanding' ? 'text-emerald-400' : vol.participation === 'contracting' ? 'text-red-400' : vol.participation === 'flat' ? 'text-amber-400' : 'text-slate-400'}
                />
                <Stat
                  label="Breakout quality"
                  value={vol.breakoutQuality ?? '—'}
                  tone={vol.breakoutQuality === 'confirmed' ? 'text-emerald-400' : vol.breakoutQuality === 'weak' ? 'text-red-400' : vol.breakoutQuality === 'pending' ? 'text-amber-400' : 'text-slate-400'}
                />
                <Stat
                  label="Liquidity sweep risk"
                  value={vol.liquiditySweepRisk}
                  tone={vol.liquiditySweepRisk === 'elevated' ? 'text-red-400' : vol.liquiditySweepRisk === 'moderate' ? 'text-amber-400' : vol.liquiditySweepRisk === 'low' ? 'text-emerald-400' : 'text-slate-400'}
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-slate-500">Volume confidence</span>
                  <span className="text-slate-300">{vol.volumeConfidence}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${vol.volumeConfidence >= 65 ? 'bg-emerald-500/60' : vol.volumeConfidence >= 45 ? 'bg-amber-500/50' : 'bg-red-500/60'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${vol.volumeConfidence}%` }}
                    transition={{ duration: 0.6 }}
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-slate-600 mb-1">Anomaly detection</p>
                {vol.anomalies.length > 0 ? (
                  <ul className="space-y-1">
                    {vol.anomalies.map((a, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-400/90 leading-relaxed">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{a}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-slate-500">No volume anomalies detected.</p>
                )}
              </div>
              {vol.summary && <p className="text-[11px] text-slate-400 leading-relaxed">{vol.summary}</p>}
              {vol.liquidityNote && <p className="text-[11px] text-slate-500 leading-relaxed">{vol.liquidityNote}</p>}
            </div>
          ) : (
            <Unavailable reason={vol?.unavailableReason} />
          )}
        </DrawerSection>

        {/* Risk / reward & invalidation */}
        <DrawerSection icon={<Scale className="w-3.5 h-3.5" />} title="Risk / reward & invalidation">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <Stat label="R:R" value={typeof signal.riskReward === 'number' ? `${signal.riskReward}` : '—'} />
            <Stat label="Risk" value={risk.label} tone={risk.cls.split(' ')[0]} />
            <Stat label="Vol regime" value={signal.volatilityRegime ? signal.volatilityRegime.replace(/_/g, ' ') : signal.volatility} />
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            <span className="text-slate-300">Invalidation:</span> {invalidation || 'No explicit invalidation level for this setup.'}
          </p>
          {bd?.confirmationNeeded && (
            <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5">
              <span className="text-slate-300">Confirmation needed:</span> {bd.confirmationNeeded}
            </p>
          )}
        </DrawerSection>

        {/* Scenarios */}
        <DrawerSection icon={<Sparkles className="w-3.5 h-3.5" />} title="Scenarios">
          {scn?.available ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/[0.03] p-3">
                <p className="text-[11px] font-semibold text-emerald-400 mb-1">Bullish</p>
                <p className="text-[12px] text-slate-400 leading-relaxed">{scn.bullish}</p>
              </div>
              <div className="rounded-lg border border-red-500/10 bg-red-500/[0.03] p-3">
                <p className="text-[11px] font-semibold text-red-400 mb-1">Bearish</p>
                <p className="text-[12px] text-slate-400 leading-relaxed">{scn.bearish}</p>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                <p className="text-[11px] font-semibold text-slate-400 mb-1">Sideways</p>
                <p className="text-[12px] text-slate-400 leading-relaxed">{scn.sideways}</p>
              </div>
              {Object.keys(scn.keyLevels).length > 0 && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Key levels: {Object.entries(scn.keyLevels).map(([k, v]) => `${k.replace(/_/g, ' ')} ${fmtN(v)}`).join(' · ')}
                </p>
              )}
              <p className="text-[11px] text-amber-400/80 leading-relaxed">{scn.doNotTradeIf}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">{scn?.unavailableReason || 'Backend scenarios unavailable — derived from available levels:'}</p>
              <p className="text-[12px] text-slate-400 leading-relaxed"><span className="text-emerald-400">Bull:</span> {legacySc.bull}</p>
              <p className="text-[12px] text-slate-400 leading-relaxed"><span className="text-red-400">Bear:</span> {legacySc.bear}</p>
            </div>
          )}
        </DrawerSection>

        {/* Risk note + not financial advice */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Live data changes quickly — this reflects the last update only.
            Analysis only, <span className="text-slate-500">not financial advice</span>;
            KorvixAI does not execute trades or place orders. Always do your own research.
          </p>
        </div>
      </div>
    </motion.aside>
  );
}

/* ═══════════════════════════════════════════
   WATCHLIST ROW
   ═══════════════════════════════════════════ */

function WatchlistRow({ item, onToggleFav, onRemove }: {
  item: WatchlistItem; onToggleFav: () => void; onRemove: () => void;
}) {
  const isPositive = item.change >= 0;
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.05] hover:bg-white/[0.02] transition-all duration-200 group">
      <button onClick={onToggleFav} className="shrink-0" aria-label="Toggle favorite">
        <Star className={`w-3.5 h-3.5 ${item.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-700 hover:text-slate-500'} transition-colors`} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-white">{item.symbol}</span>
          <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-white/[0.04] text-slate-600">{item.type}</span>
          <span className="text-[10px] text-slate-600 truncate">{item.name}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[12px] font-medium text-white">${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: item.price < 10 ? 6 : 2 })}</p>
        <div className={`flex items-center justify-end gap-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span className="text-[10px] font-medium">{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</span>
        </div>
      </div>
      <button
        onClick={onRemove}
        title="Remove"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-700 hover:text-red-400"
        aria-label="Remove from watchlist"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MARKET REGIME (derived from REAL live signals
   — an aggregate, never fabricated)
   ═══════════════════════════════════════════ */

interface MarketRegime {
  available: boolean;
  label: string;
  note: string;
  longs: number;
  shorts: number;
  waits: number;
  avgConf: number;
  n: number;
}

const REGIME_GLOW: Record<string, string> = {
  'Risk ON': 'border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-400',
  'Trend Expansion': 'border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-400',
  'Risk OFF': 'border-red-500/15 bg-red-500/[0.04] text-red-400',
  'High Volatility': 'border-amber-500/15 bg-amber-500/[0.04] text-amber-400',
  'Compression': 'border-indigo-500/15 bg-indigo-500/[0.04] text-indigo-300',
  'Chop / Range': 'border-slate-500/15 bg-slate-500/[0.05] text-slate-400',
  'Mean Reversion': 'border-slate-500/15 bg-slate-500/[0.05] text-slate-400',
  'Neutral': 'border-white/[0.06] bg-white/[0.02] text-slate-400',
};

function deriveMarketRegime(signals: TradingSignal[]): MarketRegime {
  const live = signals.filter((s) => s.isLive);
  const n = live.length;
  if (n < 3) {
    return {
      available: false, label: '', n,
      note: 'Market regime unavailable — insufficient live data (need ≥3 live symbols).',
      longs: 0, shorts: 0, waits: 0, avgConf: 0,
    };
  }
  let longs = 0, shorts = 0, waits = 0, confSum = 0, confCount = 0;
  let hiVol = 0, squeeze = 0, strong = 0, weak = 0;
  for (const s of live) {
    const dir = s.intel?.available ? s.intel.direction : s.direction;
    if (dir === 'long') longs++;
    else if (dir === 'short') shorts++;
    else waits++;
    const c = s.intel?.available ? s.intel.confidence : s.confidence;
    if (typeof c === 'number') { confSum += c; confCount++; }
    const reg = (s.analytics?.regime || s.volatilityRegime || '').toLowerCase();
    if (reg.includes('high_vol')) hiVol++;
    if (reg.includes('squeeze') || reg.includes('low_vol')) squeeze++;
    const lbl = s.analytics?.trendStrength?.label || '';
    if (lbl === 'strong' || lbl === 'very_strong') strong++;
    else if (lbl === 'weak' || lbl === 'no_trend') weak++;
  }
  const avgConf = confCount ? Math.round(confSum / confCount) : 0;
  const breadth = longs - shorts;
  const half = Math.ceil(n / 2);
  let label = 'Neutral';
  let note = 'No dominant trend — mean-reversion / range environment.';
  if (hiVol >= half) {
    label = breadth < 0 ? 'Risk OFF' : 'High Volatility';
    note = breadth < 0
      ? 'Elevated volatility with bearish breadth — risk-off conditions.'
      : 'High-volatility regime — wider stops, expansion plays favoured.';
  } else if (strong >= half && Math.abs(breadth) >= Math.ceil(n / 3) && avgConf >= 60) {
    label = 'Trend Expansion';
    note = `${breadth > 0 ? 'Bullish' : 'Bearish'} trend expansion — ${strong}/${n} symbols in strong trends, ${avgConf}% avg confidence.`;
  } else if (squeeze >= half) {
    label = 'Compression';
    note = 'Volatility compression across symbols — breakout pending, stand by.';
  } else if (weak >= half && Math.abs(breadth) <= 1) {
    label = 'Chop / Range';
    note = 'Weak trends and split breadth — choppy; range tactics only.';
  } else if (breadth > 0 && avgConf >= 55) {
    label = 'Risk ON';
    note = `Bullish breadth (${longs}↑ / ${shorts}↓) with ${avgConf}% avg confidence — momentum favoured.`;
  } else if (breadth < 0) {
    label = 'Risk OFF';
    note = `Bearish breadth (${shorts}↓ / ${longs}↑) — defensive posture.`;
  } else {
    label = 'Mean Reversion';
    note = 'No dominant trend — mean-reversion / range environment.';
  }
  return { available: true, label, note, longs, shorts, waits, avgConf, n };
}

function MarketRegimeBanner({ r }: { r: MarketRegime }) {
  if (!r.available) {
    return (
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] px-4 py-2.5 flex items-center gap-2">
        <Radar className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        <p className="text-[11px] text-slate-500 leading-relaxed">{r.note}</p>
      </div>
    );
  }
  const g = REGIME_GLOW[r.label] || REGIME_GLOW.Neutral;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl border ${g} px-4 py-2.5`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Radar className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[9px] uppercase tracking-wide text-slate-500">Market regime</span>
        <span className="text-[13px] font-semibold">{r.label}</span>
        <span className="ml-auto text-[10px] text-slate-500">
          {r.longs}↑ {r.shorts}↓ {r.waits}→ · {r.avgConf}% avg · {r.n} live
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{r.note}</p>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   MAIN PANEL
   ═══════════════════════════════════════════ */

export default function TradingPanel({ onExplainSignal }: { onExplainSignal?: (prompt: string) => void }) {
  const [activeTab, setActiveTab] = useState<'signals' | 'watchlist' | 'sentiment' | 'trending'>('signals');
  const [watchlistFilter, setWatchlistFilter] = useState<'all' | 'stocks' | 'crypto'>('all');
  const [search, setSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selected, setSelected] = useState<TradingSignal | null>(null);
  const { addToast } = useToast();

  const [watchSymbols, setWatchSymbols] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WATCH_LS_KEY);
      if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; }
    } catch { /* ignore */ }
    return DEFAULT_WATCH;
  });
  useEffect(() => {
    try { localStorage.setItem(WATCH_LS_KEY, JSON.stringify(watchSymbols)); } catch { /* ignore */ }
  }, [watchSymbols]);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAV_LS_KEY);
      if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; }
    } catch { /* ignore */ }
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem(FAV_LS_KEY, JSON.stringify(favorites)); } catch { /* ignore */ }
  }, [favorites]);

  const signalsApi = useTradingSignals(SIGNAL_SYMBOLS, '4h', POLL_MS);
  const watchApi = useTradingSignals(watchSymbols, '1d', POLL_MS);

  const freshSignals = useMemo(
    () => signalsApi.signals.filter((s) => s.isLive),
    [signalsApi.signals],
  );

  // Keep the last good signals visible if a later refresh fails (so a
  // transient backend hiccup doesn't blank the panel). Caching into a ref
  // during render is deterministic and avoids an effect feedback loop.
  const signalsCache = useRef<TradingSignal[]>([]);
  if (freshSignals.length) signalsCache.current = freshSignals;
  const signalsToShow = freshSignals.length ? freshSignals : signalsCache.current;
  const showStaleSignals = !!signalsApi.error && freshSignals.length === 0 && signalsCache.current.length > 0;
  const marketRegime = useMemo(() => deriveMarketRegime(signalsToShow), [signalsToShow]);

  const watchlistAll: WatchlistItem[] = useMemo(() => {
    const out: WatchlistItem[] = [];
    for (const s of watchApi.signals) {
      if (typeof s.price !== 'number') continue;
      const pct = typeof s.changePercent === 'number' ? s.changePercent : 0;
      out.push({
        symbol: s.symbol,
        name: s.name || s.symbol,
        price: s.price,
        change: s.price * (pct / 100),
        changePercent: pct,
        isFavorite: favorites.includes(s.symbol.toUpperCase()),
        type: s.assetType === 'crypto' ? 'crypto' : 'stock',
      });
    }
    return out;
  }, [watchApi.signals, favorites]);

  const watchlistCache = useRef<WatchlistItem[]>([]);
  if (watchlistAll.length) watchlistCache.current = watchlistAll;
  const watchlist = watchlistAll.length ? watchlistAll : watchlistCache.current;
  const showStaleWatch = !!watchApi.error && watchlistAll.length === 0 && watchlistCache.current.length > 0;

  const activeApi = activeTab === 'watchlist' ? watchApi : signalsApi;
  const lastUpdated = activeApi.lastUpdated ? new Date(activeApi.lastUpdated) : null;

  const handleRefresh = () => {
    setIsRefreshing(true);
    activeApi.refresh();
    addToast('Refreshing market data…', 'info');
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const toggleFav = (symbol: string) => {
    const up = symbol.toUpperCase();
    setFavorites((prev) => prev.includes(up) ? prev.filter((s) => s !== up) : [...prev, up]);
  };

  const addSymbol = () => {
    const sym = search.trim().toUpperCase();
    if (!sym || !/^[A-Z0-9.\-]{1,15}$/.test(sym)) {
      addToast('Enter a valid ticker (e.g. AAPL, BTCUSDT)', 'error');
      return;
    }
    if (watchSymbols.some((s) => s.toUpperCase() === sym)) {
      addToast(`${sym} is already in your watchlist`, 'info');
      return;
    }
    if (watchSymbols.length >= 20) {
      addToast('Watchlist is full (max 20)', 'error');
      return;
    }
    setWatchSymbols((prev) => [...prev, sym]);
    setSearch('');
    addToast(`${sym} added`, 'success');
  };

  const removeSymbol = (symbol: string) => {
    const up = symbol.toUpperCase();
    setWatchSymbols((prev) => prev.filter((s) => s.toUpperCase() !== up));
  };

  const explain = (prompt: string) => {
    setSelected(null);
    if (onExplainSignal) {
      onExplainSignal(prompt);
      addToast('Asked KorvixAI to explain the signal', 'success');
    } else {
      addToast('Open the Chat tab to ask KorvixAI', 'info');
    }
  };

  const filteredWatchlist = watchlist
    .filter((w) => watchlistFilter === 'all' || (watchlistFilter === 'crypto' ? w.type === 'crypto' : w.type === 'stock'))
    .filter((w) => !search || w.symbol.toLowerCase().includes(search.toLowerCase()) || w.name.toLowerCase().includes(search.toLowerCase()));

  const tabs = [
    { id: 'signals' as const, label: 'Signals', icon: Zap },
    { id: 'watchlist' as const, label: 'Watchlist', icon: Star },
    { id: 'sentiment' as const, label: 'Sentiment', icon: Activity },
    { id: 'trending' as const, label: 'Trending', icon: TrendingUp },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-white/[0.04] bg-[#0a0a0a]/60">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10 shadow-[0_0_8px_-2px_rgba(52,211,153,0.06)]">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <motion.div
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400"
                animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                style={{ boxShadow: '0 0 4px rgba(52,211,153,0.5)' }}
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-white truncate">Trading Intelligence</h2>
              <p className="text-[10px] text-slate-600">Live market signals · not financial advice</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:flex items-center text-[10px] text-slate-600">
              <Clock className="w-3 h-3 inline mr-1" />
              {lastUpdated ? fmtTime(lastUpdated) : '—'}
            </span>
            <span className="hidden sm:inline text-[9px] text-emerald-400/60 px-1.5 py-0.5 rounded-full bg-emerald-500/[0.05] border border-emerald-500/10">
              Auto {Math.round(POLL_MS / 1000)}s
            </span>
            <motion.button
              onClick={handleRefresh}
              animate={{ rotate: isRefreshing ? 360 : 0 }}
              transition={{ duration: 0.8, ease: 'linear' }}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.04] text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/[0.04] transition-all"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-full sm:w-fit overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 whitespace-nowrap ${
                activeTab === t.id ? 'bg-white/[0.06] text-white shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Market regime — derived from real live signals (honest aggregate) */}
        <MarketRegimeBanner r={marketRegime} />

        {/* ═══ SIGNALS ═══ */}
        {activeTab === 'signals' && (
          <>
            {isRefreshing || (signalsApi.isLoading && signalsToShow.length === 0) ? (
              <div className="space-y-3">
                <SignalCardSkeleton />
                <SignalCardSkeleton />
                <SignalCardSkeleton />
              </div>
            ) : signalsApi.error && signalsToShow.length === 0 ? (
              <LiveDataUnavailable onRetry={handleRefresh} message={signalsApi.error} />
            ) : signalsToShow.length === 0 ? (
              <LiveDataUnavailable onRetry={handleRefresh} message="No live trading signals right now." />
            ) : (
              <>
                {showStaleSignals && <StaleBanner at={fmtTime(lastUpdated || undefined)} onRetry={handleRefresh} />}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1">
                  <div className="p-3 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.04] text-center">
                    <p className="text-lg font-semibold text-emerald-400">{signalsToShow.filter((s) => s.direction === 'long').length}</p>
                    <p className="text-[9px] text-slate-500">Long</p>
                  </div>
                  <div className="p-3 rounded-xl border border-red-500/10 bg-red-500/[0.04] text-center">
                    <p className="text-lg font-semibold text-red-400">{signalsToShow.filter((s) => s.direction === 'short').length}</p>
                    <p className="text-[9px] text-slate-500">Short</p>
                  </div>
                  <div className="p-3 rounded-xl border border-amber-500/10 bg-amber-500/[0.04] text-center">
                    <p className="text-lg font-semibold text-amber-400">{signalsToShow.filter((s) => s.direction === 'wait' || s.direction === 'neutral').length}</p>
                    <p className="text-[9px] text-slate-500">Wait</p>
                  </div>
                  <div className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] text-center">
                    <p className="text-lg font-semibold text-white">{signalsToShow.length > 0 ? Math.round(signalsToShow.reduce((a, s) => a + s.confidence, 0) / signalsToShow.length) : 0}%</p>
                    <p className="text-[9px] text-slate-500">Avg Conf</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {signalsToShow.map((signal) => (
                    <SignalCard key={signal.id} signal={signal} onOpen={() => setSelected(signal)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ WATCHLIST ═══ */}
        {activeTab === 'watchlist' && (
          <>
            <div className="flex flex-wrap gap-2 mb-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSymbol(); }}
                  placeholder="Search or add ticker (Enter)…"
                  className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/20 transition-all"
                />
              </div>
              <button onClick={addSymbol} title="Add to watchlist"
                className="h-8 px-2.5 flex items-center gap-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10 text-[11px] text-emerald-400 hover:bg-emerald-500/[0.1] transition-all">
                <Plus className="w-3 h-3" /> Add
              </button>
              <button onClick={handleRefresh} title="Refresh watchlist"
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-white/[0.02] border border-white/[0.04] text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/[0.04] transition-all">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                {(['all', 'stocks', 'crypto'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setWatchlistFilter(f)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all capitalize ${
                      watchlistFilter === f ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {isRefreshing || (watchApi.isLoading && watchlist.length === 0) ? (
              <WatchlistSkeleton />
            ) : watchApi.error && watchlist.length === 0 ? (
              <LiveDataUnavailable onRetry={handleRefresh} message={watchApi.error} />
            ) : watchSymbols.length === 0 ? (
              <ComingSoon
                title="Your watchlist is empty"
                what="Add a ticker above (e.g. AAPL, NVDA, BTCUSDT) to track live quotes."
                source="any valid stock or crypto symbol"
              />
            ) : filteredWatchlist.length === 0 ? (
              <p className="text-[11px] text-slate-600 text-center py-8">
                {watchlist.length === 0 ? 'Waiting for live quotes…' : 'No symbols match this filter.'}
              </p>
            ) : (
              <>
                {showStaleWatch && <StaleBanner at={fmtTime(lastUpdated || undefined)} onRetry={handleRefresh} />}
                <div className="space-y-1.5">
                  {filteredWatchlist.map((item) => (
                    <WatchlistRow
                      key={item.symbol}
                      item={item}
                      onToggleFav={() => toggleFav(item.symbol)}
                      onRemove={() => removeSymbol(item.symbol)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ SENTIMENT ═══ */}
        {activeTab === 'sentiment' && (
          <ComingSoon
            title="Market sentiment — coming soon"
            what="Fear & Greed, put/call ratio, VIX and sector sentiment will appear here once a real feed is wired."
            source="a market-sentiment data provider (e.g. options flow + Fear & Greed index)"
          />
        )}

        {/* ═══ TRENDING ═══ */}
        {activeTab === 'trending' && (
          <ComingSoon
            title="Trending assets — coming soon"
            what="Most-discussed and unusual-volume tickers will appear here once a real feed is wired."
            source="a social/volume aggregation service (mentions + unusual volume)"
          />
        )}
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          />
        )}
        {selected && (
          <SignalDetailDrawer
            key="drawer"
            signal={selected}
            onClose={() => setSelected(null)}
            onExplain={explain}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
