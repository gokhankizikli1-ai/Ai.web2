import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Brain, Zap } from 'lucide-react';

const STATUS_MESSAGES = [
  { text: 'Analyzing context...', icon: Brain },
  { text: 'Building response...', icon: Sparkles },
  { text: 'Reviewing patterns...', icon: Zap },
  { text: 'Optimizing answer...', icon: Sparkles },
  { text: 'Generating strategy...', icon: Brain },
  { text: 'Processing request...', icon: Zap },
  { text: 'Formulating reply...', icon: Sparkles },
];

export default function TypingIndicator() {
  const [statusIndex, setStatusIndex] = useState(0);
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const current = STATUS_MESSAGES[statusIndex];
  const CurrentIcon = current.icon;

  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      {/* Animated avatar */}
      <div className="relative flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/80 to-blue-500/80 shadow-lg shadow-cyan-500/10">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <CurrentIcon className="h-3 w-3 text-white" />
        </motion.div>
        {/* Pulse ring */}
        <motion.div
          className="absolute inset-0 rounded-lg border border-cyan-400/30"
          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      </div>

      {/* Dots + status */}
      <div className="flex items-center gap-3">
        {/* Animated dots */}
        <div className="flex items-center gap-[4px]">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-[6px] w-[6px] rounded-full bg-cyan-400/60"
              animate={{
                scale: [1, 1.4, 1],
                opacity: [0.4, 1, 0.4],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                delay: i * 0.15,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>

        {/* Status text */}
        <AnimatePresence mode="wait">
          <motion.div
            key={statusIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-1.5"
          >
            <span className="text-[12px] text-slate-500 font-medium">{current.text}</span>
            <span className="text-slate-700 text-[12px]">{'...'.slice(0, dots)}</span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
