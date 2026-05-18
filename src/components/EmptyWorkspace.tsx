import { motion } from 'framer-motion';
import { TrendingUp, Globe, Code, Brain } from 'lucide-react';
import KorvixOrb from './KorvixOrb';
import SmartSuggestions from './SmartSuggestions';

interface EmptyWorkspaceProps {
  onQuickAction: (action: string) => void;
  activeMode: string;
  compact?: boolean;
}

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

const FEATURE_CARDS = [
  { icon: Brain, label: 'Deep Think', desc: 'Multi-step reasoning', color: 'text-violet-400', bg: 'bg-violet-500/[0.03]', border: 'border-violet-500/8' },
  { icon: Globe, label: 'Research', desc: 'Live data search', color: 'text-cyan-400', bg: 'bg-cyan-500/[0.03]', border: 'border-cyan-500/8' },
  { icon: Code, label: 'Code Assistant', desc: 'Write & review code', color: 'text-blue-400', bg: 'bg-blue-500/[0.03]', border: 'border-blue-500/8' },
  { icon: TrendingUp, label: 'Trading Intel', desc: 'Market signals', color: 'text-emerald-400', bg: 'bg-emerald-500/[0.03]', border: 'border-emerald-500/8' },
];

const MODE_TITLES: Record<string, { title: string; subtitle: string }> = {
  chat:     { title: 'What can I help you with?', subtitle: 'Start a conversation or choose a suggestion' },
  research: { title: 'Ready to research?', subtitle: 'Ask me to analyze any topic with real-time data' },
  coding:   { title: 'Let\'s build something', subtitle: 'Write, review, or debug code together' },
  trading:  { title: 'Market Intelligence', subtitle: 'Connect live data to see real-time signals' },
  startup:  { title: 'Build your startup', subtitle: 'Strategy, planning, and execution support' },
  study:    { title: 'Study mode activated', subtitle: 'Learn any topic with guided explanations' },
  creative: { title: 'Create something new', subtitle: 'Brainstorm, design, and iterate together' },
  business: { title: 'Business Intelligence', subtitle: 'Analyze data, strategy, and operations' },
  agents:   { title: 'AI Agent Workspace', subtitle: 'Deploy custom AI agents for your workflow' },
};

export default function EmptyWorkspace({ onQuickAction, activeMode }: EmptyWorkspaceProps) {
  const modeInfo = MODE_TITLES[activeMode] || MODE_TITLES.chat;

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-10 overflow-y-auto">
      <div className="w-full max-w-lg mx-auto flex flex-col items-center">

        {/* ═── Animated Orb ─══ */}
        <motion.div {...fadeUp(0)} className="mb-6">
          <KorvixOrb size="lg" variant="idle" />
        </motion.div>

        {/* ═── Title ─══ */}
        <motion.h1
          {...fadeUp(0.1)}
          className="text-[20px] font-semibold text-white text-center tracking-tight mb-1.5"
        >
          {modeInfo.title}
        </motion.h1>

        {/* ═── Subtitle ─══ */}
        <motion.p
          {...fadeUp(0.15)}
          className="text-[13px] text-slate-500 text-center mb-8"
        >
          {modeInfo.subtitle}
        </motion.p>

        {/* ═── Smart Suggestions ─══ */}
        <motion.div {...fadeUp(0.2)} className="w-full mb-8">
          <SmartSuggestions
            variant={activeMode === 'research' ? 'research' : 'chat'}
            onSelect={onQuickAction}
          />
        </motion.div>

        {/* ═── Feature Cards ─══ */}
        <motion.div {...fadeUp(0.25)} className="w-full">
          <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center mb-3">
            Capabilities
          </p>
          <div className="grid grid-cols-2 gap-2">
            {FEATURE_CARDS.map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.05, duration: 0.35 }}
                whileHover={{ scale: 1.02, y: -1 }}
                className={`flex items-center gap-2.5 rounded-xl ${card.bg} ${card.border} border px-3 py-2.5 transition-all duration-200 cursor-default`}
              >
                <card.icon className={`h-3.5 w-3.5 ${card.color} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-300 font-medium">{card.label}</p>
                  <p className="text-[10px] text-slate-600">{card.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ═── Keyboard hint ─══ */}
        <motion.p
          {...fadeUp(0.4)}
          className="text-[11px] text-slate-700 mt-6 text-center"
        >
          Press <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.05] text-[10px] text-slate-600 font-mono">/</kbd> to focus input
        </motion.p>
      </div>
    </div>
  );
}
