import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TradingSignal } from '@/types';
import { useToast } from '@/hooks/useToast';
import {
  TrendingUp, Activity, Zap,
  RefreshCw, Search, Clock, Star, ChevronRight,
  ArrowUpRight, ArrowDownRight,
  Globe, Bitcoin, Layers, Radar,
} from 'lucide-react';

// ─── Types ───
interface MarketSentiment {
  overall: 'bullish' | 'bearish' | 'neutral';
  score: number; // 0-100
  fearGreedIndex: number; // 0-100
  vix: number;
  putCallRatio: number;
  advanceDecline: number;
}

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  sparkline: number[];
  isFavorite: boolean;
  type: 'stock' | 'crypto';
}

interface TrendingAsset {
  symbol: string;
  name: string;
  volume: string;
  mentions: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  priceChange: number;
}

// ─── Mock Data ───
const DEMO_SENTIMENT: MarketSentiment = {
  overall: 'bullish',
  score: 68,
  fearGreedIndex: 72,
  vix: 14.2,
  putCallRatio: 0.82,
  advanceDecline: 1.45,
};

const DEMO_WATCHLIST: WatchlistItem[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 187.42, change: 4.27, changePercent: 2.34, sparkline: [182,183,184,183,185,186,185,187,186,187.42], isFavorite: true, type: 'stock' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 875.15, change: 22.30, changePercent: 2.61, sparkline: [850,855,860,858,865,870,868,872,870,875.15], isFavorite: true, type: 'stock' },
  { symbol: 'TSLA', name: 'Tesla Inc.', price: 248.50, change: -3.20, changePercent: -1.27, sparkline: [252,251,250,253,251,249,250,248,249,248.50], isFavorite: false, type: 'stock' },
  { symbol: 'BTC', name: 'Bitcoin', price: 67240, change: 1240, changePercent: 1.88, sparkline: [66000,65500,66200,66500,66800,67000,66600,66900,67100,67240], isFavorite: true, type: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', price: 3540, change: 87, changePercent: 2.52, sparkline: [3450,3430,3480,3490,3510,3500,3520,3510,3530,3540], isFavorite: false, type: 'crypto' },
  { symbol: 'MSFT', name: 'Microsoft', price: 421.85, change: 5.12, changePercent: 1.23, sparkline: [415,417,416,418,419,420,419,421,420,421.85], isFavorite: false, type: 'stock' },
  { symbol: 'AMD', name: 'AMD Inc.', price: 164.20, change: -2.15, changePercent: -1.29, sparkline: [167,166,165,166,164,165,163,164,165,164.20], isFavorite: false, type: 'stock' },
  { symbol: 'SOL', name: 'Solana', price: 142.60, change: 4.80, changePercent: 3.48, sparkline: [136,135,138,139,140,141,139,141,140,142.60], isFavorite: true, type: 'crypto' },
];

const DEMO_TRENDING: TrendingAsset[] = [
  { symbol: 'NVDA', name: 'NVIDIA', volume: '42.3M', mentions: 2847, sentiment: 'bullish', priceChange: 2.61 },
  { symbol: 'TSLA', name: 'Tesla', volume: '38.1M', mentions: 1923, sentiment: 'bearish', priceChange: -1.27 },
  { symbol: 'AAPL', name: 'Apple', volume: '35.7M', mentions: 1562, sentiment: 'bullish', priceChange: 2.34 },
  { symbol: 'BTC', name: 'Bitcoin', volume: '28.4B', mentions: 3421, sentiment: 'bullish', priceChange: 1.88 },
  { symbol: 'AMD', name: 'AMD', volume: '31.2M', mentions: 1245, sentiment: 'bearish', priceChange: -1.29 },
  { symbol: 'COIN', name: 'Coinbase', volume: '18.9M', mentions: 987, sentiment: 'bullish', priceChange: 3.12 },
];

const SIGNALS: TradingSignal[] = [
  { id: 's1', symbol: 'AAPL', name: 'Apple Inc.', direction: 'long', confidence: 87, setupGrade: 'A', volatility: 'medium', entryPrice: '185.15', targetPrice: '195.00', stopLoss: '180.00', timestamp: new Date(), reasoning: 'Bull flag breakout on daily with volume confirmation. RSI 58, room to run. Institutional buying detected.', sparkline: [182,183,184,183,185,186,185,187,186,187.42] },
  { id: 's2', symbol: 'NVDA', name: 'NVIDIA Corp.', direction: 'long', confidence: 92, setupGrade: 'A', volatility: 'high', entryPrice: '860.00', targetPrice: '920.00', stopLoss: '835.00', timestamp: new Date(), reasoning: 'Earnings momentum continuation. AI demand thesis intact. Break above resistance with 3x average volume.', sparkline: [850,855,860,858,865,870,868,872,870,875.15] },
  { id: 's3', symbol: 'TSLA', name: 'Tesla Inc.', direction: 'short', confidence: 64, setupGrade: 'B', volatility: 'high', entryPrice: '252.00', targetPrice: '235.00', stopLoss: '258.00', timestamp: new Date(), reasoning: 'Failed breakout above 255. Bearish divergence on MACD hourly. Increased put flow detected.', sparkline: [252,251,250,253,251,249,250,248,249,248.50] },
  { id: 's4', symbol: 'AMD', name: 'AMD Inc.', direction: 'wait', confidence: 45, setupGrade: 'C', volatility: 'medium', entryPrice: undefined, targetPrice: undefined, stopLoss: undefined, timestamp: new Date(), reasoning: 'Mixed signals. Support at 160 holding but resistance at 168 strong. Wait for decisive break.', sparkline: [167,166,165,166,164,165,163,164,165,164.20] },
];

// ─── Signal Card Component ───
function SignalCard({ signal }: { signal: TradingSignal }) {
  const [expanded, setExpanded] = useState(false);

  const dirColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    long:   { bg: 'bg-emerald-500/[0.04]',  border: 'border-emerald-500/10',  text: 'text-emerald-400',  badge: 'bg-emerald-500/[0.08] text-emerald-400' },
    short:  { bg: 'bg-red-500/[0.04]',      border: 'border-red-500/10',      text: 'text-red-400',      badge: 'bg-red-500/[0.08] text-red-400' },
    wait:   { bg: 'bg-amber-500/[0.04]',    border: 'border-amber-500/10',    text: 'text-amber-400',    badge: 'bg-amber-500/[0.08] text-amber-400' },
    neutral:{ bg: 'bg-slate-500/[0.04]',    border: 'border-slate-500/10',    text: 'text-slate-400',    badge: 'bg-slate-500/[0.08] text-slate-400' },
  };
  const colors = dirColors[signal.direction] || dirColors.neutral;

  return (
    <motion.div
      layout
      className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden`}
    >
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left">
        {/* Sparkline */}
        {signal.sparkline && (
          <div className="flex items-end gap-px h-8 w-12 shrink-0">
            {signal.sparkline.map((v, i) => {
              const min = Math.min(...signal.sparkline!);
              const max = Math.max(...signal.sparkline!);
              const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
              return (
                <div key={i} className="flex-1 rounded-sm bg-current opacity-20" style={{ height: `${Math.max(10, h)}%` }} />
              );
            })}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-white">{signal.symbol}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>{signal.direction.toUpperCase()}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${signal.setupGrade === 'A' ? 'bg-emerald-500/[0.08] text-emerald-400' : signal.setupGrade === 'B' ? 'bg-amber-500/[0.08] text-amber-400' : 'bg-slate-500/[0.08] text-slate-400'}`}>
              Grade {signal.setupGrade}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-slate-500">{signal.confidence}% confidence</span>
            <span className="text-[11px] text-slate-600 capitalize">{signal.volatility} vol</span>
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
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-white/[0.03] pt-3">
              {signal.targetPrice && signal.stopLoss && (
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

// ─── Sentiment Gauge ───
function SentimentGauge({ sentiment }: { sentiment: MarketSentiment }) {
  const sentimentColor = sentiment.overall === 'bullish' ? 'text-emerald-400' : sentiment.overall === 'bearish' ? 'text-red-400' : 'text-amber-400';
  const sentimentBg = sentiment.overall === 'bullish' ? 'bg-emerald-500/[0.06]' : sentiment.overall === 'bearish' ? 'bg-red-500/[0.06]' : 'bg-amber-500/[0.06]';

  return (
    <div className={`p-4 rounded-xl border border-white/[0.04] ${sentimentBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radar className={`w-4 h-4 ${sentimentColor}`} />
          <span className="text-[12px] font-medium text-white">Market Sentiment</span>
        </div>
        <span className={`text-[11px] font-semibold ${sentimentColor} capitalize`}>{sentiment.overall}</span>
      </div>

      {/* Overall score bar */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-[10px] text-slate-500">Bullish Score</span>
          <span className="text-[10px] text-white font-medium">{sentiment.score}/100</span>
        </div>
        <div className="w-full h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${sentiment.overall === 'bullish' ? 'bg-emerald-400' : sentiment.overall === 'bearish' ? 'bg-red-400' : 'bg-amber-400'}`}
            initial={{ width: 0 }}
            animate={{ width: `${sentiment.score}%` }}
            transition={{ duration: 1, delay: 0.2 }}
          />
        </div>
      </div>

      {/* Sub-metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02]">
          <p className="text-[9px] text-slate-600">Fear &amp; Greed</p>
          <p className={`text-[11px] font-medium ${sentiment.fearGreedIndex > 60 ? 'text-emerald-400' : sentiment.fearGreedIndex < 40 ? 'text-red-400' : 'text-amber-400'}`}>
            {sentiment.fearGreedIndex} <span className="text-slate-600">({sentiment.fearGreedIndex > 60 ? 'Greed' : sentiment.fearGreedIndex < 40 ? 'Fear' : 'Neutral'})</span>
          </p>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02]">
          <p className="text-[9px] text-slate-600">VIX</p>
          <p className="text-[11px] font-medium text-white">{sentiment.vix}</p>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02]">
          <p className="text-[9px] text-slate-600">Put/Call</p>
          <p className={`text-[11px] font-medium ${sentiment.putCallRatio < 1 ? 'text-emerald-400' : 'text-red-400'}`}>{sentiment.putCallRatio}</p>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02]">
          <p className="text-[9px] text-slate-600">A/D Ratio</p>
          <p className={`text-[11px] font-medium ${sentiment.advanceDecline > 1 ? 'text-emerald-400' : 'text-red-400'}`}>{sentiment.advanceDecline}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist Row ───
function WatchlistRow({ item, onToggleFav }: { item: WatchlistItem; onToggleFav: () => void }) {
  const isPositive = item.change >= 0;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] hover:bg-white/[0.02] transition-all group">
      <button onClick={onToggleFav} className="shrink-0">
        <Star className={`w-3.5 h-3.5 ${item.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-700 hover:text-slate-500'} transition-colors`} />
      </button>

      {/* Sparkline */}
      <div className="flex items-end gap-px h-6 w-10 shrink-0">
        {item.sparkline.map((v, i) => {
          const min = Math.min(...item.sparkline);
          const max = Math.max(...item.sparkline);
          const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
          return (
            <div key={i} className={`flex-1 rounded-sm ${isPositive ? 'bg-emerald-500/30' : 'bg-red-500/30'}`} style={{ height: `${Math.max(15, h)}%` }} />
          );
        })}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-white">{item.symbol}</span>
          <span className="text-[10px] text-slate-600">{item.name}</span>
        </div>
      </div>

      <div className="text-right shrink-0">
        <p className="text-[12px] font-medium text-white">${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        <div className={`flex items-center gap-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span className="text-[10px] font-medium">{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Trending Card ───
function TrendingCard({ asset }: { asset: TrendingAsset }) {
  const sentColor = asset.sentiment === 'bullish' ? 'text-emerald-400' : asset.sentiment === 'bearish' ? 'text-red-400' : 'text-amber-400';
  const sentBg = asset.sentiment === 'bullish' ? 'bg-emerald-500/[0.06]' : asset.sentiment === 'bearish' ? 'bg-red-500/[0.06]' : 'bg-amber-500/[0.06]';

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.03] bg-white/[0.01]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white">{asset.symbol}</span>
          <span className="text-[10px] text-slate-600">{asset.name}</span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] text-slate-500">Vol: {asset.volume}</span>
          <span className="text-[10px] text-slate-500">{asset.mentions.toLocaleString()} mentions</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${sentBg} ${sentColor} capitalize`}>{asset.sentiment}</span>
        <p className={`text-[11px] font-medium mt-1 ${asset.priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {asset.priceChange >= 0 ? '+' : ''}{asset.priceChange.toFixed(2)}%
        </p>
      </div>
    </div>
  );
}

// ─── Main Trading Panel ───
export default function TradingPanel() {
  const [activeTab, setActiveTab] = useState<'signals' | 'watchlist' | 'sentiment' | 'trending'>('signals');
  const [watchlistFilter, setWatchlistFilter] = useState<'all' | 'stocks' | 'crypto'>('all');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(DEMO_WATCHLIST);
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const { addToast } = useToast();

  const handleRefresh = () => {
    setLastRefresh(new Date());
    addToast('Trading data refreshed', 'success');
  };

  const toggleFav = (symbol: string) => {
    setWatchlist((prev) => prev.map((w) => w.symbol === symbol ? { ...w, isFavorite: !w.isFavorite } : w));
  };

  const filteredWatchlist = watchlist
    .filter((w) => watchlistFilter === 'all' || w.type === watchlistFilter)
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-white">Trading Intelligence</h2>
              <p className="text-[10px] text-slate-600">Simulated data — not financial advice</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">
              <Clock className="w-3 h-3 inline mr-1" />
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              onClick={handleRefresh}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.04] text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/[0.04] transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                activeTab === t.id ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
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
        {/* Signals Tab */}
        {activeTab === 'signals' && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-2 mb-2">
              <div className="p-3 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.04] text-center">
                <p className="text-lg font-semibold text-emerald-400">{SIGNALS.filter((s) => s.direction === 'long').length}</p>
                <p className="text-[9px] text-slate-500">Long</p>
              </div>
              <div className="p-3 rounded-xl border border-red-500/10 bg-red-500/[0.04] text-center">
                <p className="text-lg font-semibold text-red-400">{SIGNALS.filter((s) => s.direction === 'short').length}</p>
                <p className="text-[9px] text-slate-500">Short</p>
              </div>
              <div className="p-3 rounded-xl border border-amber-500/10 bg-amber-500/[0.04] text-center">
                <p className="text-lg font-semibold text-amber-400">{SIGNALS.filter((s) => s.direction === 'wait').length}</p>
                <p className="text-[9px] text-slate-500">Wait</p>
              </div>
              <div className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] text-center">
                <p className="text-lg font-semibold text-white">{Math.round(SIGNALS.reduce((a, s) => a + s.confidence, 0) / SIGNALS.length)}%</p>
                <p className="text-[9px] text-slate-500">Avg Conf</p>
              </div>
            </div>

            {/* Signal Cards */}
            <div className="space-y-2">
              {SIGNALS.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          </>
        )}

        {/* Watchlist Tab */}
        {activeTab === 'watchlist' && (
          <>
            {/* Filter + Search */}
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search symbols..."
                  className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/20 transition-all"
                />
              </div>
              <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                {(['all', 'stocks', 'crypto'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setWatchlistFilter(f)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all capitalize ${
                      watchlistFilter === f ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'stocks' ? <span className="flex items-center gap-1"><Globe className="w-2.5 h-2.5" /> Stocks</span> : <span className="flex items-center gap-1"><Bitcoin className="w-2.5 h-2.5" /> Crypto</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {filteredWatchlist.map((item) => (
                <WatchlistRow key={item.symbol} item={item} onToggleFav={() => toggleFav(item.symbol)} />
              ))}
            </div>
          </>
        )}

        {/* Sentiment Tab */}
        {activeTab === 'sentiment' && (
          <div className="space-y-3">
            <SentimentGauge sentiment={DEMO_SENTIMENT} />

            {/* Sector Sentiment */}
            <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01]">
              <h3 className="text-[12px] font-medium text-white mb-3 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-slate-500" /> Sector Sentiment
              </h3>
              {[
                { sector: 'Technology', score: 78, trend: 'up' },
                { sector: 'Healthcare', score: 62, trend: 'up' },
                { sector: 'Energy', score: 45, trend: 'down' },
                { sector: 'Finance', score: 55, trend: 'neutral' },
                { sector: 'Crypto', score: 71, trend: 'up' },
              ].map((s) => (
                <div key={s.sector} className="flex items-center gap-3 py-2 border-b border-white/[0.02] last:border-0">
                  <span className="text-[11px] text-slate-400 w-20">{s.sector}</span>
                  <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${s.score > 60 ? 'bg-emerald-400' : s.score < 40 ? 'bg-red-400' : 'bg-amber-400'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${s.score}%` }}
                      transition={{ duration: 0.8, delay: 0.1 }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 w-8 text-right">{s.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trending Tab */}
        {activeTab === 'trending' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[12px] font-medium text-white flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-slate-500" /> Trending Assets
              </h3>
              <span className="text-[10px] text-slate-600">Last 24h</span>
            </div>
            {DEMO_TRENDING.map((asset) => (
              <TrendingCard key={asset.symbol} asset={asset} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
