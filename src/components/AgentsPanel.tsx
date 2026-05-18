import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Search, ChevronRight, Sparkles, Info,
  Rocket, Package, ShoppingCart, PenLine, Users, LayoutTemplate, Globe, LineChart,
} from 'lucide-react';

/**
 * Agent Hub — Phase 3 increment 1.
 *
 * Business-focused AI agents. These are PROMPT-ROUTING presets, not
 * autonomous executors: a quick action builds a structured prompt and
 * sends it into the normal chat (via onRunPrompt). No fabricated data,
 * no autonomous execution, no backend change.
 */

interface AgentAction { label: string; prompt: string }
interface BusinessAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  bestUse: string[];
  actions: AgentAction[];
  icon: typeof Bot;
  accent: { bg: string; border: string; text: string };
}

const A = (text: string) =>
  `${text}\n\nRespond as a senior operator with a concise, structured, actionable answer. ` +
  `If you need one key detail to proceed, ask a single clarifying question first. ` +
  `Do not invent statistics, sales numbers, suppliers, or competitor figures — ` +
  `if live data is required, say so honestly and give a framework instead.`;

const AGENTS: BusinessAgent[] = [
  {
    id: 'startup-strategist', name: 'Startup Strategist', role: 'Business strategy & GTM',
    description: 'Validates ideas, shapes the business model, and plans go-to-market.',
    icon: Rocket, accent: { bg: 'bg-violet-500/[0.06]', border: 'border-violet-500/15', text: 'text-violet-400' },
    bestUse: ['Pressure-test a startup idea', 'Choose a monetization model', 'Plan a 30/60/90 GTM'],
    actions: [
      { label: 'Validate my startup idea', prompt: A('Act as a startup strategist. Validate my startup idea: assess problem, target customer, willingness to pay, and the riskiest assumption to test first.') },
      { label: 'Design a go-to-market plan', prompt: A('Act as a startup strategist. Design a pragmatic 30/60/90-day go-to-market plan for an early-stage product.') },
      { label: 'Pick a monetization model', prompt: A('Act as a startup strategist. Compare monetization models for my product and recommend one with pricing rationale.') },
    ],
  },
  {
    id: 'product-researcher', name: 'Product Researcher', role: 'Product & demand discovery',
    description: 'Finds product opportunities and frames demand without faking data.',
    icon: Package, accent: { bg: 'bg-cyan-500/[0.06]', border: 'border-cyan-500/15', text: 'text-cyan-400' },
    bestUse: ['Generate product ideas for a niche', 'Frame a demand hypothesis', 'Define a lean MVP'],
    actions: [
      { label: 'Find product ideas in a niche', prompt: A('Act as a product researcher. Generate and rank product ideas for a niche I specify, with the demand signal you would check (no fabricated numbers).') },
      { label: 'Assess demand for a product', prompt: A('Act as a product researcher. Give me a demand-validation framework for a specific product and how to test it cheaply.') },
      { label: 'Define an MVP', prompt: A('Act as a product researcher. Define the smallest credible MVP for my product and what to deliberately cut.') },
    ],
  },
  {
    id: 'dropshipping-analyst', name: 'Dropshipping Analyst', role: 'E-commerce / dropshipping',
    description: 'Evaluates dropshipping products, margins, and launch risk — honestly.',
    icon: ShoppingCart, accent: { bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/15', text: 'text-emerald-400' },
    bestUse: ['Evaluate a product', 'Pricing & margin math', 'Risk-score a launch'],
    actions: [
      { label: 'Evaluate a dropshipping product', prompt: A('Act as a dropshipping analyst. Evaluate a product I specify across demand, competition, margin, and logistics risk. State where live data is needed instead of guessing.') },
      { label: 'Pricing & margin breakdown', prompt: A('Act as a dropshipping analyst. Build a pricing & contribution-margin breakdown template (COGS, ads, fees, shipping) for a product.') },
      { label: 'Risk-score a product', prompt: A('Act as a dropshipping analyst. Give a structured risk score (saturation, ad policy, shipping, returns) for a product I describe.') },
    ],
  },
  {
    id: 'ad-copywriter', name: 'Ad Copywriter', role: 'Performance ad copy',
    description: 'Writes angles, hooks, and primary text for paid acquisition.',
    icon: PenLine, accent: { bg: 'bg-pink-500/[0.06]', border: 'border-pink-500/15', text: 'text-pink-400' },
    bestUse: ['Generate ad angles', 'Hook + primary text', 'Cold vs retargeting copy'],
    actions: [
      { label: 'Write ad angles', prompt: A('Act as a performance ad copywriter. Produce 6 distinct ad angles for a product/offer I specify, each with the emotional driver.') },
      { label: 'Write a hook + primary text', prompt: A('Act as a performance ad copywriter. Write 3 hooks + matching primary text variants for a specified audience.') },
      { label: 'Cold vs retargeting copy', prompt: A('Act as a performance ad copywriter. Write distinct cold-traffic vs retargeting copy for the same offer and explain the difference.') },
    ],
  },
  {
    id: 'competitor-analyst', name: 'Competitor Analyst', role: 'Competitive intelligence',
    description: 'Structures competitor analysis and finds differentiation gaps.',
    icon: Users, accent: { bg: 'bg-amber-500/[0.06]', border: 'border-amber-500/15', text: 'text-amber-400' },
    bestUse: ['Analyze a competitor', 'Positioning vs a rival', 'Find differentiation gaps'],
    actions: [
      { label: 'Analyze a competitor', prompt: A('Act as a competitor analyst. Give a structured teardown framework for a competitor I name (positioning, offer, pricing, funnel, weaknesses) — no invented figures.') },
      { label: 'Positioning vs a competitor', prompt: A('Act as a competitor analyst. Help me position my product against a specific competitor with a sharp differentiation statement.') },
      { label: 'Find differentiation gaps', prompt: A('Act as a competitor analyst. Identify likely differentiation gaps in a market I describe and how to validate them.') },
    ],
  },
  {
    id: 'landing-reviewer', name: 'Landing Page Reviewer', role: 'CRO / landing pages',
    description: 'Reviews landing copy and structure for conversion.',
    icon: LayoutTemplate, accent: { bg: 'bg-blue-500/[0.06]', border: 'border-blue-500/15', text: 'text-blue-400' },
    bestUse: ['Review landing copy', 'Improve hero & CTA', 'Conversion checklist'],
    actions: [
      { label: 'Review my landing page', prompt: A('Act as a CRO specialist. Review landing page copy I paste: clarity, value prop, friction, CTA — prioritized fixes.') },
      { label: 'Improve hero & CTA', prompt: A('Act as a CRO specialist. Rewrite my hero headline, subhead, and CTA with 3 variants and rationale.') },
      { label: 'Conversion checklist', prompt: A('Act as a CRO specialist. Give a prioritized landing-page conversion checklist for an early-stage offer.') },
    ],
  },
  {
    id: 'seo-analyst', name: 'SEO Analyst', role: 'SEO & content',
    description: 'Plans keywords, topics, and on-page improvements.',
    icon: Globe, accent: { bg: 'bg-teal-500/[0.06]', border: 'border-teal-500/15', text: 'text-teal-400' },
    bestUse: ['Keyword & topic plan', 'On-page review', 'Content brief'],
    actions: [
      { label: 'Keyword & topic plan', prompt: A('Act as an SEO analyst. Build a keyword & topic-cluster plan for a niche I specify (intent-mapped). State that volumes need a live tool — do not fabricate them.') },
      { label: 'On-page SEO review', prompt: A('Act as an SEO analyst. Give an on-page SEO review framework for a page I describe (title, structure, intent, internal links).') },
      { label: 'Content brief', prompt: A('Act as an SEO analyst. Produce a content brief (angle, outline, entities, CTA) for a target keyword I provide.') },
    ],
  },
  {
    id: 'finance-analyst', name: 'Finance / Trading Analyst', role: 'Finance & markets',
    description: 'Routes market/finance questions into the live trading-aware chat.',
    icon: LineChart, accent: { bg: 'bg-indigo-500/[0.06]', border: 'border-indigo-500/15', text: 'text-indigo-400' },
    bestUse: ['Analyze a stock/crypto', 'Build a trade thesis', 'Risk & sizing'],
    actions: [
      { label: 'Analyze a stock or crypto', prompt: A('Give me an honest market analysis for a symbol I specify (trend, momentum, key levels, risks). Use live data where available and say so when it is not.') },
      { label: 'Build a trade thesis', prompt: A('Help me build a structured trade thesis for a symbol: bias, invalidation, risk/reward — analysis only, not financial advice.') },
      { label: 'Risk & position sizing', prompt: A('Act as a risk analyst. Walk me through position sizing and risk management for a trade I describe — analysis only, not financial advice.') },
    ],
  },
];

export default function AgentsPanel({ onRunPrompt }: { onRunPrompt?: (prompt: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const filtered = AGENTS.filter((a) =>
    !q || `${a.name} ${a.role} ${a.description}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-3.5 border-b border-white/[0.04] bg-[#0a0a0a]/60">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/[0.08] border border-indigo-500/15">
            <Bot className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-white">Agent Hub</h2>
            <p className="text-[10px] text-slate-600">Business AI agents · prompt-routed into chat · no autonomous execution</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search agents…"
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/20 transition-all"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map((agent, i) => {
            const Icon = agent.icon;
            const open = selected === agent.id;
            return (
              <motion.div
                key={agent.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`rounded-xl border ${open ? `${agent.accent.bg} ${agent.accent.border}` : 'border-white/[0.04] bg-white/[0.01] hover:border-white/[0.08]'} transition-all duration-200`}
              >
                <button
                  onClick={() => setSelected(open ? null : agent.id)}
                  className="w-full text-left p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${agent.accent.bg} border ${agent.accent.border} shrink-0`}>
                      <Icon className={`h-4 w-4 ${agent.accent.text}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-white truncate">{agent.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/[0.1] text-emerald-400 shrink-0">Ready</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{agent.role}</p>
                      <p className="text-[11px] text-slate-500 leading-relaxed mt-1.5">{agent.description}</p>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-slate-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </div>
                </button>
                <AnimatePresence>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-white/[0.04]">
                        <div>
                          <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-1.5 mt-2">Best used for</p>
                          <ul className="space-y-1">
                            {agent.bestUse.map((b) => (
                              <li key={b} className="flex items-start gap-1.5 text-[11px] text-slate-400">
                                <Sparkles className="w-3 h-3 mt-0.5 text-slate-600 shrink-0" />{b}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-1.5">Quick actions</p>
                          <div className="flex flex-col gap-1.5">
                            {agent.actions.map((act) => (
                              <button
                                key={act.label}
                                onClick={() => onRunPrompt?.(act.prompt)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${agent.accent.bg} border ${agent.accent.border} text-[11px] font-medium ${agent.accent.text} hover:brightness-125 transition-all`}
                              >
                                {act.label}
                                <ChevronRight className="w-3.5 h-3.5 opacity-70" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="text-[11px] text-slate-600 text-center py-10">No agents match “{q}”.</p>
        )}
        <div className="flex items-start gap-2 mt-3 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Agents route a structured prompt into the AI chat. No autonomous execution and
            no live web/product data source is connected yet — answers are AI guidance, not live data.
          </p>
        </div>
      </div>
    </div>
  );
}
