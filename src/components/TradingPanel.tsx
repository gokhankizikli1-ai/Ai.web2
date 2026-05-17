import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TradingSignal } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useTradingSignals } from '@/hooks/useTradingSignals';
import {
  TrendingUp, Activity, Zap,
  RefreshCw, Search, Clock, Star, ChevronRight,
  ArrowUpRight, ArrowDownRight,
  Globe, Bitcoin, AlertTriangle, Loader2, Plus, X, Sparkles,
} from 'lucide-react';

// ─── Configuration ───
// Set to true ONLY for UI development/demo. All demo data is gated here.
const DEMO_MODE = false;

// Default symbol sets the panel asks the backend for. Backend caps at 20.
const SIGNAL_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'NVDA', 'AAPL', 'TSLA', 'MSFT'];
const DEFAULT_WATCH = ['AAPL', 'NVDA', 'TSLA', 'BTCUSDT', 'ETHUSDT', 'MSFT'];
const WATCH_LS_KEY = 'korvix.watchlist.v1';

// ─── Types ───
interface WatchlistItem {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  isFavorite: boolean;
  type: 'stock' | 'crypto';
  isLive: boolean;
}

// ─── Demo Data (only used when DEMO_MODE = true) ───
const SIGNALS_DEMO: TradingSignal[] = [
  { id: 's1', symbol: 'AAPL', name: 'Apple Inc.', direction: 'long', confidence: 87, setupGrade: 'A', volatility: 'medium', entryPrice: '185.15', targetPrice: '195.00', stopLoss: '180.00', timestamp: new Date(), reasoning: 'Bull flag breakout on daily with volume confirmation.', isLive: true },
  { id: 's2', symbol: 'NVDA', name: 'NVIDIA Corp.', direction: 'long', confidence: 92, setupGrade: 'A', volatility: 'high', entryPrice: '860.00', targetPrice: '920.00', stopLoss: '835.00', timestamp: new Date(), reasoning: 'Earnings momentum continuation.', isLive: true },
];

// ─── Demo Banner ───
function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
      <span className="text-[11px] text-amber-400/70 font-medium">DEMO DATA — not live market data</span>
    </div>
  );
}

// ─── Loading State ───
function LoadingState({ label = 'Loading live market data…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <Loader2 className="h-6 w-6 text-emerald-400/70 animate-spin mb-3" />
      <p className="text-[12px] text-slate-500">{label}</p>
    </div>
  );
}

// ─── Live Data Unavailable (connection / empty) ───
function LiveDataUnavailable({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="h-12 w-12 rounded-2xl bg-slate-500/[0.04] border border-white/[0.03] flex items-center justify-center mb-4">
        <Activity className="h-5 w-5 text-slate-600" />
      </div>
      <p className="text-[13px] font-medium text-slate-400 mb-1">
        {message || 'Live market data unavailable right now.'}
      </p>
      <p className="text-[11px] text-slate-600 mb-4 max-w-xs">
        This connects to the live signals backend. It will populate as soon as data is available.
      </p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all"
      >
        <RefreshCw className="h-3 w-3" /> Retry
      </button>
    </div>
  );
}

// ─── Not Available Yet (feature not built — NOT an error) ───
function NotAvailableYet({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="h-12 w-12 rounded-2xl bg-indigo-500/[0.05] border border-indigo-500/10 flex items-center justify-center mb-4">
        <Sparkles className="h-5 w-5 text-indigo-400/70" />
      </div>
      <p className="text-[13px] font-medium text-slate-300 mb-1">{title}</p>
      <p className="text-[11px] text-slate-600 max-w-xs">{detail}</p>
    </div>
  );
}

// ─── Signal Card ───
function SignalCard({ signal }: { signal: TradingSignal }) {
  const [expanded, setExpanded] = useState(false);
  const dirColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    long:    { bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/10', text: 'text-emerald-400', badge: 'bg-emerald-500/[0.08] text-emerald-400' },
    short:   { bg: 'bg-red-500/[0.04]',     border: 'border-red-500/10',     text: 'text-red-400',     badge: 'bg-red-500/[0.08] text-red-400' },
    wait:    { bg: 'bg-amber-500/[0.04]',   border: 'border-amber-500/10',   text: 'text-amber-400',   badge: 'bg-amber-500/[0.08] text-amber-400' },
    neutral: { bg: 'bg-slate-500/[0.04]',   border: 'border-slate-500/10',   text: 'text-slate-400',   badge: 'bg-slate-500/[0.08] text-slate-400' },
  };
  const colors = dirColors[signal.direction] || dirColors.neutral;

  return (
    <motion.div layout className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-white">{signal.symbol}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>{signal.direction.toUpperCase()}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${signal.setupGrade === 'A' ? 'bg-emerald-500/[0.08] text-emerald-400' : signal.setupGrade === 'B' ? 'bg-amber-500/[0.08] text-amber-400' : 'bg-slate-500/[0.08] text-slate-400'}`}>
              Grade {signal.setupGrade}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-slate-500">{signal.confidence}% confidence</span>
            <span className="text-[11px] text-slate-600 capitalize">{signal.volatility} vol</span>
            {signal.price != null && (
              <span className="text-[11px] text-slate-400">${signal.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
            )}
          </div>
        </div>
        {signal.entryPrice && (
          <div className="text-right shrink-0">
            <p className="text-[11px] text-slate-400">Entry</p>
            <p className="text-[12px] font-medium text-white">${signal.entryPrice}</p>
          </div>
        )}
        <motion.div animate={{ rotate: expanded ? 90 : 0 }} className="shrink-0">
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </motion.div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-3 border-t border-white/[0.03] pt-3">
              {signal.entryPrice && signal.targetPrice && signal.stopLoss && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg bg-white/[0.02]">
                    <p className="text-[10px] text-slate-600">Entry</p>
                    <p className="text-[12px] font-medium text-white">${signal.entryPrice}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-500/[0.04]">
                    <p className="text-[10px] text-emerald-400/60">Target</p>
                    <p className="text-[12px] font-medium text-emerald-400">${signal.targetPrice}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-red-500/[0.04]">
                    <p className="text-[10px] text-red-400/60">Stop</p>
                    <p className="text-[12px] font-medium text-red-400">${signal.stopLoss}</p>
                  </div>
                </div>
              )}
              <p className="text-[12px] text-slate-400 leading-relaxed">{signal.reasoning}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Watchlist Row ───
function WatchlistRow({ item, onToggleFav, onRemove }: { item: WatchlistItem; onToggleFav: () => void; onRemove: () => void }) {
  const pct = item.changePercent ?? 0;
  const isPositive = pct >= 0;
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] hover:bg-white/[0.02] transition-all group">
      <button onClick={onToggleFav} className="shrink-0" title="Favorite">
        <Star className={`w-3.5 h-3.5 ${item.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-700 hover:text-slate-500'} transition-colors`} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-white">{item.symbol}</span>
          <span className="text-[10px] text-slate-600 truncate">{item.name}</span>
          {!item.isLive && <span className="text-[9px] text-slate-600 bg-white/[0.03] px-1 rounded">no data</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        {item.price != null ? (
          <>
            <p className="text-[12px] font-medium text-white">${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <div className={`flex items-center justify-end gap-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              <span className="text-[10px] font-medium">{isPositive ? '+' : ''}{pct.toFixed(2)}%</span>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-slate-600">—</p>
        )}
      </div>
      <button onClick={onRemove} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-700 hover:text-red-400" title="Remove">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Main Trading Panel ───
export default function TradingPanel() {
  const [activeTab, setActiveTab] = useState<'signals' | 'watchlist' | 'sentiment' | 'trending'>('signals');
  const [watchlistFilter, setWatchlistFilter] = useState<'all' | 'stocks' | 'crypto'>('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const { addToast } = useToast();

  // Persisted watchlist symbols.
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

  const signalsApi = useTradingSignals(DEMO_MODE ? [] : SIGNAL_SYMBOLS, '4h');
  const watchApi = useTradingSignals(DEMO_MODE ? [] : watchSymbols, '1d');

  const liveSignals = DEMO_MODE
    ? SIGNALS_DEMO
    : signalsApi.signals.filter((s) => s.isLive);

  const watchlist: WatchlistItem[] = useMemo(() => {
    const src = DEMO_MODE ? [] : watchApi.signals;
    const bySymbol = new Map(
      src.map((s) => [s.symbol.toUpperCase(), s] as [string, TradingSignal]),
    );
    return watchSymbols.map((sym) => {
      const s = bySymbol.get(sym.toUpperCase());
      const type: 'stock' | 'crypto' = s?.assetType === 'crypto' ? 'crypto' : 'stock';
      return {
        symbol: sym.toUpperCase(),
        name: s?.name || sym.toUpperCase(),
        price: s?.price ?? null,
        changePercent: s?.changePercent ?? null,
        isFavorite: favorites.includes(sym.toUpperCase()),
        type,
        isLive: !!s?.isLive,
      };
    });
  }, [watchApi.signals, watchSymbols, favorites]);

  const filteredWatchlist = watchlist
    .filter((w) => watchlistFilter === 'all' || (watchlistFilter === 'crypto' ? w.type === 'crypto' : w.type === 'stock'))
    .filter((w) => !search || w.symbol.toLowerCase().includes(search.toLowerCase()) || w.name.toLowerCase().includes(search.toLowerCase()));

  const handleRefresh = useCallback(() => {
    if (DEMO_MODE) { addToast('Demo data refreshed', 'success'); return; }
    if (activeTab === 'watchlist') watchApi.refresh();
    else signalsApi.refresh();
    addToast('Refreshing market data…', 'info');
  }, [activeTab, signalsApi, watchApi, addToast]);

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

  const tabs = [
    { id: 'signals' as const, label: 'Signals', icon: Zap },
    { id: 'watchlist' as const, label: 'Watchlist', icon: Star },
    { id: 'sentiment' as const, label: 'Sentiment', icon: Activity },
    { id: 'trending' as const, label: 'Trending', icon: TrendingUp },
  ];

  const providerLabel = activeTab === 'watchlist' ? watchApi.provider : signalsApi.provider;
  const lastUpd = activeTab === 'watchlist' ? watchApi.lastUpdated : signalsApi.lastUpdated;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-white/[0.04] bg-[#0a0a0a]/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-white">Trading Intelligence</h2>
              <p className="text-[10px] text-slate-600">
                {DEMO_MODE ? 'Simulated data — not financial advice'
                  : providerLabel !== 'Unknown' ? `Live · ${providerLabel}` : 'Live market signals'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">
              <Clock className="w-3 h-3 inline mr-1" />
              {lastUpd ? new Date(lastUpd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
            <button onClick={handleRefresh} className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.04] text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/[0.04] transition-all" title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${activeTab === t.id ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'}`}>
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
            <DemoBanner />
            {!DEMO_MODE && signalsApi.isLoading && liveSignals.length === 0 ? (
              <LoadingState />
            ) : !DEMO_MODE && signalsApi.error ? (
              <LiveDataUnavailable onRetry={signalsApi.refresh} message={signalsApi.error} />
            ) : liveSignals.length === 0 ? (
              <LiveDataUnavailable onRetry={signalsApi.refresh}
                message="No live trading signals right now." />
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <div className="p-3 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.04] text-center">
                    <p className="text-lg font-semibold text-emerald-400">{liveSignals.filter((s) => s.direction === 'long').length}</p>
                    <p className="text-[9px] text-slate-500">Long</p>
                  </div>
                  <div className="p-3 rounded-xl border border-red-500/10 bg-red-500/[0.04] text-center">
                    <p className="text-lg font-semibold text-red-400">{liveSignals.filter((s) => s.direction === 'short').length}</p>
                    <p className="text-[9px] text-slate-500">Short</p>
                  </div>
                  <div className="p-3 rounded-xl border border-amber-500/10 bg-amber-500/[0.04] text-center">
                    {/* wait + neutral (NO_TRADE) — both non-actionable; counting
                        only 'wait' left neutral cards uncounted (Bugbot Low 4deb8777). */}
                    <p className="text-lg font-semibold text-amber-400">{liveSignals.filter((s) => s.direction === 'wait' || s.direction === 'neutral').length}</p>
                    <p className="text-[9px] text-slate-500">Wait</p>
                  </div>
                  <div className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] text-center">
                    <p className="text-lg font-semibold text-white">{liveSignals.length > 0 ? Math.round(liveSignals.reduce((a, s) => a + s.confidence, 0) / liveSignals.length) : 0}%</p>
                    <p className="text-[9px] text-slate-500">Avg Conf</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {liveSignals.map((signal) => (
                    <SignalCard key={signal.id} signal={signal} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ WATCHLIST ═══ */}
        {activeTab === 'watchlist' && (
          <>
            <DemoBanner />
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSymbol(); }}
                  placeholder="Search or add ticker (Enter)…"
                  className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/20 transition-all"
                />
              </div>
              <button onClick={addSymbol} className="h-8 px-2.5 flex items-center gap-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10 text-[11px] text-emerald-400 hover:bg-emerald-500/[0.1] transition-all" title="Add to watchlist">
                <Plus className="w-3 h-3" /> Add
              </button>
              <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                {(['all', 'stocks', 'crypto'] as const).map((f) => (
                  <button key={f} onClick={() => setWatchlistFilter(f)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all capitalize ${watchlistFilter === f ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'}`}>
                    {f === 'all' ? 'All' : f === 'stocks' ? <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" /> Stocks</span> : <span className="flex items-center gap-1"><Bitcoin className="w-2.5 h-2.5" /> Crypto</span>}
                  </button>
                ))}
              </div>
            </div>
            {!DEMO_MODE && watchApi.isLoading && watchlist.every((w) => w.price == null) ? (
              <LoadingState label="Loading quotes…" />
            ) : watchSymbols.length === 0 ? (
              <NotAvailableYet title="Your watchlist is empty" detail="Add a ticker above (e.g. AAPL, NVDA, BTCUSDT) to track live quotes." />
            ) : filteredWatchlist.length === 0 ? (
              <p className="text-[11px] text-slate-600 text-center py-8">No symbols match this filter.</p>
            ) : (
              <div className="space-y-1.5">
                {filteredWatchlist.map((item) => (
                  <WatchlistRow key={item.symbol} item={item} onToggleFav={() => toggleFav(item.symbol)} onRemove={() => removeSymbol(item.symbol)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ SENTIMENT ═══ */}
        {activeTab === 'sentiment' && (
          <NotAvailableYet
            title="Market sentiment — coming soon"
            detail="Fear & Greed, put/call and sector sentiment need a dedicated data feed that isn't wired to the backend yet. We won't show simulated numbers here."
          />
        )}

        {/* ═══ TRENDING ═══ */}
        {activeTab === 'trending' && (
          <NotAvailableYet
            title="Trending assets — coming soon"
            detail="Trending requires a social/volume aggregation service that isn't connected yet. Real data will appear here once it's available."
          />
        )}
      </div>
    </div>
  );
}
