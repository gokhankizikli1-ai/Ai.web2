import { motion } from 'framer-motion';
import { Layers, Rocket, ShoppingCart, TrendingUp, Bot, Sparkles } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

const PILLARS = [
  {
    icon: Layers,
    title: 'Multi-Workspace AI',
    desc: 'Chat, research, code, trade, launch startups, and run ecommerce — all from one intelligent workspace with context-aware switching.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/[0.04]',
    border: 'border-cyan-500/10',
    glow: 'group-hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.08)]',
  },
  {
    icon: Rocket,
    title: 'Startup Operating System',
    desc: 'Validate ideas, build pitch decks, research markets, plan MVPs, and design monetization strategies with YC-grade tooling.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/[0.04]',
    border: 'border-amber-500/10',
    glow: 'group-hover:shadow-[0_0_20px_-4px_rgba(251,191,36,0.08)]',
  },
  {
    icon: ShoppingCart,
    title: 'Ecommerce Intelligence',
    desc: 'Research winning products, optimize listings, generate ad copy, calculate margins, and build pricing strategies that convert.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/[0.04]',
    border: 'border-emerald-500/10',
    glow: 'group-hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.08)]',
  },
  {
    icon: TrendingUp,
    title: 'Trading Signals',
    desc: 'Get real-time market signals with confidence scoring, risk/reward analysis, and AI-generated trade setups for stocks and crypto.',
    color: 'text-rose-400',
    bg: 'bg-rose-500/[0.04]',
    border: 'border-rose-500/10',
    glow: 'group-hover:shadow-[0_0_20px_-4px_rgba(251,113,133,0.08)]',
  },
  {
    icon: Bot,
    title: 'AI Agent Hub',
    desc: 'Deploy specialized AI agents — from startup strategists to product researchers — each trained for specific business functions.',
    color: 'text-violet-400',
    bg: 'bg-violet-500/[0.04]',
    border: 'border-violet-500/10',
    glow: 'group-hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.08)]',
  },
  {
    icon: Sparkles,
    title: 'Premium AI Compute',
    desc: '$0.10 per credit for advanced operations. Casual chat is always free. Deep research, code execution, and agent runs consume credits.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/[0.04]',
    border: 'border-blue-500/10',
    glow: 'group-hover:shadow-[0_0_20px_-4px_rgba(96,165,250,0.08)]',
  },
];

export default function WhyKorvixSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-cyan-500/[0.02] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        {/* Section header */}
        <motion.div {...fadeUp(0)} className="text-center mb-16">
          <span className="text-[11px] font-semibold text-cyan-400/50 uppercase tracking-widest">Why KorvixAI</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-white mt-3 mb-4 tracking-tight leading-tight">
            One Platform.{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
              Infinite Workflows.
            </span>
          </h2>
          <p className="text-[15px] text-slate-500 max-w-xl mx-auto leading-relaxed">
            Switch between AI workspaces without losing context. From brainstorming a startup to analyzing a trade — everything connects.
          </p>
        </motion.div>

        {/* Cards grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.title}
              {...fadeUp(0.05 + i * 0.05)}
              className={`group relative rounded-2xl border border-white/[0.03] bg-white/[0.01] p-5 transition-all duration-300 hover:bg-white/[0.02] hover:border-white/[0.06] ${p.glow}`}
            >
              {/* Icon */}
              <div className={`inline-flex items-center justify-center h-10 w-10 rounded-xl ${p.bg} ${p.border} border mb-4`}>
                <p.icon className={`h-4 w-4 ${p.color}`} />
              </div>

              <h3 className="text-[15px] font-semibold text-white mb-2">{p.title}</h3>
              <p className="text-[13px] text-slate-600 leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
