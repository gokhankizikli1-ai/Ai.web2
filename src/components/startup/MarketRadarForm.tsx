import { useState } from 'react';
import { motion } from 'framer-motion';
import { Radar, Globe2, ChevronRight, Zap, Gauge, Telescope } from 'lucide-react';
import {
  SOURCE_DISPLAY,
  type RadarSource, type RadarSourceHealth, type MarketComplaintRequest,
} from '@/lib/startupMarketApi';

/**
 * Scan depth → timeframe mapping. The user picks a plain-language depth;
 * the "7d / 30d / 90d" detail is kept as small helper text / tooltip only.
 * Standard (30d) is the default.
 */
const SCAN_DEPTHS = [
  { key: 'quick',    label: 'Quick scan',    days: 7,  hint: 'Last ~7 days',  icon: Zap },
  { key: 'standard', label: 'Standard scan', days: 30, hint: 'Last ~30 days · recommended', icon: Gauge },
  { key: 'deep',     label: 'Deep scan',     days: 90, hint: 'Last ~90 days', icon: Telescope },
] as const;

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
 * Simplified Market Radar input — a single clear action panel:
 *   1) enter an idea/market  2) choose scan depth  3) Analyze market.
 * Region + signal sources live in a collapsed "Advanced options" row so a
 * first-time user isn't buried in controls. Unconnected sources are shown
 * (inside advanced) but disabled and honestly marked "unavailable".
 */
export default function MarketRadarForm({
  loading, sourceHealth,
  query, onQueryChange,
  timeframe, onTimeframeChange,
  region, onRegionChange,
  sources, onSourcesChange,
  onAnalyze,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const activeDepth = SCAN_DEPTHS.find((d) => d.days === timeframe) ?? SCAN_DEPTHS[1];

  return (
    <div className="rounded-2xl border border-[#253142] bg-[#111722] p-5 sm:p-6">
      {/* 1 — the ask */}
      <h2 className="text-[16px] sm:text-[17px] font-semibold text-[#F8FAFC] tracking-tight">
        What market should Korvix investigate?
      </h2>
      <p className="text-[12.5px] text-[#94A3B8] mt-1 leading-relaxed">
        Enter a product, niche, or startup idea. Korvix will find complaints, pains, and next steps.
      </p>

      {/* Large single input */}
      <textarea
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          // Plain Enter and Ctrl/Cmd+Enter both run; Shift+Enter = newline.
          if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="AI customer support tools, small restaurant POS systems, crypto portfolio tracking…"
        rows={2}
        className="mt-4 w-full rounded-xl bg-[#101620] border border-[#253142] p-3.5 text-[14px] text-[#F8FAFC] placeholder:text-[#64748B] focus:border-[#3B82F6]/50 focus:ring-2 focus:ring-[#3B82F6]/15 outline-none transition-all resize-none"
      />

      {/* 2 — scan depth (3 friendly pills; 7/30/90 hidden as helper text) */}
      <div className="mt-3.5">
        <div className="flex flex-wrap gap-1.5">
          {SCAN_DEPTHS.map((d) => {
            const active = d.days === timeframe;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onTimeframeChange(d.days)}
                title={d.hint}
                className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12.5px] font-medium border transition-colors ${
                  active
                    ? 'bg-[#3B82F6]/[0.12] border-[#3B82F6]/40 text-[#60A5FA]'
                    : 'bg-[#0D1117] border-[#253142] text-[#CBD5E1] hover:border-[#334155] hover:text-[#F8FAFC]'
                }`}
              >
                <d.icon className="h-3.5 w-3.5" />
                {d.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10.5px] text-[#64748B] mt-1.5">{activeDepth.hint}</p>
      </div>

      {/* 3 — primary action */}
      <motion.button
        whileHover={canSubmit ? { scale: 1.004 } : undefined}
        whileTap={canSubmit ? { scale: 0.996 } : undefined}
        onClick={submit}
        disabled={!canSubmit}
        className={`mt-4 w-full h-11 rounded-xl text-[13.5px] font-semibold flex items-center justify-center gap-2 border transition-all ${
          canSubmit
            ? 'bg-gradient-to-b from-[#1A2233] to-[#111722] border-[rgba(96,165,250,0.22)] text-[#F8FAFC] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:from-[#1E293B] hover:to-[#141B29] hover:border-[rgba(96,165,250,0.5)] hover:shadow-[0_4px_16px_rgba(37,99,235,0.25),0_0_0_1px_rgba(59,130,246,0.18)]'
            : 'bg-[#0D1117] border-[#253142] text-[#64748B] cursor-not-allowed'
        }`}
      >
        <Radar className="h-4 w-4" />
        {loading ? 'Analyzing…' : 'Analyze market'}
      </motion.button>

      {/* Advanced options — collapsed by default */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#CBD5E1] transition-colors"
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
          Advanced options
        </button>

        {showAdvanced && (
          <div className="mt-3 rounded-xl border border-[#253142] bg-[#0D1117] p-3.5 space-y-4">
            {/* Region */}
            <div>
              <label className="block text-[11px] font-medium text-[#CBD5E1] mb-1.5">Region</label>
              <div className="relative">
                <Globe2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B]" />
                <input
                  type="text"
                  value={region}
                  onChange={(e) => onRegionChange(e.target.value)}
                  placeholder="global"
                  className="w-full h-9 rounded-lg bg-[#101620] border border-[#253142] pl-8 pr-3 text-[12.5px] text-[#F8FAFC] placeholder:text-[#64748B] focus:border-[#3B82F6]/40 outline-none transition-all"
                />
              </div>
            </div>

            {/* Sources */}
            <div>
              <label className="block text-[11px] font-medium text-[#CBD5E1] mb-1.5">Sources</label>
              <div className="flex flex-wrap gap-1.5">
                {SOURCE_IDS.map((id) => {
                  const configured = isConfigured(id);
                  const active = sources.includes(id);
                  const meta = SOURCE_DISPLAY[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleSource(id)}
                      disabled={!configured}
                      title={configured ? meta.role : `${meta.role} — unavailable on this deployment`}
                      className={`px-2.5 h-7 rounded-lg text-[11px] border transition-colors ${
                        !configured
                          ? 'bg-transparent border-[#253142]/60 text-[#64748B] cursor-not-allowed'
                          : active
                            ? 'bg-[#3B82F6]/[0.12] border-[#3B82F6]/40 text-[#60A5FA]'
                            : 'bg-[#101620] border-[#253142] text-[#CBD5E1] hover:border-[#334155] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {configured ? meta.label : `${meta.label} unavailable`}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[10.5px] text-[#64748B]">
              Scan depth controls how far back Korvix looks — Quick ≈ 7 days, Standard ≈ 30 days, Deep ≈ 90 days.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
