/**
 * Startup Radar — deterministic founder insights derived from a report.
 *
 * Everything here is computed from observed report data (clusters,
 * market signals, recommendations, summary). Nothing is fetched and
 * nothing is invented: when the evidence is too weak for a section,
 * the deriver returns null / flags the output as hypothesis so the UI
 * can render an honest "not enough evidence" state instead.
 */
import type { ComplaintCluster, MarketComplaintReport } from './startupMarketApi';

/* ── Opportunity decision ──────────────────────────────────────────────── */

export type DecisionBucket = 'build' | 'validate' | 'avoid';

export interface RadarDecision {
  bucket: DecisionBucket;
  label: string;
  reason: string;
  nextAction: string;
  riskiestAssumption: string;
}

function usefulClusters(report: MarketComplaintReport): ComplaintCluster[] {
  // "Useful" = more than a single stray complaint signal.
  return report.complaint_clusters.filter((c) => c.frequency >= 2);
}

export function deriveDecision(report: MarketComplaintReport): RadarDecision {
  const { summary } = report;
  const score = summary.opportunity_score;
  const clusters = report.complaint_clusters;
  const top = clusters[0];
  const useful = usefulClusters(report);

  // Riskiest assumption — pick the weakest link in the actual evidence.
  let riskiestAssumption: string;
  if (!top) {
    riskiestAssumption = 'That this market has real, expressed pain at all — none was captured in this run.';
  } else if (top.willingness_to_pay_signal < 20) {
    riskiestAssumption = `That people complaining about "${top.label}" will actually pay — no pricing/budget language was observed.`;
  } else if (top.frequency < 4) {
    riskiestAssumption = `That the "${top.label}" pain is widespread — only ${top.frequency} signals back it so far.`;
  } else if (top.saturation_risk >= 60) {
    riskiestAssumption = 'That a narrow wedge can survive the competitors already named in the evidence.';
  } else {
    riskiestAssumption = `That "${top.label}" is urgent enough to switch tools for, not just to complain about.`;
  }

  // Avoid: weak score, no evidence, or crowded space with no pay signal.
  const noPaySignal = top ? top.willingness_to_pay_signal < 20 : true;
  const highSaturation = top ? top.saturation_risk >= 70 : false;
  if (score < 40 || clusters.length === 0 || (highSaturation && noPaySignal)) {
    return {
      bucket: 'avoid',
      label: 'Avoid / risky',
      reason: clusters.length === 0
        ? 'No complaint clusters were found in the configured sources — there is no observed pain to build against.'
        : `Opportunity score ${score}/100 with ${summary.confidence} confidence` +
          (highSaturation && noPaySignal
            ? ', named competitors in the evidence, and no willingness-to-pay language.'
            : ' — the observed evidence is too weak to justify building.'),
      nextAction: 'Re-run with a narrower niche or a different angle before spending any build time.',
      riskiestAssumption,
    };
  }

  // Build now: strong score, believable confidence, multiple real clusters.
  if (score >= 70 && (summary.confidence === 'medium' || summary.confidence === 'high') && useful.length >= 2) {
    return {
      bucket: 'build',
      label: 'Build now',
      reason: `Opportunity ${score}/100 with ${summary.confidence} confidence and ${useful.length} complaint clusters carrying repeated signals — the pain is observed, not guessed.`,
      nextAction: top
        ? `Scope the smallest product that removes "${top.label}" end-to-end and start the 7-day validation sprint below in parallel.`
        : 'Scope the smallest product against the top cluster and start the 7-day validation sprint.',
      riskiestAssumption,
    };
  }

  // Everything else: validate first.
  return {
    bucket: 'validate',
    label: 'Validate first',
    reason: `Opportunity ${score}/100 with ${summary.confidence} confidence` +
      (useful.length < 2
        ? ` and only ${useful.length} cluster${useful.length === 1 ? '' : 's'} with repeated signals`
        : '') +
      ' — promising but not proven. Talk to the market before building.',
    nextAction: top
      ? `Run the 7-day validation sprint anchored on "${top.label}" before writing product code.`
      : 'Run the 7-day validation sprint before writing product code.',
    riskiestAssumption,
  };
}

/* ── ICP / first users ─────────────────────────────────────────────────── */

export interface RadarIcp {
  segment: string;
  buyingTrigger: string;
  outreachAngle: string;
  whereToFind: string;
  whyNow: string;
  /** true when the segment wasn't observed in evidence — clearly a guess. */
  isHypothesis: boolean;
}

const SOURCE_COMMUNITY: Record<string, string> = {
  hackernews: 'the Hacker News threads in the citations',
  reddit: 'the Reddit threads in the citations',
  web: 'the forums/review pages in the citations',
  producthunt: 'Product Hunt launch comment sections',
  gdelt: 'communities around the news articles in the citations',
};

export function deriveIcp(report: MarketComplaintReport): RadarIcp | null {
  const top = report.complaint_clusters[0];
  if (!top) return null;

  const observedSegment = report.market_signals.underserved_segments[0];
  const segment = observedSegment
    ? observedSegment
    : `early adopters inside "${report.query}" who posted the complaints in the evidence`;

  const liveSources = Object.entries(report.data_freshness)
    .filter(([, status]) => status === 'available')
    .map(([source]) => SOURCE_COMMUNITY[source])
    .filter(Boolean);

  const trigger =
    top.urgency >= 50
      ? `They are actively hunting for a replacement — the "${top.label}" evidence includes switching/alternative-seeking language.`
      : `Hitting "${top.label}" pain in their current tool or workflow.`;

  const wtp = top.willingness_to_pay_signal;

  return {
    segment,
    buyingTrigger: trigger,
    outreachAngle: `Lead with their own words: quote the "${top.label}" complaint pattern back to them and offer a concrete fix, not a product pitch.`,
    whereToFind: liveSources.length
      ? `Start in ${liveSources.slice(0, 2).join(' and ')} — the complainers in this report are literal named leads.`
      : 'The evidence threads in the citations below — each complainer is a potential first conversation.',
    whyNow: top.recency >= 50
      ? 'The complaint signals in this run are recent within the selected window — the pain is current, not historical.'
      : 'Signals in this run skew older — confirm the pain is still current in your first conversations.',
    isHypothesis: !observedSegment,
  };
}

/* ── 7-day validation sprint ───────────────────────────────────────────── */

export interface SprintDay {
  day: number;
  title: string;
  detail: string;
}

export function deriveValidationSprint(report: MarketComplaintReport): SprintDay[] | null {
  const top = report.complaint_clusters[0];
  if (!top) return null;
  const icp = deriveIcp(report);
  const segment = icp?.segment ?? `the "${report.query}" niche`;
  const competitor = report.market_signals.competitors_mentioned[0];

  return [
    {
      day: 1,
      title: 'Pick the narrow segment + landing hypothesis',
      detail: `Target: ${segment}. Hypothesis: "${top.label}" (pain ${top.pain_score}/100) is worth paying to fix. Write one landing headline that mirrors that complaint.`,
    },
    {
      day: 2,
      title: 'Collect 20 leads from the evidence communities',
      detail: icp
        ? `${icp.whereToFind} Build a list of 20 people who expressed "${top.label}"-type pain.`
        : `Use the citation threads to list 20 people who expressed "${top.label}"-type pain.`,
    },
    {
      day: 3,
      title: 'Send outreach',
      detail: `Message all 20. ${icp?.outreachAngle ?? 'Quote their complaint back and offer a concrete fix.'} Goal: 5 booked conversations.`,
    },
    {
      day: 4,
      title: 'Run 5 calls',
      detail: `Ask how they handle "${top.label}" today, what it costs them, and what they've already tried${competitor ? ` (including ${competitor}, which appears in the evidence)` : ''}. Do not pitch.`,
    },
    {
      day: 5,
      title: 'Concierge mock / demo',
      detail: `Manually deliver the fix for "${top.label}" for 1–2 of the calls — a mock, spreadsheet, or hand-run workflow. No code.`,
    },
    {
      day: 6,
      title: 'Ask for money',
      detail: top.willingness_to_pay_signal >= 40
        ? 'Offer a paid pilot — pricing language already appears in the evidence, so a direct ask is warranted.'
        : 'Offer a paid pilot or, if that stalls, a committed waitlist. Note: no strong pricing language was observed, so expect resistance and treat it as data.',
    },
    {
      day: 7,
      title: 'Decide: build / pivot / kill',
      detail: `Build if ≥2 of 5 calls confirmed urgent "${top.label}" pain and at least one accepted the paid ask. Pivot to the #2 cluster${report.complaint_clusters[1] ? ` ("${report.complaint_clusters[1].label}")` : ''} if the pain is real but the wedge is wrong. Kill if nobody cared.`,
    },
  ];
}

/* ── Builder handoff prompt ────────────────────────────────────────────── */

export function buildBuilderPrompt(report: MarketComplaintReport): string {
  const top = report.complaint_clusters[0];
  const icp = deriveIcp(report);
  const lines: string[] = [];
  lines.push('Build a landing page and MVP concept for this evidence-backed startup wedge.');
  lines.push('');
  lines.push(`Market: ${report.query}`);
  if (top) {
    lines.push(`Top complaint (from Korvix Market Complaint Radar, ${report.summary.confidence} confidence): "${top.label}" — pain ${top.pain_score}/100, ${top.frequency} signals.`);
    const quote = top.sample_quotes[0];
    if (quote) lines.push(`Evidence quote (${quote.source}): "${quote.text}"`);
  }
  if (icp) {
    lines.push(`Target customer: ${icp.segment}${icp.isHypothesis ? ' (hypothesis — not directly observed)' : ''}.`);
  }
  if (report.recommendations.mvp_wedge.length) {
    lines.push('MVP wedge:');
    report.recommendations.mvp_wedge.forEach((w) => lines.push(`- ${w}`));
  }
  if (report.recommendations.landing_page_angles.length) {
    lines.push('Landing page angles:');
    report.recommendations.landing_page_angles.forEach((a) => lines.push(`- ${a}`));
  }
  if (report.recommendations.risks.length) {
    lines.push('Known risks (do not gloss over):');
    report.recommendations.risks.slice(0, 3).forEach((r) => lines.push(`- ${r}`));
  }
  lines.push('');
  lines.push(
    'Deliver: hero headline + subheadline mirroring the observed complaint, a 3-section landing page outline, and a v1 MVP feature list scoped ONLY to fixing the top complaint. Use only the evidence above — no invented stats, testimonials, or user counts.',
  );
  return lines.join('\n');
}
