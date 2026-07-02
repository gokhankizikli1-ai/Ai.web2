import { motion } from 'framer-motion';
import { Radar, Globe2 } from 'lucide-react';
import type { RadarSource, RadarSourceHealth, MarketComplaintRequest } from '@/lib/startupMarketApi';

const TIMEFRAMES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

const SOURCE_META: { id: RadarSource; label: string }[] = [
  { id: 'web', label: 'Web' },
  { id: 'hackernews', label: 'Hacker News' },
  { id: 'gdelt', label: 'GDELT' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'producthunt', label: 'Product Hunt' },
];

interface Props {
  loading: boolean;
  sourceHealth: RadarSourceHealth | null;
  /** Query is controlled by the parent so the empty-state example chips
   * and history restore can populate it. */
  query: string;
  onQueryChange: (query: string) => void;
  timeframe: number;
  onTimeframeChange: (timeframe: number) => void;
  region: string;
  onRegionChange: (region: string) => void;
  sources: RadarSource[];
  onSourcesChange: (sources: RadarSource[]) => void;
  onAnalyze: (req: MarketComplaintRequest) => void;
}

/**
 * Market Complaint Radar input surface: niche query, timeframe, region,
 * source toggles. Unconfigured key-gated sources are shown but disabled
 * with an honest "not configured" hint — never silently faked.
 * Ctrl/Cmd+Enter (or plain Enter) in the query field runs the analysis.
 */
export default function MarketRadarForm({
  loading,
  sourceHealth,
  query,
  onQueryChange,
  timeframe,
  onTimeframeChange,
  region,
  onRegionChange,
  sources,
  onSourcesChange,
  onAnalyze,
}: Props) {
  const isConfigured = (id: RadarSource): boolean =>
    sourceHealth ? sourceHealth.sources[id]?.configured !== false : true;

  const toggleSource = (id: RadarSource) => {
    if (!isConfigured(id)) return;
    onSourcesChange(
      sources.includes(id) ? sources.filter((s) => s !== id) : [...sources, id],
    );
  };

  const canSubmit = query.trim().length >= 3 && sources.length > 0 && !loading;

  const submit = () => {
    if (!canSubmit) return;
    onAnalyze({
      query: query.trim(),
      region: region.trim() || 'global',
      timeframe_days: timeframe,
      sources,
      max_items: 80,
    });
  };

  return (
    <div className="rounded-2xl border border-white/[0.04] bg-white/[0.008] p-4 sm:p-5">
      <label className="block text-[12px] text-slate-400 mb-1.5">
        Market, niche, or startup idea
      </label>
      <textarea
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          // Plain Enter and Ctrl/Cmd+Enter both run the analysis;
          // Shift+Enter inserts a newline.
          if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="AI customer support tools, small restaurant POS systems, crypto portfolio tracking…"
        rows={2}
        className="w-full rounded-xl bg-white/[0.015] border border-white/[0.04] p-3 text-[13px] text-white placeholder:text-[#64748B] focus:border-amber-500/25 focus:bg-white/[0.02] outline-none transition-all resize-none"
      />

      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 mt-4">
        {/* Timeframe */}
        <div>
          <label className="block text-[12px] text-slate-400 mb-1.5">Timeframe</label>
          <div className="flex gap-1.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.days}
                onClick={() => onTimeframeChange(tf.days)}
                className={`px-3 h-8 rounded-lg text-[12px] border transition-colors ${
                  timeframe === tf.days
                    ? 'bg-amber-500/[0.1] border-amber-500/25 text-amber-300'
                    : 'bg-white/[0.01] border-white/[0.04] text-slate-500 hover:text-slate-300'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Region */}
        <div>
          <label className="block text-[12px] text-slate-400 mb-1.5">Region</label>
          <div className="relative">
            <Globe2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600" />
            <input
              type="text"
              value={region}
              onChange={(e) => onRegionChange(e.target.value)}
              placeholder="global"
              className="w-full h-8 rounded-lg bg-white/[0.015] border border-white/[0.04] pl-8 pr-3 text-[12px] text-white placeholder:text-[#64748B] focus:border-amber-500/25 outline-none transition-all"
            />
          </div>
        </div>
      </div>

      {/* Source toggles */}
      <div className="mt-4">
        <label className="block text-[12px] text-slate-400 mb-1.5">Signal sources</label>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_META.map((src) => {
            const configured = isConfigured(src.id);
            const active = sources.includes(src.id);
            return (
              <button
                key={src.id}
                onClick={() => toggleSource(src.id)}
                disabled={!configured}
                title={configured ? undefined : 'Not configured on this deployment'}
                className={`px-2.5 h-7 rounded-lg text-[11px] border transition-colors ${
                  !configured
                    ? 'bg-white/[0.005] border-white/[0.02] text-slate-700 cursor-not-allowed'
                    : active
                      ? 'bg-cyan-500/[0.08] border-cyan-500/20 text-cyan-300'
                      : 'bg-white/[0.01] border-white/[0.04] text-slate-500 hover:text-slate-300'
                }`}
              >
                {src.label}
                {!configured && <span className="ml-1 text-[9px]">· not configured</span>}
              </button>
            );
          })}
        </div>
      </div>

      <motion.button
        whileHover={canSubmit ? { scale: 1.005 } : undefined}
        whileTap={canSubmit ? { scale: 0.995 } : undefined}
        onClick={submit}
        disabled={!canSubmit}
        className={`mt-5 w-full h-11 rounded-xl text-[13px] flex items-center justify-center gap-2 border transition-all ${
          canSubmit
            ? 'bg-amber-500/[0.14] border-amber-500/35 text-amber-100 hover:bg-amber-500/[0.2] shadow-[0_0_24px_-8px_rgba(251,191,36,0.35)]'
            : 'bg-white/[0.02] border-white/[0.04] text-slate-600 cursor-not-allowed'
        }`}
      >
        <Radar className="h-4 w-4" />
        {loading ? 'Analyzing…' : 'Analyze market complaints'}
        {canSubmit && !loading && (
          <kbd className="hidden sm:inline-flex items-center rounded bg-black/20 border border-white/[0.06] px-1.5 py-0.5 text-[9px] text-amber-200/60 font-mono ml-1">
            ⌘↵
          </kbd>
        )}
      </motion.button>
    </div>
  );
}
