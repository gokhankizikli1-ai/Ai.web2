import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Search, BarChart3, Sparkles, Loader2 } from 'lucide-react';

interface ThinkingStep {
  id: string;
  label: string;
  icon: typeof Brain;
  status: 'pending' | 'active' | 'completed';
  detail?: string;
}

const THINKING_STEPS: ThinkingStep[] = [
  { id: '1', label: 'Analyzing context...', icon: Brain, status: 'active' },
  { id: '2', label: 'Researching sources...', icon: Search, status: 'pending' },
  { id: '3', label: 'Building response...', icon: Sparkles, status: 'pending' },
  { id: '4', label: 'Verifying consistency...', icon: BarChart3, status: 'pending' },
];

interface AIThinkingPanelProps {
  isVisible: boolean;
}

export default function AIThinkingPanel({ isVisible }: AIThinkingPanelProps) {
  const [steps, setSteps] = useState<ThinkingStep[]>(THINKING_STEPS);

  useEffect(() => {
    if (!isVisible) {
      setSteps(THINKING_STEPS);
      return;
    }

    // Animate through steps
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => {
      const timer = setTimeout(() => {
        setSteps((prev) =>
          prev.map((s, idx) => {
            if (idx < i) return { ...s, status: 'completed' };
            if (idx === i) return { ...s, status: 'active' };
            return { ...s, status: 'pending' };
          })
        );
      }, i * 800);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-3xl mx-auto px-4 pb-3"
    >
      <div className="rounded-xl border border-[#52677A]/[0.08] bg-[#52677A]/[0.02] backdrop-blur-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#52677A]/[0.06]">
          <div className="relative flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#52677A]/30 animate-ping" style={{ animationDuration: '2s' }} />
            <Brain className="h-3.5 w-3.5 text-[#52677A] relative" />
          </div>
          <span className="text-[11px] font-medium text-[#52677A]/70 uppercase tracking-wider">AI Processing</span>
          <motion.div
            className="ml-auto flex gap-[3px]"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span className="h-1 w-1 rounded-full bg-[#52677A]/60" />
            <span className="h-1 w-1 rounded-full bg-[#52677A]/40" />
            <span className="h-1 w-1 rounded-full bg-[#52677A]/20" />
          </motion.div>
        </div>

        {/* Steps */}
        <div className="px-4 py-2 space-y-1">
          <AnimatePresence mode="popLayout">
            {steps.map((step, i) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ delay: i * 0.1, duration: 0.3 }}
                className="flex items-center gap-2.5 py-1"
              >
                {/* Status indicator */}
                <div className="w-4 flex items-center justify-center">
                  {step.status === 'completed' && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="h-3 w-3 rounded-full bg-[#6F8F7A]/20 border border-[#6F8F7A]/30 flex items-center justify-center"
                    >
                      <svg className="h-2 w-2 text-[#6F8F7A]" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </motion.div>
                  )}
                  {step.status === 'active' && (
                    <Loader2 className="h-3 w-3 text-[#52677A] animate-spin" />
                  )}
                  {step.status === 'pending' && (
                    <div className="h-2 w-2 rounded-full bg-white/[0.06] border border-white/[0.04]" />
                  )}
                </div>

                {/* Icon */}
                <step.icon className={`h-3 w-3 ${
                  step.status === 'completed' ? 'text-[#6F8F7A]/60' :
                  step.status === 'active' ? 'text-[#52677A]' :
                  'text-[#64748B]'
                }`} />

                {/* Label */}
                <span className={`text-[11px] ${
                  step.status === 'completed' ? 'text-[#6F8F7A]/60' :
                  step.status === 'active' ? 'text-[#52677A]/80' :
                  'text-[#64748B]'
                }`}>
                  {step.label}
                </span>

                {/* Active shimmer bar */}
                {step.status === 'active' && (
                  <div className="flex-1 h-[1px] bg-white/[0.02] rounded-full overflow-hidden ml-2">
                    <motion.div
                      className="h-full bg-[#52677A]/30 rounded-full"
                      animate={{ width: ['0%', '100%', '0%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
