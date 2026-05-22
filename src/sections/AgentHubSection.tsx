import { motion } from 'framer-motion';
import { Bot, Rocket, Search, Megaphone, TrendingUp, BarChart3, Globe, Shield } from 'lucide-react';
import { Link } from 'react-router';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const AGENTS = [
  { icon: Rocket, label: 'Startup Strategist', desc: 'Validate, plan, and scale your startup.', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  { icon: Search, label: 'Product Researcher', desc: 'Find winning products and analyze markets.', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  { icon: TrendingUp, label: 'Dropshipping Analyst', desc: 'Margins, shipping, supplier scoring.', color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  { icon: Megaphone, label: 'Ad Copywriter', desc: 'High-converting ads for every platform.', color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
  { icon: BarChart3, label: 'Competitor Analyst', desc: 'Spy, benchmark, and outperform rivals.', color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-100' },
  { icon: Globe, label: 'SEO Analyst', desc: 'Optimize rankings, find keywords, audit sites.', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  { icon: Shield, label: 'Finance Analyst', desc: 'Unit economics, cash flow, projections.', color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-100' },
  { icon: TrendingUp, label: 'Trading Analyst', desc: 'Signals, risk analysis, and backtesting.', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' },
];

export default function AgentHubSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-violet-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <motion.div {...fadeUp(0)} className="text-center mb-14">
          <span className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest">Agent Ecosystem</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-[#111827] mt-3 mb-4 tracking-tight leading-tight">
            Your AI Team,{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-600 to-purple-600">
              Always On
            </span>
          </h2>
          <p className="text-[15px] text-slate-600 max-w-xl mx-auto leading-relaxed">
            Deploy specialized AI agents for every business function. From startup strategy to competitor analysis — each agent is trained for its domain.
          </p>
        </motion.div>

        {/* Stats bar */}
        <motion.div {...fadeUp(0.08)} className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 mb-12">
          {[
            { label: 'Active Agents', value: '12' },
            { label: 'Total Runs', value: '98.4K' },
            { label: 'Avg Rating', value: '4.7' },
            { label: 'Uptime', value: '99.9%' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-xl font-bold text-[#111827]">{s.value}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Agent grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-10">
          {AGENTS.map((a, i) => (
            <motion.div
              key={a.label}
              {...fadeUp(0.1 + i * 0.04)}
              className="group rounded-xl border border-slate-200 bg-white p-4 transition-all duration-300 hover:bg-slate-50 hover:border-slate-300 hover:shadow-[0_0_16px_-4px_rgba(167,139,250,0.05)]"
            >
              <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${a.bg} ${a.border} border mb-3`}>
                <a.icon className={`h-3.5 w-3.5 ${a.color}`} />
              </div>
              <p className="text-[13px] font-medium text-[#111827] mb-1">{a.label}</p>
              <p className="text-[11px] text-slate-600 leading-relaxed">{a.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div {...fadeUp(0.4)} className="text-center">
          <Link
            to="/agents"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-500/[0.06] text-violet-600 border border-violet-100 text-[13px] hover:bg-violet-500/[0.1] transition-all"
          >
            <Bot className="h-4 w-4" /> Explore Agent Hub
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
