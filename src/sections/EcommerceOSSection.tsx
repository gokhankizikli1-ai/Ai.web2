import { motion } from 'framer-motion';
import { ShoppingCart, Search, Layers, Megaphone, Flame, Globe, DollarSign } from 'lucide-react';
import { Link } from 'react-router';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const TOOLS = [
  { icon: Search, label: 'Product Research', desc: 'Find winning products with demand signals.', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  { icon: Layers, label: 'Product Analyzer', desc: 'Deep-dive on any product, niche, or listing.', color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  { icon: Megaphone, label: 'Ad Copy Generator', desc: 'High-converting ads for Facebook, Google, and TikTok.', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  { icon: Flame, label: 'TikTok Hooks', desc: 'Viral hooks and scripts for short-form video.', color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
  { icon: Globe, label: 'Shopify SEO', desc: 'Optimize product pages and collections for search.', color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-100' },
  { icon: DollarSign, label: 'Pricing Optimizer', desc: 'Smart pricing based on elasticity and competitors.', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
];

export default function EcommerceOSSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-1/2 left-0 w-[500px] h-[500px] bg-emerald-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: tool cards */}
          <div className="order-2 lg:order-1 grid grid-cols-2 gap-2.5">
            {TOOLS.map((t, i) => (
              <motion.div
                key={t.label}
                {...fadeUp(0.08 + i * 0.05)}
                className="group rounded-xl border border-slate-200 bg-white p-4 transition-all duration-300 hover:bg-slate-50 hover:border-slate-300"
              >
                <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${t.bg} ${t.border} border mb-3`}>
                  <t.icon className={`h-3.5 w-3.5 ${t.color}`} />
                </div>
                <p className="text-[13px] font-medium text-[#111827] mb-1">{t.label}</p>
                <p className="text-[11px] text-slate-600 leading-relaxed">{t.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Right: content */}
          <div className="order-1 lg:order-2">
            <motion.div {...fadeUp(0)}>
              <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest">Ecommerce OS</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] mt-3 mb-4 tracking-tight leading-tight">
                Sell Smarter.{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-teal-600">
                  Scale Faster.
                </span>
              </h2>
              <p className="text-[15px] text-slate-600 leading-relaxed mb-8 max-w-md">
                From product research to pricing optimization — run your ecommerce store with AI intelligence that understands markets, margins, and buyers.
              </p>
            </motion.div>

            <motion.div {...fadeUp(0.15)} className="flex flex-wrap gap-3 mb-8">
              {[
                { label: 'Revenue', value: '$24,680' },
                { label: 'Orders', value: '1,247' },
                { label: 'Conversion', value: '3.2%' },
                { label: 'AOV', value: '$47.20' },
              ].map((s, i) => (
                <motion.div
                  key={s.label}
                  {...fadeUp(0.2 + i * 0.04)}
                  className="px-3.5 py-2.5 rounded-lg"
                  style={{
                    background: 'rgba(255,255,255,0.8)',
                    border: '1px solid rgba(148,163,184,0.18)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
                  }}
                >
                  <p className="text-[10px] font-medium text-slate-500 mb-1">{s.label}</p>
                  <p className="text-[14px] font-bold text-[#111827]">{s.value}</p>
                </motion.div>
              ))}
            </motion.div>

            <motion.div {...fadeUp(0.3)}>
              <Link
                to="/workspace"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/[0.06] text-emerald-600 border border-emerald-100 text-[13px] hover:bg-emerald-500/[0.1] transition-all"
              >
                <ShoppingCart className="h-4 w-4" /> Open Workspace
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
