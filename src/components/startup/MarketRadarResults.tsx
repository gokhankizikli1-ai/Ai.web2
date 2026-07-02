import { motion } from 'framer-motion';
import {
  ArrowUpRight, CheckCircle2, CircleSlash, Clock3, Flame, Hammer,
  ListChecks, MessageSquareWarning, Rocket, ShieldAlert, Target,
} from 'lucide-react';
import {
  SOURCE_DISPLAY, sourceLabel,
  type MarketComplaintReport, type RadarSourceHealth, type SourceStatus,
} from '@/lib/startupMarketApi';
import {
  deriveDecision, deriveIcp, deriveValidationSprint,
} from '@/lib/startupRadarInsights';
import ComplaintClusterCard from './ComplaintClusterCard';
import CompetitorWeaknessPanel from './CompetitorWeaknessPanel';
import IcpPanel from './IcpPanel';
import OpportunityDecisionBoard from './OpportunityDecisionBoard';
import ValidationSprintPanel from './ValidationSprintPanel';

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.1]',
  medium: 'text-amber-300 border-amber-500/30 bg-amber-500/[0.1]',
  low: 'text-slate-300 border-white/[0.1] bg-white/[0.04]',
};

const DECISION_CHIP_TONE: Record<string, string> = {
  build: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.1]',
  validate: 'text-amber-300 border-amber-500/30 bg-amber-500/[0.1]',
  avoid: 'text-rose-300 border-rose-500/30 bg-rose-500/[0.1]',
};

/** Evidence-quality badge tiers (avg item quality 0-100 from backend). */
function evidenceQualityBadge(score: number): { label: string; tone: string } {
  if (score >= 70) return { label: 'strong evidence', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.1]' };
  if (score >= 45) return { label: 'moderate evidence', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/[0.1]' };
  return { label: 'weak evidence', tone: 'text-rose-300 border-rose-500/30 bg-rose-500/[0.1]' };
}

function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Human, per-source issue sentence — no internal keys, no raw backend
 * notes. "Some sources were unavailable: News trends timed out;
 * Communities not connected." Deliberately deselected sources are not
 * reported as issues. */
function humanSourceIssues(
  report: MarketComplaintReport,
  sourceHealth: RadarSourceHealth | null,
): string | null {
  const msg = report.message || '';
  const phrases: string[] = [];
  for (const [source, status] of Object.entries(report.data_freshness)) {
    const label = sourceLabel(source);
    if (status === 'unavailable') {
      const timedOut = new RegExp(`${source}[^|]*timed out`, 'i').test(msg);
      phrases.push(timedOut ? `${label} timed out` : `${label} unavailable`);
    } else if (status === 'skipped') {
      const configured = sourceHealth?.sources[source as keyof RadarSourceHealth['sources']]?.configured;
      if (configured === false) phrases.push(`${label} not connected`);
    }
  }
  return phrases.length ? `Some sources were unavailable: ${phrases.join('; ')}.` : null;
}

function SourceStatusCard({
  source,
  status,
  configured,
}: {
  source: string;
  status: SourceStatus;
  configured: boolean | null; // null = health unknown
}) {
  const effective =
    status === 'skipped' && configured === false
      ? { icon: CircleSlash, tone: 'text-slate-500', label: 'not connected' }
      : status === 'available'
        ? { icon: CheckCircle2, tone: 'text-emerald-300', label: 'live' }
        : status === 'skipped'
          ? { icon: CircleSlash, tone: 'text-slate-500', label: 'not used' }
          : { icon: MessageSquareWarning, tone: 'text-rose-300', label: 'unavailable' };
  const meta = SOURCE_DISPLAY[source as keyof typeof SOURCE_DISPLAY];
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-2.5 py-2 min-w-0">
      <div className="flex items-center gap-1.5">
        <effective.icon className={`h-3 w-3 shrink-0 ${effective.tone}`} />
        <span className="text-[11px] font-medium text-slate-200 truncate">{meta?.label ?? source}</span>
        <span className={`ml-auto text-[9px] shrink-0 ${effective.tone}`}>{effective.label}</span>
      </div>
      <p className="text-[9px] text-slate-500 mt-1 leading-tight">{meta?.role ?? ''}</p>
    </div>
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
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="h-3.5 w-3.5 text-amber-400/80" />
        <h4 className="text-[13px] font-semibold text-slate-100">{title}</h4>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-[12px] text-slate-300 leading-relaxed pl-3 border-l border-white/[0.08]">
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
      <span className="block text-[10px] text-slate-500 mb-1.5">{title}</span>
      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="px-2 py-0.5 rounded-md text-[11px] text-slate-300 border border-white/[0.06] bg-white/[0.015]">
              {v}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-slate-600">none detected</span>
      )}
    </div>
  );
}

interface Props {
  report: MarketComplaintReport;
  sourceHealth: RadarSourceHealth | null;
  onSendToAdvisor: () => void;
  onSendToBuilder: () => void;
}

/**
 * Founder-grade result surface, ordered for decision-making:
 * summary + decision → source status → complaint clusters → decision
 * board → ICP → competitor weaknesses → MVP wedge → 7-day sprint →
 * risks → citations. Every derived panel is deterministic and renders
 * an honest "not enough evidence" state when the data is thin.
 */
export default function MarketRadarResults({ report, sourceHealth, onSendToAdvisor, onSendToBuilder }: Props) {
  const { summary } = report;
  const hasClusters = report.complaint_clusters.length > 0;
  const decision = deriveDecision(report);
  const icp = deriveIcp(report);
  const sprint = deriveValidationSprint(report);
  const generatedAt = formatGeneratedAt(report.generated_at);

  const sourceIssues = humanSourceIssues(report, sourceHealth);
  const broadWebWarning =
    typeof summary.evidence_quality === 'number'
      ? summary.evidence_quality < 45 && hasClusters
      : /broad web content/i.test(report.message || '');

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* 1 — Summary: score + confidence + decision */}
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* Opportunity gauge — real API value, not decoration */}
          <div className="relative w-20 h-20 shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="5" />
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
              <span className="text-[8px] text-slate-500">/100</span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-semibold text-slate-100">Opportunity score</h3>
              <span className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${CONFIDENCE_TONE[summary.confidence] || CONFIDENCE_TONE.low}`}>
                {summary.confidence} confidence
              </span>
              <span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${DECISION_CHIP_TONE[decision.bucket]}`}>
                {decision.label}
              </span>
              {typeof summary.evidence_quality === 'number' && (
                <span
                  title={`Average evidence quality ${summary.evidence_quality}/100 — real discussion content scores high, SEO/blog/news low`}
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${evidenceQualityBadge(summary.evidence_quality).tone}`}
                >
                  {evidenceQualityBadge(summary.evidence_quality).label}
                </span>
              )}
              {report.cached && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/[0.08] text-[10px] text-slate-400">
                  <Clock3 className="h-2.5 w-2.5" /> cached result
                </span>
              )}
            </div>
            {summary.top_complaint_area ? (
              <p className="text-[12px] text-slate-400 mt-1">
                Loudest complaint area: <span className="text-slate-200 font-medium">{summary.top_complaint_area}</span>
              </p>
            ) : (
              <p className="text-[12px] text-slate-400 mt-1">No dominant complaint area detected.</p>
            )}
            <p className="text-[11px] text-slate-500 mt-1">
              {summary.total_items_analyzed} items from {summary.total_sources} live source
              {summary.total_sources === 1 ? '' : 's'}
              {typeof summary.direct_complaints === 'number' && (
                <> · <span className="text-emerald-300/90">{summary.direct_complaints} direct complaint{summary.direct_complaints === 1 ? '' : 's'}</span></>
              )}
              {' '}· last {report.timeframe_days} days
              {generatedAt && ` · generated ${generatedAt}`}
            </p>
          </div>

          {hasClusters && (
            <div className="flex flex-col gap-1.5 shrink-0 w-full sm:w-auto">
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onSendToAdvisor}
                className="h-9 px-4 rounded-xl bg-amber-500/[0.14] border border-amber-500/35 text-amber-100 text-[12px] font-medium hover:bg-amber-500/[0.2] transition-all flex items-center justify-center gap-2"
              >
                <Rocket className="h-3.5 w-3.5" /> Send to Startup Advisor
                <ArrowUpRight className="h-3 w-3" />
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onSendToBuilder}
                className="h-9 px-4 rounded-xl bg-white/[0.04] border border-white/[0.1] text-slate-200 text-[12px] font-medium hover:bg-white/[0.08] hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <Hammer className="h-3.5 w-3.5" /> Send to Builder
                <ArrowUpRight className="h-3 w-3" />
              </motion.button>
            </div>
          )}
        </div>

        {/* Honest, human notices — no internal keys or raw backend notes */}
        {(broadWebWarning || sourceIssues || (!hasClusters && report.message)) && (
          <div className="mt-3 space-y-1">
            {!hasClusters && report.message && (
              <p className="text-[12px] text-slate-300 border-l-2 border-amber-500/30 pl-2.5">{report.message}</p>
            )}
            {broadWebWarning && (
              <p className="text-[12px] text-slate-300 border-l-2 border-amber-500/30 pl-2.5">
                Evidence is mostly broad web content; validate with direct user conversations.
              </p>
            )}
            {sourceIssues && (
              <p className="text-[11px] text-slate-400 border-l-2 border-white/[0.08] pl-2.5">{sourceIssues}</p>
            )}
          </div>
        )}
      </div>

      {/* 2 — Source status + limitations */}
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(report.data_freshness).map(([source, status]) => (
            <SourceStatusCard
              key={source}
              source={source}
              status={status}
              configured={sourceHealth ? sourceHealth.sources[source as keyof typeof sourceHealth.sources]?.configured ?? null : null}
            />
          ))}
        </div>
        <details className="mt-3 group">
          <summary className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer select-none transition-colors">
            Data limitations
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
            {sourceIssues && <li>• {sourceIssues}</li>}
            {summary.confidence === 'low' && (
              <li>• Confidence is LOW — treat every insight below as a hypothesis to test, not a finding.</li>
            )}
            {broadWebWarning && (
              <li>• Evidence skews toward broad web content rather than direct user complaints.</li>
            )}
            <li>• This is directional evidence from public discussions, not statistically representative proof.</li>
          </ul>
        </details>
      </div>

      {/* 3 — Complaint clusters */}
      {hasClusters && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Flame className="h-3.5 w-3.5 text-rose-300" />
            <h3 className="text-[13px] font-semibold text-slate-100">Ranked complaint clusters</h3>
          </div>
          <div className="space-y-2.5">
            {report.complaint_clusters.map((cluster, i) => (
              <ComplaintClusterCard key={cluster.id} cluster={cluster} rank={i} />
            ))}
          </div>
        </div>
      )}

      {/* 4 — Opportunity decision board */}
      <OpportunityDecisionBoard decision={decision} />

      {/* 5 — ICP / first users */}
      <IcpPanel icp={icp} report={report} />

      {/* 6 — Competitor weaknesses */}
      <CompetitorWeaknessPanel report={report} />

      {/* 7 — MVP wedge & positioning */}
      {hasClusters && (
        <RecommendationBlock
          icon={ListChecks}
          title="MVP wedge & positioning"
          items={[
            ...report.recommendations.mvp_wedge,
            ...report.recommendations.startup_angles,
            ...report.recommendations.landing_page_angles,
          ]}
        />
      )}

      {/* Market signals — compact, feeds the panels above */}
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-3.5 w-3.5 text-cyan-300" />
          <h3 className="text-[13px] font-semibold text-slate-100">Market signals</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <SignalList title="Trending keywords" values={report.market_signals.trending_keywords} />
          <SignalList title="Underserved segments" values={report.market_signals.underserved_segments} />
          <SignalList title="Common workarounds" values={report.market_signals.common_workarounds} />
          <SignalList title="Competitors mentioned" values={report.market_signals.competitors_mentioned} />
        </div>
      </div>

      {/* 8 — 7-day validation sprint */}
      {sprint && <ValidationSprintPanel sprint={sprint} />}

      {/* 9 — Risks */}
      {hasClusters && (
        <RecommendationBlock icon={ShieldAlert} title="Risks" items={report.recommendations.risks} />
      )}

      {/* 10 — Citations */}
      {report.citations.length > 0 && (
        <details className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
          <summary className="text-[12px] font-medium text-slate-300 cursor-pointer select-none">
            All citations ({report.citations.length})
          </summary>
          <ul className="mt-3 space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-1">
            {report.citations.map((c) => (
              <li key={c.url} className="flex items-start gap-2 min-w-0">
                <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] text-slate-400 border border-white/[0.06]">
                  {sourceLabel(c.source)}
                </span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-slate-300 hover:text-cyan-300 transition-colors truncate"
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
