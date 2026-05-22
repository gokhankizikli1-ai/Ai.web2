import { motion } from 'framer-motion';
import {
  Layers, Zap, Shield, Globe, Cpu, BarChart3,
} from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const FEATURES = [
  {
    icon: Layers,
    title: 'Unified Workspace',
    desc: 'Switch between AI modes without losing context. Code, research, trade, and launch — all connected.',
    span: 'col-span-1 md:col-span-2',
    bg: 'bg-slate-50',
    iconBg: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
  },
  {
    icon: Cpu,
    title: 'Multi-Agent System',
    desc: 'Deploy specialized AI agents for frontend, backend, design, marketing, and trading.',
    span: 'col-span-1',
    bg: 'bg-white',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
  },
  {
    icon: BarChart3,
    title: 'Live Trading Intelligence',
    desc: 'Real-time market signals from Finnhub and CoinGecko with AI-powered analysis.',
    span: 'col-span-1',
    bg: 'bg-white',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  {
    icon: Zap,
    title: 'Startup & Ecommerce OS',
    desc: 'Validate ideas, build MVPs, run online stores, and scale with AI guidance at every step.',
    span: 'col-span-1 md:col-span-2',
    bg: 'bg-slate-50',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    desc: 'End-to-end encryption, local data processing, and privacy-first architecture.',
    span: 'col-span-1',
    bg: 'bg-white',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
  },
  {
    icon: Globe,
    title: '13 Languages',
    desc: 'Full internationalization with Turkish, English, German, French, and more.',
    span: 'col-span-1',
    bg: 'bg-white',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
];

export default function WhyKorvixSection() {
  return (
    <section id="features" className="relative py-20 md:py-28 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-cyan-400/[0.02] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <motion.div {...fadeUp(0)} className="text-center mb-12 md:mb-16">
          <span className="text-[11px] font-semibold text-cyan-600 uppercase tracking-widest">Why KorvixAI</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-slate-900 mt-3 mb-4 tracking-tight leading-tight">
            One Platform.{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-600">
              Infinite Workflows.
            </span>
          </h2>
          <p className="text-[14px] sm:text-[15px] text-slate-600 max-w-xl mx-auto leading-relaxed">
            Switch between AI workspaces without losing context. From brainstorming a startup to analyzing a trade — everything connects.
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              {...fadeUp(0.05 + i * 0.04)}
              className={`${feature.span} group relative rounded-2xl border border-slate-200/80 ${feature.bg} p-6 transition-all duration-300 hover:shadow-lg hover:shadow-slate-900/5 hover:border-slate-300`}
            >
              <div className={`inline-flex items-center justify-center h-10 w-10 rounded-xl ${feature.iconBg} border border-slate-200/60 mb-4`}>
                <feature.icon className={`h-4.5 w-4.5 ${feature.iconColor}`} />
              </div>
              <h3 className="text-[15px] font-semibold text-slate-800 mb-2">{feature.title}</h3>
              <p className="text-[13px] text-slate-600 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
