import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  Wrench, BarChart3, Globe, Code2,
  TrendingUp, Search, ArrowRight, ExternalLink,
  Layout, Flame,
  Clock, type LucideIcon,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

interface Tool {
  name: string;
  desc: string;
  path?: string;
  isNew?: boolean;
}

interface Category {
  name: string;
  icon: LucideIcon;
  color: string;
  tools: Tool[];
}

const CATEGORIES: Category[] = [
  {
    name: 'Web & Research',
    icon: Globe,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'Website Analyzer', desc: 'Analyze any website for UX, SEO, conversion', path: '/tools/website-analyzer', isNew: true },
      { name: 'Research Assistant', desc: 'Multi-source research synthesis' },
      { name: 'Citation Finder', desc: 'Find and format academic citations' },
      { name: 'Trend Analyzer', desc: 'Track trends across platforms' },
    ],
  },
  {
    name: 'Builders',
    icon: Layout,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'Website Builder', desc: 'Generate full website structure and copy', path: '/tools/website-builder', isNew: true },
      { name: 'App Builder', desc: 'Plan app structure, stack, and MVP', path: '/tools/app-builder', isNew: true },
      { name: 'Brand Builder', desc: 'Name, slogan, colors, positioning', path: '/tools/brand-builder', isNew: true },
    ],
  },
  {
    name: 'Content & Creative',
    icon: Flame,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'Viral Content Engine', desc: 'TikTok, YouTube, Instagram, X threads', path: '/tools/viral-content', isNew: true },
      { name: 'Blog Post Writer', desc: 'Generate full blog posts with SEO' },
      { name: 'Email Composer', desc: 'Professional emails for any context' },
      { name: 'Ad Copy Generator', desc: 'Facebook, Google, TikTok ad copy' },
      { name: 'Image Prompt Generator', desc: 'DALL-E and Midjourney prompts' },
      { name: 'Story Writer', desc: 'Fiction, scripts, narratives' },
    ],
  },
  {
    name: 'Code',
    icon: Code2,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'Code Generator', desc: 'Write code in any language' },
      { name: 'Code Explainer', desc: 'Understand complex codebases' },
      { name: 'Refactoring Tool', desc: 'Clean up and optimize code' },
      { name: 'Test Generator', desc: 'Auto-generate unit tests' },
      { name: 'Documentation Writer', desc: 'Generate docs from code' },
    ],
  },
  {
    name: 'Data & Analytics',
    icon: BarChart3,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'CSV Analyzer', desc: 'Upload and analyze spreadsheet data' },
      { name: 'Chart Creator', desc: 'Visualize data with charts and graphs' },
      { name: 'SQL Generator', desc: 'Write SQL from natural language' },
      { name: 'Data Cleaner', desc: 'Fix formatting, deduplicate, normalize' },
    ],
  },
  {
    name: 'Business',
    icon: TrendingUp,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'Pitch Deck Builder', desc: 'Investor presentations slide by slide' },
      { name: 'Financial Modeler', desc: 'Revenue projections and forecasts' },
      { name: 'SWOT Analyzer', desc: 'Strengths, weaknesses, opportunities' },
      { name: 'Competitor Tracker', desc: 'Monitor competitor moves' },
    ],
  },
  {
    name: 'Operations',
    icon: Clock,
    color: 'text-[#3B82F6]/60',
    tools: [
      { name: 'Automations', desc: 'Schedule recurring AI tasks and reports', path: '/tools/automations', isNew: true },
      { name: 'Knowledge Vault', desc: 'Store and query your documents', path: '/tools/knowledge-vault', isNew: true },
      { name: 'Multi-Agent Swarm', desc: 'Complex tasks with multiple AI agents', path: '/tools/swarm', isNew: true },
    ],
  },
];

export default function ToolsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filtered = CATEGORIES.map((cat) => ({
    ...cat,
    tools: cat.tools.filter((t) =>
      !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.desc.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((cat) => cat.tools.length > 0);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-12">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/[0.08] border border-slate-500/15">
                <Wrench className="h-4 w-4 text-[#CBD5E1]/70" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Tools</h1>
            </div>
            <p className="text-[13px] text-[#94A3B8] ml-11">All AI tools and generators in one place</p>
          </motion.div>

          {/* Search */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-8">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tools..."
                className="w-full h-11 pl-11 pr-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[13px] text-slate-300 placeholder:text-[#94A3B8] focus:outline-none focus:border-[#3B82F6]/20 focus:bg-white/[0.03] transition-all"
              />
            </div>
          </motion.div>

          {/* Categories */}
          <div className="space-y-8">
            {filtered.map((cat, ci) => (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + ci * 0.05 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <cat.icon className={`w-4 h-4 ${cat.color}`} />
                  <h2 className="text-sm font-semibold text-white">{cat.name}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cat.tools.map((tool, ti) => (
                    <motion.button
                      key={tool.name}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + ci * 0.05 + ti * 0.03 }}
                      whileHover={{ y: -1, borderColor: 'rgba(255,255,255,0.08)' }}
                      onClick={() => tool.path ? navigate(tool.path) : undefined}
                      className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${
                        tool.path
                          ? 'border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.02] cursor-pointer group'
                          : 'border-white/[0.02] bg-white/[0.01] opacity-60 cursor-default'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-white">{tool.name}</span>
                          {tool.isNew && (
                            <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/[0.1] text-[#3B82F6] uppercase tracking-wider">New</span>
                          )}
                          {tool.path && (
                            <ExternalLink className="w-3 h-3 text-[#94A3B8] opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </div>
                        <p className="text-[11px] text-[#94A3B8] mt-0.5">{tool.desc}</p>
                      </div>
                      {tool.path && (
                        <ArrowRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#60A5FA] transition-colors shrink-0" />
                      )}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
