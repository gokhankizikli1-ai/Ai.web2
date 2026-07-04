import { motion, useReducedMotion } from 'framer-motion';

/**
 * A tiny premium Korvix assistant orb — a small circular status avatar (like a
 * compact ChatGPT-style assistant dot), NOT a mascot. Subtle blue glow + a soft
 * opacity/scale pulse while the assistant is working; static and calm when idle.
 * Respects prefers-reduced-motion. No emoji, no heavy glow.
 */
export default function KorvixAvatar({ size = 16, active = false }: { size?: number; active?: boolean }) {
  const reduce = useReducedMotion();
  const orb = (
    <span
      className="block rounded-full"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 35% 30%, #4a6aa5 0%, #1a2942 55%, #0a1120 100%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: 'inset 0 0.5px 1px rgba(160,195,255,0.4), 0 0 5px rgba(96,165,250,0.28)',
      }}
    />
  );

  if (active && !reduce) {
    return (
      <motion.span
        className="inline-flex shrink-0"
        animate={{ opacity: [0.55, 1, 0.55], scale: [0.92, 1, 0.92] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden="true"
      >
        {orb}
      </motion.span>
    );
  }
  return <span className="inline-flex shrink-0" aria-hidden="true">{orb}</span>;
}
