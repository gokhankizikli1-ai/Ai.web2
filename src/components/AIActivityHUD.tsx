import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Globe, TrendingUp, Search, Cpu,
  FileText, Sparkles, Database,
} from 'lucide-react';

export type AIActivity =
  | 'thinking'
  | 'deep-think'
  | 'research'
  | 'trading'
  | 'file-analysis'
  | 'coding'
  | 'generating'
  | 'searching'
  | null;

interface AIActivityHUDProps {
  activity: AIActivity;
  isVisible: boolean;
}

const ACTIVITY_CONFIG: Record<Exclude<AIActivity, null>, { label: string; icon: typeof Brain; sublabels: string[] }> = {
  thinking: {
    label: 'Thinking',
    icon: Sparkles,
    sublabels: ['Processing...', 'Connecting ideas...', 'Formulating response...'],
  },
  'deep-think': {
    label: 'Deep Think',
    icon: Brain,
    sublabels: ['Reasoning through steps...', 'Evaluating options...', 'Building logic chain...'],
  },
  research: {
    label: 'Researching',
    icon: Globe,
    sublabels: ['Scanning sources...', 'Cross-referencing...', 'Synthesizing findings...'],
  },
  trading: {
    label: 'Analyzing',
    icon: TrendingUp,
    sublabels: ['Scanning markets...', 'Evaluating signals...', 'Computing risk...'],
  },
  'file-analysis': {
    label: 'Analyzing',
    icon: FileText,
    sublabels: ['Reading document...', 'Extracting data...', 'Building insights...'],
  },
  coding: {
    label: 'Coding',
    icon: Cpu,
    sublabels: ['Planning structure...', 'Writing logic...', 'Verifying syntax...'],
  },
  generating: {
    label: 'Generating',
    icon: Database,
    sublabels: ['Building output...', 'Formatting response...', 'Finalizing...'],
  },
  searching: {
    label: 'Searching',
    icon: Search,
    sublabels: ['Querying index...', 'Filtering results...', 'Ranking sources...'],
  },
};

export default function AIActivityHUD({ activity, isVisible }: AIActivityHUDProps) {
  const [subIndex, setSubIndex] = useState(0);
  const config = activity ? ACTIVITY_CONFIG[activity] : null;

  // Rotate through sublabels
  useEffect(() => {
    if (!config) return;
    const interval = setInterval(() => {
      setSubIndex((prev) => (prev + 1) % config.sublabels.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [config]);

  return (
    <AnimatePresence>
      {isVisible && config && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.015] border border-white/[0.03] backdrop-blur-sm"
        >
          {/* Pulsing icon */}
          <div className="relative">
            <motion.div
              className="p-1 rounded-lg bg-cyan-500/[0.06] border border-cyan-500/8"
              animate={{
                boxShadow: [
                  '0 0 6px -2px rgba(34,211,238,0.08)',
                  '0 0 10px -2px rgba(34,211,238,0.15)',
                  '0 0 6px -2px rgba(34,211,238,0.08)',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <config.icon className="h-3 w-3 text-cyan-400/70" />
            </motion.div>

            {/* Active dot */}
            <motion.div
              className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-cyan-400"
              animate={{
                scale: [1, 1.4, 1],
                opacity: [0.7, 1, 0.7],
              }}
              transition={{ duration: 1.5, repeat: Infinity }}
              style={{ boxShadow: '0 0 4px rgba(34,211,238,0.5)' }}
            />
          </div>

          {/* Text */}
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-400 font-medium">{config.label}</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={subIndex}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2 }}
                className="text-[10px] text-slate-600"
              >
                {config.sublabels[subIndex]}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* Subtle progress shimmer */}
          <div className="ml-auto w-12 h-[2px] rounded-full bg-white/[0.03] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-cyan-400/30"
              animate={{ width: ['0%', '70%', '40%', '90%', '60%'] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
