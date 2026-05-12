import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Target,
  AlertTriangle, BarChart3, Shield,
  RefreshCw, Search, Plus, Clock, WifiOff,
} from 'lucide-react';
import { useTradingSignals } from '@/hooks/useTradingSignals';
import type { TradingSignal, DataProvider } from '@/types';

const FILTERS = ['All', 'Long', 'Short', 'Wait'] as const;

const PROVIDER_COLORS: Record<DataProvider, string> = {
  Binance: 'text-amber-400/70 bg-amber-500/[0.06] border-amber-500/15',
  Yahoo: 'text-purple-400/70 bg-purple-500/[0.06] border-purple-500/15',
  AlphaVantage: 'text-red-400/70 bg-red-500/[0.06] border-red-500/15',
  CoinGecko: 'text-teal-400/70 bg-teal-500/[0.06] border-teal-500/15',
  Unknown: 'text-slate-500 bg-white/[0.03] border-white/[0.06]',
};

/* ─── Sparkline SVG ─── */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} className="overflow-visible shrink-0">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(34,211,238,0.12)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#spark-grad)" />
      <polyline points={points} fill="none" stroke="rgba(34,211,238,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((data[data.length - 1] - min) / range) * h} r="2" fill="rgba(34,211,238,0.6)" />
    </svg>
  );
}

/* ─── Direction Badge ─── */
function DirectionBadge({ direction }: { direction: TradingSignal['direction'] }) {
  const config = {
    long:   { cls: 'text-emerald-400 bg-emerald-500/[0.08] border-emerald-500/15 shadow-[0_0_8px_-2px_rgba(52,211,153,0.15)]', icon: TrendingUp },
    short:  { cls: 'text-red-400 bg-red-500/[0.08] border-red-500/15 shadow-[0_0_8px_-2px_rgba(248,113,113,0.15)]', icon: TrendingDown },
    wait:   { cls: 'text-amber-400 bg-amber-500/[0.08] border-amber-500/15', icon: Minus },
    neutral:{ cls: 'text-slate-400 bg-white/[0.03] border-white/[0.06]', icon: Minus },
  };
  const c = config[direction] || config.neutral;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-[3px] rounded-md border ${c.cls}`}>
      <c.icon className="h-2.5 w-2.5" />
      {direction}
    </span>
  );
}

/* ─── Confidence Meter ─── */
// `value === null` means the backend didn't compute a confidence — render
// "—" instead of fabricating an empty 0% bar.
function ConfidenceMeter({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[10px] font-mono text-slate-700 w-[64px] text-right">—</span>;
  }
  const color = value >= 85 ? 'from-emerald-500 to-emerald-400' : value >= 70 ? 'from-cyan-500 to-cyan-400' : value >= 50 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-[3px] bg-white/[0.04] rounded-full overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[10px] font-mono font-medium ${value >= 85 ? 'text-emerald-400' : value >= 70 ? 'text-cyan-400' : value >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{value}%</span>
    </div>
  );
}

/* ─── Grade Badge ─── */
// `grade === null` means no plan was generated for this row — show a muted
// "—" rather than misrepresenting it as the worst grade ('D').
function GradeBadge({ grade }: { grade: string | null }) {
  if (grade === null) {
    return <span className="text-[10px] font-bold px-1.5 py-[2px] rounded border border-white/[0.04] text-slate-700">—</span>;
  }
  const colors: Record<string, string> = {
    A: 'text-emerald-400 bg-emerald-500/[0.08] border-emerald-500/15',
    B: 'text-cyan-400 bg-cyan-500/[0.06] border-cyan-500/12',
    C: 'text-amber-400 bg-amber-500/[0.06] border-amber-500/12',
    D: 'text-red-400 bg-red-500/[0.06] border-red-500/12',
  };
  return <span className={`text-[10px] font-bold px-1.5 py-[2px] rounded border ${colors[grade] || colors.D}`}>{grade}</span>;
}

/* ─── Volatility Bar ─── */
function VolatilityBar({ level }: { level: string }) {
  const segments = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <div className="flex items-center gap-[2px]">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`w-1 h-2.5 rounded-sm ${i <= segments ? (level === 'high' ? 'bg-red-500/40' : level === 'medium' ? 'bg-amber-500/40' : 'bg-emerald-500/40') : 'bg-white/[0.03]'}`} />
      ))}
    </div>
  );
}

/* ─── Signal Card ─── */
// `panelLive` is the panel-wide is_live flag (header indicator); the row's
// own `signal.isLive` may be false even when the panel is live (one symbol
// failed while others succeeded). We render the row state from
// `signal.isLive` so failed-row dimming is correct symbol-by-symbol.
function SignalCard({ signal, index, panelLive }: { signal: TradingSignal; index: number; panelLive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rowLive = signal.isLive ?? panelLive;

  const change   = signal.change24hPct;
  const changeUp = typeof change === 'number' && change >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      layout
      className={`rounded-xl border overflow-hidden transition-all duration-200 ${
        expanded ? 'border-white/[0.08] bg-white/[0.02]' : 'border-white/[0.03] bg-white/[0.005] hover:bg-white/[0.01] hover:border-white/[0.05]'
      } ${!rowLive ? 'opacity-60' : ''}`}
    >
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3.5">
        <DirectionBadge direction={signal.direction} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] font-semibold text-white tracking-tight">{signal.symbol}</span>
            <span className="text-[11px] text-slate-600 truncate">{signal.name}</span>
          </div>
          {/* Live price row — the user's #1 ask. Always show whatever the
              backend gave us; render the change pill in green/red. */}
          <div className="flex items-center gap-2 mt-0.5">
            {signal.price ? (
              <span className="text-[12px] font-mono text-white/85">${signal.price}</span>
            ) : (
              <span className="text-[11px] text-slate-700">no price</span>
            )}
            {typeof change === 'number' && (
              <span className={`text-[10px] font-mono ${changeUp ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                {changeUp ? '+' : ''}{change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        {signal.sparkline && <Sparkline data={signal.sparkline} />}
        <div className="flex items-center gap-2 shrink-0">
          <GradeBadge grade={signal.setupGrade} />
          <ConfidenceMeter value={signal.confidence} />
          <VolatilityBar level={signal.volatility} />
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <svg className="h-3.5 w-3.5 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="border-t border-white/[0.03] px-4 py-4 space-y-3">
              {/* Price grid — only render cells the backend actually filled. */}
              {(signal.entryPrice || signal.targetPrice || signal.stopLoss) ? (
                <div className="grid grid-cols-3 gap-2.5">
                  {signal.entryPrice && (
                    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                      <div className="text-[10px] text-slate-600 mb-1 uppercase tracking-wider font-medium">Entry</div>
                      <div className="text-[14px] font-mono text-white font-medium">{signal.entryPrice}</div>
                    </div>
                  )}
                  {signal.targetPrice && (
                    <div className="rounded-lg bg-emerald-500/[0.04] border border-emerald-500/[0.08] p-3">
                      <div className="text-[10px] text-emerald-500/60 mb-1 uppercase tracking-wider font-medium flex items-center gap-1"><Target className="h-2.5 w-2.5" /> Target</div>
                      <div className="text-[14px] font-mono text-emerald-400 font-medium">{signal.targetPrice}</div>
                    </div>
                  )}
                  {signal.stopLoss && (
                    <div className="rounded-lg bg-red-500/[0.04] border border-red-500/[0.08] p-3">
                      <div className="text-[10px] text-red-500/60 mb-1 uppercase tracking-wider font-medium flex items-center gap-1"><Shield className="h-2.5 w-2.5" /> Stop</div>
                      <div className="text-[14px] font-mono text-red-400 font-medium">{signal.stopLoss}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-3 py-2">
                  <Minus className="h-3.5 w-3.5 text-slate-600" />
                  <span className="text-[11px] text-slate-600">
                    {rowLive ? 'No setup yet — only live price available.' : 'No risk plan available.'}
                  </span>
                </div>
              )}

              {typeof signal.riskReward === 'number' && (
                <div className="text-[11px] text-slate-500">
                  Risk / reward: <span className="font-mono text-slate-300">{signal.riskReward.toFixed(2)}</span>
                </div>
              )}

              {!rowLive && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-500/[0.04] border border-amber-500/[0.08] px-3 py-2">
                  <WifiOff className="h-3.5 w-3.5 text-amber-400/60" />
                  <span className="text-[11px] text-amber-400/60">
                    {signal.errorReason || 'Live data unavailable for this symbol.'}
                  </span>
                </div>
              )}

              <p className="text-[12px] text-slate-500 leading-relaxed pl-0.5">{signal.reasoning}</p>

              {/* Per-row provenance — provider + data quality. */}
              <div className="flex items-center gap-3 text-[10px] text-slate-700 flex-wrap">
                {signal.provider && signal.provider !== 'Unknown' && (
                  <span>
                    <span className="text-slate-600">Source: </span>
                    <span className="text-cyan-400/60">{signal.provider}</span>
                  </span>
                )}
                {signal.dataQuality && (
                  <span>
                    <span className="text-slate-600">Quality: </span>
                    <span className={
                      signal.dataQuality === 'full'        ? 'text-emerald-400/60' :
                      signal.dataQuality === 'degraded'    ? 'text-amber-400/60'   :
                      signal.dataQuality === 'fallback'    ? 'text-amber-400/60'   :
                                                             'text-red-400/60'
                    }>{signal.dataQuality}</span>
                  </span>
                )}
                {signal.assetType && (
                  <span>
                    <span className="text-slate-600">Type: </span>
                    <span className="text-slate-400">{signal.assetType}</span>
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Live Data Unavailable State ─── */
function OfflineState({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/[0.06] border border-amber-500/10 mb-4">
          <WifiOff className="h-5 w-5 text-amber-400/60" />
        </div>
        <h3 className="text-[16px] font-semibold text-white mb-2">Live data unavailable</h3>
        <p className="text-[13px] text-slate-600 max-w-xs mb-6 leading-relaxed">
          The trading data provider is currently offline or has not been configured. Signals will appear here once the backend connection is established.
        </p>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.06] px-4 py-2.5 text-[12px] text-slate-300 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Retrying...' : 'Retry Connection'}
        </motion.button>
      </motion.div>
    </div>
  );
}

/* ─── Main Panel ─── */
export default function TradingPanel() {
  const { signals, isLive, provider, lastUpdated, isLoading, error, refresh } = useTradingSignals();
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [watchlistInput, setWatchlistInput] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Filter + search
  const filtered = useMemo(() => {
    let result = signals;
    if (activeFilter !== 'All') {
      result = result.filter((s) => s.direction === activeFilter.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    return result;
  }, [signals, activeFilter, searchQuery]);

  // Summary stats (only from real data)
  const stats = useMemo(() => {
    if (!isLive || signals.length === 0) return null;
    const scored = signals.filter((s) => typeof s.confidence === 'number') as Array<TradingSignal & { confidence: number }>;
    return {
      total: signals.length,
      long:  signals.filter((s) => s.direction === 'long').length,
      short: signals.filter((s) => s.direction === 'short').length,
      avgConfidence: scored.length > 0
        ? Math.round(scored.reduce((a, s) => a + s.confidence, 0) / scored.length)
        : null,
    };
  }, [signals, isLive]);

  // Format timestamp
  const formattedTime = useMemo(() => {
    if (!lastUpdated) return null;
    try {
      const d = new Date(lastUpdated);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return lastUpdated; }
  }, [lastUpdated]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.03]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/[0.08] border border-cyan-500/15">
            <BarChart3 className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-white">Trading Signals</span>
              {isLive ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400/60">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/40 animate-ping" style={{ animationDuration: '2s' }} />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-amber-400/60">
                  <WifiOff className="h-2.5 w-2.5" />
                  Offline
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Provider badge */}
          <span className={`text-[10px] font-semibold px-2 py-[3px] rounded-md border ${PROVIDER_COLORS[provider] || PROVIDER_COLORS.Unknown}`}>
            {provider}
          </span>
          {/* Refresh */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-600 hover:text-cyan-400 hover:bg-cyan-500/[0.06] border border-white/[0.04] transition-all disabled:opacity-40"
            title="Refresh signals"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing || isLoading ? 'animate-spin' : ''}`} />
          </motion.button>
        </div>
      </div>

      {/* Timestamp bar */}
      {formattedTime && (
        <div className="flex items-center justify-between px-5 py-1.5 border-b border-white/[0.02] bg-white/[0.005]">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-700">
            <Clock className="h-2.5 w-2.5" />
            Last updated: <span className="text-slate-500 font-mono">{formattedTime}</span>
          </div>
          {stats && (
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-slate-600">{stats.total} signals</span>
              <span className="text-emerald-400/60">{stats.long} long</span>
              <span className="text-red-400/60">{stats.short} short</span>
            </div>
          )}
        </div>
      )}

      {/* Search + Filter + Watchlist */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-white/[0.02]">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-3 py-1.5 flex-1 min-w-0 focus-within:border-cyan-500/15 transition-colors">
          <Search className="h-3 w-3 text-slate-700 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search symbols..."
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-slate-700 outline-none min-w-0"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-700 hover:text-slate-500 shrink-0">
              <AlertTriangle className="h-3 w-3" />
            </button>
          )}
        </div>
        {/* Watchlist add */}
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.015] border border-white/[0.04] px-2 py-1 focus-within:border-cyan-500/15 transition-colors shrink-0">
          <input
            type="text"
            value={watchlistInput}
            onChange={(e) => setWatchlistInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && watchlistInput.trim()) { setWatchlistInput(''); } }}
            placeholder="Add symbol..."
            className="w-20 bg-transparent text-[11px] text-white placeholder:text-slate-700 outline-none"
          />
          <button
            onClick={() => { if (watchlistInput.trim()) setWatchlistInput(''); }}
            className="text-slate-700 hover:text-cyan-400 transition-colors shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Direction filters */}
      {isLive && signals.length > 0 && (
        <div className="flex items-center gap-1 px-5 py-2 border-b border-white/[0.02]">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-all duration-150 ${
                activeFilter === f ? 'bg-white/[0.06] text-white' : 'text-slate-700 hover:text-slate-500 hover:bg-white/[0.015]'
              }`}
            >
              {f}
              {f !== 'All' && stats && (
                <span className={`ml-1 ${activeFilter === f ? 'text-slate-500' : 'text-slate-800'}`}>
                  {f === 'Long' ? stats.long : f === 'Short' ? stats.short : signals.filter((s) => s.direction === 'wait').length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader className="h-5 w-5 text-cyan-400/50 mb-3" />
            <span className="text-[11px] text-slate-600">Fetching trading signals...</span>
          </div>
        )}

        {/* Offline state */}
        {!isLoading && (!isLive || error) && (
          <OfflineState onRefresh={handleRefresh} isRefreshing={isRefreshing} />
        )}

        {/* Live signals */}
        {isLive && !isLoading && signals.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BarChart3 className="h-8 w-8 text-slate-800 mb-3" />
            <p className="text-[13px] text-slate-700 mb-1">No signals available</p>
            <p className="text-[11px] text-slate-800">Check back soon for new trading signals.</p>
          </div>
        )}

        {isLive && !isLoading && filtered.length === 0 && signals.length > 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search className="h-6 w-6 text-slate-800 mb-2" />
            <p className="text-[12px] text-slate-700">No signals match your filters</p>
          </div>
        )}

        {isLive && !isLoading && (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((signal, i) => (
                <SignalCard key={signal.id} signal={signal} index={i} panelLive={isLive} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline loader to avoid import issues
function Loader({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className || ''}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
