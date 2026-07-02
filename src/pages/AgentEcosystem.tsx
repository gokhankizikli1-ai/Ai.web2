import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Zap, MessageSquare, Globe, Code, FileText,
  Shield, Users, BarChart3, Palette, BookOpen,
  Cpu, X, Play, ChevronRight,
  Star, Rocket,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

interface Agent {
  id: string;
  name: string;
  description: string;
  icon: typeof Bot;
  color: string;
  border: string;
  bg: string;
  category: string;
  categoryColor: string;
  rating: number;
  users: string;
  badge?: string;
  features: string[];
  inputs: { label: string; placeholder: string; type?: string }[];
  examples: string[];
  activity: string;
  confidence: number;
  status: 'live' | 'beta' | 'coming';
  conversations: number;
  avgResponse: string;
}

const AGENTS: Agent[] = [
  { id: 'scraper', name: 'Web Scraper Agent', description: 'Scrape any website and extract structured data automatically', icon: Globe, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Research', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.8, users: '12.4K', badge: 'Popular', features: ['Auto-scrape websites', 'Data extraction', 'Format conversion', 'Schedule runs'], inputs: [{ label: 'Website URL', placeholder: 'https://example.com' }, { label: 'What to extract', placeholder: 'Product names and prices' }], examples: ['Scrape competitor pricing', 'Extract article summaries', 'Monitor price changes'], activity: '1.2K runs/hr', confidence: 94, status: 'live', conversations: 12400, avgResponse: '2.1s' },
  { id: 'seo', name: 'SEO Optimizer Agent', description: 'Optimize content for search engines with keyword research', icon: BarChart3, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Content', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.7, users: '8.9K', badge: undefined, features: ['Keyword research', 'Content optimization', 'Meta generation', 'Rank tracking'], inputs: [{ label: 'Website or content URL', placeholder: 'https://yoursite.com/blog' }], examples: ['Optimize blog post', 'Generate meta descriptions', 'Find keyword gaps'], activity: '890 runs/hr', confidence: 91, status: 'live', conversations: 8900, avgResponse: '1.8s' },
  { id: 'writer', name: 'AI Writer Agent', description: 'Generate blog posts, emails, and social media content', icon: FileText, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Content', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.9, users: '24.7K', badge: 'Popular', features: ['Blog posts', 'Email copy', 'Social content', 'SEO articles'], inputs: [{ label: 'Topic or brief', placeholder: 'Write about AI in healthcare', type: 'textarea' }], examples: ['Write a blog post', 'Generate email sequence', 'Create social media calendar'], activity: '3.1K runs/hr', confidence: 97, status: 'live', conversations: 24700, avgResponse: '3.2s' },
  { id: 'analyst', name: 'Data Analyst Agent', description: 'Analyze data sets, create charts, and find insights', icon: Cpu, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Research', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.6, users: '6.3K', badge: undefined, features: ['CSV analysis', 'Chart generation', 'Pattern detection', 'Report creation'], inputs: [{ label: 'Upload or paste data', placeholder: 'Paste CSV or describe dataset', type: 'textarea' }], examples: ['Analyze sales data', 'Generate trend report', 'Find anomalies'], activity: '520 runs/hr', confidence: 88, status: 'live', conversations: 6300, avgResponse: '4.5s' },
  { id: 'designer', name: 'UI/UX Designer Agent', description: 'Design interfaces, wireframes, and user experiences', icon: Palette, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Creative', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.5, users: '4.1K', badge: 'New', features: ['Wireframe generation', 'Design review', 'Color palette', 'Component design'], inputs: [{ label: 'Describe your UI need', placeholder: 'Design a landing page for...', type: 'textarea' }], examples: ['Design onboarding flow', 'Review current UI', 'Create color system'], activity: '340 runs/hr', confidence: 85, status: 'live', conversations: 4100, avgResponse: '3.8s' },
  { id: 'security', name: 'Security Auditor Agent', description: 'Audit code and systems for security vulnerabilities', icon: Shield, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'DevOps', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.7, users: '3.2K', badge: undefined, features: ['Code audit', 'Vulnerability scan', 'Best practices', 'Compliance check'], inputs: [{ label: 'Paste code or describe system', placeholder: 'function authenticate(user)...', type: 'textarea' }], examples: ['Audit auth system', 'Check for SQL injection', 'Review API security'], activity: '180 runs/hr', confidence: 92, status: 'live', conversations: 3200, avgResponse: '5.1s' },
  { id: 'researcher', name: 'Deep Research Agent', description: 'Conduct deep research across multiple sources with citations', icon: BookOpen, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Research', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.8, users: '9.8K', badge: 'Popular', features: ['Multi-source research', 'Citation tracking', 'Summary generation', 'Trend analysis'], inputs: [{ label: 'Research topic', placeholder: 'The impact of quantum computing on cryptography', type: 'textarea' }], examples: ['Research AI regulation', 'Compare cloud providers', 'Analyze market trends'], activity: '1.5K runs/hr', confidence: 96, status: 'live', conversations: 9800, avgResponse: '6.2s' },
  { id: 'social', name: 'Social Media Agent', description: 'Create content calendars and generate social media posts', icon: MessageSquare, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Content', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.4, users: '7.6K', badge: undefined, features: ['Content calendar', 'Post generation', 'Hashtag research', 'Engagement analysis'], inputs: [{ label: 'Brand or topic', placeholder: 'KorvixAI — AI productivity platform' }], examples: ['Generate weekly content', 'Create Twitter thread', 'Plan product launch'], activity: '780 runs/hr', confidence: 83, status: 'live', conversations: 7600, avgResponse: '2.4s' },
  { id: 'trading', name: 'Trading Signal Agent', description: 'Analyze markets and generate trading signals with risk metrics', icon: BarChart3, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Finance', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.3, users: '5.4K', badge: 'Beta', features: ['Signal detection', 'Risk analysis', 'Portfolio review', 'Market alerts'], inputs: [{ label: 'Stock or crypto symbol', placeholder: 'AAPL or BTC' }], examples: ['Analyze NVDA setup', 'Review portfolio risk', 'Find swing trades'], activity: '420 runs/hr', confidence: 79, status: 'beta', conversations: 5400, avgResponse: '4.8s' },
  { id: 'onboarding', name: 'Customer Onboarding Agent', description: 'Design user onboarding flows and activation sequences', icon: Users, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Growth', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.6, users: '3.8K', badge: undefined, features: ['Welcome sequences', 'User education', 'FAQ builder', 'Activation flows'], inputs: [{ label: 'Product description', placeholder: 'SaaS analytics platform for e-commerce', type: 'textarea' }], examples: ['Design onboarding flow', 'Create help docs', 'Build email sequence'], activity: '290 runs/hr', confidence: 87, status: 'live', conversations: 3800, avgResponse: '3.0s' },
  { id: 'api', name: 'API Builder Agent', description: 'Design REST APIs, generate schemas, and create documentation', icon: Code, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'DevOps', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.7, users: '4.6K', badge: undefined, features: ['Endpoint design', 'Schema generation', 'Documentation', 'Testing'], inputs: [{ label: 'Describe your API', placeholder: 'A REST API for a todo app with users, projects...', type: 'textarea' }], examples: ['Design payment API', 'Generate OpenAPI spec', 'Create auth endpoints'], activity: '360 runs/hr', confidence: 93, status: 'live', conversations: 4600, avgResponse: '3.5s' },
  { id: 'launch', name: 'Product Launch Agent', description: 'Plan product launches with checklists and growth playbooks', icon: Rocket, color: 'text-[#60A5FA]', border: 'border-[#3B82F6]/10', bg: 'bg-[#3B82F6]/[0.04]', category: 'Growth', categoryColor: 'text-[#60A5FA]/70 bg-[#3B82F6]/[0.06]', rating: 4.5, users: '2.9K', badge: 'New', features: ['Launch checklist', 'Press kit', 'Beta program', 'Growth playbook'], inputs: [{ label: 'Product details', placeholder: 'KorvixAI — AI workspace...', type: 'textarea' }], examples: ['Plan product launch', 'Create press release', 'Design beta signup'], activity: '210 runs/hr', confidence: 84, status: 'live', conversations: 2900, avgResponse: '2.8s' },
];

const CATEGORIES = ['All', 'Research', 'Content', 'Creative', 'Finance', 'DevOps', 'Growth'];

export default function AgentEcosystem() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const filtered = activeCategory === 'All'
    ? AGENTS
    : AGENTS.filter((a) => a.category === activeCategory);

  const handleLaunch = () => {
    const prompt = selectedAgent
      ? `${selectedAgent.name}: ${Object.values(formValues).join(' | ')}`
      : '';
    navigate('/chat', { state: { initialPrompt: prompt } });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white relative">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-16">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]/[0.08] border border-[#3B82F6]/15">
              <Bot className="h-5 w-5 text-[#60A5FA]/70" />
            </div>
            <div>
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight">AI Agent Ecosystem</h1>
              <p className="text-[13px] text-[#94A3B8]">12 production agents. Deploy any with one click.</p>
            </div>
          </div>
        </motion.div>

        {/* Activity Bar */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-6 flex items-center gap-4 py-3 px-4 rounded-2xl border border-white/[0.03] bg-white/[0.01] overflow-x-auto">
          <div className="flex items-center gap-1.5 text-[11px] text-[#4ADE80]/60 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
            <span>All systems operational</span>
          </div>
          <div className="w-px h-4 bg-white/[0.04] shrink-0" />
          <span className="text-[11px] text-[#94A3B8] shrink-0">{AGENTS.reduce((a, g) => a + g.conversations, 0).toLocaleString()} conversations</span>
          <span className="text-[11px] text-[#94A3B8] shrink-0">{AGENTS.filter((a) => a.status === 'live').length} agents live</span>
          <span className="text-[11px] text-[#94A3B8] shrink-0">{AGENTS.filter((a) => a.status === 'beta').length} in beta</span>
        </motion.div>

        {/* Category Tabs */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }} className="flex gap-1 p-0.5 rounded-xl bg-white/[0.02] border border-white/[0.03] w-fit mb-6 overflow-x-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all shrink-0 ${
                activeCategory === cat ? 'bg-white/[0.06] text-white' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
              }`}
            >
              {cat}
            </button>
          ))}
        </motion.div>

        {/* Agent Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filtered.map((agent, i) => (
            <motion.button
              key={agent.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.35 }}
              whileHover={{ scale: 1.01, y: -1 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => { setSelectedAgent(agent); setFormValues({}); }}
              className="text-left rounded-xl border border-white/[0.02] bg-white/[0.005] p-4 hover:bg-white/[0.01] hover:border-white/[0.05] transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${agent.bg} ${agent.border} border`}>
                  <agent.icon className={`h-4 w-4 ${agent.color}`} />
                </div>
                <div className="flex items-center gap-1.5">
                  {agent.status === 'live' && <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" />}
                  {agent.status === 'beta' && <div className="w-1.5 h-1.5 rounded-full bg-[#FACC15]" />}
                  <span className={`text-[9px] px-1.5 py-[1px] rounded ${agent.categoryColor}`}>{agent.category}</span>
                </div>
              </div>

              <h3 className="text-[13px] font-medium text-white mb-1">{agent.name}</h3>
              <p className="text-[11px] text-[#94A3B8] leading-relaxed mb-3 line-clamp-2">{agent.description}</p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[#94A3B8] flex items-center gap-0.5">
                    <Star className="h-2.5 w-2.5 text-[#60A5FA]/50" /> {agent.rating}
                  </span>
                  <span className="text-[10px] text-[#94A3B8] flex items-center gap-0.5">
                    <Users className="h-2.5 w-2.5" /> {agent.users}
                  </span>
                </div>
                <span className="text-[10px] text-[#60A5FA]/50 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  Launch <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* ═══ Agent Detail Modal ═══ */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0a0f1a]/70 backdrop-blur-md p-4"
            onClick={() => setSelectedAgent(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] as const }}
              className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-white/[0.06] bg-[#171C24] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${selectedAgent.bg} ${selectedAgent.border} border`}>
                    <selectedAgent.icon className={`h-4 w-4 ${selectedAgent.color}`} />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-medium text-white">{selectedAgent.name}</h3>
                    <p className="text-[11px] text-[#94A3B8]">{selectedAgent.description}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedAgent(null)} className="h-7 w-7 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/[0.05] transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
                {/* Stats */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.02] text-center">
                    <p className="text-[11px] text-[#94A3B8] mb-0.5">Rating</p>
                    <p className="text-[13px] font-medium text-[#60A5FA] flex items-center justify-center gap-0.5"><Star className="h-3 w-3" /> {selectedAgent.rating}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.02] text-center">
                    <p className="text-[11px] text-[#94A3B8] mb-0.5">Users</p>
                    <p className="text-[13px] font-medium text-white">{selectedAgent.users}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.02] text-center">
                    <p className="text-[11px] text-[#94A3B8] mb-0.5">Speed</p>
                    <p className="text-[13px] font-medium text-[#60A5FA]">{selectedAgent.avgResponse}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.02] text-center">
                    <p className="text-[11px] text-[#94A3B8] mb-0.5">Accuracy</p>
                    <p className="text-[13px] font-medium text-[#4ADE80]">{selectedAgent.confidence}%</p>
                  </div>
                </div>

                {/* Features */}
                <div>
                  <p className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Capabilities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAgent.features.map((f) => (
                      <span key={f} className="text-[10px] px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.03] text-[#94A3B8]">{f}</span>
                    ))}
                  </div>
                </div>

                {/* Quick examples */}
                <div>
                  <p className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider mb-2">Try these</p>
                  <div className="space-y-1.5">
                    {selectedAgent.examples.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => navigate('/chat', { state: { initialPrompt: `${selectedAgent.name}: ${ex}` } })}
                        className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.03] transition-all"
                      >
                        <Zap className="h-3 w-3 text-[#94A3B8] shrink-0" />
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inputs */}
                <div className="space-y-3">
                  {selectedAgent.inputs.map((input, i) => (
                    <div key={i}>
                      <label className="text-[11px] text-[#94A3B8] mb-1.5 block">{input.label}</label>
                      {input.type === 'textarea' ? (
                        <textarea
                          value={formValues[i] || ''}
                          onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))}
                          placeholder={input.placeholder}
                          rows={3}
                          className="w-full rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-[12px] text-white placeholder:text-[#94A3B8] focus:border-[#3B82F6]/20 outline-none transition-all resize-none"
                        />
                      ) : (
                        <input
                          type="text"
                          value={formValues[i] || ''}
                          onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))}
                          placeholder={input.placeholder}
                          className="w-full h-9 rounded-xl bg-white/[0.02] border border-white/[0.04] px-3 text-[12px] text-white placeholder:text-[#94A3B8] focus:border-[#3B82F6]/20 outline-none transition-all"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer CTA */}
              <div className="shrink-0 p-4 border-t border-white/[0.04] bg-white/[0.01]">
                <button
                  onClick={handleLaunch}
                  className="w-full h-10 rounded-xl bg-[#3B82F6]/[0.08] text-[#60A5FA] border border-[#3B82F6]/15 text-[13px] hover:bg-[#3B82F6]/[0.12] transition-all flex items-center justify-center gap-2"
                >
                  <Play className="h-4 w-4" /> Deploy {selectedAgent.name}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
