import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Building2, Target, Rocket, Package, Users, PenLine, LayoutTemplate,
  Save, ChevronRight, Info, ListChecks, ShoppingCart, Bot,
} from 'lucide-react';
import EcommercePanel from './EcommercePanel';
import StartupBuilderPanel from './StartupBuilderPanel';
import AutopilotPanel from './AutopilotPanel';

/**
 * Business Workspace — Phase 3 increment 1.
 *
 * A goal-driven launchpad that routes structured prompts into the normal
 * chat. The "current project summary" is the user's OWN saved input (not
 * fabricated). No live market/product data is shown — quick launches ask
 * the AI and honestly flag when live data would be needed.
 */
const LS_KEY = 'korvix.business.v1';

interface BizState { goal: string; project: string }

function load(): BizState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return { goal: String(o?.goal || ''), project: String(o?.project || '') };
    }
  } catch { /* ignore */ }
  return { goal: '', project: '' };
}

const LAUNCHES: { id: string; label: string; desc: string; icon: typeof Rocket; build: (g: string) => string }[] = [
  {
    id: 'plan', label: 'Build my business plan', desc: 'Lean plan: customer, problem, solution, model, GTM',
    icon: Rocket,
    build: (g) => `Build a lean business plan${g ? ` for this goal: "${g}"` : ''}. Cover target customer, core problem, solution, positioning, monetization model, MVP scope, 30/60/90 launch roadmap, key risks and the next 3 actions. Ask one clarifying question if essential. Do not fabricate market sizes or competitor numbers.`,
  },
  {
    id: 'ideas', label: 'Find product ideas', desc: 'Opportunity ideas + how to validate demand',
    icon: Package,
    build: (g) => `Generate and rank product/offer ideas${g ? ` aligned with: "${g}"` : ''}. For each: who it's for, the pain, why now, and the cheapest way to validate demand. State clearly that live demand data is not connected — give a validation method, not invented numbers.`,
  },
  {
    id: 'competitor', label: 'Analyze a competitor', desc: 'Structured teardown + differentiation',
    icon: Users,
    build: (g) => `Help me analyze a competitor${g ? ` in the context of: "${g}"` : ''}. Give a teardown framework (positioning, offer, pricing, funnel, weaknesses) and a sharp differentiation angle. Ask which competitor if I haven't named one. Never invent revenue/traffic figures.`,
  },
  {
    id: 'ads', label: 'Create ad angles', desc: '6 angles + hooks for paid acquisition',
    icon: PenLine,
    build: (g) => `Create 6 distinct ad angles${g ? ` for: "${g}"` : ''} with the emotional driver and a sample hook for each, plus which audience each targets.`,
  },
  {
    id: 'landing', label: 'Review landing page', desc: 'CRO review of copy, hero & CTA',
    icon: LayoutTemplate,
    build: (g) => `Act as a CRO specialist${g ? ` (business: "${g}")` : ''}. Ask me to paste my landing page copy, then review clarity, value prop, friction and CTA with prioritized, specific fixes and 3 hero/CTA rewrites.`,
  },
];

export default function BusinessPanel({ onRunPrompt }: { onRunPrompt?: (prompt: string) => void }) {
  const [state, setState] = useState<BizState>(load);
  const [draft, setDraft] = useState<BizState>(state);
  const [view, setView] = useState<'workspace' | 'ecommerce' | 'startup' | 'autopilot'>('workspace');

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const dirty = draft.goal !== state.goal || draft.project !== state.project;
  const hasGoal = !!state.goal.trim();

  const nextActions = hasGoal
    ? [
        'Define your ideal customer & their #1 pain',
        'Validate demand cheaply before building',
        'Scope the smallest credible MVP',
        'Plan a 30/60/90 go-to-market',
        'Set one primary acquisition channel',
      ]
    : ['Set a clear business goal above to tailor recommendations and launches.'];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-3.5 border-b border-white/[0.04] bg-[#0a0a0a]/60">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/[0.08] border border-amber-500/15">
            <Building2 className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-white">Business Workspace</h2>
            <p className="text-[10px] text-slate-600">Goal-driven launchpad · routes to AI chat · saved locally</p>
          </div>
        </div>
        <div className="flex gap-1 mt-3 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03] w-fit">
          {([['workspace', 'Workspace', Target], ['ecommerce', 'E-commerce', ShoppingCart], ['startup', 'Startup', Rocket], ['autopilot', 'Autopilot', Bot]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                view === id ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <Icon className="w-3 h-3" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === 'ecommerce' ? (
          <EcommercePanel onRunPrompt={onRunPrompt} />
        ) : view === 'startup' ? (
          <StartupBuilderPanel onRunPrompt={onRunPrompt} />
        ) : view === 'autopilot' ? (
          <AutopilotPanel onRunPrompt={onRunPrompt} />
        ) : (
        <div className="p-4 space-y-3">
        {/* Goal / project */}
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[12px] font-medium text-slate-300">Your business goal</span>
          </div>
          <input
            value={draft.project}
            onChange={(e) => setDraft({ ...draft, project: e.target.value })}
            placeholder="Project / company name (optional)"
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-amber-500/20 transition-all"
          />
          <textarea
            value={draft.goal}
            onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
            rows={3}
            placeholder="e.g. Launch a focused dropshipping store in the home-fitness niche and reach first profitable sales."
            className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-amber-500/20 transition-all resize-none"
          />
          <button
            onClick={() => setState(draft)}
            disabled={!dirty}
            className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-[11px] font-medium transition-all ${
              dirty ? 'bg-amber-500/[0.1] border border-amber-500/20 text-amber-400 hover:bg-amber-500/[0.16]'
                    : 'bg-white/[0.02] border border-white/[0.04] text-slate-600 cursor-default'
            }`}
          >
            <Save className="w-3 h-3" /> {dirty ? 'Save goal' : 'Saved'}
          </button>
        </div>

        {/* Current project summary (user's own input — never fabricated) */}
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
          <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-1.5">Current project</p>
          {hasGoal ? (
            <>
              {state.project.trim() && <p className="text-[12px] font-medium text-white mb-1">{state.project}</p>}
              <p className="text-[12px] text-slate-400 leading-relaxed">{state.goal}</p>
            </>
          ) : (
            <p className="text-[11px] text-slate-600">No goal set yet — add one above to personalise launches.</p>
          )}
        </div>

        {/* Recommended next actions */}
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[12px] font-medium text-slate-300">Recommended next actions</span>
          </div>
          <ul className="space-y-1.5">
            {nextActions.map((a) => (
              <li key={a} className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
                <span className="mt-1 h-1 w-1 rounded-full bg-slate-600 shrink-0" />{a}
              </li>
            ))}
          </ul>
        </div>

        {/* Quick launches */}
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-2 px-1">Quick launch</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LAUNCHES.map((l, i) => {
              const Icon = l.icon;
              return (
                <motion.button
                  key={l.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => onRunPrompt?.(l.build(state.goal.trim()))}
                  className="text-left rounded-xl border border-white/[0.04] bg-white/[0.01] hover:border-amber-500/20 hover:bg-amber-500/[0.03] p-3.5 transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/[0.06] border border-amber-500/12 shrink-0">
                      <Icon className="h-4 w-4 text-amber-400/80" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-slate-200">{l.label}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-[10px] text-slate-600 leading-relaxed mt-1">{l.desc}</p>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Launches send a structured prompt to the AI chat. Live product/market/competitor
            data sources are not connected yet — outputs are AI-generated guidance, not live data.
          </p>
        </div>
        </div>
        )}
      </div>
    </div>
  );
}
