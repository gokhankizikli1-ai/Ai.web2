import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Target,
  AlertTriangle, BarChart3, Clock,
  Shield, Zap, ChevronDown, Activity,
} from 'lucide-react';
import type { TradingSignal } from '@/types';

/* ─── Mock Data ─── */
const SIGNALS: TradingSignal[] = [
  { id: 's1', symbol: 'AAPL', name: 'Apple Inc.', direction: 'long', confidence: 87, setupGrade: 'A', volatility: 'medium', entryPrice: '$178.50', targetPrice: '$195.00', stopLoss: '$172.00', timestamp: new Date(), reasoning: 'Strong breakout above resistance with volume confirmation. RSI bullish divergence observed on daily timeframe.' },
  { id: 's2', symbol: 'TSLA', name: 'Tesla Inc.', direction: 'short', confidence: 72, setupGrade: 'B', volatility: 'high', entryPrice: '$248.00', targetPrice: '$230.00', stopLoss: '$255.00', timestamp: new Date(Date.now() - 60000), reasoning: 'Double top pattern on 4H chart. MACD showing bearish crossover with decreasing volume.' },
  { id: 's3', symbol: 'NVDA', name: 'NVIDIA Corp.', direction: 'long', confidence: 94, setupGrade: 'A', volatility: 'low', entryPrice: '$485.00', targetPrice: '$520.00', stopLoss: '$475.00', timestamp: new Date(Date.now() - 120000), reasoning: 'Cup and handle formation completing. AI demand cycle driving institutional accumulation phase.' },
  { id: 's4', symbol: 'BTC', name: 'Bitcoin', direction: 'wait', confidence: 45, setupGrade: 'C', volatility: 'high', entryPrice: '$42,800', targetPrice: '$45,200', stopLoss: '$41,500', timestamp: new Date(Date.now() - 180000), reasoning: 'Consolidation phase between $42,800-$44,200. Waiting for decisive volume-backed breakout.' },
  { id: 's5', symbol: 'MSFT', name: 'Microsoft', direction: 'long', confidence: 81, setupGrade: 'A', volatility: 'low', entryPrice: '$375.00', targetPrice: '$410.00', stopLoss: '$365.00', timestamp: new Date(Date.now() - 240000), reasoning: 'AI integration across product suite driving recurring revenue growth. Cloud momentum intact.' },
  { id: 's6', symbol: 'AMD', name: 'AMD', direction: 'short', confidence: 63, setupGrade: 'B', volatility: 'medium', entryPrice: '$142.00', targetPrice: '$130.00', stopLoss: '$148.00', timestamp: new Date(Date.now() - 300000), reasoning: 'Server market share under pressure. Guidance uncertainty post-earnings creates short opportunity.' },
];

const SPARKLINES: Record<string, number[]> = {
  AAPL: [172, 174, 173, 175, 174, 176, 177, 176, 178, 179, 178, 180, 179, 181, 180, 182, 181, 183, 182, 184],
  TSLA: [255, 253, 254, 252, 250, 251, 249, 250, 248, 247, 249, 248, 246, 247, 245, 246, 244, 245, 243, 244],
  NVDA: [472, 474, 473, 475, 476, 478, 477, 479, 480, 482, 481, 483, 482, 484, 485, 487, 486, 488, 487, 489],
  BTC: [42800, 43200, 42900, 43500, 43100, 43800, 43400, 44000, 43600, 44200, 43900, 44500, 44100, 44700, 44300, 44900, 44600, 45200, 44800, 45500],
  MSFT: [365, 368, 367, 370, 369, 372, 371, 374, 373, 376, 375, 378, 377, 380, 379, 382, 381, 384, 383, 386],
  AMD: [148, 146, 147, 145, 144, 146, 145, 143, 144, 142, 143, 141, 142, 140, 141, 139, 140, 138, 139, 137],
};

const FILTERS = ['All', 'Long', 'Short', 'Wait'] as const;

/* ─── Sparkline SVG ─── */
function Sparkline({ data, color = '#22d3ee' }: { data: number[]; color?: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 30;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  // Area fill
  const areaPoints = `0,${h} ${points} ${w},${h}`;

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      {/* End dot */}
      <circle
        cx={w}
        cy={h - ((data[data.length - 1] - min) / range) * h}
        r="2.5"
        fill={color}
        opacity={0.9}
      />
    </svg>
  );
}

/* ─── Direction Badge ─── */
function DirectionBadge({ direction }: { direction: TradingSignal['direction'] }) {
  const config = {
    long: { bg: 'bg-emerald-500/[0.08]', text: 'text-emerald-400', border: 'border-emerald-500/15', icon: TrendingUp, glow: 'shadow-[0_0_8px_-2px_rgba(52,211,153,0.15)]' },
    short: { bg: 'bg-red-500/[0.08]', text: 'text-red-400', border: 'border-red-500/15', icon: TrendingDown, glow: 'shadow-[0_0_8px_-2px_rgba(248,113,113,0.15)]' },
    wait: { bg: 'bg-amber-500/[0.08]', text: 'text-amber-400', border: 'border-amber-500/15', icon: Minus, glow: '' },
    neutral: { bg: 'bg-slate-500/[0.06]', text: 'text-slate-400', border: 'border-slate-500/10', icon: Minus, glow: '' },
  };
  const c = config[direction];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-[3px] rounded-md border ${c.bg} ${c.text} ${c.border} ${c.glow}`}>
      <c.icon className="h-2.5 w-2.5" />
      {direction}
    </span>
  );
}

/* ─── Confidence Meter ─── */
function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 85 ? 'from-emerald-500 to-emerald-400' : value >= 70 ? 'from-cyan-500 to-cyan-400' : value >= 50 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400';
  const glow = value >= 85 ? 'shadow-[0_0_8px_-2px_rgba(52,211,153,0.2)]' : value >= 70 ? 'shadow-[0_0_8px_-2px_rgba(34,211,238,0.15)]' : '';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-[3px] bg-white/[0.04] rounded-full overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-1000 ${glow}`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[10px] font-mono font-medium ${value >= 85 ? 'text-emerald-400' : value >= 70 ? 'text-cyan-400' : value >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{value}%</span>
    </div>
  );
}

/* ─── Grade Badge ─── */
function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: 'text-emerald-400 bg-emerald-500/[0.08] border-emerald-500/15',
    B: 'text-cyan-400 bg-cyan-500/[0.06] border-cyan-500/12',
    C: 'text-amber-400 bg-amber-500/[0.06] border-amber-500/12',
    D: 'text-red-400 bg-red-500/[0.06] border-red-500/12',
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded border ${colors[grade] || colors.D}`}>
      {grade}
    </span>
  );
}

/* ─── Volatility Bar ─── */
function VolatilityBar({ level }: { level: string }) {
  const config = {
    low: { segments: 1, color: 'bg-emerald-500/50' },
    medium: { segments: 2, color: 'bg-amber-500/50' },
    high: { segments: 3, color: 'bg-red-500/50' },
  };
  const c = config[level as keyof typeof config] || config.low;
  return (
    <div className="flex items-center gap-[2px]">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-1 h-2.5 rounded-sm transition-all ${i <= c.segments ? c.color : 'bg-white/[0.03]'}`}
        />
      ))}
    </div>
  );
}

/* ─── Signal Card ─── */
function SignalCard({ signal, index, isExpanded, onToggle }: {
  signal: TradingSignal;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const sparkData = SPARKLINES[signal.symbol] || [];
  const sparkColor = signal.direction === 'long' ? '#34d399' : signal.direction === 'short' ? '#f87171' : '#fbbf24';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      layout
      className={`rounded-xl border overflow-hidden transition-all duration-300 ${
        isExpanded
          ? 'border-white/[0.08] bg-white/[0.02] shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5)]'
          : 'border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] hover:bg-white/[0.015]'
      }`}
    >
      {/* Header row */}
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5">
        {/* Direction */}
        <DirectionBadge direction={signal.direction} />

        {/* Symbol */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-white tracking-tight">{signal.symbol}</span>
            <span className="text-[11px] text-slate-600">{signal.name}</span>
          </div>
        </div>

        {/* Sparkline */}
        <div className="hidden sm:block">
          <Sparkline data={sparkData} color={sparkColor} />
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2.5 shrink-0">
          <GradeBadge grade={signal.setupGrade} />
          <ConfidenceMeter value={signal.confidence} />
          <VolatilityBar level={signal.volatility} />
          <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-3.5 w-3.5 text-slate-700" />
          </motion.div>
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.03] px-4 py-4 space-y-3">
              {/* Price grid */}
              <div className="grid grid-cols-3 gap-2.5">
                {signal.entryPrice && (
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                    <div className="text-[10px] text-slate-600 mb-1 flex items-center gap-1 uppercase tracking-wider font-medium">
                      Entry
                    </div>
                    <div className="text-[14px] font-mono text-white font-medium">{signal.entryPrice}</div>
                  </div>
                )}
                {signal.targetPrice && (
                  <div className="rounded-lg bg-emerald-500/[0.04] border border-emerald-500/[0.08] p-3">
                    <div className="text-[10px] text-emerald-500/60 mb-1 flex items-center gap-1 uppercase tracking-wider font-medium">
                      <Target className="h-2.5 w-2.5" /> Target
                    </div>
                    <div className="text-[14px] font-mono text-emerald-400 font-medium">{signal.targetPrice}</div>
                  </div>
                )}
                {signal.stopLoss && (
                  <div className="rounded-lg bg-red-500/[0.04] border border-red-500/[0.08] p-3">
                    <div className="text-[10px] text-red-500/60 mb-1 flex items-center gap-1 uppercase tracking-wider font-medium">
                      <Shield className="h-2.5 w-2.5" /> Stop
                    </div>
                    <div className="text-[14px] font-mono text-red-400 font-medium">{signal.stopLoss}</div>
                  </div>
                )}
              </div>

              {/* Risk/Reward with sentiment */}
              {signal.entryPrice && signal.targetPrice && signal.stopLoss && (
                <div className="flex items-center gap-3">
                  <Zap className="h-3.5 w-3.5 text-amber-500/50" />
                  <div className="flex-1 h-[3px] bg-white/[0.03] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background: signal.direction === 'long'
                          ? 'linear-gradient(to right, rgba(52,211,153,0.3), rgba(52,211,153,0.6))'
                          : signal.direction === 'short'
                          ? 'linear-gradient(to right, rgba(248,113,113,0.3), rgba(248,113,113,0.6))'
                          : 'linear-gradient(to right, rgba(251,191,36,0.3), rgba(251,191,36,0.6))'
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${signal.confidence}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono font-medium">
                    R:R {((parseFloat(signal.targetPrice.replace(/[^0-9.]/g, '')) - parseFloat(signal.entryPrice.replace(/[^0-9.]/g, ''))) /
                      (parseFloat(signal.entryPrice.replace(/[^0-9.]/g, '')) - parseFloat(signal.stopLoss.replace(/[^0-9.]/g, '')))).toFixed(1)}:1
                  </span>
                </div>
              )}

              {/* Reasoning */}
              <p className="text-[12px] text-slate-500 leading-relaxed pl-1">{signal.reasoning}</p>

              {/* Footer meta */}
              <div className="flex items-center gap-4 pt-1">
                <div className="flex items-center gap-1.5">
                  {signal.volatility === 'high' ? (
                    <AlertTriangle className="h-3 w-3 text-amber-500/50" />
                  ) : (
                    <Shield className="h-3 w-3 text-slate-700" />
                  )}
                  <span className="text-[10px] text-slate-600 capitalize">{signal.volatility} volatility</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 text-slate-700" />
                  <span className="text-[10px] text-slate-600">Just now</span>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Activity className="h-3 w-3 text-cyan-400/40" />
                  <span className="text-[10px] text-cyan-400/50">AI Generated</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Main Panel ─── */
export default function TradingPanel() {
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return activeFilter === 'All' ? SIGNALS : SIGNALS.filter((s) => s.direction === activeFilter.toLowerCase());
  }, [activeFilter]);

  const stats = useMemo(() => ({
    total: SIGNALS.length,
    long: SIGNALS.filter((s) => s.direction === 'long').length,
    short: SIGNALS.filter((s) => s.direction === 'short').length,
    avgConfidence: Math.round(SIGNALS.reduce((a, s) => a + s.confidence, 0) / SIGNALS.length),
    highVol: SIGNALS.filter((s) => s.volatility === 'high').length,
  }), []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.03]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/[0.08] border border-cyan-500/15">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <span className="text-[14px] font-semibold text-white">Trading Signals</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/50 animate-ping" style={{ animationDuration: '2s' }} />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[11px] text-emerald-400/60 font-medium">Live</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-white/[0.02]">
        {FILTERS.map((f) => {
          const isActive = activeFilter === f;
          const colorClass = f === 'Long' ? 'text-emerald-400' : f === 'Short' ? 'text-red-400' : f === 'Wait' ? 'text-amber-400' : '';
          return (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`relative text-[11px] font-medium px-3 py-1.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-white/[0.06] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]'
                  : `text-slate-600 hover:text-slate-400 hover:bg-white/[0.02] ${colorClass}`
              }`}
            >
              {f}
              {f !== 'All' && (
                <span className={`ml-1.5 text-[9px] ${isActive ? 'text-slate-500' : 'text-slate-700'}`}>
                  {f === 'Long' ? stats.long : f === 'Short' ? stats.short : SIGNALS.filter((s) => s.direction === 'wait').length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-px bg-white/[0.015] border-b border-white/[0.02]">
        {[
          { label: 'Signals', value: stats.total.toString() },
          { label: 'Avg Confidence', value: `${stats.avgConfidence}%` },
          { label: 'Bullish', value: stats.long.toString(), color: 'text-emerald-400' },
          { label: 'Bearish', value: stats.short.toString(), color: 'text-red-400' },
        ].map((stat) => (
          <div key={stat.label} className="px-4 py-2.5 text-center">
            <div className={`text-[13px] font-semibold ${stat.color || 'text-white'}`}>{stat.value}</div>
            <div className="text-[9px] text-slate-700 mt-0.5 uppercase tracking-wider font-medium">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Signals list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((signal, i) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              index={i}
              isExpanded={expandedId === signal.id}
              onToggle={() => setExpandedId(expandedId === signal.id ? null : signal.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
