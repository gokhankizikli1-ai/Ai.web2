import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Bot,
  Target, Lightbulb, AlertTriangle,
  ChevronRight, Search, FileText, Megaphone,
  Layout, Flag, Lock, ClipboardList, Radar,
} from 'lucide-react';
import EcommerceCommandCenter from './EcommerceCommandCenter';
import StartupMarketRadar from './startup/StartupMarketRadar';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
type BusinessSubTab = 'workspace' | 'ecommerce' | 'startup' | 'autopilot';

interface BusinessState {
  subTab: BusinessSubTab;
  goalName: string;
  goalText: string;
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

const QUICK_LAUNCH = [
  { icon: FileText, title: 'Build my business plan', desc: 'Lean plan: customer, problem, solution, model, GTM', prompt: 'Build a lean business plan covering target customer, problem, solution, business model, and go-to-market strategy.' },
  { icon: Lightbulb, title: 'Find product ideas', desc: 'Opportunity ideas + how to validate demand', prompt: 'Generate 5 high-opportunity product ideas for a dropshipping or ecommerce business, including validation methods for each.' },
  { icon: Search, title: 'Analyze a competitor', desc: 'Structured teardown + differentiation', prompt: 'Walk me through a structured competitor analysis framework. How do I research competitors and find differentiation opportunities?' },
  { icon: Megaphone, title: 'Create ad angles', desc: '6 angles + hooks for paid acquisition', prompt: 'Create 6 different ad angles with compelling hooks for paid acquisition. Include headline variations and target audiences.' },
  { icon: Layout, title: 'Review landing page', desc: 'AI review of copy, hero & CTA', prompt: 'Review my landing page for conversion optimization. Analyze the hero section, copy, CTA placement, and suggest improvements.' },
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
      className="w-full px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#64748B] outline-none focus:border-white/[0.08] transition-colors"
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
      className="w-full px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#64748B] outline-none focus:border-white/[0.08] transition-colors resize-none"
    />
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
  const [autoGoal, setAutoGoal] = useState(saved.autoGoal || '');
  const [killSwitch, setKillSwitch] = useState(saved.killSwitch || false);
  const [runs, setRuns] = useState<AutoRun[]>(saved.runs || []);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(saved.auditLog || []);
  const [auditOpen, setAuditOpen] = useState(saved.auditOpen || false);

  // Persist
  useEffect(() => {
    saveState({ subTab, goalName, goalText, autoGoal, killSwitch, runs, auditLog, auditOpen });
  });

  const handlePlanRun = useCallback(() => {
    if (!autoGoal.trim() || killSwitch) return;
    const newRun: AutoRun = {
      id: crypto.randomUUID(), goal: autoGoal, status: 'planning',
      steps: ['Analyze', 'Draft', 'Review', 'Approve'], timestamp: Date.now(),
    };
    setRuns(prev => [newRun, ...prev]);
    setAuditLog(prev => [{ id: crypto.randomUUID(), action: 'Run planned', detail: `Goal: "${autoGoal}"`, timestamp: Date.now() }, ...prev]);
  }, [autoGoal, killSwitch]);

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
              <AlertTriangle className="h-3 w-3 text-[#64748B] shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Launches send a structured prompt to the AI chat. Live product/market/competitor data sources are not connected yet — outputs are AI-generated guidance, not live data.
              </p>
            </div>
          </div>
        )}

        {subTab === 'ecommerce' && (
          <div className="h-full -mx-4 -mb-4">
            <EcommerceCommandCenter />
          </div>
        )}

        {subTab === 'startup' && (
          <div>
            {/* Same live Market Complaint Radar as /tools/startup —
                embedded mode hands "Send to Startup Advisor" off via the
                in-app korvix-route-to-chat event instead of a navigation. */}
            <div className="flex items-center gap-2 mb-2.5">
              <Radar className="h-3.5 w-3.5 text-amber-400/70" />
              <div>
                <span className="text-[13px] font-medium text-white">Market Complaint Radar</span>
                <p className="text-[10px] text-slate-500">Find where the market is angry before you build — live public signals, honest source status.</p>
              </div>
            </div>
            <StartupMarketRadar embedded />
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
              <ChevronRight className={`h-3.5 w-3.5 text-[#64748B] ml-auto transition-transform ${auditOpen ? 'rotate-90' : ''}`} />
            </button>
            {auditOpen && (
              <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                {auditLog.length === 0 ? (
                  <p className="text-[11px] text-slate-600">No audit entries yet.</p>
                ) : (
                  auditLog.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 text-[10px]">
                      <span className="text-[#64748B] shrink-0">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <div>
                        <span className="text-slate-400">{entry.action}</span>
                        <span className="text-[#64748B]"> — {entry.detail}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-2 rounded-xl border border-white/[0.02] bg-white/[0.005]">
              <AlertTriangle className="h-3 w-3 text-[#64748B] shrink-0 mt-0.5" />
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
