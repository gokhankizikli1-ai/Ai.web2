import { motion } from 'framer-motion';
import { Rocket, Lightbulb, FileText, BarChart3, DollarSign, Zap, Shield } from 'lucide-react';
import { Link } from 'react-router';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const TOOLS = [
  { icon: Lightbulb, label: 'Idea Validator', desc: 'Score your idea across 10 dimensions. Get honest feedback.', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  { icon: Zap, label: 'MVP Planner', desc: 'Define minimum features to launch fast and iterate.', color: 'text-cyan-600', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  { icon: FileText, label: 'Pitch Deck AI', desc: 'Build investor-ready pitch decks slide by slide.', color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-100' },
  { icon: BarChart3, label: 'Market Research', desc: 'TAM, SAM, SOM analysis with trend detection.', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  { icon: DollarSign, label: 'Monetization', desc: 'Revenue models, pricing tiers, and unit economics.', color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
  { icon: Shield, label: 'Competitor Radar', desc: 'Find weaknesses and position your startup.', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
];

const STEPS = [
  { num: '01', label: 'Describe Your Idea', desc: 'Input your concept, target market, and goals.' },
  { num: '02', label: 'AI Validates & Scores', desc: 'Get a 0-100 score across 10 dimensions.' },
  { num: '03', label: 'Build Your Plan', desc: 'Generate pitch decks, MVPs, and growth strategies.' },
];

export default function StartupOSSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-amber-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: content */}
          <div>
            <motion.div {...fadeUp(0)}>
              <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-widest">Startup OS</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#111827] mt-3 mb-4 tracking-tight leading-tight">
                From Idea to{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-600 to-orange-600">
                  Funded Startup
                </span>
              </h2>
              <p className="text-[15px] text-slate-600 leading-relaxed mb-8 max-w-md">
                Validate, plan, and pitch your startup with AI-powered tools. Get an honest idea score, build your MVP plan, and create investor-ready decks.
              </p>
            </motion.div>

            {/* Steps */}
            <div className="space-y-4 mb-8">
              {STEPS.map((s, i) => (
                <motion.div
                  key={s.num}
                  {...fadeUp(0.1 + i * 0.06)}
                  className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 bg-white"
                >
                  <span className="text-[13px] font-bold text-amber-700/70 shrink-0 w-8">{s.num}</span>
                  <div>
                    <p className="text-[13px] font-medium text-[#111827] mb-0.5">{s.label}</p>
                    <p className="text-[12px] text-slate-600">{s.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div {...fadeUp(0.3)}>
              <Link
                to="/workspace"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/[0.06] text-amber-600 border border-amber-100 text-[13px] hover:bg-amber-500/[0.1] transition-all"
              >
                <Rocket className="h-4 w-4" /> Open Workspace
              </Link>
            </motion.div>
          </div>

          {/* Right: tool cards */}
          <div className="grid grid-cols-2 gap-2.5">
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
        </div>
      </div>
    </section>
  );
}
