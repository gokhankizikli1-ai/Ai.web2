// Phase 5.2 — Trading Signal Card.
//
// Renders the structured `metadata.trading_signal` that comes back from the
// trading_analyst mode. Designed to feel like an institutional terminal card:
// directional bias badge, level grid (entry / stop / TPs), setup grade bar,
// fakeout & liquidity risk meters, do_now / do_not_do bullets.
//
// Renders nothing when the signal is empty/incomplete — safe to drop next to
// every message bubble without affecting non-trading replies.
import {
  TrendingUp, TrendingDown, Clock, AlertOctagon, Ban,
  Crosshair, Shield, Target, CheckCircle2, XCircle, Gauge,
} from 'lucide-react';
import type { TradingSignal } from '@/types';

interface Props {
  signal: TradingSignal;
}

const DIRECTIONAL_STYLES: Record<string, { label: string; bg: string; ring: string; text: string; icon: React.ComponentType<{ className?: string }> }> = {
  LONG:            { label: 'LONG',            bg: 'bg-emerald-500/12', ring: 'ring-emerald-400/30', text: 'text-emerald-300', icon: TrendingUp },
  SHORT:           { label: 'SHORT',           bg: 'bg-rose-500/12',    ring: 'ring-rose-400/30',    text: 'text-rose-300',    icon: TrendingDown },
  WAIT:            { label: 'WAIT',            bg: 'bg-amber-500/12',   ring: 'ring-amber-400/30',   text: 'text-amber-300',   icon: Clock },
  REVERSAL_WATCH:  { label: 'REVERSAL WATCH',  bg: 'bg-violet-500/12',  ring: 'ring-violet-400/30',  text: 'text-violet-300',  icon: AlertOctagon },
  NO_TRADE:        { label: 'NO TRADE',        bg: 'bg-slate-500/12',   ring: 'ring-slate-400/30',   text: 'text-slate-300',   icon: Ban },
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1)    return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function riskTone(score: number | null | undefined) {
  if (score === null || score === undefined) return { color: 'bg-slate-500', text: 'text-slate-400' };
  if (score >= 7) return { color: 'bg-rose-400',    text: 'text-rose-300' };
  if (score >= 4) return { color: 'bg-amber-400',   text: 'text-amber-300' };
  return { color: 'bg-emerald-400', text: 'text-emerald-300' };
}

export default function TradingSignalCard({ signal }: Props) {
  if (!signal || (!signal.directional_bias && !signal.side && !signal.action)) return null;

  const dirKey = (signal.directional_bias || '').toUpperCase();
  const style  = DIRECTIONAL_STYLES[dirKey] ?? DIRECTIONAL_STYLES.WAIT;
  const Icon   = style.icon;
  const showLevels = dirKey === 'LONG' || dirKey === 'SHORT';
  const grade  = typeof signal.setup_grade === 'number' ? Math.max(0, Math.min(10, signal.setup_grade)) : null;
  const fakeoutTone   = riskTone(signal.fakeout_risk);
  const liquidityTone = riskTone(signal.liquidity_risk);
  const doNow    = (signal.do_now    || []).filter(Boolean).slice(0, 4);
  const doNotDo  = (signal.do_not_do || []).filter(Boolean).slice(0, 4);

  return (
    <div className="mt-3 rounded-[14px] border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm overflow-hidden">
      {/* Header — directional bias + symbol */}
      <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${style.bg} border-b border-white/[0.04]`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ring-1 ${style.ring} ${style.bg}`}>
            <Icon className={`h-3.5 w-3.5 ${style.text}`} />
          </div>
          <div className="min-w-0">
            <div className={`text-[12px] font-semibold tracking-wide ${style.text}`}>{style.label}</div>
            <div className="text-[10px] text-slate-500 truncate">
              {signal.symbol || 'TRADE'} · {signal.timeframe || '—'}
              {signal.regime ? ` · ${signal.regime}` : ''}
            </div>
          </div>
        </div>
        {typeof signal.probability_pct === 'number' && (
          <div className="text-right shrink-0">
            <div className={`text-[15px] font-semibold ${style.text}`}>{signal.probability_pct}%</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500">olasılık</div>
          </div>
        )}
      </div>

      {/* Trigger line */}
      {signal.trigger && (
        <div className="px-4 py-2 border-b border-white/[0.04] bg-white/[0.012]">
          <div className="flex items-start gap-2">
            <Crosshair className="h-3 w-3 text-cyan-400/70 mt-0.5 shrink-0" />
            <div className="text-[11px] text-slate-300 leading-snug">
              <span className="text-slate-500 mr-1">Tetikleyici:</span>
              {signal.trigger}
            </div>
          </div>
        </div>
      )}

      {/* Levels grid (only when there's an actionable trade) */}
      {showLevels && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-white/[0.04] border-b border-white/[0.04]">
          <Cell label="Giriş"   value={fmt(signal.entry)} tone="text-cyan-300" />
          <Cell label="Stop"    value={fmt(signal.stop)}  tone="text-rose-300" icon={Shield} />
          <Cell label="TP1"     value={fmt(signal.take_profit_1)} tone="text-emerald-300/90" icon={Target} />
          <Cell label="TP2"     value={fmt(signal.take_profit_2)} tone="text-emerald-300/80" />
          <Cell label="TP3"     value={fmt(signal.take_profit_3)} tone="text-emerald-300/70" />
        </div>
      )}

      {/* Metrics row */}
      <div className="px-4 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-white/[0.04]">
        {/* Setup grade bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Gauge className="h-2.5 w-2.5" /> Setup
            </span>
            <span className="text-[11px] font-medium text-slate-300">
              {grade ?? '—'}<span className="text-slate-600">/10</span>
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
            {grade !== null && (
              <div
                className={`h-full rounded-full ${grade >= 7 ? 'bg-emerald-400' : grade >= 4 ? 'bg-amber-400' : 'bg-rose-400'}`}
                style={{ width: `${grade * 10}%` }}
              />
            )}
          </div>
        </div>

        {/* R:R */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">R : R</div>
          <div className="text-[12px] font-medium text-slate-200">
            {signal.risk_reward ? `1 : ${fmt(signal.risk_reward)}` : '—'}
          </div>
        </div>

        {/* Fakeout risk */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Fakeout</span>
            <span className={`text-[11px] font-medium ${fakeoutTone.text}`}>{signal.fakeout_risk ?? '—'}/10</span>
          </div>
          <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
            {typeof signal.fakeout_risk === 'number' && (
              <div className={`h-full rounded-full ${fakeoutTone.color}`} style={{ width: `${signal.fakeout_risk * 10}%` }} />
            )}
          </div>
        </div>

        {/* Liquidity risk */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Likidite</span>
            <span className={`text-[11px] font-medium ${liquidityTone.text}`}>{signal.liquidity_risk ?? '—'}/10</span>
          </div>
          <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
            {typeof signal.liquidity_risk === 'number' && (
              <div className={`h-full rounded-full ${liquidityTone.color}`} style={{ width: `${signal.liquidity_risk * 10}%` }} />
            )}
          </div>
        </div>
      </div>

      {/* Invalidation */}
      {signal.invalidation && (
        <div className="px-4 py-2 border-b border-white/[0.04] bg-rose-500/[0.03]">
          <div className="text-[10px] uppercase tracking-wider text-rose-300/70 mb-0.5">Invalidasyon</div>
          <div className="text-[11px] text-slate-300 leading-snug">{signal.invalidation}</div>
        </div>
      )}

      {/* DO NOW / DO NOT DO */}
      {(doNow.length > 0 || doNotDo.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/[0.04]">
          {doNow.length > 0 && (
            <div className="bg-[#0a0a0f]/30 px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-300/80 mb-1.5">
                <CheckCircle2 className="h-3 w-3" /> Şimdi yap
              </div>
              <ul className="space-y-1">
                {doNow.map((item, i) => (
                  <li key={i} className="text-[11px] text-slate-300 leading-snug flex gap-1.5">
                    <span className="text-emerald-400/60 shrink-0">›</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {doNotDo.length > 0 && (
            <div className="bg-[#0a0a0f]/30 px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-300/80 mb-1.5">
                <XCircle className="h-3 w-3" /> Yapma
              </div>
              <ul className="space-y-1">
                {doNotDo.map((item, i) => (
                  <li key={i} className="text-[11px] text-slate-300 leading-snug flex gap-1.5">
                    <span className="text-rose-400/60 shrink-0">›</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Cell({
  label, value, tone = 'text-slate-200', icon: IconCmp,
}: { label: string; value: string; tone?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-[#0a0a0f]/30 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5 flex items-center gap-1">
        {IconCmp && <IconCmp className="h-2.5 w-2.5" />}{label}
      </div>
      <div className={`text-[12px] font-mono font-medium ${tone}`}>{value}</div>
    </div>
  );
}
