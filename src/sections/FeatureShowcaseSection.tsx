import { motion } from 'framer-motion';
import { MessageSquare, Globe, Briefcase, Bot, TrendingUp, Wrench, Compass, Brain } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const FEATURES = [
  {
    icon: MessageSquare,
    title: 'AI Chat',
    desc: 'Deep Think, Fast, Research, Creative, Code, Study modes. Context-aware multi-turn conversations with streaming responses.',
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
    border: 'border-cyan-100',
  },
  {
    icon: Globe,
    title: 'Research',
    desc: 'Real-time web research with citation tracking. Multi-source synthesis with source verification and trend analysis.',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
  },
  {
    icon: Briefcase,
    title: 'Business Workspace',
    desc: 'Startup OS, Ecommerce OS, Agent Hub, and Trading Intelligence — all in one dashboard with workspace isolation.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
  },
  {
    icon: Bot,
    title: 'AI Agents',
    desc: '12 specialized agents — startup strategists, product researchers, SEO optimizers, security auditors, and more.',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-100',
  },
  {
    icon: TrendingUp,
    title: 'Trading Intelligence',
    desc: 'Market signals with confidence scoring, watchlists, sentiment analysis, and risk/reward calculations.',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    border: 'border-rose-100',
  },
  {
    icon: Wrench,
    title: 'Tools & Explore',
    desc: 'Website analyzer, app builder, brand builder, viral content generator, knowledge vault, and multi-agent swarms.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
  },
  {
    icon: Brain,
    title: 'Deep Reasoning',
    desc: 'Chain-of-thought reasoning, step-by-step problem solving, and multi-hop analysis for complex tasks.',
    color: 'text-pink-400',
    bg: 'bg-pink-500/[0.05]',
    border: 'border-pink-500/10',
  },
  {
    icon: Compass,
    title: 'Explore Hub',
    desc: 'Discover new capabilities, trending agents, community templates, and curated AI workflows for every use case.',
    color: 'text-teal-600',
    bg: 'bg-teal-500/[0.05]',
    border: 'border-teal-100',
  },
];

export default function FeatureShowcaseSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <motion.div {...fadeUp(0)} className="text-center mb-16">
          <span className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest">Capabilities</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-[#111827] mt-3 mb-4 tracking-tight leading-tight">
            Everything You Need,{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-600 to-purple-600">
              Nothing You Don&apos;t
            </span>
          </h2>
          <p className="text-[15px] text-slate-600 max-w-xl mx-auto leading-relaxed">
            Switch between specialized AI workspaces without losing context. Each workspace is optimized for its domain.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              {...fadeUp(0.04 + i * 0.04)}
              className="group relative rounded-2xl border border-slate-200/80 bg-white p-5 transition-all duration-300 hover:shadow-lg hover:shadow-slate-900/5 hover:border-slate-300"
            >
              <div className={`inline-flex items-center justify-center h-9 w-9 rounded-lg ${f.bg} ${f.border} border mb-3`}>
                <f.icon className={`h-4 w-4 ${f.color}`} />
              </div>
              <h3 className="text-[14px] font-semibold text-[#111827] mb-1.5">{f.title}</h3>
              <p className="text-[12px] text-slate-600 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
