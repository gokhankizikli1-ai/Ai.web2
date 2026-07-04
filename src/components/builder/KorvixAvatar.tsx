import { motion } from 'framer-motion';

/**
 * A small, premium circular Korvix avatar for assistant/execution rows — a mini
 * version of the Web Build orb (radial-gradient sphere + specular highlight +
 * soft blue glow), replacing the old flat sparkle tile. When `active` (assistant
 * working) it emits a subtle pulse ring. No emoji, performance-friendly.
 */
export default function KorvixAvatar({ size = 26, active = false }: { size?: number; active?: boolean }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 34% 30%, #3b5891 0%, #16233f 55%, #0a1120 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: 'inset 0 1px 2px rgba(150,190,255,0.28), 0 0 12px rgba(96,165,250,0.32)',
      }}
      aria-hidden="true"
    >
      {/* glassy specular highlight */}
      <span
        className="absolute rounded-full"
        style={{
          top: '15%', left: '20%', width: '36%', height: '28%',
          background: 'radial-gradient(circle at 40% 40%, rgba(255,255,255,0.6), rgba(255,255,255,0) 70%)',
        }}
      />
      {active && (
        <motion.span
          className="absolute inset-0 rounded-full"
          initial={{ boxShadow: '0 0 0 0 rgba(96,165,250,0.5)' }}
          animate={{ boxShadow: ['0 0 0 0 rgba(96,165,250,0.5)', '0 0 0 6px rgba(96,165,250,0)'] }}
          transition={{ duration: 1.7, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </span>
  );
}
