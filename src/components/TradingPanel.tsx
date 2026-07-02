import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TradingSignal } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useLanguageStore } from '@/stores/languageStore';
import { useTradingSignals } from '@/hooks/useTradingSignals';
import {
  TrendingUp, Activity, Zap, RefreshCw, Search, Clock, Star,
  ChevronRight, ArrowUpRight, ArrowDownRight, Layers, Radar,
  AlertTriangle, BarChart3, Shield, Target, Crosshair,
  TrendingDown, Minus, Plus, Eye, Sparkles,
} from 'lucide-react';
import { ALL_ASSETS } from '@/data/tradingAssets';

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

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
  sparkline: number[];
  isFavorite: boolean;
  type: 'stock' | 'crypto' | 'etf';
}

interface MockSignal extends TradingSignal {
  riskLevel: 'Low' | 'Medium' | 'High';
  timeframe: string;
  tags: string[];
  scenario: 'bullish' | 'neutral' | 'bearish';
}

// ═══════════════════════════════════════════
// MOCK DATA — Premium AI Signals (frontend-only)
// ═══════════════════════════════════════════

const MOCK_SIGNALS: MockSignal[] = [
  {
    id: 'mock-1', symbol: 'NVDA', name: 'NVIDIA Corp', direction: 'long', confidence: 84,
    setupGrade: 'A', volatility: 'medium', entryPrice: '142.20', targetPrice: '151.00', stopLoss: '136.50',
    timestamp: new Date(), reasoning: 'Momentum improving with volume confirmation. RSI breakout above 60 with MACD bullish crossover. Institutional accumulation detected.',
    provider: 'Finnhub', sparkline: [138, 139.5, 140.2, 139.8, 141, 142.5, 141.8, 143, 142.2, 144, 143.5, 142.8, 143.2, 142.5, 141.8],
    riskLevel: 'Medium', timeframe: '1D', tags: ['breakout', 'volume', 'RSI'], scenario: 'bullish',
  },
  {
    id: 'mock-2', symbol: 'AAPL', name: 'Apple Inc.', direction: 'long', confidence: 72,
    setupGrade: 'B', volatility: 'low', entryPrice: '213.07', targetPrice: '220.00', stopLoss: '208.00',
    timestamp: new Date(), reasoning: 'Consolidation breakout near all-time highs. Strong support at 50-day EMA. Services revenue growth trajectory remains intact.',
    provider: 'Finnhub', sparkline: [208, 209, 210.5, 211, 212.5, 211.8, 213, 212.5, 213.5, 214, 213.8, 214.2, 213.5, 213, 213.07],
    riskLevel: 'Low', timeframe: '4h', tags: ['trend', 'support'], scenario: 'bullish',
  },
  {
    id: 'mock-3', symbol: 'TSLA', name: 'Tesla Inc.', direction: 'short', confidence: 68,
    setupGrade: 'B', volatility: 'high', entryPrice: '248.50', targetPrice: '235.00', stopLoss: '255.00',
    timestamp: new Date(), reasoning: 'Bearish engulfing pattern on daily. Volume divergence suggests weakening momentum. Key resistance rejection at $252.',
    provider: 'Finnhub', sparkline: [255, 254, 252.5, 253, 251, 250, 251.5, 249, 250.5, 248, 249.5, 247, 248.5, 249, 248.5],
    riskLevel: 'High', timeframe: '1D', tags: ['reversal', 'volume'], scenario: 'bearish',
  },
  {
    id: 'mock-4', symbol: 'BTC', name: 'Bitcoin', direction: 'long', confidence: 78,
    setupGrade: 'A', volatility: 'high', entryPrice: '67890', targetPrice: '72000', stopLoss: '64500',
    timestamp: new Date(), reasoning: 'ETF inflows accelerating. Hash rate at all-time high indicates strong network fundamentals. Breakout above $67.5K resistance zone.',
    provider: 'CoinGecko', sparkline: [65000, 65500, 66200, 65800, 66500, 67000, 66800, 67200, 67500, 67000, 67800, 67600, 67900, 67700, 67890],
    riskLevel: 'Medium', timeframe: '1D', tags: ['breakout', 'ETF', 'momentum'], scenario: 'bullish',
  },
  {
    id: 'mock-5', symbol: 'ETH', name: 'Ethereum', direction: 'long', confidence: 65,
    setupGrade: 'B', volatility: 'medium', entryPrice: '3520', targetPrice: '3800', stopLoss: '3350',
    timestamp: new Date(), reasoning: 'Staking yield attractive vs. DeFi rates. Layer-2 adoption driving network usage. Support holding at $3.4K.',
    provider: 'CoinGecko', sparkline: [3400, 3420, 3450, 3430, 3480, 3500, 3490, 3510, 3500, 3525, 3530, 3515, 3525, 3518, 3520],
    riskLevel: 'Medium', timeframe: '4h', tags: ['staking', 'L2'], scenario: 'bullish',
  },
  {
    id: 'mock-6', symbol: 'AMD', name: 'AMD', direction: 'neutral', confidence: 52,
    setupGrade: 'C', volatility: 'medium', entryPrice: '162.80', targetPrice: undefined, stopLoss: undefined,
    timestamp: new Date(), reasoning: 'Mixed signals. AI revenue growth positive but data center competition intensifying. Wait for clearer directional setup.',
    provider: 'Finnhub', sparkline: [160, 161, 162, 161.5, 163, 164, 163.5, 162.5, 163, 162, 163.5, 163, 162.8, 163, 162.8],
    riskLevel: 'Medium', timeframe: '1D', tags: ['mixed', 'consolidation'], scenario: 'neutral',
  },
  {
    id: 'mock-7', symbol: 'SOL', name: 'Solana', direction: 'long', confidence: 71,
    setupGrade: 'B', volatility: 'high', entryPrice: '142.30', targetPrice: '155.00', stopLoss: '134.00',
    timestamp: new Date(), reasoning: 'DeFi TVL growth accelerating. Network uptime stabilized. Strong developer activity with increasing dApp deployments.',
    provider: 'CoinGecko', sparkline: [135, 136, 138, 137, 139, 140, 141, 140.5, 142, 143, 142.5, 141.5, 142, 143, 142.3],
    riskLevel: 'High', timeframe: '1D', tags: ['DeFi', 'momentum'], scenario: 'bullish',
  },
  {
    id: 'mock-8', symbol: 'META', name: 'Meta Platforms', direction: 'long', confidence: 76,
    setupGrade: 'A', volatility: 'low', entryPrice: '485.20', targetPrice: '510.00', stopLoss: '472.00',
    timestamp: new Date(), reasoning: 'AI investments showing ROI in ad targeting efficiency. Reality Labs losses narrowing. Strong free cash flow generation.',
    provider: 'Finnhub', sparkline: [470, 472, 475, 478, 480, 482, 480, 483, 485, 484, 486, 485.5, 487, 486, 485.2],
    riskLevel: 'Low', timeframe: '1W', tags: ['AI', 'fundamentals'], scenario: 'bullish',
  },
  {
    id: 'mock-9', symbol: 'SOUN', name: 'SoundHound AI', direction: 'long', confidence: 61,
    setupGrade: 'B', volatility: 'high', entryPrice: '8.42', targetPrice: '11.50', stopLoss: '6.80',
    timestamp: new Date(), reasoning: 'Voice AI partnership announcements driving interest. Small cap with high beta. Monitor for volatility expansion.',
    provider: 'Finnhub', sparkline: [7.8, 8.0, 8.2, 8.1, 8.5, 8.3, 8.6, 8.4, 8.7, 8.5, 8.6, 8.4, 8.5, 8.3, 8.42],
    riskLevel: 'High', timeframe: '1D', tags: ['momentum', 'small-cap'], scenario: 'bullish',
  },
  {
    id: 'mock-10', symbol: 'PLTR', name: 'Palantir', direction: 'long', confidence: 69,
    setupGrade: 'B', volatility: 'medium', entryPrice: '62.40', targetPrice: '70.00', stopLoss: '57.00',
    timestamp: new Date(), reasoning: 'Government contract renewals strong. AIP commercial adoption accelerating. Profitability inflection point reached.',
    provider: 'Finnhub', sparkline: [58, 59, 60, 59.5, 61, 62, 61.5, 62.5, 63, 62.8, 63.5, 62.5, 62.8, 62.2, 62.4],
    riskLevel: 'Medium', timeframe: '4h', tags: ['AI', 'government'], scenario: 'bullish',
  },
];

const DEMO_SENTIMENT: MarketSentiment = {
  overall: 'bullish', score: 68, fearGreedIndex: 72, vix: 14.2, putCallRatio: 0.82, advanceDecline: 1.45,
};

// ═══════════════════════════════════════════
// WATCHLIST PERSISTENCE
// ═══════════════════════════════════════════

const WATCHLIST_KEY = 'korvix_watchlist';

function loadWatchlistSymbols(): string[] {
  try { const s = localStorage.getItem(WATCHLIST_KEY); return s ? JSON.parse(s) : ['AAPL','NVDA','BTC','ETH','SOL','SPY','TSLA','MSFT']; }
  catch { return ['AAPL','NVDA','BTC','ETH','SOL','SPY','TSLA','MSFT']; }
}

function saveWatchlistSymbols(symbols: string[]) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols)); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════
// TIMEFRAMES
// ═══════════════════════════════════════════

const TIMEFRAMES = [
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
];

// ═══════════════════════════════════════════
// SKELETON COMPONENTS
// ═══════════════════════════════════════════

function SkeletonPulse({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-white/[0.02] ${className}`}>
      <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
        animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }} />
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

function ChartSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] space-y-4">
      <div className="flex items-center justify-between">
        <SkeletonPulse className="h-4 w-32" />
        <SkeletonPulse className="h-4 w-20" />
      </div>
      <SkeletonPulse className="h-[160px] w-full rounded-lg" />
      <div className="flex gap-2">
        <SkeletonPulse className="h-6 w-16" />
        <SkeletonPulse className="h-6 w-16" />
        <SkeletonPulse className="h-6 w-16 ml-auto" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// MINI SPARKLINE
// ═══════════════════════════════════════════

function MiniSparkline({ price, isPositive }: { price: number; isPositive: boolean }) {
  const data = useMemo(() => generateSparkline(price, 12), [price]);
  const min = Math.min(...data);
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-px h-8 w-16">
      {data.map((v, i) => {
        const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
        return <div key={i} className={`flex-1 rounded-sm ${isPositive ? 'bg-[#4ADE80]/20' : 'bg-[#F87171]/20'}`} style={{ height: `${Math.max(10, h)}%` }} />;
      })}
    </div>
  );
}

// ═══════════════════════════════════════════
// SPARKLINE GENERATOR
// ═══════════════════════════════════════════

function generateSparkline(basePrice: number, points: number = 15): number[] {
  const data: number[] = [basePrice];
  for (let i = 1; i < points; i++) {
    const change = (Math.random() - 0.48) * basePrice * 0.02;
    data.push(Math.max(basePrice * 0.9, data[i - 1] + change));
  }
  return data;
}

// ═══════════════════════════════════════════
// CONFIDENCE METER
// ═══════════════════════════════════════════

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const color = confidence >= 75 ? 'bg-[#4ADE80]' : confidence >= 50 ? 'bg-[#FACC15]' : 'bg-[#F87171]';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
        <motion.div className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }} animate={{ width: `${confidence}%` }} transition={{ duration: 0.8, delay: 0.2 }} />
      </div>
      <span className={`text-[10px] font-semibold tabular-nums ${confidence >= 75 ? 'text-[#4ADE80]' : confidence >= 50 ? 'text-[#FACC15]' : 'text-[#F87171]'}`}>
        {confidence}%
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
// RISK BADGE
// ═══════════════════════════════════════════

function RiskBadge({ level }: { level: 'Low' | 'Medium' | 'High' }) {
  const colors = {
    Low: { bg: 'bg-[#4ADE80]/[0.06]', text: 'text-[#4ADE80]', border: 'border-[#4ADE80]/10' },
    Medium: { bg: 'bg-[#FACC15]/[0.06]', text: 'text-[#FACC15]', border: 'border-[#FACC15]/10' },
    High: { bg: 'bg-[#F87171]/[0.06]', text: 'text-[#F87171]', border: 'border-[#F87171]/10' },
  };
  const c = colors[level];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium ${c.bg} ${c.text} border ${c.border}`}>
      <Shield className="w-2.5 h-2.5" />
      {level} Risk
    </span>
  );
}

// ═══════════════════════════════════════════
// SCENARIO CHIP
// ═══════════════════════════════════════════

function ScenarioChip({ scenario }: { scenario: 'bullish' | 'neutral' | 'bearish' }) {
  const config = {
    bullish: { icon: TrendingUp, color: 'text-[#4ADE80]', bg: 'bg-[#4ADE80]/[0.06]', border: 'border-[#4ADE80]/10', label: 'Bullish' },
    neutral: { icon: Minus, color: 'text-[#FACC15]', bg: 'bg-[#FACC15]/[0.06]', border: 'border-[#FACC15]/10', label: 'Neutral' },
    bearish: { icon: TrendingDown, color: 'text-[#F87171]', bg: 'bg-[#F87171]/[0.06]', border: 'border-[#F87171]/10', label: 'Bearish' },
  };
  const c = config[scenario];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${c.bg} ${c.color} border ${c.border}`}>
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}

// ═══════════════════════════════════════════
// SIGNAL TAG
// ═══════════════════════════════════════════

function SignalTag({ tag }: { tag: string }) {
  return (
    <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/[0.03] text-[#858B99] border border-white/[0.04] hover:text-[#B6BBC6] hover:border-white/[0.06] transition-colors cursor-default">
      {tag}
    </span>
  );
}

// ═══════════════════════════════════════════
// PREMIUM SIGNAL CARD
// ═══════════════════════════════════════════

function PremiumSignalCard({ signal }: { signal: MockSignal }) {
  const [expanded, setExpanded] = useState(false);
  const dirColors = {
    long: { bg: 'bg-[#4ADE80]/[0.04]', border: 'border-[#4ADE80]/10', text: 'text-[#4ADE80]', badge: 'bg-[#4ADE80]/[0.08] text-[#4ADE80]', icon: ArrowUpRight },
    short: { bg: 'bg-[#F87171]/[0.04]', border: 'border-[#F87171]/10', text: 'text-[#F87171]', badge: 'bg-[#F87171]/[0.08] text-[#F87171]', icon: ArrowDownRight },
    wait: { bg: 'bg-[#FACC15]/[0.04]', border: 'border-[#FACC15]/10', text: 'text-[#FACC15]', badge: 'bg-[#FACC15]/[0.08] text-[#FACC15]', icon: Minus },
    neutral: { bg: 'bg-slate-500/[0.04]', border: 'border-slate-500/10', text: 'text-[#B6BBC6]', badge: 'bg-slate-500/[0.08] text-[#B6BBC6]', icon: Minus },
  };
  const colors = dirColors[signal.direction] || dirColors.neutral;
  const DirIcon = colors.icon;

  return (
    <motion.div layout
      className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden transition-all duration-200 hover:border-opacity-30`}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {/* Header Row */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left">
        {/* Sparkline */}
        {signal.sparkline && (
          <div className="hidden sm:flex items-end gap-px h-8 w-12 shrink-0">
            {signal.sparkline.map((v, i) => {
              const min = Math.min(...signal.sparkline!);
              const max = Math.max(...signal.sparkline!);
              const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
              return <div key={i} className={`flex-1 rounded-sm ${signal.direction === 'long' ? 'bg-[#4ADE80]/25' : signal.direction === 'short' ? 'bg-[#F87171]/25' : 'bg-[#FACC15]/20'}`} style={{ height: `${Math.max(10, h)}%` }} />;
            })}
          </div>
        )}

        {/* Main Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-white">{signal.symbol}</span>
            <span className="text-[10px] text-[#858B99]">{signal.name}</span>
            <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>
              <DirIcon className="w-2.5 h-2.5" />
              {signal.direction.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <RiskBadge level={signal.riskLevel} />
            <span className="text-[10px] text-[#858B99]">{signal.timeframe}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${signal.setupGrade === 'A' ? 'bg-[#4ADE80]/[0.08] text-[#4ADE80]' : signal.setupGrade === 'B' ? 'bg-[#FACC15]/[0.08] text-[#FACC15]' : 'bg-slate-500/[0.08] text-[#B6BBC6]'}`}>
              Grade {signal.setupGrade}
            </span>
          </div>
        </div>

        {/* Price Column */}
        <div className="text-right shrink-0 hidden sm:block">
          <ConfidenceMeter confidence={signal.confidence} />
          {signal.entryPrice && <p className="text-[10px] text-[#858B99] mt-1">Entry <span className="text-white/70">${signal.entryPrice}</span></p>}
        </div>

        <motion.div animate={{ rotate: expanded ? 90 : 0 }} className="shrink-0">
          <ChevronRight className="w-4 h-4 text-[#858B99]" />
        </motion.div>
      </button>

      {/* Expanded Detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-3 border-t border-white/[0.03] pt-3">
              {/* Entry / Target / Stop */}
              {signal.entryPrice && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                    <div className="flex items-center gap-1 mb-1">
                      <Crosshair className="w-3 h-3 text-[#858B99]" />
                      <p className="text-[9px] text-[#858B99]">Entry</p>
                    </div>
                    <p className="text-[13px] font-semibold text-white">${signal.entryPrice}</p>
                  </div>
                  {signal.targetPrice && (
                    <div className="p-2.5 rounded-lg bg-[#4ADE80]/[0.04] border border-[#4ADE80]/10">
                      <div className="flex items-center gap-1 mb-1">
                        <Target className="w-3 h-3 text-[#4ADE80]/60" />
                        <p className="text-[9px] text-[#4ADE80]/60">Target</p>
                      </div>
                      <p className="text-[13px] font-semibold text-[#4ADE80]">${signal.targetPrice}</p>
                    </div>
                  )}
                  {signal.stopLoss && (
                    <div className="p-2.5 rounded-lg bg-[#F87171]/[0.04] border border-[#F87171]/10">
                      <div className="flex items-center gap-1 mb-1">
                        <Shield className="w-3 h-3 text-[#F87171]/60" />
                        <p className="text-[9px] text-[#F87171]/60">Stop</p>
                      </div>
                      <p className="text-[13px] font-semibold text-[#F87171]">${signal.stopLoss}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Confidence + Scenario */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#858B99]">Confidence</span>
                  <ConfidenceMeter confidence={signal.confidence} />
                </div>
                <ScenarioChip scenario={signal.scenario} />
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1">
                {signal.tags.map(tag => <SignalTag key={tag} tag={tag} />)}
              </div>

              {/* Reasoning */}
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="w-3 h-3 text-[#8B5CF6]/50" />
                  <span className="text-[10px] text-[#858B99]">AI Analysis</span>
                </div>
                <p className="text-[11px] text-[#B6BBC6] leading-relaxed">{signal.reasoning}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════
// WATCHLIST ROW
// ═══════════════════════════════════════════

function WatchlistRow({ item, onToggleFav, onToggleWatchlist, inWatchlist }: {
  item: WatchlistItem; onToggleFav: () => void; onToggleWatchlist: () => void; inWatchlist: boolean;
}) {
  const isPositive = item.change >= 0;
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.05] hover:bg-white/[0.02] transition-all duration-200 group">
      <button onClick={onToggleFav} className="shrink-0">
        <Star className={`w-3.5 h-3.5 ${item.isFavorite ? 'text-[#FACC15] fill-[#FACC15]' : 'text-[#858B99] hover:text-[#858B99]'} transition-colors`} />
      </button>

      {/* Sparkline */}
      <div className="hidden sm:flex items-end gap-px h-6 w-10 shrink-0">
        {item.sparkline.map((v, i) => {
          const min = Math.min(...item.sparkline);
          const max = Math.max(...item.sparkline);
          const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
          return <div key={i} className={`flex-1 rounded-sm ${isPositive ? 'bg-[#4ADE80]/25' : 'bg-[#F87171]/25'}`} style={{ height: `${Math.max(15, h)}%` }} />;
        })}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-white">{item.symbol}</span>
          <span className="text-[10px] text-[#858B99] truncate">{item.name}</span>
        </div>
      </div>

      <div className="text-right shrink-0">
        <p className="text-[12px] font-medium text-white">${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        <div className={`flex items-center gap-0.5 ${isPositive ? 'text-[#4ADE80]' : 'text-[#F87171]'}`}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          <span className="text-[10px] font-medium">{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</span>
        </div>
      </div>

      <button onClick={onToggleWatchlist}
        className={`shrink-0 p-1.5 rounded-lg transition-all ${inWatchlist ? 'bg-[#4ADE80]/[0.08] text-[#4ADE80] border border-[#4ADE80]/15' : 'text-slate-700 hover:text-[#858B99] border border-transparent'}`}
        title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}>
        {inWatchlist ? <Eye className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════
// SENTIMENT GAUGE
// ═══════════════════════════════════════════

function SentimentGauge({ sentiment }: { sentiment: MarketSentiment }) {
  const sentimentColor = sentiment.overall === 'bullish' ? 'text-[#4ADE80]' : sentiment.overall === 'bearish' ? 'text-[#F87171]' : 'text-[#FACC15]';
  const sentimentBg = sentiment.overall === 'bullish' ? 'bg-[#4ADE80]/[0.06]' : sentiment.overall === 'bearish' ? 'bg-[#F87171]/[0.06]' : 'bg-[#FACC15]/[0.06]';

  return (
    <div className={`p-4 rounded-xl border border-white/[0.04] ${sentimentBg} transition-all duration-200 hover:border-white/[0.06]`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radar className={`w-4 h-4 ${sentimentColor}`} />
          <span className="text-[12px] font-semibold text-white">Market Sentiment</span>
        </div>
        <ScenarioChip scenario={sentiment.overall} />
      </div>

      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-[10px] text-[#858B99]">Bullish Score</span>
          <span className="text-[10px] text-white font-medium">{sentiment.score}/100</span>
        </div>
        <div className="w-full h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
          <motion.div className={`h-full rounded-full ${sentiment.overall === 'bullish' ? 'bg-[#4ADE80]' : sentiment.overall === 'bearish' ? 'bg-[#F87171]' : 'bg-[#FACC15]'}`}
            initial={{ width: 0 }} animate={{ width: `${sentiment.score}%` }} transition={{ duration: 1, delay: 0.2 }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(() => {
          const items = [
            { label: 'Fear & Greed', value: sentiment.fearGreedIndex, display: `${sentiment.fearGreedIndex} (${sentiment.fearGreedIndex > 60 ? 'Greed' : sentiment.fearGreedIndex < 40 ? 'Fear' : 'Neutral'})`, color: sentiment.fearGreedIndex > 60 ? 'text-[#4ADE80]' : sentiment.fearGreedIndex < 40 ? 'text-[#F87171]' : 'text-[#FACC15]' },
            { label: 'VIX', value: sentiment.vix, display: `${sentiment.vix}`, color: 'text-white' },
            { label: 'Put/Call', value: sentiment.putCallRatio, display: `${sentiment.putCallRatio}`, color: sentiment.putCallRatio < 1 ? 'text-[#4ADE80]' : 'text-[#F87171]' },
            { label: 'A/D Ratio', value: sentiment.advanceDecline, display: `${sentiment.advanceDecline}`, color: sentiment.advanceDecline > 1 ? 'text-[#4ADE80]' : 'text-[#F87171]' },
          ];
          return items.map(m => (
            <div key={m.label} className="p-2 rounded-lg bg-white/[0.02]">
              <p className="text-[9px] text-[#858B99]">{m.label}</p>
              <p className={`text-[11px] font-semibold ${m.color}`}>{m.display}</p>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// CHART PLACEHOLDER
// ═══════════════════════════════════════════

function ChartPlaceholder({ symbol, timeframe, isLoading }: { symbol?: string; timeframe: string; isLoading: boolean }) {
  if (isLoading) {
    return <ChartSkeleton />;
  }

  const tfLabel = TIMEFRAMES.find(t => t.value === timeframe)?.label || timeframe;

  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#858B99]" />
          <span className="text-[12px] font-medium text-white">{symbol || 'Market Overview'}</span>
          <span className="text-[9px] text-[#858B99]">{tfLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
          <span className="text-[9px] text-[#858B99]">AI analyzing</span>
        </div>
      </div>

      {/* Skeleton chart visual */}
      <div className="h-[160px] rounded-lg bg-white/[0.02] border border-white/[0.03] relative overflow-hidden flex items-end justify-center gap-px px-4 pb-4 pt-8">
        {Array.from({ length: 40 }).map((_, i) => {
          const h = 20 + Math.sin(i * 0.4) * 30 + Math.random() * 40;
          return (
            <motion.div key={i} className="flex-1 rounded-sm bg-[#4ADE80]/10"
              initial={{ height: 0 }} animate={{ height: `${h}%` }}
              transition={{ duration: 0.5, delay: i * 0.01 }} />
          );
        })}
        {/* Overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <Sparkles className="w-6 h-6 text-[#8B5CF6]/30 mx-auto mb-2" />
            <p className="text-[11px] text-[#858B99]">Premium chart coming soon</p>
            <p className="text-[9px] text-slate-700 mt-0.5">Real-time market data integration in progress</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#858B99]">Provider:</span>
        <span className="text-[10px] text-[#B6BBC6]">AI-generated market intelligence</span>
        <span className="ml-auto text-[9px] text-slate-700 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Not financial advice
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════

function EmptySignalsState() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
        <Radar className="w-5 h-5 text-[#858B99]" />
      </div>
      <p className="text-[13px] font-medium text-[#B6BBC6] mb-1">No signals yet</p>
      <p className="text-[11px] text-[#858B99] max-w-xs">Add assets to your watchlist to generate AI trading signals. Our engine analyzes price action, volume, and momentum patterns.</p>
    </motion.div>
  );
}

// ═══════════════════════════════════════════
// DELAYED DATA BADGE
// ═══════════════════════════════════════════

function DelayedDataBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-[#FACC15]/[0.06] text-[#FACC15] border border-[#FACC15]/10">
      <Clock className="w-2.5 h-2.5" />
      Delayed data
    </span>
  );
}

// ═══════════════════════════════════════════
// MARKET STATUS
// ═══════════════════════════════════════════

function MarketStatus({ isOpen }: { isOpen: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium ${isOpen ? 'bg-[#4ADE80]/[0.06] text-[#4ADE80] border border-[#4ADE80]/10' : 'bg-slate-500/[0.06] text-[#B6BBC6] border border-slate-500/10'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-[#4ADE80]' : 'bg-slate-500'}`} />
      {isOpen ? 'Market Open' : 'Market Closed'}
    </span>
  );
}

// ═══════════════════════════════════════════
// MAIN TRADING PANEL
// ═══════════════════════════════════════════

export default function TradingPanel() {
  const [activeTab, setActiveTab] = useState<'signals' | 'watchlist' | 'sentiment' | 'assets'>('signals');
  const [assetCategory, setAssetCategory] = useState<'stocks' | 'crypto' | 'watchlist'>('stocks');
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { t } = useLanguageStore();
  const { addToast } = useToast();

  // Watchlist state with persistence
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(loadWatchlistSymbols);
  const [favorites, setFavorites] = useState<string[]>(['AAPL', 'NVDA', 'BTC', 'ETH']);

  // Timeframe
  const [timeframe, setTimeframe] = useState(() => {
    try { return localStorage.getItem('korvix-trading-timeframe') || '1d'; }
    catch { return '1d'; }
  });

  // API signals
  const { signals: apiSignals, isLive: apiIsLive, provider, isLoading: apiLoading, refresh: refreshApi } = useTradingSignals({ timeframe });
  const hasLiveSignals = apiIsLive && apiSignals.length > 0;

  // Use mock signals when no live data (frontend-only)
  const displaySignals: MockSignal[] = useMemo(() => {
    if (hasLiveSignals) {
      return apiSignals.map(s => ({
        ...s, riskLevel: s.confidence > 70 ? 'Medium' : 'High' as 'Low' | 'Medium' | 'High',
        timeframe: timeframe, tags: ['volume', 'momentum'],
        scenario: (s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : 'neutral') as 'bullish' | 'neutral' | 'bearish',
      }));
    }
    return MOCK_SIGNALS;
  }, [hasLiveSignals, apiSignals, timeframe]);

  // Filter signals by watchlist if needed
  const filteredSignals = useMemo(() => {
    if (activeTab === 'watchlist') {
      return displaySignals.filter(s => watchlistSymbols.includes(s.symbol));
    }
    return displaySignals;
  }, [displaySignals, activeTab, watchlistSymbols]);

  // Watchlist items
  const watchlistItems: WatchlistItem[] = useMemo(() => {
    const symbols = activeTab === 'watchlist' ? watchlistSymbols :
      assetCategory === 'stocks' ? ALL_ASSETS.filter(a => a.type === 'stock').map(a => a.symbol) :
      assetCategory === 'crypto' ? ALL_ASSETS.filter(a => a.type === 'crypto').map(a => a.symbol) :
      watchlistSymbols;

    return symbols.map(sym => {
      const asset = ALL_ASSETS.find(a => a.symbol === sym);
      if (!asset) {
        // Fallback for assets not in ALL_ASSETS
        return { symbol: sym, name: sym, price: 100, change: 0, changePercent: 0, sparkline: generateSparkline(100), isFavorite: favorites.includes(sym), type: 'stock' as const };
      }
      return { ...asset, sparkline: generateSparkline(asset.price), isFavorite: favorites.includes(sym) };
    }).filter(Boolean);
  }, [watchlistSymbols, assetCategory, activeTab, favorites]);

  // Search filter
  const searchedItems = useMemo(() => {
    if (!search) return watchlistItems;
    return watchlistItems.filter(w =>
      w.symbol.toLowerCase().includes(search.toLowerCase()) ||
      w.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [watchlistItems, search]);

  // Persist timeframe
  const handleTimeframeChange = (tf: string) => {
    setTimeframe(tf);
    try { localStorage.setItem('korvix-trading-timeframe', tf); } catch { /* ignore */ }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setLastRefresh(new Date());
    refreshApi();
    setTimeout(() => { setIsRefreshing(false); addToast('Trading data refreshed', 'success'); }, 800);
  };

  const toggleFav = (symbol: string) => {
    setFavorites(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  };

  const toggleWatchlist = (symbol: string) => {
    setWatchlistSymbols(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      saveWatchlistSymbols(next);
      return next;
    });
    addToast(watchlistSymbols.includes(symbol) ? `Removed ${symbol}` : `Added ${symbol} to watchlist`, 'success');
  };

  // Signal counts
  const longCount = filteredSignals.filter(s => s.direction === 'long').length;
  const shortCount = filteredSignals.filter(s => s.direction === 'short').length;
  const holdCount = filteredSignals.filter(s => s.direction === 'wait' || s.direction === 'neutral').length;
  const avgConf = filteredSignals.length > 0 ? Math.round(filteredSignals.reduce((a, s) => a + s.confidence, 0) / filteredSignals.length) : 0;

  // Market hours check (simplified)
  const now = new Date();
  const hour = now.getUTCHours();
  const isMarketOpen = hour >= 13 && hour < 20; // Approximate US market hours in UTC

  const tabs = [
    { id: 'signals' as const, label: 'AI Signals', icon: Zap },
    { id: 'watchlist' as const, label: 'Watchlist', icon: Star },
    { id: 'sentiment' as const, label: 'Sentiment', icon: Activity },
    { id: 'assets' as const, label: 'Assets', icon: Layers },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ═══ PREMIUM HEADER ═══ */}
      <div className="shrink-0 p-4 border-b border-white/[0.04] bg-[#11151C]/60">
        {/* Title Row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-[#4ADE80]/[0.06] border border-[#4ADE80]/10 shadow-[0_0_8px_-2px_rgba(134, 168, 139,0.06)]">
              <TrendingUp className="h-4 w-4 text-[#4ADE80]" />
              {!hasLiveSignals && (
                <motion.div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#FACC15]"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ boxShadow: '0 0 4px rgba(194, 161, 90,0.5)' }} />
              )}
              {hasLiveSignals && (
                <motion.div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#4ADE80]"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ boxShadow: '0 0 4px rgba(134, 168, 139,0.5)' }} />
              )}
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-white">Trading Intelligence</h2>
              <p className="text-[10px] text-[#858B99]">
                {hasLiveSignals ? `Live · ${provider}` : 'AI-powered market analysis'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MarketStatus isOpen={isMarketOpen} />
            <DelayedDataBadge />
            <span className="text-[10px] text-[#858B99] tabular-nums">
              <Clock className="w-3 h-3 inline mr-1" />
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <motion.button onClick={handleRefresh} animate={{ rotate: isRefreshing ? 360 : 0 }}
              transition={{ duration: 0.8, ease: 'linear' }}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/[0.04] text-[#858B99] hover:text-[#4ADE80] hover:bg-[#4ADE80]/[0.04] transition-all">
              <RefreshCw className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </div>

        {/* Timeframe Controls */}
        <div className="flex items-center gap-1 mb-3">
          <span className="text-[9px] text-[#858B99] uppercase tracking-wider mr-1">{t('timeframe')}</span>
          {TIMEFRAMES.map((tf) => (
            <button key={tf.value} onClick={() => handleTimeframeChange(tf.value)}
              className={`px-2.5 py-[3px] rounded-md text-[10px] font-semibold transition-all ${
                timeframe === tf.value
                  ? 'bg-[#4ADE80]/[0.08] text-[#4ADE80] border border-[#4ADE80]/15 shadow-[0_0_8px_-2px_rgba(134, 168, 139,0.08)]'
                  : 'text-[#858B99] hover:text-[#B6BBC6] border border-transparent hover:bg-white/[0.02]'
              }`}>
              {tf.label}
            </button>
          ))}
          <span className="ml-auto text-[9px] text-[#858B99] tabular-nums font-mono">{timeframe}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSearch(''); if (tab.id === 'assets') setAssetCategory('stocks'); if (tab.id === 'watchlist') setAssetCategory('stocks'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${
                activeTab === tab.id ? 'bg-white/[0.06] text-white shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]' : 'text-[#858B99] hover:text-[#B6BBC6]'
              }`}>
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {/* ═══ SIGNALS TAB ═══ */}
        {activeTab === 'signals' && (
          <>
            {apiLoading ? (
              /* Loading skeletons */
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                  {[{ label: 'Long', color: 'text-[#4ADE80]', border: 'border-[#4ADE80]/10', bg: 'bg-[#4ADE80]/[0.04]' },
                    { label: 'Short', color: 'text-[#F87171]', border: 'border-[#F87171]/10', bg: 'bg-[#F87171]/[0.04]' },
                    { label: 'Hold', color: 'text-[#FACC15]', border: 'border-[#FACC15]/10', bg: 'bg-[#FACC15]/[0.04]' },
                    { label: 'Avg Conf', color: 'text-white', border: 'border-white/[0.04]', bg: 'bg-white/[0.01]' }].map((stat) => (
                    <div key={stat.label} className={`p-3 rounded-xl border ${stat.border} ${stat.bg} text-center`}>
                      <p className={`text-lg font-semibold ${stat.color}`}>--</p>
                      <p className="text-[9px] text-[#858B99]">{stat.label}</p>
                    </div>
                  ))}
                </div>
                <SignalCardSkeleton />
                <SignalCardSkeleton />
                <SignalCardSkeleton />
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-3 rounded-xl border border-[#4ADE80]/10 bg-[#4ADE80]/[0.04] text-center">
                    <p className="text-lg font-semibold text-[#4ADE80]">{longCount}</p>
                    <p className="text-[9px] text-[#858B99]">Long</p>
                  </div>
                  <div className="p-3 rounded-xl border border-[#F87171]/10 bg-[#F87171]/[0.04] text-center">
                    <p className="text-lg font-semibold text-[#F87171]">{shortCount}</p>
                    <p className="text-[9px] text-[#858B99]">Short</p>
                  </div>
                  <div className="p-3 rounded-xl border border-[#FACC15]/10 bg-[#FACC15]/[0.04] text-center">
                    <p className="text-lg font-semibold text-[#FACC15]">{holdCount}</p>
                    <p className="text-[9px] text-[#858B99]">Hold</p>
                  </div>
                  <div className="p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] text-center">
                    <p className="text-lg font-semibold text-white">{avgConf}%</p>
                    <p className="text-[9px] text-[#858B99]">Avg Conf</p>
                  </div>
                </div>

                {/* Chart Placeholder */}
                <ChartPlaceholder timeframe={timeframe} isLoading={false} />

                {/* Signal Cards */}
                {filteredSignals.length > 0 ? (
                  <div className="space-y-2">
                    {filteredSignals.map((signal) => (
                      <PremiumSignalCard key={signal.id} signal={signal} />
                    ))}
                  </div>
                ) : (
                  <EmptySignalsState />
                )}

                {/* Disclaimer */}
                <div className="flex items-center justify-center gap-1.5 py-3">
                  <AlertTriangle className="w-3 h-3 text-slate-700" />
                  <p className="text-[9px] text-slate-700">AI-generated market intelligence. Not financial advice.</p>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ WATCHLIST TAB ═══ */}
        {activeTab === 'watchlist' && (
          <>
            {/* Category Tabs */}
            <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
              {(['stocks', 'crypto', 'watchlist'] as const).map((cat) => (
                <button key={cat} onClick={() => setAssetCategory(cat)}
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
                    assetCategory === cat ? 'bg-white/[0.06] text-white' : 'text-[#858B99] hover:text-[#B6BBC6]'
                  }`}>
                  {cat === 'watchlist' ? `My Watchlist (${watchlistSymbols.length})` : cat === 'stocks' ? 'Stocks' : 'Crypto'}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#858B99]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets..."
                className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-[#858B99] focus:outline-none focus:border-[#4ADE80]/20 transition-all" />
            </div>

            {isRefreshing ? <WatchlistSkeleton /> : (
              <div className="space-y-1.5">
                {searchedItems.length === 0 ? (
                  <div className="text-center py-8">
                    <Search className="w-8 h-8 text-white/[0.06] mx-auto mb-2" />
                    <p className="text-[12px] text-[#858B99]">No assets found</p>
                    <p className="text-[10px] text-slate-700 mt-1">Try a different search term</p>
                  </div>
                ) : (
                  searchedItems.map((item) => (
                    <WatchlistRow key={item.symbol} item={item}
                      onToggleFav={() => toggleFav(item.symbol)}
                      onToggleWatchlist={() => toggleWatchlist(item.symbol)}
                      inWatchlist={watchlistSymbols.includes(item.symbol)} />
                  ))
                )}
              </div>
            )}
          </>
        )}

        {/* ═══ SENTIMENT TAB ═══ */}
        {activeTab === 'sentiment' && (
          <>
            {isRefreshing ? (
              <div className="space-y-3">
                <div className="p-4 rounded-xl border border-white/[0.02] bg-white/[0.01] space-y-3">
                  <div className="flex justify-between"><SkeletonPulse className="h-4 w-32" /><SkeletonPulse className="h-4 w-16" /></div>
                  <SkeletonPulse className="h-2 w-full rounded-full" />
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => <SkeletonPulse key={i} className="h-12" />)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SentimentGauge sentiment={DEMO_SENTIMENT} />

                {/* Scenario Distribution */}
                <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01]">
                  <h3 className="text-[12px] font-semibold text-white mb-3 flex items-center gap-2">
                    <BarChart3 className="w-3.5 h-3.5 text-[#858B99]" /> Signal Distribution
                  </h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Bullish', count: longCount, total: filteredSignals.length, color: 'bg-[#4ADE80]', text: 'text-[#4ADE80]' },
                      { label: 'Neutral', count: holdCount, total: filteredSignals.length, color: 'bg-[#FACC15]', text: 'text-[#FACC15]' },
                      { label: 'Bearish', count: shortCount, total: filteredSignals.length, color: 'bg-[#F87171]', text: 'text-[#F87171]' },
                    ].map((d) => (
                      <div key={d.label} className="flex items-center gap-3">
                        <span className={`text-[11px] ${d.text} w-14`}>{d.label}</span>
                        <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                          <motion.div className={`h-full rounded-full ${d.color}`}
                            initial={{ width: 0 }}
                            animate={{ width: d.total > 0 ? `${(d.count / d.total) * 100}%` : '0%' }}
                            transition={{ duration: 0.8, delay: 0.1 }} />
                        </div>
                        <span className="text-[10px] text-[#858B99] w-6 text-right">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sector Sentiment */}
                <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01]">
                  <h3 className="text-[12px] font-semibold text-white mb-3 flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-[#858B99]" /> Sector Sentiment
                  </h3>
                  {[
                    { sector: 'Technology', score: 78, trend: 'up' },
                    { sector: 'Healthcare', score: 62, trend: 'up' },
                    { sector: 'Energy', score: 45, trend: 'down' },
                    { sector: 'Finance', score: 55, trend: 'neutral' },
                    { sector: 'Crypto', score: 71, trend: 'up' },
                  ].map((s) => (
                    <div key={s.sector} className="flex items-center gap-3 py-2 border-b border-white/[0.02] last:border-0">
                      <span className="text-[11px] text-[#B6BBC6] w-20">{s.sector}</span>
                      <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                        <motion.div className={`h-full rounded-full ${s.score > 60 ? 'bg-[#4ADE80]' : s.score < 40 ? 'bg-[#F87171]' : 'bg-[#FACC15]'}`}
                          initial={{ width: 0 }} animate={{ width: `${s.score}%` }} transition={{ duration: 0.8, delay: 0.1 }} />
                      </div>
                      <span className="text-[10px] text-[#858B99] w-8 text-right">{s.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ ASSETS TAB ═══ */}
        {activeTab === 'assets' && (
          <>
            {/* Category Tabs */}
            <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
              {(['stocks', 'crypto'] as const).map((cat) => (
                <button key={cat} onClick={() => { setAssetCategory(cat); setSearch(''); }}
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
                    assetCategory === cat ? 'bg-white/[0.06] text-white' : 'text-[#858B99] hover:text-[#B6BBC6]'
                  }`}>
                  {cat === 'stocks' ? `Stocks (${ALL_ASSETS.filter(a => a.type === 'stock').length})` : `Crypto (${ALL_ASSETS.filter(a => a.type === 'crypto').length})`}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#858B99]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${assetCategory}...`}
                className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-[#858B99] focus:outline-none focus:border-[#4ADE80]/20 transition-all" />
            </div>

            {/* Asset Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_ASSETS
                .filter(a => a.type === assetCategory)
                .filter(a => !search || a.symbol.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase()))
                .map((asset) => {
                  const isPositive = asset.change >= 0;
                  const inWl = watchlistSymbols.includes(asset.symbol);
                  return (
                    <motion.div key={asset.symbol} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.05] hover:bg-white/[0.02] transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-white">{asset.symbol}</span>
                          <span className="text-[9px] text-[#858B99] truncate max-w-[80px]">{asset.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ScenarioChip scenario={isPositive ? 'bullish' : 'bearish'} />
                          <button onClick={() => toggleWatchlist(asset.symbol)}
                            className={`p-1 rounded transition-all ${inWl ? 'text-[#4ADE80]' : 'text-slate-700 hover:text-[#858B99]'}`}>
                            {inWl ? <Eye className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-[14px] font-semibold text-white">${asset.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                          <div className={`flex items-center gap-0.5 ${isPositive ? 'text-[#4ADE80]' : 'text-[#F87171]'}`}>
                            {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            <span className="text-[10px] font-medium">{isPositive ? '+' : ''}{asset.changePercent.toFixed(2)}%</span>
                          </div>
                        </div>
                        {/* Mini sparkline */}
                        <MiniSparkline price={asset.price} isPositive={isPositive} />
                      </div>
                    </motion.div>
                  );
                })}
            </div>

            {ALL_ASSETS.filter(a => a.type === assetCategory).filter(a => !search || a.symbol.toLowerCase().includes(search.toLowerCase())).length === 0 && (
              <div className="text-center py-8">
                <Search className="w-8 h-8 text-white/[0.06] mx-auto mb-2" />
                <p className="text-[12px] text-[#858B99]">No assets found</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
