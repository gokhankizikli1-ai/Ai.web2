import { motion } from 'framer-motion';
import {
  LayoutGrid, Rocket, ShoppingBag, TrendingUp, Bot, Brain,
  Zap, type LucideIcon,
} from 'lucide-react';

interface FeatureCard {
  icon: LucideIcon;
  label: string;
  color: string;
  glow: string;
}

const FEATURES: FeatureCard[] = [
  { icon: LayoutGrid, label: 'Multi-Workspace AI', color: 'text-[#52677A]', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(34,211,238,0.15)] group-hover:border-[#52677A]/20' },
  { icon: Rocket, label: 'Startup Operating System', color: 'text-orange-500', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(251,146,60,0.15)] group-hover:border-orange-500/20' },
  { icon: ShoppingBag, label: 'Ecommerce Intelligence', color: 'text-emerald-600', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(52,211,153,0.15)] group-hover:border-emerald-500/20' },
  { icon: TrendingUp, label: 'Trading Signals', color: 'text-green-600', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(74,222,128,0.15)] group-hover:border-green-500/20' },
  { icon: Bot, label: 'AI Agents', color: 'text-indigo-500', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(129,140,248,0.15)] group-hover:border-indigo-500/20' },
  { icon: Brain, label: 'Memory System', color: 'text-violet-600', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(167,139,250,0.15)] group-hover:border-violet-500/20' },
  { icon: Zap, label: 'Automation Engine', color: 'text-amber-600', glow: 'group-hover:shadow-[0_0_24px_-6px_rgba(251,191,36,0.15)] group-hover:border-amber-500/20' },
];

export default function WhyKorvixStrip() {
  return (
    <section className="relative py-8 border-y border-slate-200 overflow-hidden">
      {/* Subtle background */}
      <div className="absolute inset-0 bg-slate-50" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        {/* Label */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-[11px] font-semibold text-slate-800 uppercase tracking-widest text-center mb-5"
        >
          Why KorvixAI
        </motion.p>

        {/* Cards */}
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              whileHover={{ y: -2 }}
              className={`group flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-200 bg-white transition-all duration-300 shrink-0 snap-start cursor-default shadow-sm ${f.glow}`}
            >
              <f.icon className={`w-4 h-4 ${f.color} transition-transform duration-300 group-hover:scale-110`} />
              <span className="text-[12px] font-medium text-slate-700 whitespace-nowrap">{f.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
