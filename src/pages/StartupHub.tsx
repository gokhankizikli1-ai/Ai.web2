import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, Lightbulb, DollarSign, TrendingUp, FileText,
  BarChart3, Target, Zap, Sparkles, ArrowLeft, ArrowUpRight,
  Crown, Layers, Search,
  Flame, Users, Star,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const COLOR_MAP: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  amber:  { bg: 'bg-amber-500/[0.05]',  border: 'border-amber-500/10',  icon: 'text-amber-400',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,191,36,0.08)]' },
  cyan:   { bg: 'bg-cyan-500/[0.05]',   border: 'border-cyan-500/10',   icon: 'text-cyan-400',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.08)]' },
  violet: { bg: 'bg-violet-500/[0.05]', border: 'border-violet-500/10', icon: 'text-violet-400', glow: 'hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.08)]' },
  emerald:{ bg: 'bg-emerald-500/[0.05]',border: 'border-emerald-500/10',icon: 'text-emerald-400',glow: 'hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.08)]' },
  rose:   { bg: 'bg-rose-500/[0.05]',   border: 'border-rose-500/10',   icon: 'text-rose-400',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,113,133,0.08)]' },
  blue:   { bg: 'bg-blue-500/[0.05]',   border: 'border-blue-500/10',   icon: 'text-blue-400',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(96,165,250,0.08)]' },
  indigo: { bg: 'bg-indigo-500/[0.05]', border: 'border-indigo-500/10', icon: 'text-indigo-400', glow: 'hover:shadow-[0_0_20px_-4px_rgba(129,140,248,0.08)]' },
  pink:   { bg: 'bg-pink-500/[0.05]',   border: 'border-pink-500/10',   icon: 'text-pink-400',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(244,114,182,0.08)]' },
  teal:   { bg: 'bg-teal-500/[0.05]',   border: 'border-teal-500/10',   icon: 'text-teal-400',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(45,212,191,0.08)]' },
  orange: { bg: 'bg-orange-500/[0.05]', border: 'border-orange-500/10', icon: 'text-orange-400', glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,146,60,0.08)]' },
};

const TOOLS = [
  { id: 'validator', name: 'Idea Validator', icon: Lightbulb, color: 'amber', desc: 'Score your idea across 10 dimensions with honest AI feedback.', badge: 'Popular', inputs: [{ label: 'Describe your startup idea', placeholder: 'A platform that uses AI to...', type: 'textarea' }] },
  { id: 'saas', name: 'SaaS Generator', icon: Layers, color: 'cyan', desc: 'Build full SaaS from idea to tech stack to pricing.', badge: 'New', inputs: [{ label: 'Product name', placeholder: 'Acme AI' }, { label: 'What does it do?', placeholder: 'Helps businesses automate...', type: 'textarea' }] },
  { id: 'competitor', name: 'Competitor Radar', icon: Search, color: 'violet', desc: 'Research competitors, find weaknesses, position yourself.', badge: null, inputs: [{ label: 'Your startup idea or product', placeholder: 'AI-powered marketing automation...', type: 'textarea' }] },
  { id: 'monetization', name: 'Revenue Planner', icon: DollarSign, color: 'emerald', desc: 'Generate revenue streams, pricing tiers, and business models.', badge: null, inputs: [{ label: 'Describe your product', placeholder: 'A SaaS tool that helps...', type: 'textarea' }] },
  { id: 'growth', name: 'Growth Planner', icon: TrendingUp, color: 'rose', desc: 'Design viral loops, referral programs, and growth strategies.', badge: null, inputs: [{ label: 'Your product and target audience', placeholder: 'Product: AI writing tool. Audience: Content marketers.', type: 'textarea' }] },
  { id: 'landing', name: 'Landing Generator', icon: FileText, color: 'blue', desc: 'Generate full landing page copy with hero, features, CTA.', badge: 'Popular', inputs: [{ label: 'Product name', placeholder: 'Acme' }, { label: 'Key features', placeholder: 'AI-powered analytics...', type: 'textarea' }] },
  { id: 'pitch', name: 'Pitch Deck AI', icon: Crown, color: 'indigo', desc: 'Build investor pitch decks slide by slide.', badge: null, inputs: [{ label: 'Startup name + one-liner', placeholder: 'Acme — AI for small business marketing', type: 'textarea' }] },
  { id: 'market', name: 'Market Sizer', icon: BarChart3, color: 'pink', desc: 'Analyze TAM, SAM, SOM, trends, and entry barriers.', badge: null, inputs: [{ label: 'Industry or market', placeholder: 'AI-powered customer service' }] },
  { id: 'icp', name: 'ICP Builder', icon: Target, color: 'teal', desc: 'Define your ideal customer profile with precision.', badge: null, inputs: [{ label: 'Product description', placeholder: 'Helps SaaS founders automate outreach', type: 'textarea' }] },
  { id: 'mvp', name: 'MVP Scope', icon: Zap, color: 'orange', desc: 'Define minimum features to launch fast and iterate.', badge: 'Popular', inputs: [{ label: 'Full product vision', placeholder: 'I want to build a platform that...', type: 'textarea' }] },
];

export default function StartupHub() {
  const navigate = useNavigate();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const activeTool = TOOLS.find((t) => t.id === selectedTool);

  const handleSubmit = () => {
    const prompt = activeTool ? `${activeTool.name}: ${Object.values(formValues).join(' | ')}` : '';
    navigate('/chat', { state: { initialPrompt: prompt } });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => navigate('/workspace')} className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                <ArrowLeft className="h-3 w-3" /> Workspace
              </button>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/[0.08] border border-amber-500/15">
                <Rocket className="h-5 w-5 text-amber-400/70" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">Startup Hub</h1>
                <p className="text-[12px] text-slate-500">Validate, build, and scale your startup</p>
              </div>
            </div>

            {/* Stats bar */}
            <div className="flex gap-3 mt-4">
              {[
                { icon: Zap, label: 'Tools', value: '12', color: 'text-amber-400' },
                { icon: Star, label: 'Avg Score', value: '7.8', color: 'text-cyan-400' },
                { icon: Users, label: 'Founders', value: '2.4K', color: 'text-violet-400' },
              ].map((s, i) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.04 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                  <s.icon className={`h-3 w-3 ${s.color}`} />
                  <span className="text-[12px] font-medium text-white">{s.value}</span>
                  <span className="text-[10px] text-slate-600">{s.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <AnimatePresence mode="wait">
            {!selectedTool ? (
              <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

                {/* Idea Score */}
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-6 p-5 rounded-2xl border border-white/[0.03] bg-white/[0.005]">
                  <div className="flex items-center gap-4">
                    <div className="relative w-20 h-20 shrink-0">
                      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke="white" strokeOpacity="0.03" strokeWidth="5" />
                        <motion.circle cx="40" cy="40" r="34" fill="none" stroke="#fbbf24" strokeWidth="5" strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 34} initial={{ strokeDashoffset: 2 * Math.PI * 34 }} animate={{ strokeDashoffset: 2 * Math.PI * 34 * 0.22 }}
                          transition={{ duration: 1.2, ease: 'easeOut' }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold text-white">78</span>
                        <span className="text-[8px] text-slate-600">/100</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-[14px] font-semibold text-white mb-1">Idea Score</h3>
                      <p className="text-[12px] text-slate-500">Strong concept with clear market fit potential. High execution readiness.</p>
                    </div>
                  </div>
                </motion.div>

                {/* Tools Grid */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {TOOLS.map((tool, i) => {
                    const c = COLOR_MAP[tool.color] || COLOR_MAP.amber;
                    return (
                      <motion.button key={tool.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.35 }}
                        whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }}
                        onClick={() => { setSelectedTool(tool.id); setFormValues({}); }}
                        className={`text-left rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 transition-all duration-200 hover:bg-white/[0.015] hover:border-white/[0.06] ${c.glow} group`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} ${c.border} border`}>
                            <tool.icon className={`h-4 w-4 ${c.icon}`} />
                          </div>
                          {tool.badge && (
                            <span className={`text-[9px] font-semibold px-1.5 py-[2px] rounded ${tool.badge === 'Popular' ? 'bg-amber-500/[0.08] text-amber-400/70' : 'bg-cyan-500/[0.08] text-cyan-400/70'}`}>
                              {tool.badge === 'Popular' && <Flame className="h-2.5 w-2.5 inline mr-0.5" />}
                              {tool.badge}
                            </span>
                          )}
                        </div>
                        <h3 className="text-[13px] font-medium text-white mb-1 group-hover:text-slate-200 transition-colors">{tool.name}</h3>
                        <p className="text-[11px] text-slate-600 leading-relaxed">{tool.desc}</p>
                        <div className="flex items-center gap-1 mt-2 text-[#64748B] group-hover:text-slate-500 transition-colors">
                          <span className="text-[10px]">Launch</span>
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key="tool" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => setSelectedTool(null)} className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-white transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                </div>

                {activeTool && (
                  <>
                    <div className="flex items-center gap-3 mb-6">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${(COLOR_MAP[activeTool.color] || COLOR_MAP.amber).bg} ${(COLOR_MAP[activeTool.color] || COLOR_MAP.amber).border} border`}>
                        <activeTool.icon className={`h-5 w-5 ${(COLOR_MAP[activeTool.color] || COLOR_MAP.amber).icon}`} />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-white">{activeTool.name}</h2>
                        <p className="text-[12px] text-slate-500">{activeTool.desc}</p>
                      </div>
                    </div>

                    <div className="space-y-4 mb-6">
                      {activeTool.inputs.map((input, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                          <label className="block text-[12px] text-slate-400 mb-1.5">{input.label}</label>
                          {(input as any).type === 'textarea' ? (
                            <textarea value={formValues[i] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))} placeholder={input.placeholder} rows={4}
                              className="w-full rounded-xl bg-white/[0.015] border border-white/[0.04] p-3 text-[13px] text-white placeholder:text-[#64748B] focus:border-cyan-500/20 focus:bg-white/[0.02] outline-none transition-all resize-none" />
                          ) : (
                            <input type="text" value={formValues[i] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))} placeholder={input.placeholder}
                              className="w-full h-10 rounded-xl bg-white/[0.015] border border-white/[0.04] px-3 text-[13px] text-white placeholder:text-[#64748B] focus:border-cyan-500/20 focus:bg-white/[0.02] outline-none transition-all" />
                          )}
                        </motion.div>
                      ))}
                    </div>

                    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={handleSubmit}
                      className="w-full h-11 rounded-xl bg-white/[0.06] text-white border border-white/[0.08] text-[13px] hover:bg-white/[0.08] transition-all flex items-center justify-center gap-2"
                    >
                      <Sparkles className="h-4 w-4" /> Generate with AI
                    </motion.button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
