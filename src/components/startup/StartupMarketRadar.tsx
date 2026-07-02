import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, MessageSquareWarning } from 'lucide-react';
import MarketRadarForm from './MarketRadarForm';
import MarketRadarResults from './MarketRadarResults';
import RadarEmptyState from './RadarEmptyState';
import {
  analyzeMarketComplaints, fetchRadarHealth, RadarError,
  type MarketComplaintReport, type MarketComplaintRequest, type RadarSourceHealth,
} from '@/lib/startupMarketApi';
import { buildBuilderPrompt } from '@/lib/startupRadarInsights';
import {
  clearRadarHistory, loadRadarHistory, saveRadarReport,
  type RadarHistoryEntry,
} from '@/lib/startupRadarHistory';

const LOADING_STAGES = [
  'Scanning public discussions…',
  'Collecting current market signals…',
  'Clustering complaint patterns…',
  'Ranking opportunity gaps…',
];

/** Structured handoff into Startup Advisor chat. First line stays
 * `Market: <query>` — the backend startup_complaints tool keys its radar
 * (and cache hit) off that line. Only observed data goes in the prompt. */
export function buildAdvisorPrompt(report: MarketComplaintReport): string {
  const lines: string[] = [];
  lines.push(`Market: ${report.query}`);
  lines.push('');
  lines.push(
    `Korvix Market Complaint Radar result (generated ${report.generated_at}, ` +
    `last ${report.timeframe_days} days, confidence: ${report.summary.confidence}, ` +
    `opportunity ${report.summary.opportunity_score}/100, ` +
    `${report.summary.total_items_analyzed} items from ${report.summary.total_sources} sources):`,
  );
  lines.push('');
  lines.push('Top complaint clusters:');
  report.complaint_clusters.slice(0, 5).forEach((c, i) => {
    lines.push(
      `${i + 1}. ${c.label} — pain ${c.pain_score}/100, ${c.frequency} signals, ` +
      `willingness-to-pay ${c.willingness_to_pay_signal}/100, saturation risk ${c.saturation_risk}/100`,
    );
    const q = c.sample_quotes[0];
    if (q) lines.push(`   evidence quote (${q.source}): "${q.text}"`);
  });
  const s = report.market_signals;
  lines.push('');
  lines.push('Market signals:');
  if (s.competitors_mentioned.length) lines.push(`- competitors mentioned: ${s.competitors_mentioned.join(', ')}`);
  if (s.trending_keywords.length) lines.push(`- trending keywords: ${s.trending_keywords.join(', ')}`);
  if (s.underserved_segments.length) lines.push(`- underserved segments: ${s.underserved_segments.join(', ')}`);
  if (s.common_workarounds.length) lines.push(`- common workarounds: ${s.common_workarounds.join(', ')}`);
  if (report.citations.length) {
    lines.push('');
    lines.push('Citations:');
    report.citations.slice(0, 8).forEach((c) => lines.push(`- ${c.url}`));
  }
  lines.push('');
  lines.push(
    'Using ONLY the observed data above plus explicitly stated assumptions, give me a brutal ' +
    'founder strategy: the sharpest startup wedge, the MVP scope, a 7-day validation plan, ' +
    'and a first-100-customers plan. Flag weak or missing evidence honestly.',
  );
  return lines.join('\n');
}

interface Props {
  /** true when rendered inside an already-mounted chat surface (e.g. the
   * Business Workspace subtab). Switches the Startup Advisor / Builder
   * handoffs from a route navigation to the in-app `korvix-route-to-chat`
   * event — ChatDashboard doesn't remount on same-route navigation, so
   * only the event path can actually switch tabs from inside it. */
  embedded?: boolean;
}

/**
 * The complete Market Complaint Radar experience: query/timeframe/region/
 * source form, premium empty state with local analysis history, honest
 * loading/error states, founder-grade result surface (decision board,
 * ICP, competitor weaknesses, 7-day sprint), and Startup Advisor /
 * Builder handoffs. Route-agnostic — /tools/startup wraps it in the full
 * page shell, BusinessPanel embeds it directly.
 */
export default function StartupMarketRadar({ embedded = false }: Props) {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [report, setReport] = useState<MarketComplaintReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<RadarError | null>(null);
  const [lastRequest, setLastRequest] = useState<MarketComplaintRequest | null>(null);
  const [sourceHealth, setSourceHealth] = useState<RadarSourceHealth | null>(null);
  const [history, setHistory] = useState<RadarHistoryEntry[]>(() => loadRadarHistory());

  // Source configuration state — lets the form disable unconfigured
  // sources honestly instead of letting the request silently skip them.
  useEffect(() => {
    let cancelled = false;
    fetchRadarHealth().then((h) => { if (!cancelled) setSourceHealth(h); });
    return () => { cancelled = true; };
  }, []);

  // Rotate honest progress copy while the radar runs.
  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading]);

  const runAnalysis = async (req: MarketComplaintRequest) => {
    setLoading(true);
    setError(null);
    setReport(null);
    setLastRequest(req);
    try {
      const result = await analyzeMarketComplaints(req);
      setReport(result);
      // History stores exactly what's on screen — last 5, local only.
      setHistory(saveRadarReport(result));
    } catch (e) {
      setError(e instanceof RadarError ? e : new RadarError('server', 'Analysis failed unexpectedly.'));
    } finally {
      setLoading(false);
    }
  };

  const restoreFromHistory = (entry: RadarHistoryEntry) => {
    setError(null);
    setQuery(entry.report.query);
    setReport(entry.report);
  };

  const handleClearHistory = () => {
    clearRadarHistory();
    setHistory([]);
  };

  /** Shared handoff: in-app event when embedded in ChatDashboard,
   * full navigation from the standalone /tools/startup page. */
  const handOffToChat = (prompt: string) => {
    if (embedded) {
      window.dispatchEvent(new CustomEvent('korvix-route-to-chat', {
        detail: { prompt, workspace: 'startup' },
      }));
    } else {
      navigate('/chat?tab=startup', { state: { initialPrompt: prompt } });
    }
  };

  const sendToAdvisor = () => {
    if (report) handOffToChat(buildAdvisorPrompt(report));
  };

  // The builder pages don't accept an external prompt handoff, so the
  // builder ask goes through chat with a build-oriented structured
  // prompt (evidence-backed wedge → landing page + MVP concept).
  const sendToBuilder = () => {
    if (!report) return;
    const prompt = buildBuilderPrompt(report);
    if (embedded) {
      window.dispatchEvent(new CustomEvent('korvix-route-to-chat', {
        detail: { prompt, workspace: 'chat' },
      }));
    } else {
      navigate('/chat', { state: { initialPrompt: prompt } });
    }
  };

  return (
    <div>
      <MarketRadarForm
        loading={loading}
        sourceHealth={sourceHealth}
        query={query}
        onQueryChange={setQuery}
        onAnalyze={runAnalysis}
      />

      <div className={embedded ? 'mt-3' : 'mt-5'}>
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-white/[0.04] bg-white/[0.008] p-8 flex flex-col items-center gap-3"
            >
              <Loader2 className="h-5 w-5 text-amber-400/70 animate-spin" />
              <p className="text-[12px] text-slate-400">{LOADING_STAGES[stage]}</p>
              <p className="text-[10px] text-slate-600">Fetching current public signals — this usually takes a few seconds.</p>
            </motion.div>
          )}

          {!loading && error && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.03] p-6"
            >
              <div className="flex items-start gap-3">
                <MessageSquareWarning className="h-4 w-4 text-rose-400/80 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-medium text-white mb-1">
                    {error.kind === 'disabled' ? 'Market Intelligence is not enabled'
                      : error.kind === 'network' ? 'Backend unreachable'
                      : 'Analysis failed'}
                  </h3>
                  <p className="text-[12px] text-slate-400 leading-relaxed">{error.message}</p>
                  {error.kind !== 'disabled' && lastRequest && (
                    <button
                      onClick={() => runAnalysis(lastRequest)}
                      className="mt-3 px-3 h-8 rounded-lg text-[12px] text-slate-300 border border-white/[0.08] hover:bg-white/[0.03] transition-colors"
                    >
                      Retry analysis
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {!loading && !error && report && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <MarketRadarResults
                report={report}
                sourceHealth={sourceHealth}
                onSendToAdvisor={sendToAdvisor}
                onSendToBuilder={sendToBuilder}
              />
            </motion.div>
          )}

          {!loading && !error && !report && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <RadarEmptyState
                history={history}
                onPickExample={setQuery}
                onRestore={restoreFromHistory}
                onClearHistory={handleClearHistory}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
