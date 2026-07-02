import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight, Clock3,
  Flame, Hammer, ListChecks, Rocket, ShieldAlert, Target,
} from 'lucide-react';
import {
  sourceLabel,
  type MarketComplaintReport, type RadarSourceHealth,
} from '@/lib/startupMarketApi';
import {
  deriveDecision, deriveIcp, deriveValidationSprint,
} from '@/lib/startupRadarInsights';
import ComplaintClusterCard from './ComplaintClusterCard';
import CompetitorWeaknessPanel from './CompetitorWeaknessPanel';
import EvidenceTrail from './EvidenceTrail';
import IcpPanel from './IcpPanel';
import ValidationSprintPanel from './ValidationSprintPanel';

const TOP_CLUSTERS_VISIBLE = 3;

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-[#86A08F] border-[#6F8F7A]/40 bg-[#6F8F7A]/[0.12]',
  medium: 'text-[#637B90] border-[#52677A]/40 bg-[#52677A]/[0.12]',
  low: 'text-slate-300 border-white/[0.1] bg-white/[0.04]',
};

const DECISION_CHIP_TONE: Record<string, string> = {
  build: 'text-[#86A08F] border-[#6F8F7A]/40 bg-[#6F8F7A]/[0.12]',
  validate: 'text-[#637B90] border-[#52677A]/40 bg-[#52677A]/[0.12]',
  avoid: 'text-[#C98A93] border-[#B76E79]/40 bg-[#B76E79]/[0.12]',
};

/** Evidence-quality badge tiers (avg item quality 0-100 from backend). */
function evidenceQualityBadge(score: number): { label: string; tone: string } {
  if (score >= 70) return { label: 'strong evidence', tone: 'text-[#86A08F] border-[#6F8F7A]/40 bg-[#6F8F7A]/[0.12]' };
  if (score >= 45) return { label: 'moderate evidence', tone: 'text-[#637B90] border-[#52677A]/40 bg-[#52677A]/[0.12]' };
  return { label: 'weak evidence', tone: 'text-[#C98A93] border-[#B76E79]/40 bg-[#B76E79]/[0.12]' };
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
 * notes. Deliberately deselected sources are not reported as issues. */
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

function Section({
  icon: Icon,
  iconTone,
  title,
  children,
}: {
  icon: typeof Rocket;
  iconTone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`h-3.5 w-3.5 ${iconTone}`} />
        <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-[12px] text-slate-300 leading-relaxed pl-3 border-l border-white/[0.08]">
          {item}
        </li>
      ))}
    </ul>
  );
}

function SignalList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <span className="block text-[10px] text-slate-500 mb-1.5">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="px-2 py-0.5 rounded-md text-[11px] text-slate-300 border border-white/[0.06] bg-white/[0.015]">
            {v}
          </span>
        ))}
      </div>
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
 * Founder research cockpit, simplest-first:
 * 1 summary+decision · 2 top pains · 3 what to build first ·
 * 4 who to sell to first · 5 7-day sprint · 6 evidence trail.
 * Secondary material (market signals, competitor detail, risks) is
 * collapsed or reduced to muted notes when empty. Every panel is
 * deterministic and honest about thin data.
 */
export default function MarketRadarResults({
  report, sourceHealth, onSendToAdvisor, onSendToBuilder,
}: Props) {
  const { summary } = report;
  const hasClusters = report.complaint_clusters.length > 0;
  const decision = deriveDecision(report);
  const icp = deriveIcp(report);
  const sprint = deriveValidationSprint(report);
  const generatedAt = formatGeneratedAt(report.generated_at);
  const [showAllClusters, setShowAllClusters] = useState(false);

  const sourceIssues = humanSourceIssues(report, sourceHealth);
  const broadWebWarning =
    typeof summary.evidence_quality === 'number'
      ? summary.evidence_quality < 45 && hasClusters
      : /broad web content/i.test(report.message || '');

  const visibleClusters = showAllClusters
    ? report.complaint_clusters
    : report.complaint_clusters.slice(0, TOP_CLUSTERS_VISIBLE);
  const hiddenClusterCount = report.complaint_clusters.length - TOP_CLUSTERS_VISIBLE;

  const buildFirstItems = [
    ...report.recommendations.mvp_wedge,
    ...report.recommendations.landing_page_angles.slice(0, 2),
    ...report.recommendations.startup_angles.slice(0, 1),
  ];

  const competitors = report.market_signals.competitors_mentioned;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* 1 — Summary: score + decision + confidence + quality + reason */}
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* Opportunity gauge — real API value, not decoration */}
          <div className="relative w-20 h-20 shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="5" />
              <motion.circle
                cx="40" cy="40" r="34" fill="none" stroke="#52677A" strokeWidth="5" strokeLinecap="round"
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
              <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${DECISION_CHIP_TONE[decision.bucket]}`}>
                {decision.label}
              </span>
              <span className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${CONFIDENCE_TONE[summary.confidence] || CONFIDENCE_TONE.low}`}>
                {summary.confidence} confidence
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
                  <Clock3 className="h-2.5 w-2.5" /> cached
                </span>
              )}
            </div>
            {/* The one-sentence reason */}
            <p className="text-[12px] text-slate-300 leading-relaxed mt-1.5">{decision.reason}</p>
            <p className="text-[11px] text-slate-500 mt-1">
              {summary.total_items_analyzed} items from {summary.total_sources} live source
              {summary.total_sources === 1 ? '' : 's'}
              {typeof summary.direct_complaints === 'number' && (
                <> · <span className="text-[#86A08F]">{summary.direct_complaints} direct complaint{summary.direct_complaints === 1 ? '' : 's'}</span></>
              )}
              {' '}· last {report.timeframe_days} days
              {generatedAt && ` · ${generatedAt}`}
            </p>
          </div>

          {hasClusters && (
            <div className="flex flex-col gap-1.5 shrink-0 w-full sm:w-auto">
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={onSendToAdvisor}
                className="h-9 px-4 rounded-xl bg-[#52677A]/[0.16] border border-[#52677A]/45 text-[#DCE4EC] text-[12px] font-medium hover:bg-[#52677A]/[0.22] transition-all flex items-center justify-center gap-2"
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

        {/* Honest notices + per-source status, kept quiet */}
        {(broadWebWarning || sourceIssues || (!hasClusters && report.message)) && (
          <div className="mt-3 space-y-1">
            {!hasClusters && report.message && (
              <p className="text-[12px] text-slate-300 border-l-2 border-[#52677A]/40 pl-2.5">{report.message}</p>
            )}
            {broadWebWarning && (
              <p className="text-[12px] text-slate-300 border-l-2 border-[#52677A]/40 pl-2.5">
                Evidence is mostly broad web content; validate with direct user conversations.
              </p>
            )}
            {sourceIssues && (
              <p className="text-[11px] text-slate-400 border-l-2 border-white/[0.08] pl-2.5">{sourceIssues}</p>
            )}
          </div>
        )}
        <details className="mt-2 group/lim">
          <summary className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors">
            <ChevronRight className="h-3 w-3 transition-transform group-open/lim:rotate-90" />
            Sources & limitations
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
            <li>
              • Sources this run:{' '}
              {Object.entries(report.data_freshness)
                .map(([s, status]) => `${sourceLabel(s)} (${
                  status === 'available' ? 'live'
                    : status === 'unavailable' ? 'unavailable'
                    : sourceHealth?.sources[s as keyof RadarSourceHealth['sources']]?.configured === false
                      ? 'not connected' : 'not used'
                })`)
                .join(' · ')}
            </li>
            {summary.confidence === 'low' && (
              <li>• Confidence is LOW — treat every insight as a hypothesis to test, not a finding.</li>
            )}
            <li>• Directional evidence from public discussions, not statistically representative proof.</li>
          </ul>
        </details>
      </div>

      {/* 2 — Top pains */}
      {hasClusters && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Flame className="h-3.5 w-3.5 text-[#C98A93]" />
            <h3 className="text-[13px] font-semibold text-slate-100">Top pains</h3>
          </div>
          <div className="space-y-2.5">
            {visibleClusters.map((cluster, i) => (
              <ComplaintClusterCard key={cluster.id} cluster={cluster} rank={i} />
            ))}
          </div>
          {!showAllClusters && hiddenClusterCount > 0 && (
            <button
              onClick={() => setShowAllClusters(true)}
              className="mt-2.5 flex items-center gap-1 text-[11px] text-[#637B90] hover:text-[#7890A3] transition-colors"
            >
              <ChevronDown className="h-3 w-3" />
              Show {hiddenClusterCount} more cluster{hiddenClusterCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {/* 3 — What to build first */}
      {hasClusters && buildFirstItems.length > 0 && (
        <Section icon={ListChecks} iconTone="text-[#637B90]" title="What to build first">
          <BulletList items={buildFirstItems} />
          <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-2.5 py-2">
            <AlertTriangle className="h-3 w-3 text-[#637B90] shrink-0 mt-0.5" />
            <p className="text-[12px] text-slate-300 leading-relaxed">
              <span className="text-slate-100 font-medium">Riskiest assumption: </span>
              {decision.riskiestAssumption}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 pl-2.5 border-l-2 border-white/[0.08]">
            Next: {decision.nextAction}
          </p>
        </Section>
      )}

      {/* 4 — Who to sell to first */}
      <IcpPanel icp={icp} report={report} />

      {/* 5 — 7-day validation sprint */}
      {sprint && <ValidationSprintPanel sprint={sprint} />}

      {/* 6 — Evidence trail */}
      {/* Collapsed by default — expand to inspect the pages actually used */}
      <EvidenceTrail report={report} />

      {/* Secondary — competitors: full panel only when something was found */}
      {competitors.length > 0 ? (
        <CompetitorWeaknessPanel report={report} />
      ) : (
        <p className="text-[11px] text-slate-500 px-1">
          No strong competitor mentions found in this run.
        </p>
      )}

      {/* Secondary — market signals + risks, collapsed */}
      {hasClusters && (
        <details className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4 group/sig">
          <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 text-slate-500 transition-transform group-open/sig:rotate-90" />
            <Target className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[13px] font-semibold text-slate-100">Market signals & risks</span>
          </summary>
          <div className="grid sm:grid-cols-2 gap-4 mt-3">
            <SignalList title="Trending keywords" values={report.market_signals.trending_keywords} />
            <SignalList title="Underserved segments" values={report.market_signals.underserved_segments} />
            <SignalList title="Common workarounds" values={report.market_signals.common_workarounds} />
            <SignalList title="Competitors mentioned" values={competitors} />
          </div>
          {report.recommendations.risks.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 mb-2">
                <ShieldAlert className="h-3 w-3 text-[#637B90]" />
                <span className="text-[11px] font-medium text-slate-200">Risks</span>
              </div>
              <BulletList items={report.recommendations.risks} />
            </div>
          )}
        </details>
      )}
    </motion.div>
  );
}
