import { motion } from 'framer-motion';
import KorvixOrb from './KorvixOrb';

const STATUS_MESSAGES = [
  'Thinking...',
  'Analyzing context...',
  'Building response...',
];

export default function TypingIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={`flex items-center gap-3 ${compact ? 'py-1' : 'py-2'}`}
    >
      {/* Korvix Orb — small */}
      <KorvixOrb size="sm" variant="thinking" />

      {/* Status text with breathing animation */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {STATUS_MESSAGES.map((msg, i) => (
            <motion.span
              key={msg}
              className="text-[11px] text-slate-500"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 6,
                repeat: Infinity,
                delay: i * 2,
                times: [0, 0.1, 0.8, 1],
              }}
            >
              {msg}
            </motion.span>
          ))}
        </div>

        {/* Subtle progress bar */}
        <div className="w-16 h-[2px] rounded-full bg-white/[0.03] overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-cyan-400/30"
            animate={{ width: ['0%', '60%', '30%', '80%', '50%'] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
