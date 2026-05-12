import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, Lightbulb, DollarSign, TrendingUp, FileText,
  BarChart3, Target, Zap, Sparkles, ArrowRight, Globe, Layers,
  Search, Crown, Flame, ChevronRight,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const TOOLS = [
  {
    id: 'validator', name: 'Idea Validator', icon: Lightbulb, color: 'amber',
    desc: 'Score your startup idea across 10 dimensions. Get honest feedback.',
    badge: 'Popular', inputs: [{ label: 'Describe your startup idea', placeholder: 'A platform that...', type: 'textarea' }],
  },
  {
    id: 'saas', name: 'SaaS Generator', icon: Layers, color: 'cyan',
    desc: 'Build your full SaaS from idea to tech stack to pricing model.',
    badge: 'New', inputs: [
      { label: 'Product name', placeholder: 'Acme AI', type: 'text' },
      { label: 'What does it do?', placeholder: 'Helps businesses...', type: 'textarea' },
    ],
  },
  {
    id: 'competitor', name: 'Competitor Analyzer', icon: Search, color: 'violet',
    desc: 'Research competitors, find their weaknesses, and position yourself.',
    badge: null, inputs: [{ label: 'Your startup idea or product', placeholder: 'AI-powered...', type: 'textarea' }],
  },
  {
    id: 'monetization', name: 'Monetization Planner', icon: DollarSign, color: 'emerald',
    desc: 'Generate revenue streams, pricing tiers, and business models.',
    badge: null, inputs: [{ label: 'Describe your product', placeholder: 'A tool that...', type: 'textarea' }],
  },
  {
    id: 'growth', name: 'Viral Growth Planner', icon: TrendingUp, color: 'rose',
    desc: 'Design viral loops, referral programs, and growth strategies.',
    badge: null, inputs: [{ label: 'Your product and target audience', placeholder: 'Product:... Audience:...', type: 'textarea' }],
  },
  {
    id: 'landing', name: 'Landing Page Generator', icon: FileText, color: 'blue',
    desc: 'Generate full landing page copy with hero, features, CTA, and pricing.',
    badge: 'Popular', inputs: [
      { label: 'Product name', placeholder: 'Acme', type: 'text' },
      { label: 'Key features', placeholder: 'AI-powered analytics...', type: 'textarea' },
    ],
  },
  {
    id: 'pitch', name: 'Pitch Deck Assistant', icon: Crown, color: 'indigo',
    desc: 'Build your investor pitch deck slide by slide with AI.',
    badge: null, inputs: [{ label: 'Startup name + one-liner', placeholder: 'Acme — AI for...', type: 'textarea' }],
  },
  {
    id: 'market', name: 'Market Research', icon: BarChart3, color: 'pink',
    desc: 'Analyze TAM, SAM, SOM, trends, and entry barriers.',
    badge: null, inputs: [{ label: 'Industry or market', placeholder: 'AI-powered healthcare...', type: 'text' }],
  },
  {
    id: 'model', name: 'Business Model Analyzer', icon: Globe, color: 'teal',
    desc: 'Compare business models, find the best fit, and optimize.',
    badge: null, inputs: [{ label: 'Describe your product', placeholder: 'Subscription-based...', type: 'textarea' }],
  },
  {
    id: 'icp', name: 'ICP Generator', icon: Target, color: 'orange',
    desc: 'Define your ideal customer profile with AI precision.',
    badge: null, inputs: [{ label: 'Product description', placeholder: 'Helps SaaS founders...', type: 'textarea' }],
  },
  {
    id: 'pricing', name: 'Pricing Strategy AI', icon: DollarSign, color: 'green',
    desc: 'Design pricing tiers, freemium models, and revenue optimization.',
    badge: null, inputs: [{ label: 'Product + current pricing', placeholder: 'We charge $29/mo for...', type: 'textarea' }],
  },
  {
    id: 'mvp', name: 'MVP Scope Generator', icon: Zap, color: 'yellow',
    desc: 'Define the minimum feature set to launch fast and learn.',
    badge: 'Popular', inputs: [{ label: 'Full product vision', placeholder: 'I want to build a platform that...', type: 'textarea' }],
  },
];

const COLOR_MAP: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  amber:   { bg: 'bg-amber-500/[0.05]', border: 'border-amber-500/10', icon: 'text-amber-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,191,36,0.08)]' },
  cyan:    { bg: 'bg-cyan-500/[0.05]', border: 'border-cyan-500/10', icon: 'text-cyan-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.08)]' },
  violet:  { bg: 'bg-violet-500/[0.05]', border: 'border-violet-500/10', icon: 'text-violet-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.08)]' },
  emerald: { bg: 'bg-emerald-500/[0.05]', border: 'border-emerald-500/10', icon: 'text-emerald-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.08)]' },
  rose:    { bg: 'bg-rose-500/[0.05]', border: 'border-rose-500/10', icon: 'text-rose-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,113,133,0.08)]' },
  blue:    { bg: 'bg-blue-500/[0.05]', border: 'border-blue-500/10', icon: 'text-blue-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(96,165,250,0.08)]' },
  indigo:  { bg: 'bg-indigo-500/[0.05]', border: 'border-indigo-500/10', icon: 'text-indigo-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(129,140,248,0.08)]' },
  pink:    { bg: 'bg-pink-500/[0.05]', border: 'border-pink-500/10', icon: 'text-pink-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(244,114,182,0.08)]' },
  teal:    { bg: 'bg-teal-500/[0.05]', border: 'border-teal-500/10', icon: 'text-teal-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(45,212,191,0.08)]' },
  orange:  { bg: 'bg-orange-500/[0.05]', border: 'border-orange-500/10', icon: 'text-orange-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,146,60,0.08)]' },
  green:   { bg: 'bg-green-500/[0.05]', border: 'border-green-500/10', icon: 'text-green-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(74,222,128,0.08)]' },
  yellow:  { bg: 'bg-yellow-500/[0.05]', border: 'border-yellow-500/10', icon: 'text-yellow-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(250,204,21,0.08)]' },
};

export default function StartupHub() {
  const navigate = useNavigate();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const activeTool = TOOLS.find((t) => t.id === selectedTool);

  // Pre-fill the chat composer via React Router state. ChatDashboard reads
  // location.state.prompt on mount and pushes it into the input — so the
  // user lands in chat with their tool answers ready to send, not lost.
  const handleSubmit = () => {
    const filled = Object.values(formValues).map((v) => v.trim()).filter(Boolean);
    if (!activeTool || filled.length === 0) {
      navigate('/chat');
      return;
    }
    const labels = (activeTool.inputs || []).map((i) => i.label);
    const lines  = filled.map((v, i) => labels[i] ? `${labels[i]}: ${v}` : v);
    const prompt = `[${activeTool.name}]\n${lines.join('\n')}`;
    navigate('/chat', { state: { prompt } });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/[0.08] border border-orange-500/15">
              <Rocket className="h-5 w-5 text-orange-400/70" />
            </div>
            <div>
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight">Startup Hub</h1>
              <p className="text-[13px] text-slate-500">Validate ideas, build MVPs, and find product-market fit — with AI.</p>
            </div>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {/* Tool Grid View */}
          {!selectedTool && (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
            >
              {TOOLS.map((tool, i) => {
                const c = COLOR_MAP[tool.color] || COLOR_MAP.amber;
                return (
                  <motion.button
                    key={tool.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.35 }}
                    onClick={() => { setSelectedTool(tool.id); setFormValues({}); }}
                    className={`text-left rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 transition-all duration-200 hover:bg-white/[0.01] hover:border-white/[0.06] ${c.glow} group`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} border ${c.border}`}>
                        <tool.icon className={`h-4 w-4 ${c.icon}`} />
                      </div>
                      {tool.badge && (
                        <span className={`text-[9px] font-semibold px-1.5 py-[2px] rounded ${tool.badge === 'Popular' ? 'bg-orange-500/[0.08] text-orange-400/70' : 'bg-cyan-500/[0.08] text-cyan-400/70'}`}>
                          {tool.badge === 'Popular' && <Flame className="h-2.5 w-2.5 inline mr-0.5" />}
                          {tool.badge}
                        </span>
                      )}
                    </div>
                    <h3 className="text-[13px] font-medium text-slate-300 group-hover:text-white transition-colors mb-1">{tool.name}</h3>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{tool.desc}</p>
                    <div className="flex items-center gap-1 mt-3 text-[11px] text-slate-700 group-hover:text-orange-400/60 transition-colors">
                      Launch <ArrowRight className="h-3 w-3" />
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          )}

          {/* Tool Detail View */}
          {selectedTool && activeTool && (
            <motion.div
              key="detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              className="max-w-xl mx-auto"
            >
              <button
                onClick={() => setSelectedTool(null)}
                className="text-[12px] text-slate-600 hover:text-slate-400 transition-colors mb-4 flex items-center gap-1"
              >
                <ChevronRight className="h-3 w-3 rotate-180" /> Back to tools
              </button>

              <div className="rounded-xl border border-white/[0.04] bg-white/[0.005] p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${COLOR_MAP[activeTool.color]?.bg || ''} border ${COLOR_MAP[activeTool.color]?.border || ''}`}>
                    <activeTool.icon className={`h-5 w-5 ${COLOR_MAP[activeTool.color]?.icon || ''}`} />
                  </div>
                  <div>
                    <h2 className="text-[16px] font-semibold text-white">{activeTool.name}</h2>
                    <p className="text-[12px] text-slate-500">{activeTool.desc}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {activeTool.inputs.map((input, i) => (
                    <div key={i}>
                      <label className="text-[12px] text-slate-400 mb-1.5 block">{input.label}</label>
                      {input.type === 'textarea' ? (
                        <textarea
                          value={formValues[`input-${i}`] || ''}
                          onChange={(e) => setFormValues((prev) => ({ ...prev, [`input-${i}`]: e.target.value }))}
                          placeholder={input.placeholder}
                          rows={4}
                          className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-orange-500/20 resize-none transition-colors"
                        />
                      ) : (
                        <input
                          type="text"
                          value={formValues[`input-${i}`] || ''}
                          onChange={(e) => setFormValues((prev) => ({ ...prev, [`input-${i}`]: e.target.value }))}
                          placeholder={input.placeholder}
                          className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-orange-500/20 transition-colors"
                        />
                      )}
                    </div>
                  ))}

                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={handleSubmit}
                    className="w-full h-10 rounded-lg bg-orange-500/[0.08] hover:bg-orange-500/[0.12] border border-orange-500/15 text-orange-400 text-[13px] font-medium transition-all flex items-center justify-center gap-2 mt-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate with AI
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
