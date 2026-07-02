import { motion } from 'framer-motion';
import {
  ArrowUpRight, CheckCircle2, CircleSlash, Clock3, Flame,
  Lightbulb, ListChecks, MessageSquareWarning, Rocket, ShieldAlert,
  Target, Users,
} from 'lucide-react';
import type { MarketComplaintReport, SourceStatus } from '@/lib/startupMarketApi';
import ComplaintClusterCard from './ComplaintClusterCard';

const SOURCE_LABELS: Record<string, string> = {
  web: 'Web',
  hackernews: 'Hacker News',
  gdelt: 'GDELT',
  reddit: 'Reddit',
  producthunt: 'Product Hunt',
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.08]',
  medium: 'text-amber-300 border-amber-500/25 bg-amber-500/[0.08]',
  low: 'text-slate-300 border-white/[0.08] bg-white/[0.03]',
};

function FreshnessChip({ source, status }: { source: string; status: SourceStatus }) {
  const meta =
    status === 'available'
      ? { icon: CheckCircle2, tone: 'text-emerald-400/80', label: 'live' }
      : status === 'skipped'
        ? { icon: CircleSlash, tone: 'text-slate-600', label: 'skipped' }
        : { icon: MessageSquareWarning, tone: 'text-rose-400/70', label: 'unavailable' };
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/[0.04] bg-white/[0.01] text-[10px] text-slate-500">
      <meta.icon className={`h-3 w-3 ${meta.tone}`} />
      {SOURCE_LABELS[source] || source}
      <span className={meta.tone}>{meta.label}</span>
    </span>
  );
}

function RecommendationBlock({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof Rocket;
  title: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.008] p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="h-3.5 w-3.5 text-amber-400/70" />
        <h4 className="text-[12px] font-medium text-white">{title}</h4>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] text-slate-400 leading-relaxed pl-3 border-l border-white/[0.06]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignalList({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <span className="block text-[10px] text-slate-600 mb-1.5">{title}</span>
      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="px-2 py-0.5 rounded-md text-[10px] text-slate-400 border border-white/[0.04] bg-white/[0.01] capitalize">
              {v}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-slate-700">none detected</span>
      )}
    </div>
  );
}

interface Props {
  report: MarketComplaintReport;
  onSendToAdvisor: () => void;
}

/**
 * Full radar result surface: opportunity summary, honest per-source
 * freshness, ranked complaint clusters with evidence, market signals,
 * deterministic recommendations, and the Startup Advisor handoff.
 */
export default function MarketRadarResults({ report, onSendToAdvisor }: Props) {
  const { summary } = report;
  const hasClusters = report.complaint_clusters.length > 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Summary card */}
      <div className="rounded-2xl border border-white/[0.04] bg-white/[0.008] p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* Opportunity gauge — real API value, not decoration */}
          <div className="relative w-20 h-20 shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="white" strokeOpacity="0.04" strokeWidth="5" />
              <motion.circle
                cx="40" cy="40" r="34" fill="none" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 34}
                initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 34 * (1 - summary.opportunity_score / 100) }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-white">{summary.opportunity_score}</span>
              <span className="text-[8px] text-slate-600">/100</span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-semibold text-white">Opportunity score</h3>
              <span className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${CONFIDENCE_TONE[summary.confidence] || CONFIDENCE_TONE.low}`}>
                {summary.confidence} confidence
              </span>
              {report.cached && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/[0.06] text-[10px] text-slate-500">
                  <Clock3 className="h-2.5 w-2.5" /> cached result
                </span>
              )}
            </div>
            {summary.top_complaint_area ? (
              <p className="text-[12px] text-slate-500 mt-1">
                Loudest complaint area: <span className="text-slate-300 capitalize">{summary.top_complaint_area}</span>
              </p>
            ) : (
              <p className="text-[12px] text-slate-500 mt-1">No dominant complaint area detected.</p>
            )}
            <p className="text-[11px] text-slate-600 mt-1">
              {summary.total_items_analyzed} items from {summary.total_sources} live source
              {summary.total_sources === 1 ? '' : 's'} · last {report.timeframe_days} days
            </p>
          </div>

          {hasClusters && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={onSendToAdvisor}
              className="shrink-0 h-10 px-4 rounded-xl bg-amber-500/[0.1] border border-amber-500/25 text-amber-200 text-[12px] hover:bg-amber-500/[0.14] transition-all flex items-center gap-2"
            >
              <Rocket className="h-3.5 w-3.5" /> Send to Startup Advisor
              <ArrowUpRight className="h-3 w-3" />
            </motion.button>
          )}
        </div>

        {/* Per-source freshness — always shown, always honest */}
        <div className="flex flex-wrap gap-1.5 mt-4">
          {Object.entries(report.data_freshness).map(([source, status]) => (
            <FreshnessChip key={source} source={source} status={status} />
          ))}
        </div>

        {report.message && (
          <p className="mt-3 text-[11px] text-slate-500 border-l-2 border-amber-500/25 pl-2.5">
            {report.message}
          </p>
        )}
      </div>

      {/* Complaint clusters */}
      {hasClusters && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Flame className="h-3.5 w-3.5 text-rose-400/70" />
            <h3 className="text-[13px] font-medium text-white">Ranked complaint clusters</h3>
          </div>
          <div className="space-y-2.5">
            {report.complaint_clusters.map((cluster, i) => (
              <ComplaintClusterCard key={cluster.id} cluster={cluster} rank={i} />
            ))}
          </div>
        </div>
      )}

      {/* Market signals */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.008] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-3.5 w-3.5 text-cyan-400/70" />
          <h3 className="text-[12px] font-medium text-white">Market signals</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <SignalList title="Competitors mentioned in evidence" values={report.market_signals.competitors_mentioned} />
          <SignalList title="Trending keywords" values={report.market_signals.trending_keywords} />
          <SignalList title="Underserved segments" values={report.market_signals.underserved_segments} />
          <SignalList title="Common workarounds" values={report.market_signals.common_workarounds} />
        </div>
      </div>

      {/* Recommendations */}
      {hasClusters && (
        <div className="grid sm:grid-cols-2 gap-2.5">
          <RecommendationBlock icon={Lightbulb} title="Startup angles" items={report.recommendations.startup_angles} />
          <RecommendationBlock icon={ListChecks} title="MVP wedge" items={report.recommendations.mvp_wedge} />
          <RecommendationBlock icon={Users} title="First 100 customers" items={report.recommendations.first_100_customers} />
          <RecommendationBlock icon={Rocket} title="Landing page angles" items={report.recommendations.landing_page_angles} />
          <div className="sm:col-span-2">
            <RecommendationBlock icon={ShieldAlert} title="Risks" items={report.recommendations.risks} />
          </div>
        </div>
      )}

      {/* Citations */}
      {report.citations.length > 0 && (
        <details className="rounded-xl border border-white/[0.04] bg-white/[0.008] p-4">
          <summary className="text-[12px] text-slate-400 cursor-pointer select-none">
            All citations ({report.citations.length})
          </summary>
          <ul className="mt-3 space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-1">
            {report.citations.map((c) => (
              <li key={c.url} className="flex items-start gap-2 min-w-0">
                <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] text-slate-500 border border-white/[0.04]">
                  {SOURCE_LABELS[c.source] || c.source}
                </span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-slate-400 hover:text-cyan-300 transition-colors truncate"
                >
                  {c.title || c.url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </motion.div>
  );
}
