import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight, ChevronDown, ChevronRight, Clock3,
  Database, Flame, Hammer, ListChecks, Rocket, ShieldAlert, Swords, Target,
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

/** Plain-language decision label shown to normal users (bucket → words).
 * Presentation only — the underlying decision logic is unchanged. */
const DECISION_LABEL: Record<string, string> = {
  build: 'Build now',
  validate: 'Validate first',
  avoid: 'Avoid for now',
};

/** Verdict word tone — text-only, palette accents (success/accent/danger). */
const DECISION_VERDICT_TONE: Record<string, string> = {
  build: 'text-[#86A08F]',
  validate: 'text-[#60A5FA]',
  avoid: 'text-[#C98A93]',
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-[#86A08F] border-[#4ADE80]/40 bg-[#4ADE80]/[0.12]',
  medium: 'text-[#60A5FA] border-[#3B82F6]/40 bg-[#3B82F6]/[0.12]',
  low: 'text-slate-300 border-white/[0.1] bg-white/[0.04]',
};

/** Evidence-quality badge tiers (avg item quality 0-100 from backend). */
function evidenceQualityBadge(score: number): { label: string; tone: string } {
  if (score >= 70) return { label: 'strong evidence', tone: 'text-[#86A08F] border-[#4ADE80]/40 bg-[#4ADE80]/[0.12]' };
  if (score >= 45) return { label: 'moderate evidence', tone: 'text-[#60A5FA] border-[#3B82F6]/40 bg-[#3B82F6]/[0.12]' };
  return { label: 'weak evidence', tone: 'text-[#C98A93] border-[#F87171]/40 bg-[#F87171]/[0.12]' };
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

/** Per-source unavailable phrases — no internal keys, no raw backend
 * notes. Deliberately deselected sources are not reported as issues.
 * Returns the individual phrases so the UI can show a calm one-liner and
 * tuck the detail behind an expandable row. */
function sourceIssuePhrases(
  report: MarketComplaintReport,
  sourceHealth: RadarSourceHealth | null,
): string[] {
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
  return phrases;
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
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className={`h-3.5 w-3.5 ${iconTone}`} />
        <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** Clean stacked label → value block (no fixed-width label column). */
function LabeledBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[10px] font-medium uppercase tracking-[0.06em] text-[#64748B] mb-1">{label}</span>
      <div className="text-[12.5px] text-slate-300 leading-relaxed">{children}</div>
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
      <span className="block text-[10px] text-[#94A3B8] mb-1.5">{title}</span>
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
 * Simplest-first founder result:
 *   Recommendation card (score · decision · one-line summary · next step)
 *   → what people complain about (top 3) → what to build first →
 *   first customers → validation plan (Day 1-2). Everything heavier —
 *   sources used, competitor detail, signals & risks, full plan, data
 *   limitations — is collapsed behind "Show details" controls. Every
 *   panel stays deterministic and honest about thin data.
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

  const issuePhrases = sourceIssuePhrases(report, sourceHealth);
  const broadWebWarning =
    typeof summary.evidence_quality === 'number'
      ? summary.evidence_quality < 45 && hasClusters
      : /broad web content/i.test(report.message || '');

  const visibleClusters = showAllClusters
    ? report.complaint_clusters
    : report.complaint_clusters.slice(0, TOP_CLUSTERS_VISIBLE);
  const hiddenClusterCount = report.complaint_clusters.length - TOP_CLUSTERS_VISIBLE;

  // Product recommendation — labeled parts, not a flat bullet list.
  const mvpWedge = report.recommendations.mvp_wedge;
  const whyWedge = report.recommendations.startup_angles[0];
  // Longer supporting angles live behind "Show reasoning".
  const reasoningItems = [
    ...report.recommendations.startup_angles.slice(1),
    ...report.recommendations.landing_page_angles,
  ];
  const hasBuildGuidance =
    mvpWedge.length > 0 || report.recommendations.startup_angles.length > 0
    || report.recommendations.landing_page_angles.length > 0;

  const competitors = report.market_signals.competitors_mentioned;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* ── Market decision — the visual hero ── */}
      <div className="rounded-2xl border border-[#253142] bg-[#111722] p-5 sm:p-6">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#64748B]">Market decision</span>

        {/* Big score + big verdict word */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3">
          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className="text-[26px] font-bold text-white leading-none">{summary.opportunity_score}</span>
            <span className="text-[13px] font-medium text-[#64748B]">/100</span>
          </div>
          <span className={`text-[22px] font-bold leading-none ${DECISION_VERDICT_TONE[decision.bucket] ?? 'text-slate-100'}`}>
            {DECISION_LABEL[decision.bucket] ?? decision.label}
          </span>
        </div>

        {/* One plain-English summary line */}
        <p className="text-[13px] text-slate-300 leading-relaxed mt-3">{decision.reason}</p>

        {/* Clear next step — subtle accent box */}
        {hasClusters && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#3B82F6]/[0.06] border border-[#3B82F6]/20 px-3.5 py-3">
            <ListChecks className="h-3.5 w-3.5 text-[#60A5FA] shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-slate-200 leading-relaxed">
              <span className="font-semibold text-[#F8FAFC]">Next step: </span>
              {decision.nextAction}
            </p>
          </div>
        )}

        {/* Two primary actions */}
        {hasClusters && (
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={onSendToAdvisor}
              className="flex-1 h-10 px-4 rounded-xl bg-[#3B82F6]/[0.16] border border-[#3B82F6]/45 text-[#DCE4EC] text-[12.5px] font-medium hover:bg-[#3B82F6]/[0.22] transition-all flex items-center justify-center gap-2"
            >
              <Rocket className="h-3.5 w-3.5" /> Validate with users
              <ArrowUpRight className="h-3 w-3" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={onSendToBuilder}
              className="flex-1 h-10 px-4 rounded-xl bg-white/[0.04] border border-white/[0.1] text-slate-200 text-[12.5px] font-medium hover:bg-white/[0.08] hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <Hammer className="h-3.5 w-3.5" /> Create build plan
              <ArrowUpRight className="h-3 w-3" />
            </motion.button>
          </div>
        )}

        {/* Quiet secondary metadata row */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4">
          <span className={`px-1.5 py-0.5 rounded border text-[9.5px] font-medium ${CONFIDENCE_TONE[summary.confidence] || CONFIDENCE_TONE.low}`}>
            {summary.confidence} confidence
          </span>
          {typeof summary.evidence_quality === 'number' && (
            <span
              title={`Average evidence quality ${summary.evidence_quality}/100 — real discussion content scores high, SEO/blog/news low`}
              className={`px-1.5 py-0.5 rounded border text-[9.5px] font-medium ${evidenceQualityBadge(summary.evidence_quality).tone}`}
            >
              {evidenceQualityBadge(summary.evidence_quality).label}
            </span>
          )}
          {report.cached && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.08] text-[9.5px] text-[#94A3B8]">
              <Clock3 className="h-2.5 w-2.5" /> cached
            </span>
          )}
          <span className="text-[10px] text-[#64748B]">
            {summary.total_items_analyzed} items · {summary.total_sources} source{summary.total_sources === 1 ? '' : 's'}
            {generatedAt && ` · ${generatedAt}`}
          </span>
        </div>

        {/* Calm notices — one line, detail on demand */}
        {(broadWebWarning || issuePhrases.length > 0 || (!hasClusters && report.message)) && (
          <div className="mt-3 space-y-1.5">
            {!hasClusters && report.message && (
              <p className="text-[12px] text-slate-300 border-l-2 border-[#3B82F6]/40 pl-2.5">{report.message}</p>
            )}
            {broadWebWarning && (
              <p className="text-[12px] text-slate-300 border-l-2 border-[#3B82F6]/40 pl-2.5">
                Evidence is mostly broad web content; validate with direct user conversations.
              </p>
            )}
            {issuePhrases.length > 0 && (
              <details className="group/src">
                <summary className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-slate-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors">
                  <ChevronRight className="h-3 w-3 transition-transform group-open/src:rotate-90" />
                  Some sources were unavailable.
                  <span className="text-[#64748B]">View source status</span>
                </summary>
                <ul className="mt-1.5 ml-4 space-y-0.5 text-[11px] text-[#94A3B8]">
                  {issuePhrases.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* ── What people complain about (top 3) ── */}
      {hasClusters && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <Flame className="h-3.5 w-3.5 text-[#C98A93]" />
            <h3 className="text-[13px] font-semibold text-slate-100">What people complain about</h3>
          </div>
          <div className="space-y-2.5">
            {visibleClusters.map((cluster, i) => (
              <ComplaintClusterCard key={cluster.id} cluster={cluster} rank={i} />
            ))}
          </div>
          {!showAllClusters && hiddenClusterCount > 0 && (
            <button
              onClick={() => setShowAllClusters(true)}
              className="mt-2.5 flex items-center gap-1 text-[11px] text-[#60A5FA] hover:text-[#60A5FA] transition-colors"
            >
              <ChevronDown className="h-3 w-3" />
              Show {hiddenClusterCount} more complaint{hiddenClusterCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      {/* ── What to build first — clean labeled card ── */}
      {hasClusters && hasBuildGuidance && (
        <Section icon={ListChecks} iconTone="text-[#60A5FA]" title="What to build first">
          <div className="rounded-xl border border-[#253142] bg-[#111722] p-4 space-y-3.5">
            {mvpWedge.length > 0 && (
              <LabeledBlock label="MVP wedge">
                {mvpWedge.length === 1 ? (
                  <p>{mvpWedge[0]}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {mvpWedge.map((w, i) => (
                      <li key={i} className="pl-3 border-l border-white/[0.08]">{w}</li>
                    ))}
                  </ul>
                )}
              </LabeledBlock>
            )}
            {whyWedge && <LabeledBlock label="Why this wedge">{whyWedge}</LabeledBlock>}
            <LabeledBlock label="Riskiest assumption">{decision.riskiestAssumption}</LabeledBlock>
            <LabeledBlock label="Next action">{decision.nextAction}</LabeledBlock>

            {reasoningItems.length > 0 && (
              <details className="group/why">
                <summary className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-slate-300 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors">
                  <ChevronRight className="h-3 w-3 transition-transform group-open/why:rotate-90" />
                  Show reasoning
                </summary>
                <ul className="mt-2.5 space-y-1.5">
                  {reasoningItems.map((item, i) => (
                    <li key={i} className="text-[12px] text-slate-300 leading-relaxed pl-3 border-l border-white/[0.08]">
                      {item}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Section>
      )}

      {/* ── First customers to target ── */}
      <IcpPanel icp={icp} report={report} />

      {/* ── Validation plan (Day 1-2 preview) ── */}
      {sprint && <ValidationSprintPanel sprint={sprint} />}

      {/* ── Collapsed advanced material ── */}
      {/* Sources used — collapsed */}
      <EvidenceTrail report={report} />

      {/* Competitor weaknesses — collapsed, only when something was found */}
      {competitors.length > 0 && (
        <details className="rounded-xl border border-[#253142] bg-[#111722] p-4 group/comp transition-colors hover:border-[rgba(59,130,246,0.30)]">
          <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8] transition-transform group-open/comp:rotate-90" />
            <Swords className="h-3.5 w-3.5 text-[#60A5FA]" />
            <span className="text-[13px] font-semibold text-slate-100">Competitor weaknesses</span>
          </summary>
          <div className="mt-3">
            <CompetitorWeaknessPanel report={report} />
          </div>
        </details>
      )}

      {/* Signals and risks — collapsed */}
      {hasClusters && (
        <details className="rounded-xl border border-[#253142] bg-[#111722] p-4 group/sig transition-colors hover:border-[rgba(59,130,246,0.30)]">
          <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8] transition-transform group-open/sig:rotate-90" />
            <Target className="h-3.5 w-3.5 text-[#3B82F6]" />
            <span className="text-[13px] font-semibold text-slate-100">Signals and risks</span>
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
                <ShieldAlert className="h-3 w-3 text-[#60A5FA]" />
                <span className="text-[11px] font-medium text-slate-200">Risks</span>
              </div>
              <BulletList items={report.recommendations.risks} />
            </div>
          )}
        </details>
      )}

      {/* Data limitations — collapsed, bottom of the technical block */}
      <details className="rounded-xl border border-[#253142] bg-[#111722] p-4 group/lim transition-colors hover:border-[rgba(59,130,246,0.30)]">
        <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3.5 w-3.5 text-[#94A3B8] transition-transform group-open/lim:rotate-90" />
          <Database className="h-3.5 w-3.5 text-[#60A5FA]" />
          <span className="text-[13px] font-semibold text-slate-100">Data limitations</span>
        </summary>
        <ul className="mt-3 space-y-1 text-[11px] text-[#94A3B8]">
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
    </motion.div>
  );
}
