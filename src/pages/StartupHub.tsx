import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lightbulb, DollarSign, TrendingUp, FileText,
  BarChart3, Target, Zap, Sparkles, ArrowLeft, ArrowUpRight,
  Crown, Layers, Search, Radar, Loader2, MessageSquareWarning,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import MarketRadarForm from '@/components/startup/MarketRadarForm';
import MarketRadarResults from '@/components/startup/MarketRadarResults';
import {
  analyzeMarketComplaints, fetchRadarHealth, RadarError,
  type MarketComplaintReport, type MarketComplaintRequest, type RadarSourceHealth,
} from '@/lib/startupMarketApi';

const COLOR_MAP: Record<string, { bg: string; border: string; icon: string }> = {
  amber:  { bg: 'bg-amber-500/[0.05]',  border: 'border-amber-500/10',  icon: 'text-amber-400' },
  cyan:   { bg: 'bg-cyan-500/[0.05]',   border: 'border-cyan-500/10',   icon: 'text-cyan-400' },
  violet: { bg: 'bg-violet-500/[0.05]', border: 'border-violet-500/10', icon: 'text-violet-400' },
  emerald:{ bg: 'bg-emerald-500/[0.05]',border: 'border-emerald-500/10',icon: 'text-emerald-400' },
  rose:   { bg: 'bg-rose-500/[0.05]',   border: 'border-rose-500/10',   icon: 'text-rose-400' },
  blue:   { bg: 'bg-blue-500/[0.05]',   border: 'border-blue-500/10',   icon: 'text-blue-400' },
  indigo: { bg: 'bg-indigo-500/[0.05]', border: 'border-indigo-500/10', icon: 'text-indigo-400' },
  pink:   { bg: 'bg-pink-500/[0.05]',   border: 'border-pink-500/10',   icon: 'text-pink-400' },
  teal:   { bg: 'bg-teal-500/[0.05]',   border: 'border-teal-500/10',   icon: 'text-teal-400' },
  orange: { bg: 'bg-orange-500/[0.05]', border: 'border-orange-500/10', icon: 'text-orange-400' },
};

// Secondary prompt-based tools — kept as a compact launcher into Startup
// Advisor chat. The radar above is the core product surface.
const TOOLS = [
  { id: 'validator', name: 'Idea Validator', icon: Lightbulb, color: 'amber', desc: 'Score your idea across 10 dimensions with honest AI feedback.', inputs: [{ label: 'Describe your startup idea', placeholder: 'A platform that uses AI to...', type: 'textarea' }] },
  { id: 'saas', name: 'SaaS Generator', icon: Layers, color: 'cyan', desc: 'Build full SaaS from idea to tech stack to pricing.', inputs: [{ label: 'Product name', placeholder: 'Acme AI' }, { label: 'What does it do?', placeholder: 'Helps businesses automate...', type: 'textarea' }] },
  { id: 'competitor', name: 'Competitor Radar', icon: Search, color: 'violet', desc: 'Research competitors, find weaknesses, position yourself.', inputs: [{ label: 'Your startup idea or product', placeholder: 'AI-powered marketing automation...', type: 'textarea' }] },
  { id: 'monetization', name: 'Revenue Planner', icon: DollarSign, color: 'emerald', desc: 'Generate revenue streams, pricing tiers, and business models.', inputs: [{ label: 'Describe your product', placeholder: 'A SaaS tool that helps...', type: 'textarea' }] },
  { id: 'growth', name: 'Growth Planner', icon: TrendingUp, color: 'rose', desc: 'Design viral loops, referral programs, and growth strategies.', inputs: [{ label: 'Your product and target audience', placeholder: 'Product: AI writing tool. Audience: Content marketers.', type: 'textarea' }] },
  { id: 'landing', name: 'Landing Generator', icon: FileText, color: 'blue', desc: 'Generate full landing page copy with hero, features, CTA.', inputs: [{ label: 'Product name', placeholder: 'Acme' }, { label: 'Key features', placeholder: 'AI-powered analytics...', type: 'textarea' }] },
  { id: 'pitch', name: 'Pitch Deck AI', icon: Crown, color: 'indigo', desc: 'Build investor pitch decks slide by slide.', inputs: [{ label: 'Startup name + one-liner', placeholder: 'Acme — AI for small business marketing', type: 'textarea' }] },
  { id: 'market', name: 'Market Sizer', icon: BarChart3, color: 'pink', desc: 'Analyze TAM, SAM, SOM, trends, and entry barriers.', inputs: [{ label: 'Industry or market', placeholder: 'AI-powered customer service' }] },
  { id: 'icp', name: 'ICP Builder', icon: Target, color: 'teal', desc: 'Define your ideal customer profile with precision.', inputs: [{ label: 'Product description', placeholder: 'Helps SaaS founders automate outreach', type: 'textarea' }] },
  { id: 'mvp', name: 'MVP Scope', icon: Zap, color: 'orange', desc: 'Define minimum features to launch fast and iterate.', inputs: [{ label: 'Full product vision', placeholder: 'I want to build a platform that...', type: 'textarea' }] },
];

const LOADING_STAGES = [
  'Scanning public discussions…',
  'Collecting current market signals…',
  'Clustering complaint patterns…',
  'Ranking opportunity gaps…',
];

/** Structured handoff into Startup Advisor chat. First line stays
 * `Market: <query>` — the backend startup_complaints tool keys its radar
 * (and cache hit) off that line. Only observed data goes in the prompt. */
function buildAdvisorPrompt(report: MarketComplaintReport): string {
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

export default function StartupHub() {
  const navigate = useNavigate();

  // ── Radar state ──
  const [report, setReport] = useState<MarketComplaintReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<RadarError | null>(null);
  const [lastRequest, setLastRequest] = useState<MarketComplaintRequest | null>(null);
  const [sourceHealth, setSourceHealth] = useState<RadarSourceHealth | null>(null);

  // ── Secondary tools state ──
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const activeTool = TOOLS.find((t) => t.id === selectedTool);

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
    } catch (e) {
      setError(e instanceof RadarError ? e : new RadarError('server', 'Analysis failed unexpectedly.'));
    } finally {
      setLoading(false);
    }
  };

  const sendToAdvisor = () => {
    if (!report) return;
    // ChatDashboard consumes location.state.initialPrompt and ?tab=startup
    // forces the startup workspace, whose messages run as startup_advisor.
    navigate('/chat?tab=startup', { state: { initialPrompt: buildAdvisorPrompt(report) } });
  };

  const handleToolSubmit = () => {
    const prompt = activeTool ? `${activeTool.name}: ${Object.values(formValues).join(' | ')}` : '';
    navigate('/chat?tab=startup', { state: { initialPrompt: prompt } });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => navigate('/workspace')} className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                <ArrowLeft className="h-3 w-3" /> Workspace
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/[0.08] border border-amber-500/15">
                <Radar className="h-5 w-5 text-amber-400/70" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">Market Complaint Radar</h1>
                <p className="text-[12px] text-slate-500">Find where the market is angry before you build.</p>
              </div>
            </div>
          </motion.div>

          {/* Radar input */}
          <MarketRadarForm loading={loading} sourceHealth={sourceHealth} onAnalyze={runAnalysis} />

          {/* Radar states */}
          <div className="mt-5">
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
                  <MarketRadarResults report={report} onSendToAdvisor={sendToAdvisor} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Secondary — prompt-based startup tools */}
          <details className="mt-8 group">
            <summary className="flex items-center gap-2 cursor-pointer select-none text-[12px] text-slate-500 hover:text-slate-300 transition-colors list-none">
              <Sparkles className="h-3.5 w-3.5" />
              Startup Advisor tools
              <span className="text-[10px] text-slate-700">— prompt launchers into Startup Advisor chat</span>
            </summary>

            <div className="mt-4">
              <AnimatePresence mode="wait">
                {!selectedTool ? (
                  <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {TOOLS.map((tool, i) => {
                        const c = COLOR_MAP[tool.color] || COLOR_MAP.amber;
                        return (
                          <motion.button
                            key={tool.id}
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02, duration: 0.3 }}
                            onClick={() => { setSelectedTool(tool.id); setFormValues({}); }}
                            className="text-left rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 transition-all duration-200 hover:bg-white/[0.015] hover:border-white/[0.06] group/tool"
                          >
                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.bg} ${c.border} border mb-2.5`}>
                              <tool.icon className={`h-4 w-4 ${c.icon}`} />
                            </div>
                            <h3 className="text-[12px] font-medium text-white mb-1">{tool.name}</h3>
                            <p className="text-[10px] text-slate-600 leading-relaxed">{tool.desc}</p>
                            <div className="flex items-center gap-1 mt-2 text-[#64748B] group-hover/tool:text-slate-500 transition-colors">
                              <span className="text-[10px]">Open in chat</span>
                              <ArrowUpRight className="h-2.5 w-2.5" />
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="tool" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <button onClick={() => setSelectedTool(null)} className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-white transition-colors mb-4">
                      <ArrowLeft className="h-3.5 w-3.5" /> All tools
                    </button>

                    {activeTool && (
                      <>
                        <div className="flex items-center gap-3 mb-5">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${(COLOR_MAP[activeTool.color] || COLOR_MAP.amber).bg} ${(COLOR_MAP[activeTool.color] || COLOR_MAP.amber).border} border`}>
                            <activeTool.icon className={`h-5 w-5 ${(COLOR_MAP[activeTool.color] || COLOR_MAP.amber).icon}`} />
                          </div>
                          <div>
                            <h2 className="text-lg font-semibold text-white">{activeTool.name}</h2>
                            <p className="text-[12px] text-slate-500">{activeTool.desc}</p>
                          </div>
                        </div>

                        <div className="space-y-4 mb-5">
                          {activeTool.inputs.map((input, i) => (
                            <div key={i}>
                              <label className="block text-[12px] text-slate-400 mb-1.5">{input.label}</label>
                              {(input as { type?: string }).type === 'textarea' ? (
                                <textarea
                                  value={formValues[i] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))}
                                  placeholder={input.placeholder} rows={4}
                                  className="w-full rounded-xl bg-white/[0.015] border border-white/[0.04] p-3 text-[13px] text-white placeholder:text-[#64748B] focus:border-cyan-500/20 focus:bg-white/[0.02] outline-none transition-all resize-none"
                                />
                              ) : (
                                <input
                                  type="text" value={formValues[i] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))}
                                  placeholder={input.placeholder}
                                  className="w-full h-10 rounded-xl bg-white/[0.015] border border-white/[0.04] px-3 text-[13px] text-white placeholder:text-[#64748B] focus:border-cyan-500/20 focus:bg-white/[0.02] outline-none transition-all"
                                />
                              )}
                            </div>
                          ))}
                        </div>

                        <motion.button
                          whileHover={{ scale: 1.005 }} whileTap={{ scale: 0.995 }} onClick={handleToolSubmit}
                          className="w-full h-11 rounded-xl bg-white/[0.06] text-white border border-white/[0.08] text-[13px] hover:bg-white/[0.08] transition-all flex items-center justify-center gap-2"
                        >
                          <Sparkles className="h-4 w-4" /> Open in Startup Advisor
                        </motion.button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
