import { motion } from 'framer-motion';

interface KorvixOrbProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'thinking' | 'loading' | 'idle';
  className?: string;
}

const SIZE_MAP = {
  sm:  28,
  md:  48,
  lg:  80,
  xl:  120,
};

export default function KorvixOrb({ size = 'md', variant = 'default', className = '' }: KorvixOrbProps) {
  const px = SIZE_MAP[size];
  const isThinking = variant === 'thinking';
  const isLoading = variant === 'loading';

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: px, height: px }}
    >
      {/* Outer glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 70%)',
        }}
        animate={{
          scale: isThinking ? [1, 1.35, 1] : isLoading ? [1, 1.2, 1] : [1, 1.08, 1],
          opacity: isThinking ? [0.5, 0.9, 0.5] : [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: isThinking ? 2 : 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Secondary glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          inset: '15%',
          background: 'radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 60%)',
        }}
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.4, 0.7, 0.4],
        }}
        transition={{
          duration: isThinking ? 1.5 : 2.5,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 0.3,
        }}
      />

      {/* Core orb */}
      <motion.div
        className="relative rounded-full overflow-hidden"
        style={{
          width: px * 0.45,
          height: px * 0.45,
          background: 'radial-gradient(ellipse 80% 60% at 40% 30%, rgba(165,243,252,0.9), rgba(34,211,238,0.5) 40%, rgba(14,165,233,0.3) 70%, transparent 100%)',
          boxShadow: isThinking
            ? '0 0 16px rgba(34,211,238,0.35), 0 0 32px rgba(34,211,238,0.15), inset 0 0 8px rgba(255,255,255,0.15)'
            : '0 0 10px rgba(34,211,238,0.2), 0 0 20px rgba(34,211,238,0.08), inset 0 0 6px rgba(255,255,255,0.1)',
        }}
        animate={{
          boxShadow: isThinking
            ? [
              '0 0 16px rgba(34,211,238,0.35), 0 0 32px rgba(34,211,238,0.15), inset 0 0 8px rgba(255,255,255,0.15)',
              '0 0 24px rgba(34,211,238,0.5), 0 0 48px rgba(34,211,238,0.2), inset 0 0 12px rgba(255,255,255,0.25)',
              '0 0 16px rgba(34,211,238,0.35), 0 0 32px rgba(34,211,238,0.15), inset 0 0 8px rgba(255,255,255,0.15)',
            ]
            : undefined,
        }}
        transition={{
          duration: isThinking ? 1.8 : 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        {/* Shimmer sweep */}
        <motion.div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)',
            backgroundSize: '200% 200%',
          }}
          animate={{
            backgroundPosition: ['200% 200%', '-100% -100%'],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'linear',
          }}
        />

        {/* Inner bright spot */}
        <div
          className="absolute rounded-full"
          style={{
            top: '15%',
            left: '20%',
            width: '35%',
            height: '25%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,0.8), transparent 70%)',
            filter: 'blur(1px)',
          }}
        />
      </motion.div>

      {/* Orbiting ring */}
      <motion.div
        className="absolute rounded-full border border-cyan-400/[0.06]"
        style={{ inset: '10%' }}
        animate={{ rotate: 360 }}
        transition={{
          duration: isThinking ? 4 : 8,
          repeat: Infinity,
          ease: 'linear',
        }}
      >
        {/* Ring dot */}
        <div
          className="absolute rounded-full bg-cyan-400/40"
          style={{
            top: '-2px',
            left: '50%',
            width: '3px',
            height: '3px',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 4px rgba(34,211,238,0.4)',
          }}
        />
      </motion.div>

      {/* Thinking sparkles */}
      {(isThinking || isLoading) && (
        <>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute w-[2px] h-[2px] rounded-full bg-cyan-300/50"
              style={{
                top: `${20 + i * 30}%`,
                left: `${15 + i * 25}%`,
              }}
              animate={{
                opacity: [0, 0.8, 0],
                scale: [0.5, 1.2, 0.5],
                y: [0, -8, 0],
              }}
              transition={{
                duration: 1.5 + i * 0.3,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.4,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}
