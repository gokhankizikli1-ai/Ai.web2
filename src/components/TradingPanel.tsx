import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TradingSignal } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useLanguageStore } from '@/stores/languageStore';
import { useTradingSignals } from '@/hooks/useTradingSignals';
import KorvixOrb from './KorvixOrb';
import {
  TrendingUp, Activity, Zap,
  RefreshCw, Search, Clock, Star, ChevronRight,
  ArrowUpRight, ArrowDownRight,
  Layers, Radar,
  AlertTriangle,
} from 'lucide-react';
import { ALL_ASSETS } from '@/data/tradingAssets';

// ─── Types ───
interface MarketSentiment {
  overall: 'bullish' | 'bearish' | 'neutral';
  score: number;
  fearGreedIndex: number;
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
  sparkline?: number[];
  isFavorite: boolean;
  type: 'stock' | 'crypto' | 'etf';
  is_live?: boolean;
  source?: string;
}

interface TrendingAsset {
  symbol: string;
  name: string;
  volume: string;
  mentions: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  priceChange: number;
  is_live?: boolean;
}

// ─── Demo Data ───
const DEMO_SENTIMENT: MarketSentiment = {
  overall: 'bullish',
  score: 68,
  fearGreedIndex: 72,
  vix: 14.2,
  putCallRatio: 0.82,
  advanceDecline: 1.45,
};

const DEMO_TRENDING: TrendingAsset[] = [
  { symbol: 'NVDA', name: 'NVIDIA', volume: '42.3M', mentions: 2847, sentiment: 'bullish', priceChange: 2.61, is_live: false },
  { symbol: 'TSLA', name: 'Tesla', volume: '38.1M', mentions: 1923, sentiment: 'bearish', priceChange: -1.27, is_live: false },
  { symbol: 'AAPL', name: 'Apple', volume: '35.7M', mentions: 1562, sentiment: 'bullish', priceChange: 2.34, is_live: false },
  { symbol: 'BTC', name: 'Bitcoin', volume: '28.4B', mentions: 3421, sentiment: 'bullish', priceChange: 1.88, is_live: false },
  { symbol: 'AMD', name: 'AMD', volume: '31.2M', mentions: 1245, sentiment: 'bearish', priceChange: -1.29, is_live: false },
  { symbol: 'COIN', name: 'Coinbase', volume: '18.9M', mentions: 987, sentiment: 'bullish', priceChange: 3.12, is_live: false },
];

// ─── Fallback demo signals (shown when live API is unavailable) ───
const FALLBACK_SIGNALS: TradingSignal[] = [
  { id: 's1', symbol: 'AAPL', name: 'Apple Inc.', direction: 'long', confidence: 87, setupGrade: 'A', volatility: 'medium', entryPrice: '185.15', targetPrice: '195.00', stopLoss: '180.00', timestamp: new Date(), reasoning: 'Bull flag breakout on daily with volume confirmation. RSI 58, room to run. Institutional buying detected.', sparkline: [182,183,184,183,185,186,185,187,186,187.42] },
  { id: 's2', symbol: 'NVDA', name: 'NVIDIA Corp.', direction: 'long', confidence: 92, setupGrade: 'A', volatility: 'high', entryPrice: '860.00', targetPrice: '920.00', stopLoss: '835.00', timestamp: new Date(), reasoning: 'Earnings momentum continuation. AI demand thesis intact. Break above resistance with 3x average volume.', sparkline: [850,855,860,858,865,870,868,872,870,875.15] },
  { id: 's3', symbol: 'TSLA', name: 'Tesla Inc.', direction: 'short', confidence: 64, setupGrade: 'B', volatility: 'high', entryPrice: '252.00', targetPrice: '235.00', stopLoss: '258.00', timestamp: new Date(), reasoning: 'Failed breakout above 255. Bearish divergence on MACD hourly. Increased put flow detected.', sparkline: [252,251,250,253,251,249,250,248,249,248.50] },
  { id: 's4', symbol: 'AMD', name: 'AMD Inc.', direction: 'wait', confidence: 45, setupGrade: 'C', volatility: 'medium', entryPrice: undefined, targetPrice: undefined, stopLoss: undefined, timestamp: new Date(), reasoning: 'Mixed signals. Support at 160 holding but resistance at 168 strong. Wait for decisive break.', sparkline: [167,166,165,166,164,165,163,164,165,164.20] },
];

/* ═══════════════════════════════════════════
   SKELETON COMPONENTS
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
    <div className="p-4 rounded-xl border border-white/[0.02] bg-white/[0.01] space-y-3">
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

function SentimentSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-white/[0.02] bg-white/[0.01] space-y-3">
      <div className="flex items-center justify-between">
        <SkeletonPulse className="h-4 w-32" />
        <SkeletonPulse className="h-4 w-16" />
      </div>
      <SkeletonPulse className="h-2 w-full rounded-full" />
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonPulse key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01]">
          <div className="flex-1">
            <SkeletonPulse className="h-3 w-20 mb-1" />
            <SkeletonPulse className="h-3 w-32" />
          </div>
          <SkeletonPulse className="h-3 w-10" />
          <SkeletonPulse className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

// ─── Demo Data Banner ───
function DemoBanner({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
      <span className="text-[11px] text-amber-400/70 font-medium">DEMO DATA — not live market data</span>
    </div>
  );
}

// ─── Live Data Unavailable Fallback ───
function LiveDataUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <div className="relative p-8 rounded-2xl border border-white/[0.04] bg-white/[0.015] backdrop-blur-sm max-w-sm w-full">
        {/* Subtle glow */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-24 h-24 bg-cyan-500/[0.03] rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex flex-col items-center">
          <KorvixOrb size="md" variant="idle" className="mb-5" />
          <p className="text-[14px] font-medium text-slate-300 mb-2">Live market data unavailable</p>
          <p className="text-[12px] text-slate-600 mb-6 leading-relaxed">
            Trading signals require a live market data connection. Connect your broker to see real-time signals.
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

// ─── Signal Card Component ───
function SignalCard({ signal, isLive = false }: { signal: TradingSignal; isLive?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const dirColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    long:   { bg: 'bg-emerald-500/[0.04]',  border: 'border-emerald-500/10',  text: 'text-emerald-400',  badge: 'bg-emerald-500/[0.08] text-emerald-400' },
    short:  { bg: 'bg-red-500/[0.04]',      border: 'border-red-500/10',      text: 'text-red-400',      badge: 'bg-red-500/[0.08] text-red-400' },
    wait:   { bg: 'bg-amber-500/[0.04]',    border: 'border-amber-500/10',    text: 'text-amber-400',    badge: 'bg-amber-500/[0.08] text-amber-400' },
    neutral:{ bg: 'bg-slate-500/[0.04]',    border: 'border-slate-500/10',    text: 'text-slate-400',    badge: 'bg-slate-500/[0.08] text-slate-400' },
  };
  const colors = dirColors[signal.direction] || dirColors.neutral;
  // Map provider to display label
  const providerLabel = signal.provider && signal.provider !== 'Unknown' ? signal.provider : undefined;

  return (
    <motion.div
      layout
      className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden transition-all duration-200 hover:border-opacity-20`}
    >
      {!isLive && (
        <div className="px-3 pt-2">
          <span className="text-[9px] font-medium text-amber-400/50 bg-amber-500/[0.06] border border-amber-500/10 px-1.5 py-0.5 rounded">
            DEMO DATA
          </span>
        </div>
      )}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left">
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
            {providerLabel && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/[0.08] text-cyan-400 border border-cyan-500/10">
                {providerLabel}
              </span>
            )}
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
    <div className={`p-4 rounded-xl border border-white/[0.04] ${sentimentBg} transition-all duration-200 hover:border-white/[0.06]`}>
      <div className="mb-2">
        <span className="text-[9px] font-medium text-amber-400/50 bg-amber-500/[0.06] border border-amber-500/10 px-1.5 py-0.5 rounded">
          DEMO DATA
        </span>
      </div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radar className={`w-4 h-4 ${sentimentColor}`} />
          <span className="text-[12px] font-medium text-white">Market Sentiment</span>
        </div>
        <span className={`text-[11px] font-semibold ${sentimentColor} capitalize`}>{sentiment.overall}</span>
      </div>

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
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.05] hover:bg-white/[0.02] transition-all duration-200 group">
      <button onClick={onToggleFav} className="shrink-0">
        <Star className={`w-3.5 h-3.5 ${item.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-700 hover:text-slate-500'} transition-colors`} />
      </button>

      <div className="flex items-end gap-px h-6 w-10 shrink-0">
        {item.sparkline && item.sparkline.map((v, i) => {
          const min = Math.min(...item.sparkline!);
          const max = Math.max(...item.sparkline!);
          const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
          return (
            <div key={i} className={`flex-1 rounded-sm ${isPositive ? 'bg-emerald-500/30' : 'bg-red-500/30'}`} style={{ height: `${Math.max(15, h)}%` }} />
          );
        })}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-white">{item.symbol}</span>
          <span className="text-[9px] text-amber-400/40 bg-amber-500/[0.05] px-1 rounded">DEMO</span>
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
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.04] transition-all duration-200">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-white">{asset.symbol}</span>
          <span className="text-[9px] text-amber-400/40 bg-amber-500/[0.05] px-1 rounded">DEMO</span>
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
const TIMEFRAMES = [
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
];

export default function TradingPanel() {
  const [activeTab, setActiveTab] = useState<'signals' | 'watchlist' | 'sentiment' | 'trending'>('signals');
  const [watchlistFilter, setWatchlistFilter] = useState<'all' | 'stocks' | 'crypto' | 'etfs' | 'favorites'>('all');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(
    ALL_ASSETS.map((a) => ({ ...a, isFavorite: ['AAPL', 'NVDA', 'BTC', 'ETH', 'SOL', 'SPY'].includes(a.symbol) }))
  );
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { t } = useLanguageStore();
  const [timeframe, setTimeframe] = useState(() => {
    try { return localStorage.getItem('korvix-trading-timeframe') || '1d'; }
    catch { return '1d'; }
  });
  const { addToast } = useToast();

  // Live trading signals from backend
  const { signals: apiSignals, isLive: apiIsLive, provider, refresh: refreshApi } = useTradingSignals();
  const hasLiveSignals = apiIsLive && apiSignals.length > 0;

  // Persist timeframe
  const handleTimeframeChange = (tf: string) => {
    setTimeframe(tf);
    try { localStorage.setItem('korvix-trading-timeframe', tf); } catch { /* ignore */ }
  };

  // Signals: live API data when available, fallback demo otherwise
  const signalsToShow = hasLiveSignals ? apiSignals : FALLBACK_SIGNALS;

  const handleRefresh = () => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    refreshApi();
    setTimeout(() => {
      setIsRefreshing(false);
      addToast(hasLiveSignals ? 'Trading data refreshed' : 'Demo data refreshed', 'success');
    }, 800);
  };

  const toggleFav = (symbol: string) => {
    setWatchlist((prev) => prev.map((w) => w.symbol === symbol ? { ...w, isFavorite: !w.isFavorite } : w));
  };

  const filteredWatchlist = watchlist
    .filter((w) => {
      if (watchlistFilter === 'all') return true;
      if (watchlistFilter === 'favorites') return w.isFavorite;
      if (watchlistFilter === 'etfs') return ['SPY','QQQ','ARKK'].includes(w.symbol);
      return w.type === watchlistFilter;
    })
    .filter((w) => !search || w.symbol.toLowerCase().includes(search.toLowerCase()) || w.name.toLowerCase().includes(search.toLowerCase()));

  const tabs = [
    { id: 'signals' as const, label: t('signals'), icon: Zap },
    { id: 'watchlist' as const, label: t('watchlist'), icon: Star },
    { id: 'sentiment' as const, label: t('sentiment'), icon: Activity },
    { id: 'trending' as const, label: t('trending'), icon: TrendingUp },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-white/[0.04] bg-[#0a0a0a]/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10 shadow-[0_0_8px_-2px_rgba(52,211,153,0.06)]">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              {/* Live pulse dot */}
              {hasLiveSignals && (
                <motion.div
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ boxShadow: '0 0 4px rgba(52,211,153,0.5)' }}
                />
              )}
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-white">Trading Intelligence</h2>
              <p className="text-[10px] text-slate-600">
                {hasLiveSignals
                  ? `Live market signals${provider && provider !== 'Unknown' ? ` · ${provider}` : ''}`
                  : 'Simulated data — not financial advice'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">
              <Clock className="w-3 h-3 inline mr-1" />
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <motion.button
              onClick={handleRefresh}
              animate={{ rotate: isRefreshing ? 360 : 0 }}
              transition={{ duration: 0.8, ease: 'linear' }}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.04] text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/[0.04] transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[9px] text-slate-700 uppercase tracking-wider mr-1">{t('timeframe')}</span>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => handleTimeframeChange(tf.value)}
              className={`px-2 py-[2px] rounded text-[10px] font-medium transition-all ${
                timeframe === tf.value
                  ? 'bg-emerald-500/[0.08] text-emerald-400 border border-emerald-500/15'
                  : 'text-slate-600 hover:text-slate-400 border border-transparent'
              }`}
            >
              {tf.label}
            </button>
          ))}
          <span className="ml-auto text-[9px] text-slate-700 tabular-nums">{timeframe}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${
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
        {/* ═══ SIGNALS TAB ═══ */}
        {activeTab === 'signals' && (
          <>
            <DemoBanner show={!hasLiveSignals} />
            {isRefreshing ? (
              <div className="space-y-3">
                <SignalCardSkeleton />
                <SignalCardSkeleton />
                <SignalCardSkeleton />
              </div>
            ) : hasLiveSignals && signalsToShow.length === 0 ? (
              <LiveDataUnavailable onRetry={handleRefresh} />
            ) : (
              <>
                {/* Summary stats */}
                <div className="grid grid-cols-4 gap-2 mb-2">
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
                    <p className="text-[9px] text-slate-500">Hold</p>
                  </div>
                  <div className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] text-center">
                    <p className="text-lg font-semibold text-white">{signalsToShow.length > 0 ? Math.round(signalsToShow.reduce((a, s) => a + s.confidence, 0) / signalsToShow.length) : 0}%</p>
                    <p className="text-[9px] text-slate-500">Avg Conf</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {signalsToShow.map((signal) => (
                    <SignalCard key={signal.id} signal={signal} isLive={hasLiveSignals} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ WATCHLIST TAB ═══ */}
        {activeTab === 'watchlist' && (
          <>
            <DemoBanner />
            {isRefreshing ? (
              <WatchlistSkeleton />
            ) : false ? (
              <LiveDataUnavailable onRetry={handleRefresh} />
            ) : (
              <>
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
                    {(['all', 'stocks', 'crypto', 'etfs', 'favorites'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setWatchlistFilter(f)}
                        className={`px-2 py-[3px] rounded text-[10px] font-medium transition-all ${
                          watchlistFilter === f ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        {f === 'etfs' ? t('etf') : f === 'favorites' ? t('favorite') : f === 'all' ? t('all') : f === 'stocks' ? t('stocks') : f === 'crypto' ? t('crypto') : f}
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
          </>
        )}

        {/* ═══ SENTIMENT TAB ═══ */}
        {activeTab === 'sentiment' && (
          <>
            {isRefreshing ? (
              <SentimentSkeleton />
            ) : false ? (
              <LiveDataUnavailable onRetry={handleRefresh} />
            ) : (
              <div className="space-y-3">
                <DemoBanner show />
                <SentimentGauge sentiment={DEMO_SENTIMENT} />

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
          </>
        )}

        {/* ═══ TRENDING TAB ═══ */}
        {activeTab === 'trending' && (
          <>
            <DemoBanner show />
            {isRefreshing ? (
              <TrendingSkeleton />
            ) : false ? (
              <LiveDataUnavailable onRetry={handleRefresh} />
            ) : (
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
          </>
        )}
      </div>
    </div>
  );
}
