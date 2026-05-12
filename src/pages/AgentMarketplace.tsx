import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bot, Search, Star, Download,
  Code2, TrendingUp, FileText, Globe, Shield,
  Sparkles, Brain, BarChart3, Wand2, Cpu,
  CheckCircle2,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

interface MarketplaceAgent {
  id: string;
  name: string;
  description: string;
  icon: typeof Bot;
  color: string;
  creator: string;
  rating: number;
  downloads: string;
  category: string;
  tags: string[];
  installed?: boolean;
}

const CATEGORIES = ['All', 'Coding', 'Trading', 'Research', 'Writing', 'Security', 'Productivity', 'Data'];

const AGENTS: MarketplaceAgent[] = [
  { id: '1', name: 'Startup Mentor', description: 'Validate ideas, build MVPs, find PMF', icon: Sparkles, color: 'orange', creator: 'KorvixAI', rating: 4.9, downloads: '2.4k', category: 'Productivity', tags: ['startup', 'mvp', 'validation'], installed: true },
  { id: '2', name: 'Shopify Expert', description: 'Product research, ad copy, SEO optimization', icon: TrendingUp, color: 'emerald', creator: 'KorvixAI', rating: 4.8, downloads: '1.8k', category: 'Productivity', tags: ['ecommerce', 'shopify', 'ads'] },
  { id: '3', name: 'Code Reviewer', description: 'Review PRs, find bugs, optimize performance', icon: Code2, color: 'blue', creator: 'KorvixAI', rating: 4.7, downloads: '3.1k', category: 'Coding', tags: ['code', 'review', 'git'], installed: true },
  { id: '4', name: 'Market Scanner', description: 'Monitors markets for trading signals', icon: BarChart3, color: 'cyan', creator: 'KorvixAI', rating: 4.8, downloads: '2.0k', category: 'Trading', tags: ['trading', 'signals', 'stocks'], installed: true },
  { id: '5', name: 'Research Analyst', description: 'Deep research and synthesis across sources', icon: Brain, color: 'violet', creator: 'KorvixAI', rating: 4.9, downloads: '1.5k', category: 'Research', tags: ['research', 'analysis', 'reports'] },
  { id: '6', name: 'Content Writer', description: 'Generate and refine content across formats', icon: Wand2, color: 'pink', creator: 'KorvixAI', rating: 4.6, downloads: '2.2k', category: 'Writing', tags: ['writing', 'blog', 'copy'] },
  { id: '7', name: 'Security Auditor', description: 'Scans for vulnerabilities and compliance', icon: Shield, color: 'red', creator: 'KorvixAI', rating: 4.7, downloads: '980', category: 'Security', tags: ['security', 'audit', 'compliance'] },
  { id: '8', name: 'Data Parser', description: 'Extracts and structures data from sources', icon: FileText, color: 'teal', creator: 'KorvixAI', rating: 4.5, downloads: '1.2k', category: 'Data', tags: ['data', 'parsing', 'extraction'] },
  { id: '9', name: 'System Optimizer', description: 'Monitors and optimizes system performance', icon: Cpu, color: 'indigo', creator: 'KorvixAI', rating: 4.8, downloads: '750', category: 'Productivity', tags: ['system', 'performance', 'monitoring'] },
  { id: '10', name: 'SEO Specialist', description: 'Keyword research, content optimization, backlinks', icon: Globe, color: 'amber', creator: 'AlexDev', rating: 4.6, downloads: '1.1k', category: 'Productivity', tags: ['seo', 'marketing', 'content'] },
  { id: '11', name: 'Legal Assistant', description: 'Contract review, compliance checks, risk analysis', icon: Shield, color: 'slate', creator: 'LegalAI', rating: 4.4, downloads: '620', category: 'Security', tags: ['legal', 'contracts', 'compliance'] },
  { id: '12', name: 'Finance Planner', description: 'Budget planning, investment analysis, forecasting', icon: BarChart3, color: 'green', creator: 'FinancePro', rating: 4.7, downloads: '890', category: 'Productivity', tags: ['finance', 'planning', 'investment'] },
];

const COLOR_BG: Record<string, string> = {
  orange: 'bg-orange-500/[0.06]', emerald: 'bg-emerald-500/[0.06]', blue: 'bg-blue-500/[0.06]',
  cyan: 'bg-cyan-500/[0.06]', violet: 'bg-violet-500/[0.06]', pink: 'bg-pink-500/[0.06]',
  red: 'bg-red-500/[0.06]', teal: 'bg-teal-500/[0.06]', indigo: 'bg-indigo-500/[0.06]',
  amber: 'bg-amber-500/[0.06]', slate: 'bg-slate-500/[0.06]', green: 'bg-green-500/[0.06]',
};
const COLOR_BORDER: Record<string, string> = {
  orange: 'border-orange-500/12', emerald: 'border-emerald-500/12', blue: 'border-blue-500/12',
  cyan: 'border-cyan-500/12', violet: 'border-violet-500/12', pink: 'border-pink-500/12',
  red: 'border-red-500/12', teal: 'border-teal-500/12', indigo: 'border-indigo-500/12',
  amber: 'border-amber-500/12', slate: 'border-slate-500/12', green: 'border-green-500/12',
};
const COLOR_TEXT: Record<string, string> = {
  orange: 'text-orange-400/70', emerald: 'text-emerald-400/70', blue: 'text-blue-400/70',
  cyan: 'text-cyan-400/70', violet: 'text-violet-400/70', pink: 'text-pink-400/70',
  red: 'text-red-400/70', teal: 'text-teal-400/70', indigo: 'text-indigo-400/70',
  amber: 'text-amber-400/70', slate: 'text-slate-400/70', green: 'text-green-400/70',
};

export default function AgentMarketplace() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = AGENTS.filter((a) => {
    const matchCat = activeCategory === 'All' || a.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q));
    return matchCat && matchSearch;
  });

  const installedCount = AGENTS.filter((a) => a.installed).length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-12">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/[0.08] border border-indigo-500/15">
              <Bot className="h-5 w-5 text-indigo-400/70" />
            </div>
            <div>
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight">Agent Marketplace</h1>
              <p className="text-[13px] text-slate-500">{installedCount} installed · {AGENTS.length} available · Browse, install, and create AI agents.</p>
            </div>
          </div>
        </motion.div>

        {/* Search + categories */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-6 space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.015] border border-white/[0.04] px-3 py-2 max-w-sm focus-within:border-indigo-500/15 transition-colors">
            <Search className="h-3.5 w-3.5 text-slate-700 shrink-0" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents, tags..."
              className="flex-1 bg-transparent text-[12px] text-white placeholder:text-slate-700 outline-none min-w-0" />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setActiveCategory(c)}
                className={`px-2.5 py-1 rounded-md text-[11px] transition-all ${activeCategory === c ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400 hover:bg-white/[0.015]'}`}>
                {c}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Agent Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filtered.map((agent, i) => (
            <motion.div key={agent.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.35 }}
              className="rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 hover:bg-white/[0.01] hover:border-white/[0.05] transition-all group">
              <div className="flex items-start gap-3 mb-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${COLOR_BG[agent.color] || ''} border ${COLOR_BORDER[agent.color] || ''} shrink-0`}>
                  <agent.icon className={`h-5 w-5 ${COLOR_TEXT[agent.color] || ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-slate-300 group-hover:text-white transition-colors">{agent.name}</span>
                    {agent.installed && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/50 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">{agent.description}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-700 mb-3">
                <span>by {agent.creator}</span>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5"><Star className="h-2.5 w-2.5 text-amber-400/40" />{agent.rating}</span>
                  <span className="flex items-center gap-0.5"><Download className="h-2.5 w-2.5" />{agent.downloads}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {agent.tags.slice(0, 3).map((t) => (
                  <span key={t} className="text-[9px] text-slate-600 bg-white/[0.02] border border-white/[0.03] px-1.5 py-[1px] rounded">{t}</span>
                ))}
              </div>

              <button className={`w-full h-8 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                agent.installed
                  ? 'bg-emerald-500/[0.06] text-emerald-400/60 border border-emerald-500/10 cursor-default'
                  : 'bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.05]'
              }`}>
                {agent.installed ? <><CheckCircle2 className="h-3 w-3" /> Installed</> : <><Download className="h-3 w-3" /> Install</>}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
