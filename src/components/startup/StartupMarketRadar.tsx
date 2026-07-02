import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { History, MessageSquareWarning, X } from 'lucide-react';
import MarketRadarForm from './MarketRadarForm';
import MarketRadarResults from './MarketRadarResults';
import RadarEmptyState from './RadarEmptyState';
import RecentAnalyses from './RecentAnalyses';
import ResearchActivity from './ResearchActivity';
import { cleanTitle } from '@/lib/chatTitles';
import {
  analyzeMarketComplaints, fetchRadarHealth, RadarError,
  type MarketComplaintReport, type MarketComplaintRequest,
  type RadarSource, type RadarSourceHealth,
} from '@/lib/startupMarketApi';
import { buildBuilderPrompt } from '@/lib/startupRadarInsights';
import {
  clearRadarHistory, loadRadarHistory, saveRadarReport,
  type RadarHistoryEntry,
} from '@/lib/startupRadarHistory';

const DEFAULT_SOURCES: RadarSource[] = ['web', 'hackernews', 'gdelt'];

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

/** Best-effort form restore from a stored report: the report carries the
 * query + timeframe; selected sources are approximated as everything
 * that wasn't skipped in that run. Region isn't stored — left as-is. */
function sourcesFromReport(report: MarketComplaintReport): RadarSource[] {
  const selected = Object.entries(report.data_freshness)
    .filter(([, status]) => status !== 'skipped')
    .map(([source]) => source as RadarSource);
  return selected.length ? selected : DEFAULT_SOURCES;
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
 * source form, premium empty state, local analysis history with automatic
 * restore of the latest report after a refresh, honest loading/error
 * states, the founder-grade result surface, and Startup Advisor / Builder
 * handoffs. Route-agnostic — /tools/startup wraps it in the full page
 * shell, BusinessPanel embeds it directly.
 */
export default function StartupMarketRadar({ embedded = false }: Props) {
  const navigate = useNavigate();

  // Form controls — lifted so example chips, history restore, and
  // refresh-restore can repopulate the exact run setup.
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState(30);
  const [region, setRegion] = useState('global');
  const [sources, setSources] = useState<RadarSource[]>(DEFAULT_SOURCES);

  const [report, setReport] = useState<MarketComplaintReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RadarError | null>(null);
  const [lastRequest, setLastRequest] = useState<MarketComplaintRequest | null>(null);
  const [sourceHealth, setSourceHealth] = useState<RadarSourceHealth | null>(null);
  const [history, setHistory] = useState<RadarHistoryEntry[]>(() => loadRadarHistory());
  // "Restored from recent analysis" note — shown after the automatic
  // refresh-restore, dismissible, cleared by any fresh analysis.
  const [restoredNote, setRestoredNote] = useState(false);

  // Auto-restore the latest report on mount so a page refresh doesn't
  // lose the analysis the user was just reading. No API call — this is
  // the exact stored report. loadRadarHistory() already fails silently
  // to [] on any localStorage/parse problem.
  useEffect(() => {
    const latest = loadRadarHistory()[0];
    if (latest) {
      setReport(latest.report);
      setQuery(latest.report.query);
      setTimeframe(latest.report.timeframe_days || 30);
      setSources(sourcesFromReport(latest.report));
      setRestoredNote(true);
      // Land the user at the top of the restored result, not wherever
      // the browser's scroll restoration left them.
      if (!embedded) requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Source configuration state — lets the form disable unconnected
  // sources honestly instead of letting the request silently skip them.
  useEffect(() => {
    let cancelled = false;
    fetchRadarHealth().then((h) => { if (!cancelled) setSourceHealth(h); });
    return () => { cancelled = true; };
  }, []);

  const runAnalysis = async (req: MarketComplaintRequest) => {
    setLoading(true);
    setError(null);
    setReport(null);
    setRestoredNote(false);
    setLastRequest(req);
    // Chat-naming fix: when embedded in the workspace, adopt the query as
    // the active session title so the sidebar shows the research topic
    // instead of a stale "New Business". Title-only — no tab switch. The
    // chat hook only renames unused "New X" sessions, so an existing
    // named conversation is never overwritten.
    if (embedded) {
      const title = cleanTitle(req.query);
      if (title) {
        window.dispatchEvent(new CustomEvent('korvix-set-session-title', { detail: { title } }));
      }
    }
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
    setRestoredNote(false);
    setQuery(entry.report.query);
    setTimeframe(entry.report.timeframe_days || 30);
    setSources(sourcesFromReport(entry.report));
    setReport(entry.report);
  };

  const handleClearHistory = () => {
    clearRadarHistory();
    setHistory([]);
  };

  /** Shared handoff: in-app event when embedded in ChatDashboard,
   * full navigation from the standalone /tools/startup page. Both
   * handoffs land in NORMAL Chat (never a project/build context) and
   * carry a ready session title so the chat never sits as "New Chat". */
  const handOffToChat = (prompt: string, title: string) => {
    if (embedded) {
      window.dispatchEvent(new CustomEvent('korvix-route-to-chat', {
        detail: { prompt, workspace: 'chat', title },
      }));
    } else {
      navigate('/chat', { state: { initialPrompt: prompt, sessionTitle: title } });
    }
  };

  const sendToAdvisor = () => {
    if (!report) return;
    handOffToChat(
      buildAdvisorPrompt(report),
      cleanTitle(report.query, 'Startup: ') || 'Startup research',
    );
  };

  // The builder pages don't accept an external prompt handoff, so the
  // builder ask goes through chat with a build-oriented structured
  // prompt (evidence-backed wedge → landing page + MVP concept).
  const sendToBuilder = () => {
    if (!report) return;
    handOffToChat(
      buildBuilderPrompt(report),
      cleanTitle(report.query, 'Builder: ') || 'Builder: MVP concept',
    );
  };

  return (
    <div>
      <MarketRadarForm
        loading={loading}
        sourceHealth={sourceHealth}
        query={query}
        onQueryChange={setQuery}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        region={region}
        onRegionChange={setRegion}
        sources={sources}
        onSourcesChange={setSources}
        onAnalyze={runAnalysis}
      />

      <div className={embedded ? 'mt-3 space-y-3' : 'mt-5 space-y-4'}>
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ResearchActivity />
            </motion.div>
          )}

          {!loading && error && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-[#F87171]/30 bg-[#F87171]/[0.06] p-6"
            >
              <div className="flex items-start gap-3">
                <MessageSquareWarning className="h-4 w-4 text-[#C98A93] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-semibold text-slate-100 mb-1">
                    {error.kind === 'disabled' ? 'Market Intelligence is not enabled'
                      : error.kind === 'network' ? 'Backend unreachable'
                      : 'Analysis failed'}
                  </h3>
                  <p className="text-[12px] text-slate-300 leading-relaxed">{error.message}</p>
                  {error.kind !== 'disabled' && lastRequest && (
                    <button
                      onClick={() => runAnalysis(lastRequest)}
                      className="mt-3 px-3 h-8 rounded-lg text-[12px] text-slate-200 border border-white/[0.1] hover:bg-white/[0.04] transition-colors"
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
              {restoredNote && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-[#3B82F6]/25 bg-[#3B82F6]/[0.10]">
                  <History className="h-3 w-3 text-[#3B82F6] shrink-0" />
                  <span className="text-[11px] text-slate-300">Restored from recent analysis</span>
                  <button
                    onClick={() => setRestoredNote(false)}
                    aria-label="Dismiss"
                    className="ml-auto text-[#94A3B8] hover:text-slate-300 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
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
              <RadarEmptyState query={query} onPickExample={setQuery} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recent analyses — expanded in the empty state, collapsed and
            out of the way when a report is on screen. */}
        {!loading && (
          <RecentAnalyses
            history={history}
            defaultOpen={!report && !error}
            onRestore={restoreFromHistory}
            onClearHistory={handleClearHistory}
          />
        )}
      </div>
    </div>
  );
}
