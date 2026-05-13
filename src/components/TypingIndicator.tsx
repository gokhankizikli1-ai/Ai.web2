import { motion } from 'framer-motion';

const STATUS_MESSAGES = ['Thinking...', 'Building response...', 'Checking context...'];

export default function TypingIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${compact ? 'py-1' : 'py-2'}`}>
      {/* Avatar dot */}
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400/20 to-blue-500/20">
        <div className="h-1.5 w-1.5 rounded-full bg-cyan-400/60" />
      </div>

      {/* Bubble with dots */}
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white/[0.02] border border-white/[0.04] px-3.5 py-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-slate-500/60"
            animate={{
              opacity: [0.2, 0.7, 0.2],
              scale: [0.9, 1.1, 0.9],
            }}
            transition={{
              duration: 1.4,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.18,
            }}
          />
        ))}
      </div>

      {/* Status text — optional, very subtle */}
      <motion.span
        className="text-[10px] text-slate-700 ml-0.5"
        animate={{ opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {STATUS_MESSAGES[0]}
      </motion.span>
    </div>
  );
}
