import { motion } from 'framer-motion';
import { Radar, Globe2 } from 'lucide-react';
import {
  SOURCE_DISPLAY,
  type RadarSource, type RadarSourceHealth, type MarketComplaintRequest,
} from '@/lib/startupMarketApi';

const TIMEFRAMES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

const SOURCE_IDS: RadarSource[] = ['web', 'hackernews', 'gdelt', 'reddit', 'producthunt'];

interface Props {
  loading: boolean;
  sourceHealth: RadarSourceHealth | null;
  /** All controls are controlled by the parent so example chips, history
   * restore, and refresh-restore can repopulate the exact run setup. */
  query: string;
  onQueryChange: (query: string) => void;
  timeframe: number;
  onTimeframeChange: (days: number) => void;
  region: string;
  onRegionChange: (region: string) => void;
  sources: RadarSource[];
  onSourcesChange: (sources: RadarSource[]) => void;
  onAnalyze: (req: MarketComplaintRequest) => void;
}

/**
 * Market Complaint Radar input surface: niche query, timeframe, region,
 * source toggles. Unconnected key-gated sources are shown but disabled
 * with an honest "not connected" hint — never silently faked.
 * Ctrl/Cmd+Enter (or plain Enter) in the query field runs the analysis.
 */
export default function MarketRadarForm({
  loading, sourceHealth,
  query, onQueryChange,
  timeframe, onTimeframeChange,
  region, onRegionChange,
  sources, onSourcesChange,
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
    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-4 sm:p-5">
      <label className="block text-[12px] font-medium text-slate-300 mb-1.5">
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
        className="w-full rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 text-[13px] text-slate-100 placeholder:text-[#7F8FA3] focus:border-[#7EA6BF]/40 focus:bg-white/[0.03] outline-none transition-all resize-none"
      />

      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 mt-4">
        {/* Timeframe */}
        <div>
          <label className="block text-[12px] font-medium text-slate-300 mb-1.5">Timeframe</label>
          <div className="flex gap-1.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.days}
                onClick={() => onTimeframeChange(tf.days)}
                className={`px-3 h-8 rounded-lg text-[12px] border transition-colors ${
                  timeframe === tf.days
                    ? 'bg-[#7EA6BF]/[0.14] border-[#7EA6BF]/40 text-[#9DB0C2]'
                    : 'bg-white/[0.02] border-white/[0.06] text-[#A9B7C6] hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Region */}
        <div>
          <label className="block text-[12px] font-medium text-slate-300 mb-1.5">Region</label>
          <div className="relative">
            <Globe2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#7F8FA3]" />
            <input
              type="text"
              value={region}
              onChange={(e) => onRegionChange(e.target.value)}
              placeholder="global"
              className="w-full h-8 rounded-lg bg-white/[0.02] border border-white/[0.06] pl-8 pr-3 text-[12px] text-slate-100 placeholder:text-[#7F8FA3] focus:border-[#7EA6BF]/40 outline-none transition-all"
            />
          </div>
        </div>
      </div>

      {/* Source toggles */}
      <div className="mt-4">
        <label className="block text-[12px] font-medium text-slate-300 mb-1.5">Signal sources</label>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_IDS.map((id) => {
            const configured = isConfigured(id);
            const active = sources.includes(id);
            const meta = SOURCE_DISPLAY[id];
            return (
              <button
                key={id}
                onClick={() => toggleSource(id)}
                disabled={!configured}
                title={configured ? meta.role : `${meta.role} — not connected on this deployment`}
                className={`px-2.5 h-7 rounded-lg text-[11px] border transition-colors ${
                  !configured
                    ? 'bg-white/[0.008] border-white/[0.03] text-[#7F8FA3] cursor-not-allowed'
                    : active
                      ? 'bg-[#7EA6BF]/[0.14] border-[#7EA6BF]/40 text-[#9DB0C2]'
                      : 'bg-white/[0.02] border-white/[0.06] text-[#A9B7C6] hover:text-slate-200'
                }`}
              >
                {meta.label}
                {!configured && <span className="ml-1 text-[9px]">· not connected</span>}
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
        className={`mt-5 w-full h-11 rounded-xl text-[13px] font-medium flex items-center justify-center gap-2 border transition-all ${
          canSubmit
            ? 'bg-[#7EA6BF]/[0.16] border-[#7EA6BF]/45 text-[#DCE4EC] hover:bg-[#7EA6BF]/[0.22]'
            : 'bg-white/[0.02] border-white/[0.05] text-[#7F8FA3] cursor-not-allowed'
        }`}
      >
        <Radar className="h-4 w-4" />
        {loading ? 'Analyzing…' : 'Analyze market complaints'}
        {canSubmit && !loading && (
          <kbd className="hidden sm:inline-flex items-center rounded bg-black/20 border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-[#9DB0C2]/70 font-mono ml-1">
            ⌘↵
          </kbd>
        )}
      </motion.button>
    </div>
  );
}
