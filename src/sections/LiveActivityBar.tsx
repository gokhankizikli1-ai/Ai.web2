import { motion } from 'framer-motion';
import { Bot, TrendingUp, Sparkles, ShoppingBag, Activity, Rocket } from 'lucide-react';

const ACTIVITIES = [
  { icon: Bot, text: '3 agents active', color: 'text-indigo-500', bg: 'bg-indigo-500/[0.08]' },
  { icon: Sparkles, text: 'Analyzing startup idea...', color: 'text-purple-500', bg: 'bg-purple-500/[0.08]' },
  { icon: ShoppingBag, text: 'Generating ecommerce strategy...', color: 'text-emerald-600', bg: 'bg-emerald-500/[0.08]' },
  { icon: TrendingUp, text: 'Signal updated — AAPL', color: 'text-green-600', bg: 'bg-green-500/[0.08]' },
  { icon: Rocket, text: 'Workspace synced', color: 'text-orange-500', bg: 'bg-orange-500/[0.08]' },
  { icon: Activity, text: '12 tasks completed today', color: 'text-[#52677A]', bg: 'bg-[#EEF1F4]0/[0.08]' },
];

export default function LiveActivityBar() {
  return (
    <section className="relative py-4 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-4 overflow-x-auto scrollbar-hide">
          {/* Live dot */}
          <div className="flex items-center gap-1.5 shrink-0">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.3, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-[10px] font-semibold text-emerald-600/70 uppercase tracking-wider">Live</span>
          </div>

          <div className="w-px h-4 bg-slate-100 shrink-0" />

          {/* Scrolling activities */}
          <div className="flex items-center gap-3">
            {ACTIVITIES.map((a, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${a.bg} border border-slate-200 shrink-0`}
              >
                <a.icon className={`w-3 h-3 ${a.color}`} />
                <span className="text-[10px] text-slate-500 whitespace-nowrap">{a.text}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
