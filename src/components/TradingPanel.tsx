import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TradingSignal } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useTradingSignals } from '@/hooks/useTradingSignals';
import KorvixOrb from './KorvixOrb';
import {
  TrendingUp, TrendingDown, Activity, Zap,
  RefreshCw, Search, Clock, Star, ChevronRight,
  ArrowUpRight, ArrowDownRight,
  AlertTriangle, Plus, X, Sparkles,
  ShieldAlert, Info, MessageSquare, Gauge,
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

function buildWatchlistItems(signals: TradingSignal[], favorites: string[]): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const s of signals) {
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

function trendSummary(s: TradingSignal): string {
  const base =
    s.direction === 'long' ? 'Bullish bias'
    : s.direction === 'short' ? 'Bearish bias'
    : s.direction === 'wait' ? 'No defined edge — stand aside'
    : 'Range / no-trade';
  const bits: string[] = [base];
  if (s.volatilityRegime) bits.push(`${s.volatilityRegime} regime`);
  bits.push(`${s.confidence}% confidence`);
  if (typeof s.riskReward === 'number') bits.push(`R:R ${s.riskReward}`);
  return bits.join(' · ');
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
  const lines = [
    L('Symbol', s.symbol),
    L('Asset type', s.assetType),
    L('Timeframe', s.timeframe),
    L('Direction', s.direction.toUpperCase()),
    L('Confidence', `${s.confidence}%`),
    L('Setup grade', s.setupGrade),
    L('Last price', typeof s.price === 'number' ? s.price : undefined),
    L('Entry', s.entryPrice),
    L('Target', s.targetPrice),
    L('Stop', s.stopLoss),
    L('Risk:Reward', s.riskReward),
    L('Volatility', s.volatilityRegime || s.volatility),
    L('Invalidation', s.invalidation),
  ].filter(Boolean).join('\n');
  return (
    `Explain this trading signal in plain language — analysis only, NOT financial advice, and do NOT execute any trade:\n\n` +
    `${lines}\n\n` +
    `Why is the bias ${s.direction.toUpperCase()}? What is the bullish case, the bearish case, ` +
    `the key risks, and what would invalidate this setup?`
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

function SignalDetailDrawer({
  signal, onClose, onExplain,
}: {
  signal: TradingSignal;
  onClose: () => void;
  onExplain?: (prompt: string) => void;
}) {
  const c = tone(signal.direction);
  const risk = riskLevel(signal);
  const sc = scenarios(signal);

  return (
    <motion.aside
      key="drawer"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] max-w-[100vw] bg-[#0b0b0c]/95 backdrop-blur-xl border-l border-white/[0.06] shadow-[0_0_60px_-15px_rgba(0,0,0,0.8)] flex flex-col"
    >
      {/* Header */}
      <div className={`shrink-0 p-4 border-b border-white/[0.05] ${c.bg}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[16px] font-semibold text-white">{signal.symbol}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.badge}`}>
                {signal.direction.toUpperCase()}
              </span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${GRADE_BADGE[signal.setupGrade]}`}>
                Grade {signal.setupGrade}
              </span>
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
        {/* Price snapshot */}
        <DrawerSection icon={<Gauge className="w-3.5 h-3.5" />} title="Price snapshot">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-white/[0.02]">
              <p className="text-[9px] text-slate-600">Last price</p>
              <p className="text-[13px] font-medium text-white">
                {typeof signal.price === 'number'
                  ? `$${signal.price.toLocaleString('en-US', { maximumFractionDigits: signal.price < 10 ? 6 : 2 })}`
                  : '—'}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-white/[0.02]">
              <p className="text-[9px] text-slate-600">Change</p>
              <p className={`text-[13px] font-medium ${typeof signal.changePercent === 'number' && signal.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {typeof signal.changePercent === 'number'
                  ? `${signal.changePercent >= 0 ? '+' : ''}${signal.changePercent.toFixed(2)}%`
                  : '—'}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/[0.04]">
              <p className="text-[9px] text-emerald-400/60">Entry</p>
              <p className="text-[13px] font-medium text-emerald-400">{signal.entryPrice ? `$${signal.entryPrice}` : '—'}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-red-500/[0.04]">
              <p className="text-[9px] text-red-400/60">Stop</p>
              <p className="text-[13px] font-medium text-red-400">{signal.stopLoss ? `$${signal.stopLoss}` : '—'}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-white/[0.02]">
              <p className="text-[9px] text-slate-600">Target 1</p>
              <p className="text-[13px] font-medium text-white">{signal.targetPrice ? `$${signal.targetPrice}` : '—'}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-white/[0.02]">
              <p className="text-[9px] text-slate-600">Target 2</p>
              <p className="text-[13px] font-medium text-white">{signal.takeProfit2 ? `$${signal.takeProfit2}` : '—'}</p>
            </div>
          </div>
        </DrawerSection>

        {/* Trend summary */}
        <DrawerSection icon={signal.direction === 'short' ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />} title="Trend summary">
          <p className="text-[12px] text-slate-400 leading-relaxed">{trendSummary(signal)}</p>
          <p className="text-[12px] text-slate-500 leading-relaxed mt-1.5">{signal.reasoning}</p>
        </DrawerSection>

        {/* Support / Resistance — honest: this feed doesn't provide them */}
        <DrawerSection icon={<Activity className="w-3.5 h-3.5" />} title="Support / Resistance">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Structured support/resistance levels are not provided by the current
            signals feed. The defined trade levels above (entry / stop / targets)
            are the only price levels returned for this setup — no estimated
            levels are shown.
          </p>
        </DrawerSection>

        {/* AI explanation (rule-based from real fields) + ask-AI action */}
        <DrawerSection icon={<Sparkles className="w-3.5 h-3.5" />} title="Signal rationale">
          <p className="text-[12px] text-slate-400 leading-relaxed">
            Bias is <span className={c.text}>{signal.direction.toUpperCase()}</span> at{' '}
            {signal.confidence}% confidence (grade {signal.setupGrade}, {risk.label.toLowerCase()} risk
            {typeof signal.riskReward === 'number' ? `, R:R ${signal.riskReward}` : ''}).
            {signal.invalidation ? ` Invalidation: ${signal.invalidation}.` : ''}
          </p>
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

        {/* Scenarios */}
        <div className="grid grid-cols-1 gap-2">
          <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <h4 className="text-[12px] font-medium text-emerald-400">Bullish scenario</h4>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">{sc.bull}</p>
          </div>
          <div className="rounded-xl border border-red-500/10 bg-red-500/[0.03] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              <h4 className="text-[12px] font-medium text-red-400">Bearish scenario</h4>
            </div>
            <p className="text-[12px] text-slate-400 leading-relaxed">{sc.bear}</p>
          </div>
        </div>

        {/* Risk notes */}
        <DrawerSection icon={<ShieldAlert className="w-3.5 h-3.5" />} title="Risk notes">
          <ul className="space-y-1.5 text-[11px] text-slate-500 leading-relaxed list-disc list-inside">
            <li>Overall risk rated <span className={risk.cls.split(' ')[0]}>{risk.label}</span> from volatility, confidence, grade{typeof signal.riskReward === 'number' ? ' and R:R' : ''}.</li>
            <li>{signal.volatility === 'high' ? 'Elevated volatility — position size accordingly.' : signal.volatility === 'low' ? 'Lower volatility — moves may be slower than expected.' : 'Moderate volatility regime.'}</li>
            {signal.invalidation && <li>Setup invalidated if: {signal.invalidation}.</li>}
            <li>Live data can change quickly; signal reflects the last update only.</li>
          </ul>
        </DrawerSection>

        {/* Not financial advice */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Analysis only — not financial advice. KorvixAI does not execute trades
            or place orders. Always do your own research.
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
  // transient backend hiccup doesn't blank the panel).
  const signalsToShow = freshSignals.length ? freshSignals : signalsApi.lastLiveSignals;
  const showStaleSignals = freshSignals.length === 0 && signalsApi.lastLiveSignals.length > 0;
  const signalsStaleAt = signalsApi.lastLiveUpdated ? new Date(signalsApi.lastLiveUpdated) : null;

  const liveWatchSignals = useMemo(
    () => watchApi.signals.filter((s) => s.isLive),
    [watchApi.signals],
  );
  const watchlistAll = useMemo(
    () => buildWatchlistItems(liveWatchSignals, favorites),
    [liveWatchSignals, favorites],
  );
  const watchlistCache = useMemo(
    () => buildWatchlistItems(watchApi.lastLiveSignals, favorites),
    [watchApi.lastLiveSignals, favorites],
  );

  const watchlist = watchlistAll.length ? watchlistAll : watchlistCache;
  const showStaleWatch = watchlistAll.length === 0 && watchlistCache.length > 0;
  const watchlistStaleAt = watchApi.lastLiveUpdated ? new Date(watchApi.lastLiveUpdated) : null;

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
    if (!sym || !/^[A-Z0-9.-]{1,15}$/.test(sym)) {
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
                {showStaleSignals && <StaleBanner at={fmtTime(signalsStaleAt || undefined)} onRetry={handleRefresh} />}
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
                {showStaleWatch && <StaleBanner at={fmtTime(watchlistStaleAt || undefined)} onRetry={handleRefresh} />}
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
