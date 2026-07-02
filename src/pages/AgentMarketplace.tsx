import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bot, Search, Star, Download,
  Code2, TrendingUp, FileText, Globe, Shield,
  Sparkles, Brain, BarChart3, Wand2, Cpu,
  CheckCircle2, ArrowLeft, Users, Trophy,
  Zap,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import { AlertCircle } from 'lucide-react';
import { Link } from 'react-router';

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
  { id: '1', name: 'Startup Mentor', description: 'Validate ideas, build MVPs, find PMF with AI-guided startup coaching and market analysis.', icon: Sparkles, color: 'orange', creator: 'KorvixAI', rating: 4.9, downloads: '2.4k', category: 'Productivity', tags: ['startup', 'mvp', 'validation'], installed: true },
  { id: '2', name: 'Shopify Expert', description: 'Product research, ad copy generation, SEO optimization for e-commerce stores.', icon: TrendingUp, color: 'emerald', creator: 'KorvixAI', rating: 4.8, downloads: '1.8k', category: 'Productivity', tags: ['ecommerce', 'shopify', 'ads'] },
  { id: '3', name: 'Code Reviewer', description: 'Review PRs, find bugs, optimize performance with detailed code analysis.', icon: Code2, color: 'blue', creator: 'KorvixAI', rating: 4.7, downloads: '3.1k', category: 'Coding', tags: ['code', 'review', 'git'], installed: true },
  { id: '4', name: 'Market Scanner', description: 'Monitors markets for trading signals and investment opportunities in real-time.', icon: BarChart3, color: 'cyan', creator: 'KorvixAI', rating: 4.8, downloads: '2.0k', category: 'Trading', tags: ['trading', 'signals', 'stocks'], installed: true },
  { id: '5', name: 'Research Analyst', description: 'Deep research and synthesis across academic and commercial sources.', icon: Brain, color: 'violet', creator: 'KorvixAI', rating: 4.9, downloads: '1.5k', category: 'Research', tags: ['research', 'analysis', 'reports'] },
  { id: '6', name: 'Content Writer', description: 'Generate and refine content across formats — blogs, ads, social, email.', icon: Wand2, color: 'pink', creator: 'KorvixAI', rating: 4.6, downloads: '2.2k', category: 'Writing', tags: ['writing', 'blog', 'copy'] },
  { id: '7', name: 'Security Auditor', description: 'Scans for vulnerabilities, compliance gaps, and security risks.', icon: Shield, color: 'red', creator: 'KorvixAI', rating: 4.7, downloads: '980', category: 'Security', tags: ['security', 'audit', 'compliance'] },
  { id: '8', name: 'Data Parser', description: 'Extracts and structures data from unstructured sources and documents.', icon: FileText, color: 'teal', creator: 'KorvixAI', rating: 4.5, downloads: '1.2k', category: 'Data', tags: ['data', 'parsing', 'extraction'] },
  { id: '9', name: 'System Optimizer', description: 'Monitors and optimizes system performance, resource allocation, and workflows.', icon: Cpu, color: 'indigo', creator: 'KorvixAI', rating: 4.8, downloads: '750', category: 'Productivity', tags: ['system', 'performance', 'monitoring'] },
  { id: '10', name: 'SEO Specialist', description: 'Keyword research, content optimization, backlink strategy, and rank tracking.', icon: Globe, color: 'amber', creator: 'AlexDev', rating: 4.6, downloads: '1.1k', category: 'Productivity', tags: ['seo', 'marketing', 'content'] },
  { id: '11', name: 'Legal Assistant', description: 'Contract review, compliance checks, risk analysis, and legal document drafting.', icon: Shield, color: 'slate', creator: 'LegalAI', rating: 4.4, downloads: '620', category: 'Security', tags: ['legal', 'contracts', 'compliance'] },
  { id: '12', name: 'Finance Planner', description: 'Budget planning, investment analysis, forecasting, and financial modeling.', icon: BarChart3, color: 'green', creator: 'FinancePro', rating: 4.7, downloads: '890', category: 'Productivity', tags: ['finance', 'planning', 'investment'] },
];

const COLOR_ICON: Record<string, string> = {
  orange: 'text-[#9CBBD1]', emerald: 'text-[#9CBBD1]', blue: 'text-[#9CBBD1]',
  cyan: 'text-[#9CBBD1]', violet: 'text-[#9CBBD1]', pink: 'text-[#9CBBD1]',
  red: 'text-[#9CBBD1]', teal: 'text-[#9CBBD1]', indigo: 'text-[#9CBBD1]',
  amber: 'text-[#9CBBD1]', slate: 'text-[#A9B7C6]', green: 'text-[#9CBBD1]',
};

const COLOR_BG_ICON: Record<string, string> = {
  orange: 'bg-[#7EA6BF]/[0.06]', emerald: 'bg-[#7EA6BF]/[0.06]', blue: 'bg-[#7EA6BF]/[0.06]',
  cyan: 'bg-[#7EA6BF]/[0.06]', violet: 'bg-[#7EA6BF]/[0.06]', pink: 'bg-[#7EA6BF]/[0.06]',
  red: 'bg-[#7EA6BF]/[0.06]', teal: 'bg-[#7EA6BF]/[0.06]', indigo: 'bg-[#7EA6BF]/[0.06]',
  amber: 'bg-[#7EA6BF]/[0.06]', slate: 'bg-slate-500/[0.06]', green: 'bg-[#7EA6BF]/[0.06]',
};

const COLOR_BORDER_ICON: Record<string, string> = {
  orange: 'border-[#7EA6BF]/15', emerald: 'border-[#7EA6BF]/15', blue: 'border-[#7EA6BF]/15',
  cyan: 'border-[#7EA6BF]/15', violet: 'border-[#7EA6BF]/15', pink: 'border-[#7EA6BF]/15',
  red: 'border-[#7EA6BF]/15', teal: 'border-[#7EA6BF]/15', indigo: 'border-[#7EA6BF]/15',
  amber: 'border-[#7EA6BF]/15', slate: 'border-slate-500/15', green: 'border-[#7EA6BF]/15',
};

const COLOR_GLOW: Record<string, string> = {
  orange: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', emerald: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', blue: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]',
  cyan: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', violet: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', pink: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]',
  red: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', teal: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', indigo: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]',
  amber: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]', slate: 'group-hover:shadow-[0_0_20px_-4px_rgba(169, 183, 198,0.08)]', green: 'group-hover:shadow-[0_0_20px_-4px_rgba(126, 166, 191,0.08)]',
};

export default function AgentMarketplace() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  const filtered = AGENTS.filter((a) => {
    const matchCat = activeCategory === 'All' || a.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q));
    return matchCat && matchSearch;
  });

  const installedCount = AGENTS.filter((a) => a.installed).length;
  const topRating = Math.max(...AGENTS.map((a) => a.rating));
  const totalDownloads = AGENTS.reduce((acc, a) => {
    const num = parseFloat(a.downloads.replace('k', '')) * (a.downloads.includes('k') ? 1000 : 1);
    return acc + num;
  }, 0);

  const stats = [
    { label: 'Installed', value: `${installedCount}`, icon: CheckCircle2, color: 'text-[#86A88B]', bg: 'bg-[#86A88B]/[0.06]', border: 'border-[#86A88B]/10' },
    { label: 'Available', value: `${AGENTS.length}`, icon: Bot, color: 'text-[#9CBBD1]', bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/10' },
    { label: 'Top Rating', value: `${topRating}`, icon: Trophy, color: 'text-[#9CBBD1]', bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/10' },
    { label: 'Downloads', value: `${(totalDownloads / 1000).toFixed(1)}k`, icon: Download, color: 'text-[#9CBBD1]', bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/10' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-12">
        {/* Back to workspace */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="mb-4"
        >
          <Link
            to="/workspace"
            className="inline-flex items-center gap-1.5 text-[11px] text-[#7F8FA3] hover:text-slate-300 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Workspace
          </Link>
        </motion.div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-6"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[#7EA6BF]/[0.06] border border-[#7EA6BF]/15">
              <Bot className="h-5 w-5 text-[#9CBBD1]/70" />
              {/* Orbital ring */}
              <motion.div
                className="absolute inset-0 rounded-xl border border-[#7EA6BF]/[0.08]"
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                style={{ borderStyle: 'dashed' }}
              />
            </div>
            <div>
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight">Agent Marketplace</h1>
              <p className="text-[13px] text-[#7F8FA3]">Browse, install, and create AI agents for your workspace.</p>
            </div>
          </div>
        </motion.div>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6"
        >
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className={`relative flex items-center gap-3 p-3 rounded-xl border ${s.border} ${s.bg} overflow-hidden group`}
            >
              {/* Subtle glow on hover */}
              <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${s.bg}`} style={{ filter: 'blur(20px)' }} />
              <div className="relative flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} ${s.border} border`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div>
                  <p className="text-[16px] font-semibold text-white">{s.value}</p>
                  <p className="text-[10px] text-[#7F8FA3]">{s.label}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Demo transparency */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="mb-4 p-3 rounded-xl border border-[#C2A15A]/10 bg-[#C2A15A]/[0.02] flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-[#C2A15A] shrink-0" />
          <p className="text-[11px] text-[#7F8FA3]">
            All agents shown are demonstration previews. Install actions are simulated. Connect your backend to enable real agent execution.
          </p>
        </motion.div>

        {/* Search + categories */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-6 space-y-3"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.015] border border-white/[0.04] px-3.5 py-2.5 max-w-sm focus-within:border-[#7EA6BF]/15 focus-within:bg-white/[0.02] transition-all w-full sm:w-auto">
              <Search className="h-3.5 w-3.5 text-[#7F8FA3] shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents, tags..."
                className="flex-1 bg-transparent text-[12px] text-white placeholder:text-[#7F8FA3] outline-none min-w-0"
              />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#7F8FA3]">
              <Users className="h-3 w-3" />
              <span>{filtered.length} agent{filtered.length !== 1 ? 's' : ''} {activeCategory !== 'All' ? `in ${activeCategory}` : ''}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                className={`px-3 py-[6px] rounded-lg text-[11px] font-medium transition-all ${
                  activeCategory === c
                    ? 'bg-white/[0.06] text-white border border-white/[0.06] shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]'
                    : 'text-[#7F8FA3] hover:text-[#A9B7C6] hover:bg-white/[0.015] border border-transparent hover:border-white/[0.03]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Featured Agent Banner (first installed agent) */}
        {activeCategory === 'All' && !search && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mb-6"
          >
            {(() => {
              const featured = AGENTS.find((a) => a.installed);
              if (!featured) return null;
              return (
                <div
                  className={`relative overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.01] p-5 group cursor-default transition-all duration-300 hover:border-white/[0.06] ${COLOR_GLOW[featured.color]}`}
                  onMouseEnter={() => setHoveredAgent(featured.id)}
                  onMouseLeave={() => setHoveredAgent(null)}
                >
                  {/* Background glow */}
                  <div className={`absolute -top-10 -right-10 w-40 h-40 ${COLOR_BG_ICON[featured.color]} rounded-full blur-3xl opacity-30 pointer-events-none transition-opacity duration-500 ${hoveredAgent === featured.id ? 'opacity-50' : 'opacity-30'}`} />
                  <div className="relative flex flex-col sm:flex-row items-start gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${COLOR_BG_ICON[featured.color]} border ${COLOR_BORDER_ICON[featured.color]} shrink-0`}>
                      <featured.icon className={`h-6 w-6 ${COLOR_ICON[featured.color]}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="flex items-center gap-1 text-[9px] font-medium text-[#9CBBD1] bg-[#7EA6BF]/[0.06] border border-[#7EA6BF]/10 px-1.5 py-0.5 rounded-full">
                          <Zap className="h-2.5 w-2.5" /> Featured
                        </span>
                        <span className="text-[9px] text-[#7F8FA3]">by {featured.creator}</span>
                      </div>
                      <h3 className="text-[16px] font-semibold text-white mb-1">{featured.name}</h3>
                      <p className="text-[12px] text-[#7F8FA3] leading-relaxed mb-3">{featured.description}</p>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`h-3 w-3 ${s <= Math.floor(featured.rating) ? 'text-[#9CBBD1] fill-[#9CBBD1]' : 'text-[#7F8FA3]'}`}
                            />
                          ))}
                          <span className="text-[11px] text-[#A9B7C6] ml-1">{featured.rating}</span>
                        </div>
                        <span className="text-[10px] text-[#7F8FA3] flex items-center gap-1">
                          <Download className="h-3 w-3" /> {featured.downloads}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 self-center">
                      <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#86A88B]/[0.06] text-[#86A88B] border border-[#86A88B]/10 text-[11px] font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Installed
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>
        )}

        {/* Agent Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((agent, i) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.35 }}
              whileHover={{ y: -2 }}
              className={`relative overflow-hidden rounded-2xl border border-white/[0.03] bg-white/[0.005] p-4 hover:bg-white/[0.01] hover:border-white/[0.06] transition-all duration-300 group ${COLOR_GLOW[agent.color] || ''}`}
              onMouseEnter={() => setHoveredAgent(agent.id)}
              onMouseLeave={() => setHoveredAgent(null)}
            >
              {/* Subtle color glow */}
              <div className={`absolute -top-8 -right-8 w-24 h-24 ${COLOR_BG_ICON[agent.color]} rounded-full blur-2xl opacity-20 pointer-events-none transition-opacity duration-500 ${hoveredAgent === agent.id ? 'opacity-40' : 'opacity-20'}`} />

              <div className="relative">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${COLOR_BG_ICON[agent.color] || ''} border ${COLOR_BORDER_ICON[agent.color] || ''} shrink-0 transition-transform duration-300 group-hover:scale-105`}>
                    <agent.icon className={`h-5 w-5 ${COLOR_ICON[agent.color] || ''}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-slate-200 group-hover:text-white transition-colors">{agent.name}</span>
                      {agent.installed && <CheckCircle2 className="h-3.5 w-3.5 text-[#86A88B]/60 shrink-0" />}
                    </div>
                    <p className="text-[11px] text-[#7F8FA3] leading-relaxed mt-0.5">{agent.description}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#7F8FA3] mb-3">
                  <span>by <span className="text-[#7F8FA3]">{agent.creator}</span></span>
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-2.5 w-2.5 ${s <= Math.floor(agent.rating) ? 'text-[#9CBBD1]/50 fill-[#9CBBD1]/50' : 'text-[#7F8FA3]'}`}
                        />
                      ))}
                      <span className="text-[#7F8FA3] ml-0.5">{agent.rating}</span>
                    </span>
                    <span className="flex items-center gap-0.5 text-[#7F8FA3]">
                      <Download className="h-2.5 w-2.5" />
                      {agent.downloads}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {agent.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="text-[9px] text-[#7F8FA3] bg-white/[0.02] border border-white/[0.03] px-2 py-[2px] rounded-md"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                <button
                  className={`w-full h-9 rounded-xl text-[11px] font-medium transition-all duration-200 flex items-center justify-center gap-1.5 ${
                    agent.installed
                      ? 'bg-[#86A88B]/[0.06] text-[#86A88B]/70 border border-[#86A88B]/10 cursor-default'
                      : 'bg-white/[0.03] text-[#A9B7C6] hover:text-white hover:bg-white/[0.06] border border-white/[0.05] hover:border-white/[0.1] active:scale-[0.98]'
                  }`}
                >
                  {agent.installed ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" /> Installed
                    </>
                  ) : (
                    <>
                      <Download className="h-3 w-3" /> Install
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="relative p-8 rounded-2xl border border-white/[0.04] bg-white/[0.015] max-w-sm w-full">
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-16 h-16 bg-[#7EA6BF]/[0.03] rounded-full blur-xl pointer-events-none" />
              <Search className="h-8 w-8 text-[#7F8FA3] mx-auto mb-3" />
              <p className="text-[14px] font-medium text-[#A9B7C6] mb-1">No agents found</p>
              <p className="text-[12px] text-[#7F8FA3]">Try adjusting your search or category filter.</p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
