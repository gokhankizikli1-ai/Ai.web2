import { useState } from 'react';
import {
  Bot, Rocket, Search, ShoppingCart, Megaphone,
  Target, Layout, BarChart3, TrendingUp, Sparkles,
  ChevronRight, Zap,
} from 'lucide-react';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
interface HubAgent {
  id: string;
  name: string;
  description: string;
  icon: typeof Bot;
  color: string;
  prompts: { label: string; prompt: string }[];
}

/* ═══════════════════════════════════════════
   8 BUSINESS AGENTS
   ═══════════════════════════════════════════ */
const HUB_AGENTS: HubAgent[] = [
  {
    id: 'startup-strategist',
    name: 'Startup Strategist',
    description: 'Validate ideas, build MVPs, find product-market fit',
    icon: Rocket,
    color: 'orange',
    prompts: [
      { label: 'Validate my startup idea', prompt: 'Validate my startup idea. Walk me through a structured validation framework including problem interviews, market sizing, and competitive analysis.' },
      { label: 'Build a lean business plan', prompt: 'Build a lean business plan for my startup. Cover target customer, problem, solution, business model, and go-to-market strategy.' },
      { label: 'Find product-market fit', prompt: 'Help me find product-market fit. What metrics should I track and what experiments should I run to validate demand?' },
    ],
  },
  {
    id: 'product-researcher',
    name: 'Product Researcher',
    description: 'Find winning products, validate demand, analyze trends',
    icon: Search,
    color: 'blue',
    prompts: [
      { label: 'Find winning product ideas', prompt: 'Generate 5 high-opportunity product ideas for ecommerce. Include demand validation methods and market analysis for each.' },
      { label: 'Analyze product demand', prompt: 'Walk me through a demand analysis framework. How do I validate there is real market demand for a product before investing?' },
      { label: 'Research product trends', prompt: 'Research current product trends in the home-fitness niche. What categories are growing and what are the emerging opportunities?' },
    ],
  },
  {
    id: 'dropshipping-analyst',
    name: 'Dropshipping Analyst',
    description: 'Margin analysis, supplier evaluation, shipping risk',
    icon: ShoppingCart,
    color: 'emerald',
    prompts: [
      { label: 'Calculate product margins', prompt: 'Help me calculate and optimize product margins for dropshipping. Include COGS, shipping, ad costs, and platform fees.' },
      { label: 'Evaluate supplier options', prompt: 'Walk me through evaluating dropshipping suppliers. What criteria should I use and what red flags should I watch for?' },
      { label: 'Assess shipping risks', prompt: 'Assess shipping risks for my dropshipping product. What delivery timeframes, customs issues, and return handling should I plan for?' },
    ],
  },
  {
    id: 'ad-copywriter',
    name: 'Ad Copywriter',
    description: 'Generate ad angles, hooks, landing page copy',
    icon: Megaphone,
    color: 'violet',
    prompts: [
      { label: 'Generate ad angles', prompt: 'Create 6 different ad angles with compelling hooks for paid acquisition. Include headline variations and target audiences.' },
      { label: 'Write ad copy', prompt: 'Write high-converting ad copy for Facebook ads. Include 3 headline variations, primary text, and call-to-action options.' },
      { label: 'Create email sequences', prompt: 'Create a 5-email welcome sequence for new customers. Include subject lines, body copy, and conversion goals for each email.' },
    ],
  },
  {
    id: 'competitor-analyst',
    name: 'Competitor Analyst',
    description: 'Structured teardowns, gap analysis, positioning',
    icon: Target,
    color: 'red',
    prompts: [
      { label: 'Analyze a competitor', prompt: 'Walk me through a structured competitor analysis framework. How do I research competitors and find differentiation opportunities?' },
      { label: 'Find market gaps', prompt: 'Help me find market gaps my competitors are missing. What positioning strategies and feature opportunities should I consider?' },
      { label: 'Build a positioning map', prompt: 'Help me build a competitive positioning map. What dimensions should I use and how do I position against existing players?' },
    ],
  },
  {
    id: 'landing-page-reviewer',
    name: 'Landing Page Reviewer',
    description: 'Conversion audits, UX analysis, CTA optimization',
    icon: Layout,
    color: 'cyan',
    prompts: [
      { label: 'Review landing page', prompt: 'Review my landing page for conversion optimization. Analyze the hero section, copy, CTA placement, and suggest improvements.' },
      { label: 'Optimize CTA buttons', prompt: 'Help me optimize my call-to-action buttons. What copy, colors, placement, and sizing will maximize conversion rates?' },
      { label: 'Audit page structure', prompt: 'Audit my landing page structure. What sections should I include, in what order, and what are the best practices for each?' },
    ],
  },
  {
    id: 'seo-analyst',
    name: 'SEO Analyst',
    description: 'Keyword research, content strategy, rank optimization',
    icon: BarChart3,
    color: 'indigo',
    prompts: [
      { label: 'Keyword research', prompt: 'Conduct keyword research for my niche. Find high-volume, low-competition keywords with search intent analysis.' },
      { label: 'Build content strategy', prompt: 'Build an SEO content strategy for my website. What topics should I cover, how often should I publish, and what content formats work best?' },
      { label: 'Optimize for rankings', prompt: 'Walk me through on-page SEO optimization. What meta tags, headings, internal links, and content structure will help me rank higher?' },
    ],
  },
  {
    id: 'finance-trading-analyst',
    name: 'Finance / Trading Analyst',
    description: 'Market analysis, risk management, portfolio strategy',
    icon: TrendingUp,
    color: 'amber',
    prompts: [
      { label: 'Analyze market trends', prompt: 'Analyze current market trends and identify key levels for major indices. What are the support and resistance zones I should watch?' },
      { label: 'Build risk framework', prompt: 'Help me build a risk management framework for trading. What position sizing, stop losses, and portfolio allocation should I use?' },
      { label: 'Evaluate trading strategy', prompt: 'Evaluate my trading strategy. What are the strengths, weaknesses, and how can I improve my win rate and risk-adjusted returns?' },
    ],
  },
];

/* ═══════════════════════════════════════════
   COLOR MAP
   ═══════════════════════════════════════════ */
const COLOR_MAP: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  orange:  { bg: 'bg-[#52677A]/[0.05]',  border: 'border-[#52677A]/10',  icon: 'text-[#637B90]',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  blue:    { bg: 'bg-[#52677A]/[0.05]',    border: 'border-[#52677A]/10',    icon: 'text-[#637B90]',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  emerald: { bg: 'bg-[#52677A]/[0.05]', border: 'border-[#52677A]/10', icon: 'text-[#637B90]', glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  violet:  { bg: 'bg-[#52677A]/[0.05]',  border: 'border-[#52677A]/10',  icon: 'text-[#637B90]',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  red:     { bg: 'bg-[#52677A]/[0.05]',     border: 'border-[#52677A]/10',     icon: 'text-[#637B90]',     glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  cyan:    { bg: 'bg-[#52677A]/[0.05]',    border: 'border-[#52677A]/10',    icon: 'text-[#637B90]',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  indigo:  { bg: 'bg-[#52677A]/[0.05]',  border: 'border-[#52677A]/10',  icon: 'text-[#637B90]',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
  amber:   { bg: 'bg-[#52677A]/[0.05]',   border: 'border-[#52677A]/10',   icon: 'text-[#637B90]',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(82,103,122,0.08)]' },
};

/* ═══════════════════════════════════════════
   ROUTE TO CHAT
   ═══════════════════════════════════════════ */
function routeToChat(prompt: string) {
  window.dispatchEvent(new CustomEvent('korvix-route-to-chat', {
    detail: { prompt, workspace: 'agents' },
  }));
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */
export default function AgentsPanel() {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#52677A]/[0.06] border border-[#52677A]/10">
            <Bot className="h-4 w-4 text-[#637B90]/70" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-white">Agent Hub</h2>
            <p className="text-[11px] text-slate-500">Specialised AI agents — click any action to route into chat</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 pb-6">
        <div className="space-y-3">
          {HUB_AGENTS.map((agent) => {
            const c = COLOR_MAP[agent.color] || COLOR_MAP.blue;
            const isExpanded = expandedAgent === agent.id;

            return (
              <div
                key={agent.id}
                className={`rounded-2xl border border-white/[0.03] bg-white/[0.005] overflow-hidden transition-all duration-300 ${c.glow} ${isExpanded ? 'border-white/[0.06]' : ''}`}
              >
                {/* Agent Card Header */}
                <button
                  onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                  className="flex items-center gap-3 w-full p-4 text-left group"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.bg} border ${c.border} shrink-0 transition-transform duration-300 group-hover:scale-105`}>
                    <agent.icon className={`h-5 w-5 ${c.icon}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-white">{agent.name}</span>
                      <ChevronRight className={`h-4 w-4 text-[#64748B] transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">{agent.description}</p>
                  </div>
                </button>

                {/* Expanded Prompts */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-1.5">
                    <div className="h-px bg-white/[0.03] mb-2.5" />
                    {agent.prompts.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => routeToChat(p.prompt)}
                        className="flex items-center gap-3 w-full p-2.5 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:bg-white/[0.02] hover:border-white/[0.05] transition-all text-left group/action"
                      >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.02] border border-white/[0.03] shrink-0">
                          <Zap className="h-3 w-3 text-slate-500 group-hover/action:text-slate-400 transition-colors" />
                        </div>
                        <span className="text-[12px] text-slate-400 group-hover/action:text-slate-300 transition-colors">{p.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-[#64748B] ml-auto group-hover/action:text-slate-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl border border-white/[0.02] bg-white/[0.005]">
          <Sparkles className="h-3.5 w-3.5 text-slate-600 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Each agent sends a specialised structured prompt into the AI chat. Responses are AI-generated guidance — no live data or external execution is performed.
          </p>
        </div>
      </div>
    </div>
  );
}
