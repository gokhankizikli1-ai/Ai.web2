import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, TrendingUp, Star, Zap, ArrowRight,
  ExternalLink, Flame, Sparkles, Users, Clock,
  Globe, Code2, Cpu, Palette, LineChart, Shield,
  ChevronRight, Bookmark, BookmarkCheck, Rocket,
  MessageSquare, ShoppingBag, Brain,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const TRENDING = [
  { title: 'AI Agent Workflows', category: 'Technology', views: '12.4k', trend: '+34%', icon: Cpu, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.08]', border: 'border-[#52677A]/10' },
  { title: 'Shopify AI Tools', category: 'Ecommerce', views: '8.7k', trend: '+21%', icon: ShoppingBag, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.08]', border: 'border-[#52677A]/10' },
  { title: 'Startup Pitch AI', category: 'Startup', views: '6.2k', trend: '+18%', icon: Rocket, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.08]', border: 'border-[#52677A]/10' },
  { title: 'Code Generation', category: 'Development', views: '15.1k', trend: '+42%', icon: Code2, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.08]', border: 'border-[#52677A]/10' },
];

const FEATURED_AGENTS = [
  { name: 'Growth Hacker', description: 'Viral growth strategies, funnel optimization, and acquisition tactics', icon: TrendingUp, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]', users: '4.2k', rating: 4.9, tags: ['Marketing', 'Growth'] },
  { name: 'UX Researcher', description: 'User interviews, usability testing, and design validation', icon: Users, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]', users: '3.1k', rating: 4.8, tags: ['Design', 'Research'] },
  { name: 'Security Auditor', description: 'Code security review, vulnerability assessment, compliance', icon: Shield, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]', users: '2.8k', rating: 4.7, tags: ['Security', 'Code'] },
  { name: 'Data Scientist', description: 'Data analysis, ML models, visualization, and insights', icon: LineChart, color: 'text-[#7890A3]', bg: 'bg-[#52677A]/[0.06]', users: '5.6k', rating: 4.9, tags: ['Data', 'ML'] },
];

const NEW_ARRIVALS = [
  { title: 'Creative Director AI', desc: 'Brand identity, visual strategy, and creative campaigns', icon: Palette, time: '2 days ago', color: 'text-[#7890A3]' },
  { title: 'Global Expansion Advisor', desc: 'Market entry strategy, localization, and compliance', icon: Globe, time: '3 days ago', color: 'text-[#7890A3]' },
  { title: 'Deep Research Pro', desc: 'Multi-source research with academic paper access', icon: Brain, time: '4 days ago', color: 'text-[#7890A3]' },
  { title: 'Conversational Designer', desc: 'Design chat flows, voice UI, and interaction patterns', icon: MessageSquare, time: '5 days ago', color: 'text-[#7890A3]' },
];

const COMMUNITY_PROMPTS = [
  { title: 'Analyze competitor landing pages and suggest improvements', author: 'sarah_dev', likes: 234, uses: '1.2k', category: 'Marketing' },
  { title: 'Generate TikTok scripts from product descriptions', author: 'growth_king', likes: 189, uses: '890', category: 'Social' },
  { title: 'Debug React performance issues step by step', author: 'react_ninja', likes: 312, uses: '2.1k', category: 'Code' },
  { title: 'Create investor update emails from metrics', author: 'founder_life', likes: 156, uses: '670', category: 'Startup' },
  { title: 'Design system prompt for brand voice consistency', author: 'design_pro', likes: 278, uses: '1.5k', category: 'Design' },
  { title: 'Generate SEO blog outlines with keyword research', author: 'seo_expert', likes: 198, uses: '940', category: 'SEO' },
];

function BookmarkButton() {
  const [saved, setSaved] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setSaved(!saved); }}
      className={`p-1.5 rounded-md transition-colors ${saved ? 'text-[#7890A3] bg-[#52677A]/10' : 'text-slate-600 hover:text-slate-400 hover:bg-white/[0.03]'}`}
    >
      {saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'agents' | 'prompts' | 'trending'>('all');

  const filteredPrompts = search
    ? COMMUNITY_PROMPTS.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()))
    : COMMUNITY_PROMPTS;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Hero */}
          <motion.div {...fadeUp(0)} className="mb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#52677A]/[0.1] border border-[#52677A]/15">
                <Compass className="h-4 w-4 text-[#7890A3]" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Explore</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Discover trending agents, community prompts, and new arrivals</p>
          </motion.div>

          {/* Search + Tabs */}
          <motion.div {...fadeUp(0.05)} className="flex flex-col sm:flex-row gap-3 mb-8">
            <div className="flex-1 relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agents, prompts, and tools..."
                className="w-full h-10 pl-4 pr-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[13px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-[#52677A]/20 focus:bg-white/[0.03] transition-all"
              />
            </div>
            <div className="flex items-center gap-1 p-0.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              {(['all', 'trending', 'agents', 'prompts'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3.5 py-2 rounded-lg text-[12px] font-medium transition-all capitalize ${
                    activeTab === tab ? 'bg-white/[0.06] text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Trending Now */}
          <AnimatePresence mode="wait">
            {(activeTab === 'all' || activeTab === 'trending') && (
              <motion.section {...fadeUp(0.1)} key="trending" className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <Flame className="w-4 h-4 text-[#7890A3]" />
                  <h2 className="text-sm font-medium text-white">Trending Now</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {TRENDING.map((item) => (
                    <motion.div
                      key={item.title}
                      whileHover={{ y: -2 }}
                      className={`p-4 rounded-2xl border ${item.border} ${item.bg} cursor-pointer group`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`p-2 rounded-lg bg-white/[0.03]`}>
                          <item.icon className={`w-4 h-4 ${item.color}`} />
                        </div>
                        <span className="text-[11px] font-medium text-[#6F8F7A]">{item.trend}</span>
                      </div>
                      <h3 className="text-[13px] font-medium text-white mb-0.5">{item.title}</h3>
                      <p className="text-[11px] text-slate-500">{item.category} · {item.views} views</p>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Featured Agents */}
            {(activeTab === 'all' || activeTab === 'agents') && (
              <motion.section {...fadeUp(0.15)} key="agents" className="mb-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4 text-[#7890A3]" />
                    <h2 className="text-sm font-medium text-white">Featured Agents</h2>
                  </div>
                  <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-[#7890A3] transition-colors">
                    View all <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {FEATURED_AGENTS.map((agent) => (
                    <motion.div
                      key={agent.name}
                      whileHover={{ y: -1 }}
                      className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] hover:bg-white/[0.02] cursor-pointer transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl ${agent.bg} shrink-0`}>
                          <agent.icon className={`w-5 h-5 ${agent.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <h3 className="text-[13px] font-medium text-white">{agent.name}</h3>
                            <BookmarkButton />
                          </div>
                          <p className="text-[11px] text-slate-500 mb-2">{agent.description}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {agent.tags.map((tag) => (
                              <span key={tag} className="px-1.5 py-0.5 rounded-md bg-white/[0.03] text-[10px] text-slate-500">{tag}</span>
                            ))}
                            <span className="text-[10px] text-slate-600 ml-auto flex items-center gap-1">
                              <Users className="w-3 h-3" /> {agent.users} · <Star className="w-3 h-3 text-[#7890A3]" /> {agent.rating}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* New Arrivals */}
            {activeTab === 'all' && (
              <motion.section {...fadeUp(0.2)} key="new" className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-[#7890A3]" />
                  <h2 className="text-sm font-medium text-white">New Arrivals</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {NEW_ARRIVALS.map((item) => (
                    <motion.div
                      key={item.title}
                      whileHover={{ y: -2 }}
                      className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] cursor-pointer transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <item.icon className={`w-4 h-4 ${item.color}`} />
                        <span className="text-[11px] text-slate-500 ml-auto flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {item.time}
                        </span>
                      </div>
                      <h3 className="text-[13px] font-medium text-white mb-1">{item.title}</h3>
                      <p className="text-[11px] text-slate-500">{item.desc}</p>
                      <div className="flex items-center gap-1 mt-3 text-[11px] text-[#7890A3]/70 group-hover:text-[#7890A3] transition-colors">
                        Try it <ChevronRight className="w-3 h-3" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Community Prompts */}
            {(activeTab === 'all' || activeTab === 'prompts') && (
              <motion.section {...fadeUp(0.25)} key="prompts">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[#7890A3]" />
                    <h2 className="text-sm font-medium text-white">Community Prompts</h2>
                  </div>
                </div>
                <div className="space-y-2">
                  {filteredPrompts.map((prompt, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-4 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.06] hover:bg-white/[0.02] cursor-pointer transition-all group"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[13px] font-medium text-white group-hover:text-[#7890A3] transition-colors truncate">{prompt.title}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-500">@{prompt.author}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.03] text-slate-600">{prompt.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 shrink-0">
                        <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> {prompt.uses}</span>
                        <span className="flex items-center gap-1"><Flame className="w-3 h-3 text-[#7890A3]" /> {prompt.likes}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-[#7890A3] transition-colors" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Footer CTA */}
          <motion.div {...fadeUp(0.3)} className="mt-12 p-6 rounded-2xl border border-[#52677A]/10 bg-[#52677A]/[0.02] text-center">
            <h3 className="text-sm font-medium text-white mb-1">Want to share your own prompts?</h3>
            <p className="text-[12px] text-slate-500 mb-3">Join the community and contribute your best AI prompts</p>
            <button className="px-4 py-2 rounded-xl bg-[#52677A]/[0.1] border border-[#52677A]/15 text-[12px] font-medium text-[#7890A3] hover:bg-[#52677A]/[0.15] transition-colors">
              Coming Soon
            </button>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
