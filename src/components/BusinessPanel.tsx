import { useState, useEffect, useCallback } from 'react';
import {
  Building2, ShoppingCart, Bot,
  Target, Lightbulb, Users, TrendingUp, Shield,
  CheckSquare, BarChart3, Sparkles, AlertTriangle,
  ChevronRight, Search, FileText, Megaphone,
  Layout, Flag, Lock, ClipboardList,
} from 'lucide-react';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
type BusinessSubTab = 'workspace' | 'ecommerce' | 'startup' | 'autopilot';

interface BusinessState {
  subTab: BusinessSubTab;
  goalName: string;
  goalText: string;
  productIdea: string;
  nicheAudience: string;
  sellPrice: string;
  cogs: string;
  shipping: string;
  adCost: string;
  feesPercent: string;
  riskSliders: Record<string, number>;
  startupCanvas: Record<string, string>;
  mvpChecks: boolean[];
  autoGoal: string;
  killSwitch: boolean;
  runs: AutoRun[];
  auditLog: AuditEntry[];
  auditOpen: boolean;
}

interface AutoRun {
  id: string;
  goal: string;
  status: 'planning' | 'running' | 'done' | 'failed';
  steps: string[];
  timestamp: number;
}

interface AuditEntry {
  id: string;
  action: string;
  detail: string;
  timestamp: number;
}

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */
const STORAGE_KEY = 'korvix_business_workspace';

const RISK_SLIDERS = [
  { key: 'marketSaturation', label: 'Market saturation', defaultValue: 3 },
  { key: 'adPolicySensitivity', label: 'Ad-policy sensitivity', defaultValue: 3 },
  { key: 'shippingComplexity', label: 'Shipping complexity', defaultValue: 3 },
  { key: 'returnRate', label: 'Expected return rate', defaultValue: 3 },
  { key: 'differentiation', label: 'Your differentiation (higher = better)', defaultValue: 3 },
];

const MVP_ITEMS = [
  'Core value flow works end-to-end',
  'A single primary user can sign up & use it',
  'One key success metric is instrumented',
  'Manual ops are acceptable (no premature automation)',
  'Landing page with a clear single CTA',
  'Feedback loop with ~5 target users',
];

const ROADMAP_STEPS = [
  { num: 1, title: 'Validate', desc: 'Problem interviews; confirm the pain is real and urgent.' },
  { num: 2, title: 'Build MVP', desc: 'Smallest credible version of the core value flow.' },
  { num: 3, title: 'Private beta', desc: 'Hand-held onboarding for the first users; watch retention.' },
  { num: 4, title: 'Public launch', desc: 'One channel, one message, one clear CTA.' },
  { num: 5, title: 'Iterate', desc: 'Double down on what retains; cut the rest.' },
];

const CANVAS_FIELDS = [
  { key: 'idea', label: 'Idea summary' },
  { key: 'customer', label: 'Target customer' },
  { key: 'pain', label: 'Pain point' },
  { key: 'solution', label: 'Solution' },
  { key: 'positioning', label: 'Market positioning' },
  { key: 'monetization', label: 'Monetization model' },
];

const QUICK_LAUNCH = [
  { icon: FileText, title: 'Build my business plan', desc: 'Lean plan: customer, problem, solution, model, GTM', prompt: 'Build a lean business plan covering target customer, problem, solution, business model, and go-to-market strategy.' },
  { icon: Lightbulb, title: 'Find product ideas', desc: 'Opportunity ideas + how to validate demand', prompt: 'Generate 5 high-opportunity product ideas for a dropshipping or ecommerce business, including validation methods for each.' },
  { icon: Search, title: 'Analyze a competitor', desc: 'Structured teardown + differentiation', prompt: 'Walk me through a structured competitor analysis framework. How do I research competitors and find differentiation opportunities?' },
  { icon: Megaphone, title: 'Create ad angles', desc: '6 angles + hooks for paid acquisition', prompt: 'Create 6 different ad angles with compelling hooks for paid acquisition. Include headline variations and target audiences.' },
  { icon: Layout, title: 'Review landing page', desc: 'AI review of copy, hero & CTA', prompt: 'Review my landing page for conversion optimization. Analyze the hero section, copy, CTA placement, and suggest improvements.' },
];

const STARTUP_ACTIONS = [
  { icon: Sparkles, title: 'Generate full startup plan', prompt: 'Generate a complete startup plan from idea to launch including market validation, MVP scope, and go-to-market strategy.' },
  { icon: AlertTriangle, title: 'Pressure-test the idea', prompt: 'Pressure-test my startup idea. Identify the biggest risks, weaknesses, and blind spots I should address before building.' },
  { icon: Target, title: 'Refine positioning', prompt: 'Help me refine my product positioning. Who is the ideal customer, what is the core value proposition, and how do we differentiate?' },
  { icon: TrendingUp, title: 'Stress-test monetization', prompt: 'Stress-test my monetization model. What pricing strategies should I consider and what are the potential revenue risks?' },
];

const ECOMMERCE_ACTIONS = [
  { icon: TrendingUp, title: 'Demand analysis framework', prompt: 'Walk me through a demand analysis framework for my ecommerce product. How do I validate there is real market demand before investing?' },
  { icon: Shield, title: 'Competition analysis structure', prompt: 'Provide a structured competition analysis framework. How do I research competitors, find gaps, and position my product?' },
  { icon: Users, title: 'Audience analysis structure', prompt: 'Help me build an audience analysis. Who are my ideal customers, what are their pain points, and where do they hang out online?' },
  { icon: Megaphone, title: 'Generate ad angles', prompt: 'Generate high-converting ad angles and hooks for my ecommerce product. Include Facebook and TikTok ad variations.' },
  { icon: ShoppingCart, title: 'Full e-commerce analysis', prompt: 'Run a complete ecommerce analysis for my product including pricing strategy, margin optimization, and growth recommendations.' },
];

/* ═══════════════════════════════════════════
   LOCAL STORAGE
   ═══════════════════════════════════════════ */
function loadState(): Partial<BusinessState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveState(state: BusinessState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════
   E-COMMERCE CALCULATIONS
   ═══════════════════════════════════════════ */
function calcMargin(sp: number, cogs: number, ship: number, ad: number, fees: number) {
  const totalCost = cogs + ship + ad + (sp * fees / 100);
  const contribution = sp - totalCost;
  const margin = sp > 0 ? (contribution / sp) * 100 : 0;
  const maxAd = sp - cogs - ship - (sp * fees / 100);
  return {
    contribution: contribution.toFixed(2),
    margin: margin.toFixed(1),
    maxAd: maxAd > 0 ? maxAd.toFixed(2) : '0.00',
    totalCost: totalCost.toFixed(2),
  };
}

function calcRisk(sliders: Record<string, number>) {
  // Base 50, each slider deviates ±5 per point from center (3)
  // Differentiation is inverted (higher = better = lower risk)
  let score = 50;
  for (const s of RISK_SLIDERS) {
    const v = sliders[s.key] ?? s.defaultValue;
    if (s.key === 'differentiation') {
      score += (3 - v) * 5; // inverted
    } else {
      score += (v - 3) * 5;
    }
  }
  return Math.max(0, Math.min(100, score));
}

function riskLabel(score: number) {
  if (score >= 70) return { label: 'Low', color: 'text-emerald-400' };
  if (score >= 50) return { label: 'Medium', color: 'text-amber-400' };
  if (score >= 30) return { label: 'High', color: 'text-orange-400' };
  return { label: 'Very High', color: 'text-red-400' };
}

/* ═══════════════════════════════════════════
   CARD WRAPPER
   ═══════════════════════════════════════════ */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.04] bg-white/[0.015] p-3 ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider mb-2">{children}</p>
  );
}

function Inp({
  value, onChange, placeholder, type = 'text'
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-slate-700 outline-none focus:border-white/[0.08] transition-colors"
    />
  );
}

function Txt({
  value, onChange, placeholder, rows = 2
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-slate-700 outline-none focus:border-white/[0.08] transition-colors resize-none"
    />
  );
}

function ActionBtn({ icon: Icon, title, onClick }: { icon: typeof FileText; title: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full p-2 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.02] hover:border-white/[0.06] transition-all text-left group"
    >
      <Icon className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-400 transition-colors shrink-0" />
      <span className="text-[12px] text-slate-400 group-hover:text-slate-300 transition-colors">{title}</span>
      <ChevronRight className="h-3.5 w-3.5 text-slate-700 group-hover:text-slate-500 ml-auto transition-colors shrink-0" />
    </button>
  );
}

/* ═══════════════════════════════════════════
   ROUTE TO CHAT
   ═══════════════════════════════════════════ */
function routeToChat(prompt: string) {
  window.dispatchEvent(new CustomEvent('korvix-route-to-chat', { detail: { prompt, workspace: 'business' } }));
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */
export default function BusinessPanel() {
  const saved = loadState();

  const [subTab, setSubTab] = useState<BusinessSubTab>(saved.subTab || 'workspace');
  const [goalName, setGoalName] = useState(saved.goalName || '');
  const [goalText, setGoalText] = useState(saved.goalText || '');
  const [productIdea, setProductIdea] = useState(saved.productIdea || '');
  const [nicheAudience, setNicheAudience] = useState(saved.nicheAudience || '');
  const [sellPrice, setSellPrice] = useState(saved.sellPrice || '40');
  const [cogs, setCogs] = useState(saved.cogs || '10');
  const [shipping, setShipping] = useState(saved.shipping || '5');
  const [adCost, setAdCost] = useState(saved.adCost || '10');
  const [feesPercent, setFeesPercent] = useState(saved.feesPercent || '3');
  const [riskSliders, setRiskSliders] = useState<Record<string, number>>(
    saved.riskSliders || Object.fromEntries(RISK_SLIDERS.map(s => [s.key, s.defaultValue]))
  );
  const [startupCanvas, setStartupCanvas] = useState<Record<string, string>>(saved.startupCanvas || {});
  const [mvpChecks, setMvpChecks] = useState<boolean[]>(saved.mvpChecks || new Array(MVP_ITEMS.length).fill(false));
  const [autoGoal, setAutoGoal] = useState(saved.autoGoal || '');
  const [killSwitch, setKillSwitch] = useState(saved.killSwitch || false);
  const [runs, setRuns] = useState<AutoRun[]>(saved.runs || []);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(saved.auditLog || []);
  const [auditOpen, setAuditOpen] = useState(saved.auditOpen || false);

  // Persist
  useEffect(() => {
    saveState({ subTab, goalName, goalText, productIdea, nicheAudience, sellPrice, cogs, shipping, adCost, feesPercent, riskSliders, startupCanvas, mvpChecks, autoGoal, killSwitch, runs, auditLog, auditOpen });
  });

  const margin = calcMargin(
    parseFloat(sellPrice) || 0, parseFloat(cogs) || 0, parseFloat(shipping) || 0,
    parseFloat(adCost) || 0, parseFloat(feesPercent) || 0,
  );
  const riskScore = calcRisk(riskSliders);
  const rLabel = riskLabel(riskScore);

  const handlePlanRun = useCallback(() => {
    if (!autoGoal.trim() || killSwitch) return;
    const newRun: AutoRun = {
      id: crypto.randomUUID(), goal: autoGoal, status: 'planning',
      steps: ['Analyze', 'Draft', 'Review', 'Approve'], timestamp: Date.now(),
    };
    setRuns(prev => [newRun, ...prev]);
    setAuditLog(prev => [{ id: crypto.randomUUID(), action: 'Run planned', detail: `Goal: "${autoGoal}"`, timestamp: Date.now() }, ...prev]);
  }, [autoGoal, killSwitch]);

  const toggleMvp = (i: number) => setMvpChecks(prev => { const n = [...prev]; n[i] = !n[i]; return n; });

  const SUB_TABS: { id: BusinessSubTab; label: string }[] = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'ecommerce', label: 'E-commerce' },
    { id: 'startup', label: 'Startup' },
    { id: 'autopilot', label: 'Autopilot' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/[0.06] border border-amber-500/10">
            <Building2 className="h-3 w-3 text-amber-400/70" />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-white">Business Workspace</h2>
            <p className="text-[10px] text-slate-500">Goal-driven launchpad · routes to AI chat · saved locally</p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="shrink-0 flex items-center gap-1 px-4 pb-2">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              subTab === t.id
                ? 'bg-white/[0.06] text-white'
                : 'text-slate-600 hover:text-slate-400 hover:bg-white/[0.015]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
        {subTab === 'workspace' && (
          <div className="space-y-2.5">
            {/* Goal card */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[13px] font-medium text-white">Your business goal</span>
              </div>
              <div className="space-y-1.5">
                <Inp value={goalName} onChange={setGoalName} placeholder="Project / company name (optional)" />
                <Txt value={goalText} onChange={setGoalText} placeholder="e.g. Launch a focused dropshipping store in the home-fitness niche and reach first profitable sales." rows={3} />
                <span className="text-[10px] text-slate-600">Saved</span>
              </div>
            </Card>

            {/* Current project */}
            <Card>
              <SectionLabel>Current project</SectionLabel>
              {goalText ? (
                <p className="text-[12px] text-slate-400 leading-relaxed">{goalText}</p>
              ) : (
                <p className="text-[12px] text-slate-600">No goal set yet — add one above to personalise launches.</p>
              )}
            </Card>

            {/* Recommended actions */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Flag className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[13px] font-medium text-white">Recommended next actions</span>
              </div>
              <p className="text-[12px] text-slate-500">
                Set a clear business goal above to tailor recommendations and launches.
              </p>
            </Card>

            {/* Quick launch */}
            <SectionLabel>Quick launch</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_LAUNCH.map((item) => (
                <button
                  key={item.title}
                  onClick={() => routeToChat(item.prompt)}
                  className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.02] hover:border-white/[0.06] transition-all text-left group"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] border border-white/[0.04] shrink-0">
                    <item.icon className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-white group-hover:text-slate-200 transition-colors">{item.title}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-2 rounded-xl border border-white/[0.02] bg-white/[0.005]">
              <AlertTriangle className="h-3 w-3 text-slate-700 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Launches send a structured prompt to the AI chat. Live product/market/competitor data sources are not connected yet — outputs are AI-generated guidance, not live data.
              </p>
            </div>
          </div>
        )}

        {subTab === 'ecommerce' && (
          <div className="space-y-2.5">
            {/* Product inputs */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Product idea</p>
                <Inp value={productIdea} onChange={setProductIdea} placeholder="e.g. posture-correction brace" />
              </div>
              <div>
                <p className="text-[11px] text-slate-500 mb-1">Niche / audience</p>
                <Inp value={nicheAudience} onChange={setNicheAudience} placeholder="e.g. desk workers, back pain" />
              </div>
            </div>

            {/* Pricing & margin */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[13px] font-medium text-white">Pricing &amp; margin</span>
              </div>
              <p className="text-[10px] text-slate-600 mb-2.5">Enter price &amp; costs — figures are computed from your inputs only.</p>
              <div className="grid grid-cols-3 gap-2 mb-1.5">
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Sell price</p>
                  <Inp value={sellPrice} onChange={setSellPrice} type="number" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">COGS</p>
                  <Inp value={cogs} onChange={setCogs} type="number" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Shipping</p>
                  <Inp value={shipping} onChange={setShipping} type="number" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Ad cost / order</p>
                  <Inp value={adCost} onChange={setAdCost} type="number" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Fees %</p>
                  <Inp value={feesPercent} onChange={setFeesPercent} type="number" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Contribution', value: `$${margin.contribution}`, color: 'text-emerald-400' },
                  { label: 'Margin %', value: `${margin.margin}%`, color: 'text-emerald-400' },
                  { label: 'Max ad / order', value: `$${margin.maxAd}`, color: 'text-white' },
                  { label: 'Total cost', value: `$${margin.totalCost}`, color: 'text-white' },
                ].map((r) => (
                  <div key={r.label} className="text-center p-2 rounded-lg bg-white/[0.01]">
                    <p className="text-[9px] text-slate-600 mb-0.5">{r.label}</p>
                    <p className={`text-[13px] font-semibold ${r.color}`}>{r.value}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Risk score */}
            <Card>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[13px] font-medium text-white">Risk score</span>
                </div>
                <span className={`text-[13px] font-semibold ${rLabel.color}`}>{riskScore}/100 · {rLabel.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {RISK_SLIDERS.map((s) => (
                  <div key={s.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-500">{s.label}</span>
                      <span className="text-[10px] text-slate-600">{(riskSliders[s.key] ?? s.defaultValue)}/5</span>
                    </div>
                    <input
                      type="range"
                      min={1} max={5} step={1}
                      value={riskSliders[s.key] ?? s.defaultValue}
                      onChange={(e) => setRiskSliders(p => ({ ...p, [s.key]: parseInt(e.target.value) }))}
                      className="w-full h-1 rounded-full appearance-none cursor-pointer accent-emerald-400"
                      style={{ background: `linear-gradient(to right, rgb(52,211,153) 0%, rgb(52,211,153) ${((riskSliders[s.key] ?? s.defaultValue) - 1) / 4 * 100}%, rgba(255,255,255,0.04) ${((riskSliders[s.key] ?? s.defaultValue) - 1) / 4 * 100}%)` }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-700 mt-1.5">Derived from your own assessment — not market data.</p>
            </Card>

            {/* Launch read */}
            <Card>
              <SectionLabel>Launch read</SectionLabel>
              <p className="text-[12px] text-slate-400">
                {productIdea ? 'Workable on your inputs — validate real demand with a small test budget before scaling.' : 'Enter your price and costs to get a margin-based read.'}
              </p>
            </Card>

            {/* AI actions */}
            <SectionLabel>Analyze with AI (routes to chat)</SectionLabel>
            <div className="space-y-1.5">
              {ECOMMERCE_ACTIONS.map((a) => (
                <ActionBtn key={a.title} icon={a.icon} title={a.title} onClick={() => routeToChat(a.prompt)} />
              ))}
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-2 rounded-xl border border-white/[0.02] bg-white/[0.005]">
              <AlertTriangle className="h-3 w-3 text-slate-700 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Live product research source not connected yet — no trends, sales, supplier or competition data is fetched. Margin/risk use only your inputs; AI analyses are guidance, not live data.
              </p>
            </div>
          </div>
        )}

        {subTab === 'startup' && (
          <div className="space-y-2.5">
            <span className="text-[13px] font-medium text-white">Startup builder</span>

            {/* Planning canvas */}
            <div className="grid grid-cols-2 gap-2">
              {CANVAS_FIELDS.map((f) => (
                <div key={f.key}>
                  <p className="text-[10px] text-slate-500 mb-1">{f.label}</p>
                  <Txt
                    value={startupCanvas[f.key] || ''}
                    onChange={(v) => setStartupCanvas(p => ({ ...p, [f.key]: v }))}
                    placeholder={f.key === 'idea' ? 'One-line pitch' : f.key === 'customer' ? 'Who pays / uses it' : f.key === 'pain' ? 'The urgent problem' : f.key === 'solution' ? 'How you solve it' : f.key === 'positioning' ? 'Vs alternatives / status quo' : 'How it makes money'}
                    rows={2}
                  />
                </div>
              ))}
            </div>

            {/* MVP checklist */}
            <Card>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[13px] font-medium text-white">MVP checklist</span>
                </div>
                <span className="text-[11px] text-slate-500">{mvpChecks.filter(Boolean).length}/{MVP_ITEMS.length}</span>
              </div>
              <div className="space-y-1">
                {MVP_ITEMS.map((item, i) => (
                  <button key={i} onClick={() => toggleMvp(i)} className="flex items-center gap-2.5 w-full text-left group">
                    <div className={`flex h-4 w-4 items-center justify-center rounded border transition-all shrink-0 ${mvpChecks[i] ? 'bg-emerald-500/20 border-emerald-500/30' : 'border-white/[0.08]'}`}>
                      {mvpChecks[i] && <CheckSquare className="h-3 w-3 text-emerald-400" />}
                    </div>
                    <span className={`text-[11px] transition-colors ${mvpChecks[i] ? 'text-slate-600 line-through' : 'text-slate-400'}`}>{item}</span>
                  </button>
                ))}
              </div>
            </Card>

            {/* Launch roadmap */}
            <Card>
              <div className="flex items-center gap-2 mb-2.5">
                <Flag className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[13px] font-medium text-white">Launch roadmap</span>
              </div>
              <div className="space-y-2">
                {ROADMAP_STEPS.map((step) => (
                  <div key={step.num} className="flex items-start gap-2.5">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.03] border border-white/[0.06] shrink-0 mt-0.5">
                      <span className="text-[9px] font-medium text-slate-400">{step.num}</span>
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-white">{step.title}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Next actions */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400/60" />
                <span className="text-[13px] font-medium text-white">Next actions</span>
              </div>
              <ul className="space-y-1.5">
                {[
                  'Fill in: Idea summary, Target customer, Pain point, Solution, Market positioning, Monetization model to sharpen the plan.',
                  'Run 5 problem interviews before building.',
                  'Define one success metric and instrument it.',
                ].map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
                    <span className="text-slate-700 mt-0.5">•</span>{t}
                  </li>
                ))}
              </ul>
            </Card>

            {/* AI actions */}
            <SectionLabel>Build with AI (routes to chat)</SectionLabel>
            <div className="space-y-1.5">
              {STARTUP_ACTIONS.map((a) => (
                <ActionBtn key={a.title} icon={a.icon} title={a.title} onClick={() => routeToChat(a.prompt)} />
              ))}
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-2 rounded-xl border border-white/[0.02] bg-white/[0.005]">
              <AlertTriangle className="h-3 w-3 text-slate-700 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Planning canvas saved locally. No live market/competition data is connected — AI outputs are guidance, not validated research.
              </p>
            </div>
          </div>
        )}

        {subTab === 'autopilot' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-indigo-400/70" />
                <span className="text-[13px] font-medium text-white">Autopilot — dry-run agent runs</span>
              </div>
              <button
                onClick={() => setKillSwitch(p => !p)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border ${killSwitch ? 'bg-red-500/[0.08] text-red-400 border-red-500/15' : 'bg-white/[0.02] text-slate-500 border-white/[0.04]'}`}
              >
                <Lock className="h-3 w-3" />
                Kill-switch{killSwitch ? 'ed' : ''}
              </button>
            </div>

            {/* Goal */}
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[13px] font-medium text-white">Goal</span>
              </div>
              <Txt value={autoGoal} onChange={setAutoGoal} placeholder="e.g. Launch a landing page for a home-fitness coaching offer and get the first 10 signups." rows={3} />
              <div className="mt-2">
                <button
                  onClick={handlePlanRun}
                  disabled={!autoGoal.trim() || killSwitch}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[12px] text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Bot className="h-3.5 w-3.5" /> Plan run
                </button>
              </div>
            </Card>

            {/* Run history */}
            <Card>
              <SectionLabel>Run history</SectionLabel>
              {runs.length === 0 ? (
                <p className="text-[11px] text-slate-600">No runs yet — set a goal above and plan a run.</p>
              ) : (
                <div className="space-y-1">
                  {runs.map((run) => (
                    <div key={run.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.01] border border-white/[0.02]">
                      <div className={`flex h-5 w-5 items-center justify-center rounded-full shrink-0 ${run.status === 'done' ? 'bg-emerald-500/[0.08]' : run.status === 'failed' ? 'bg-red-500/[0.08]' : 'bg-amber-500/[0.08]'}`}>
                        <Bot className={`h-3 w-3 ${run.status === 'done' ? 'text-emerald-400' : run.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-slate-300 truncate">{run.goal}</p>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full capitalize ${run.status === 'done' ? 'bg-emerald-500/[0.06] text-emerald-400' : run.status === 'failed' ? 'bg-red-500/[0.06] text-red-400' : 'bg-amber-500/[0.06] text-amber-400'}`}>{run.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Audit log */}
            <button
              onClick={() => setAuditOpen(p => !p)}
              className="flex items-center gap-2 w-full text-left"
            >
              <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[13px] font-medium text-white">Audit log</span>
              <span className="text-[11px] text-slate-600">({auditLog.length})</span>
              <ChevronRight className={`h-3.5 w-3.5 text-slate-700 ml-auto transition-transform ${auditOpen ? 'rotate-90' : ''}`} />
            </button>
            {auditOpen && (
              <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                {auditLog.length === 0 ? (
                  <p className="text-[11px] text-slate-600">No audit entries yet.</p>
                ) : (
                  auditLog.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 text-[10px]">
                      <span className="text-slate-700 shrink-0">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <div>
                        <span className="text-slate-400">{entry.action}</span>
                        <span className="text-slate-700"> — {entry.detail}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-2 rounded-xl border border-white/[0.02] bg-white/[0.005]">
              <AlertTriangle className="h-3 w-3 text-slate-700 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Dry-run only. Analyze/draft route a structured prompt into the normal chat; compute records your own numbers. Research &amp; act steps are gated — approvals are recorded in the audit log but never executed (no external-data/execution gate is open). Runs, audit log and the kill-switch are stored locally in this browser only.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
