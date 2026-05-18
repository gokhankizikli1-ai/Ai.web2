import { motion } from 'framer-motion';
import { TrendingUp, Star, Clock, Bell, BookOpen, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

const FEATURES = [
  { icon: Star, label: 'Watchlist', desc: 'Track your favorite stocks and crypto with real-time sparklines and price alerts.', color: 'text-amber-400', bg: 'bg-amber-500/[0.04]', border: 'border-amber-500/10' },
  { icon: TrendingUp, label: 'Signals', desc: 'AI-generated trade signals with confidence scoring and setup grades.', color: 'text-emerald-400', bg: 'bg-emerald-500/[0.04]', border: 'border-emerald-500/10' },
  { icon: BookOpen, label: 'Journal', desc: 'Log every trade with notes, review performance, and identify patterns.', color: 'text-cyan-400', bg: 'bg-cyan-500/[0.04]', border: 'border-cyan-500/10' },
  { icon: Bell, label: 'Alerts', desc: 'Get notified when your conditions trigger — price, volume, or sentiment.', color: 'text-rose-400', bg: 'bg-rose-500/[0.04]', border: 'border-rose-500/10' },
  { icon: ShieldCheck, label: 'Risk/Reward', desc: 'Every signal includes entry, target, stop-loss, and risk/reward ratio.', color: 'text-violet-400', bg: 'bg-violet-500/[0.04]', border: 'border-violet-500/10' },
  { icon: Clock, label: 'Confidence Engine', desc: 'Multi-factor scoring: technicals, sentiment, volume, and market context.', color: 'text-blue-400', bg: 'bg-blue-500/[0.04]', border: 'border-blue-500/10' },
];

export default function TradingIntelligenceSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <motion.div {...fadeUp(0)} className="text-center mb-14">
          <span className="text-[11px] font-semibold text-emerald-400/50 uppercase tracking-widest">Trading Intelligence</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-white mt-3 mb-4 tracking-tight leading-tight">
            Trade with{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
              AI Confidence
            </span>
          </h2>
          <p className="text-[15px] text-slate-500 max-w-xl mx-auto leading-relaxed">
            Real-time market signals with confidence scoring, watchlists, and risk management. Not financial advice — but AI-powered intelligence.
          </p>
        </motion.div>

        {/* Mock signal card */}
        <motion.div {...fadeUp(0.08)} className="max-w-lg mx-auto mb-12 p-5 rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-[15px] font-semibold text-white">AAPL</span>
              <span className="text-[11px] text-emerald-400 bg-emerald-500/[0.08] px-2 py-0.5 rounded-full">LONG</span>
              <span className="text-[10px] text-emerald-400/60 bg-emerald-500/[0.06] px-1.5 py-0.5 rounded-full">Grade A</span>
            </div>
            <span className="text-[11px] text-slate-500">87% confidence</span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="p-2.5 rounded-xl bg-white/[0.02]">
              <p className="text-[9px] text-slate-600 mb-0.5">Entry</p>
              <p className="text-[13px] font-medium text-white">$185.15</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/[0.03]">
              <p className="text-[9px] text-emerald-400/60 mb-0.5">Target</p>
              <p className="text-[13px] font-medium text-emerald-400">$195.00</p>
            </div>
            <div className="p-2.5 rounded-xl bg-red-500/[0.03]">
              <p className="text-[9px] text-red-400/60 mb-0.5">Stop</p>
              <p className="text-[13px] font-medium text-red-400">$180.00</p>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Bull flag breakout on daily with volume confirmation. RSI 58, room to run. Institutional buying detected.
          </p>
        </motion.div>

        {/* Features grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-10">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.label}
              {...fadeUp(0.12 + i * 0.04)}
              className="group rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 transition-all duration-300 hover:bg-white/[0.015] hover:border-white/[0.06]"
            >
              <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${f.bg} ${f.border} border mb-3`}>
                <f.icon className={`h-3.5 w-3.5 ${f.color}`} />
              </div>
              <p className="text-[13px] font-medium text-white mb-1">{f.label}</p>
              <p className="text-[11px] text-slate-600 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div {...fadeUp(0.35)} className="text-center">
          <Link
            to="/chat"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/[0.06] text-emerald-400 border border-emerald-500/10 text-[13px] hover:bg-emerald-500/[0.1] transition-all"
          >
            <TrendingUp className="h-4 w-4" /> Open Trading Workspace
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
