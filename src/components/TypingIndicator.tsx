import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const DEFAULT_LABELS = ['Thinking…', 'Writing…'];
const CYCLE_MS = 2200;

/**
 * Minimal assistant activity indicator — a small breathing dot plus one
 * quietly cycling status label (ChatGPT/Claude style). No avatar, no
 * progress theater. Callers can pass honest step labels (e.g. research
 * stages); nothing here ever names sources it hasn't seen.
 */
export default function TypingIndicator({
  compact = false,
  labels,
}: {
  compact?: boolean;
  labels?: string[];
}) {
  const steps = labels && labels.length > 0 ? labels : DEFAULT_LABELS;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    const t = setInterval(
      () => setIndex((i) => Math.min(i + 1, steps.length - 1)),
      CYCLE_MS,
    );
    return () => clearInterval(t);
  }, [steps.length]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={`flex items-center gap-2.5 ${compact ? 'py-1' : 'py-2'}`}
    >
      <motion.span
        className="h-2 w-2 rounded-full bg-[#3B82F6]"
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        aria-label="working"
      />
      <span className="text-[12px] text-[#CBD5E1]">{steps[index]}</span>
    </motion.div>
  );
}
