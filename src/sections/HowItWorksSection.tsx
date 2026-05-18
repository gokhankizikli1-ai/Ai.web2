import { motion } from 'framer-motion';
import { Layers, Rocket, FileOutput, HardDrive, ChevronRight } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

const STEPS = [
  {
    icon: Layers,
    num: '01',
    title: 'Choose Your Workspace',
    desc: 'Switch between Chat, Research, Startup, Ecommerce, Trading, and Agents — each workspace is context-aware and specialized.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/[0.04]',
    border: 'border-cyan-500/10',
    arrowColor: 'text-cyan-400/20',
  },
  {
    icon: Rocket,
    num: '02',
    title: 'Launch Agent or Tool',
    desc: 'Pick from 12+ specialized AI agents or 30+ tools. Each is trained for a specific business function with domain expertise.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/[0.04]',
    border: 'border-amber-500/10',
    arrowColor: 'text-amber-400/20',
  },
  {
    icon: FileOutput,
    num: '03',
    title: 'Get Structured Output',
    desc: 'Receive formatted, actionable results — not generic chat. Pitch decks, product research, trade signals, code, and more.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/[0.04]',
    border: 'border-emerald-500/10',
    arrowColor: 'text-emerald-400/20',
  },
  {
    icon: HardDrive,
    num: '04',
    title: 'Save & Continue',
    desc: 'All outputs persist locally. Pick up where you left off, export your work, or continue refining in the chat workspace.',
    color: 'text-violet-400',
    bg: 'bg-violet-500/[0.04]',
    border: 'border-violet-500/10',
    arrowColor: 'text-violet-400/20',
  },
];

export default function HowItWorksSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <motion.div {...fadeUp(0)} className="text-center mb-16">
          <span className="text-[11px] font-semibold text-blue-400/50 uppercase tracking-widest">How It Works</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-white mt-3 mb-4 tracking-tight leading-tight">
            Four Steps to{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
              AI-Powered Results
            </span>
          </h2>
          <p className="text-[15px] text-slate-500 max-w-xl mx-auto leading-relaxed">
            No setup. No configuration. Choose a workspace, launch a tool, and get professional-grade output instantly.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <motion.div key={s.num} {...fadeUp(0.08 + i * 0.06)} className="relative">
              {/* Connector arrow on desktop */}
              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-8 left-full translate-x-2 z-10">
                  <ChevronRight className={`h-5 w-5 ${s.arrowColor}`} />
                </div>
              )}

              <div className="rounded-2xl border border-white/[0.03] bg-white/[0.005] p-5 transition-all duration-300 hover:bg-white/[0.01] hover:border-white/[0.06] h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} ${s.border} border`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <span className="text-[11px] font-mono text-slate-700">{s.num}</span>
                </div>
                <h3 className="text-[14px] font-semibold text-white mb-2">{s.title}</h3>
                <p className="text-[12px] text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
