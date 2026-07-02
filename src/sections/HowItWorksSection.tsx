import { motion } from 'framer-motion';
import { Layers, Rocket, FileOutput, HardDrive, ChevronRight } from 'lucide-react';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const STEPS = [
  {
    icon: Layers,
    num: '01',
    title: 'Choose Your Workspace',
    desc: 'Switch between Chat, Research, Startup, Ecommerce, Trading, and Agents — each workspace is context-aware and specialized.',
    color: 'text-[#52677A]',
    bg: 'bg-[#EEF1F4]',
    border: 'border-[#DDE3EA]',
    arrowColor: 'text-[#52677A]/20',
  },
  {
    icon: Rocket,
    num: '02',
    title: 'Launch Agent or Tool',
    desc: 'Pick from 12+ specialized AI agents or 30+ tools. Each is trained for a specific business function with domain expertise.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    arrowColor: 'text-amber-600/20',
  },
  {
    icon: FileOutput,
    num: '03',
    title: 'Get Structured Output',
    desc: 'Receive formatted, actionable results — not generic chat. Pitch decks, product research, trade signals, code, and more.',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    arrowColor: 'text-emerald-600/20',
  },
  {
    icon: HardDrive,
    num: '04',
    title: 'Save & Continue',
    desc: 'All outputs persist locally. Pick up where you left off, export your work, or continue refining in the chat workspace.',
    color: 'text-violet-600',
    bg: 'bg-[#EEF1F4]',
    border: 'border-[#DDE3EA]',
    arrowColor: 'text-violet-600/20',
  },
];

export default function HowItWorksSection() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-500/[0.015] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <motion.div {...fadeUp(0)} className="text-center mb-16">
          <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-widest">How It Works</span>
          <h2 className="text-3xl sm:text-4xl md:text-[42px] font-bold text-[#111827] mt-3 mb-4 tracking-tight leading-tight">
            Four Steps to{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
              AI-Powered Results
            </span>
          </h2>
          <p className="text-[15px] text-slate-600 max-w-xl mx-auto leading-relaxed">
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

              <div className="rounded-2xl border border-slate-200 bg-white p-5 transition-all duration-300 hover:border-slate-300 hover:shadow-sm h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${s.bg} ${s.border} border`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">{s.num}</span>
                </div>
                <h3 className="text-[14px] font-semibold text-[#111827] mb-2">{s.title}</h3>
                <p className="text-[12px] text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
