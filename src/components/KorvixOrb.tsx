import { useState } from 'react';
import { motion } from 'framer-motion';

interface KorvixOrbProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'thinking' | 'loading' | 'idle';
  className?: string;
}

const SIZE_MAP = {
  sm:  { px: 40,  scale: 0.28 },
  md:  { px: 72,  scale: 0.52 },
  lg:  { px: 140, scale: 1.0 },
  xl:  { px: 200, scale: 1.42 },
};

/* ─── Octagon corner coordinates ─── */
function octagonPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 180) * (i * 45 - 90);
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

/* ─── Orbiting particle on elliptical path ─── */
function Particle({
  radiusX, radiusY, duration, delay, size, color, glow,
}: {
  radiusX: number; radiusY: number; duration: number; delay: number;
  size: number; color: string; glow: string;
}) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: size, height: size, backgroundColor: color,
        boxShadow: `0 0 ${size * 2.5}px ${glow}, 0 0 ${size * 5}px ${glow}`,
        top: '50%', left: '50%', marginTop: -size / 2, marginLeft: -size / 2,
      }}
      animate={{
        x: [0, radiusX, 0, -radiusX, 0],
        y: [-radiusY, 0, radiusY, 0, -radiusY],
        opacity: [0.95, 0.4, 0.95, 0.4, 0.95],
        scale: [1, 0.65, 1, 0.65, 1],
      }}
      transition={{ duration, repeat: Infinity, ease: 'linear', delay,
        times: [0, 0.25, 0.5, 0.75, 1],
      }}
    />
  );
}

/* ─── Expanding pulse wave ring ─── */
function PulseWave({ size: waveSize, delay, thickness = 0.6 }: { size: number; delay: number; thickness?: number }) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: waveSize, height: waveSize,
        top: '50%', left: '50%', marginTop: -waveSize / 2, marginLeft: -waveSize / 2,
        border: `${thickness}px solid rgba(126, 166, 191,0.06)`,
      }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: [0, 0.3, 0], scale: [0.5, 1.25, 1.5] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeOut', delay }}
    />
  );
}

/* ─── Corner node sparkle ─── */
function CornerSparkle({ angle, radius, size, delay }: { angle: number; radius: number; size: number; delay: number }) {
  const rad = (Math.PI / 180) * (angle - 90);
  const x = 50 + (radius / 140) * 50 * Math.cos(rad);
  const y = 50 + (radius / 140) * 50 * Math.sin(rad);
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: size, height: size,
        left: `${x}%`, top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        background: 'radial-gradient(circle, rgba(165,243,252,0.8), rgba(126, 166, 191,0.3))',
        boxShadow: `0 0 ${size * 2}px rgba(126, 166, 191,0.3)`,
      }}
      animate={{ opacity: [0.2, 0.9, 0.2], scale: [0.7, 1.1, 0.7] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

/* ═══════════════════════════════════════════════
   KORVIX AI CORE — Main Component
   ═══════════════════════════════════════════════ */
export default function KorvixOrb({ size = 'lg', variant = 'default', className = '' }: KorvixOrbProps) {
  const { px } = SIZE_MAP[size];
  const isThinking = variant === 'thinking';
  const s = SIZE_MAP[size].scale; // scale factor relative to lg=140

  // Particle configs
  const [particles] = useState(() => [
    { id: 0, rx: px * 0.30, ry: px * 0.30, dur: 5.0, delay: 0.0,  sz: 2.2,  col: 'rgba(165,243,252,0.7)', glow: 'rgba(165,243,252,0.4)' },
    { id: 1, rx: px * 0.36, ry: px * 0.28, dur: 6.5, delay: 1.2,  sz: 1.5,  col: 'rgba(126, 166, 191,0.6)',  glow: 'rgba(126, 166, 191,0.3)' },
    { id: 2, rx: px * 0.24, ry: px * 0.36, dur: 4.2, delay: 2.5,  sz: 1.8,  col: 'rgba(126, 166, 191,0.5)',  glow: 'rgba(126, 166, 191,0.25)' },
    { id: 3, rx: px * 0.40, ry: px * 0.22, dur: 7.8, delay: 0.8,  sz: 1.2,  col: 'rgba(165,243,252,0.5)', glow: 'rgba(165,243,252,0.2)' },
    { id: 4, rx: px * 0.22, ry: px * 0.38, dur: 5.5, delay: 3.0,  sz: 1.0,  col: 'rgba(126, 166, 191,0.45)', glow: 'rgba(126, 166, 191,0.15)' },
    { id: 5, rx: px * 0.33, ry: px * 0.33, dur: 8.2, delay: 1.8,  sz: 1.6,  col: 'rgba(126, 166, 191,0.5)',  glow: 'rgba(126, 166, 191,0.2)' },
    { id: 6, rx: px * 0.28, ry: px * 0.20, dur: 4.8, delay: 0.4,  sz: 0.9,  col: 'rgba(255,255,255,0.4)', glow: 'rgba(255,255,255,0.15)' },
    { id: 7, rx: px * 0.38, ry: px * 0.30, dur: 9.0, delay: 2.2,  sz: 1.3,  col: 'rgba(126, 166, 191,0.4)',  glow: 'rgba(126, 166, 191,0.18)' },
  ]);

  const pulseWaves = [
    { id: 0, sz: px * 0.55, delay: 0.0 },
    { id: 1, sz: px * 0.70, delay: 1.0 },
    { id: 2, sz: px * 0.85, delay: 2.0 },
    { id: 3, sz: px * 1.0,  delay: 3.0 },
  ];

  const c = px / 2; // center
  const ring = px * 0.38; // base ring radius

  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: px, height: px }}>

      {/* ═══ Layer 0: Deep ambient glow ═══ */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: px, height: px,
          background: 'radial-gradient(circle, rgba(126, 166, 191,0.07) 0%, rgba(126, 166, 191,0.025) 35%, transparent 65%)',
        }}
        animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.85, 0.5] }}
        transition={{ duration: isThinking ? 2 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: px * 0.65, height: px * 0.65,
          background: 'radial-gradient(circle, rgba(126, 166, 191,0.05) 0%, transparent 55%)',
        }}
        animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: isThinking ? 2.5 : 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />

      {/* ═══ Layer 1: Pulse waves ═══ */}
      {pulseWaves.map((w) => (
        <PulseWave key={w.id} size={w.sz} delay={w.delay} />
      ))}

      {/* ═══ Layer 2: Corner sparkles on octagon vertices ═══ */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
        <CornerSparkle key={i} angle={angle} radius={ring * 0.95} size={Math.max(2, 3 * s)} delay={i * 0.4} />
      ))}

      {/* ═══ Layer 3: SVG Ring + Hexagon System ═══ */}
      <svg className="absolute" style={{ width: px, height: px }} viewBox={`0 0 ${px} ${px}`}>
        <defs>
          <linearGradient id={`grad1-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(126, 166, 191,0.2)" />
            <stop offset="50%" stopColor="rgba(126, 166, 191,0.04)" />
            <stop offset="100%" stopColor="rgba(126, 166, 191,0.15)" />
          </linearGradient>
          <linearGradient id={`grad2-${size}`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(165,243,252,0.15)" />
            <stop offset="50%" stopColor="rgba(126, 166, 191,0.03)" />
            <stop offset="100%" stopColor="rgba(126, 166, 191,0.1)" />
          </linearGradient>
          <radialGradient id={`coreGlow-${size}`}>
            <stop offset="0%" stopColor="rgba(165,243,252,0.9)" />
            <stop offset="40%" stopColor="rgba(126, 166, 191,0.5)" />
            <stop offset="100%" stopColor="rgba(126, 166, 191,0.1)" />
          </radialGradient>
          {/* Octagonal mesh pattern */}
          <pattern id={`octMesh-${size}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform={`scale(${Math.max(0.5, s)})`}>
            <polygon
              points={octagonPoints(7, 7, 4)}
              fill="none"
              stroke="rgba(126, 166, 191,0.06)"
              strokeWidth="0.4"
            />
          </pattern>
        </defs>

        {/* Octagonal outer frame */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: isThinking ? 30 : 60, repeat: Infinity, ease: 'linear' }}
        >
          <polygon
            points={octagonPoints(c, c, ring * 0.92)}
            fill="none"
            stroke={`url(#grad1-${size})`}
            strokeWidth={Math.max(0.5, s * 1.0)}
            opacity={0.35}
          />
          {/* Octagon corner nodes */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const a = (Math.PI / 180) * (i * 45 - 90);
            const nx = c + ring * 0.92 * Math.cos(a);
            const ny = c + ring * 0.92 * Math.sin(a);
            return <circle key={i} cx={nx} cy={ny} r={Math.max(1.2, s * 1.8)} fill="rgba(126, 166, 191,0.2)" />;
          })}
        </motion.g>

        {/* Inner octagon mesh fill */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, -360] }}
          transition={{ duration: isThinking ? 40 : 80, repeat: Infinity, ease: 'linear' }}
        >
          <polygon
            points={octagonPoints(c, c, ring * 0.65)}
            fill={`url(#octMesh-${size})`}
            stroke={`url(#grad2-${size})`}
            strokeWidth={Math.max(0.3, s * 0.6)}
            opacity={0.25}
          />
        </motion.g>

        {/* Ring 1: Large dashed arc, slow */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: isThinking ? 10 : 22, repeat: Infinity, ease: 'linear' }}
        >
          <circle cx={c} cy={c} r={ring * 0.82} fill="none"
            stroke={`url(#grad1-${size})`} strokeWidth={Math.max(0.4, s * 0.7)}
            strokeDasharray={`${px * 0.035} ${px * 0.055}`} opacity={0.4} />
        </motion.g>

        {/* Ring 2: Medium with accent segment, counter */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [360, 0] }}
          transition={{ duration: isThinking ? 7 : 15, repeat: Infinity, ease: 'linear' }}
        >
          <circle cx={c} cy={c} r={ring * 0.62} fill="none"
            stroke="rgba(126, 166, 191,0.06)" strokeWidth={Math.max(0.3, s * 0.5)} />
          {/* Bright arc segment */}
          <circle cx={c} cy={c} r={ring * 0.62} fill="none"
            stroke="rgba(165,243,252,0.25)" strokeWidth={Math.max(0.6, s * 1.0)}
            strokeDasharray={`${px * 0.08} ${px * 0.3}`} strokeLinecap="round" />
        </motion.g>

        {/* Ring 3: Thin dotted, fast */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, -360] }}
          transition={{ duration: isThinking ? 4 : 9, repeat: Infinity, ease: 'linear' }}
        >
          <circle cx={c} cy={c} r={ring * 0.48} fill="none"
            stroke="rgba(126, 166, 191,0.1)" strokeWidth={Math.max(0.3, s * 0.45)}
            strokeDasharray={`${px * 0.018} ${px * 0.035}`} />
        </motion.g>

        {/* Ring 4: Tick marks ring */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: isThinking ? 18 : 35, repeat: Infinity, ease: 'linear' }}
        >
          {Array.from({ length: 24 }, (_, i) => {
            const a1 = (Math.PI / 180) * (i * 15 - 90);
            const a2 = (Math.PI / 180) * (i * 15 - 90);
            const r1 = ring * 0.72;
            const r2 = ring * 0.76;
            return (
              <line key={i}
                x1={c + r1 * Math.cos(a1)} y1={c + r1 * Math.sin(a1)}
                x2={c + r2 * Math.cos(a2)} y2={c + r2 * Math.sin(a2)}
                stroke="rgba(126, 166, 191,0.08)" strokeWidth={Math.max(0.3, s * 0.4)} strokeLinecap="round" />
            );
          })}
        </motion.g>

        {/* Scanner sweep — bright rotating line */}
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: isThinking ? 3 : 6, repeat: Infinity, ease: 'linear' }}
        >
          <line
            x1={c} y1={c}
            x2={c} y2={c - ring * 0.85}
            stroke="url(#coreGlow-${size})"
            strokeWidth={Math.max(0.5, s * 0.8)}
            strokeLinecap="round"
            opacity={0.35}
          />
          {/* Scanner head glow */}
          <circle cx={c} cy={c - ring * 0.82} r={Math.max(1.5, s * 2)} fill="rgba(165,243,252,0.5)">
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
        </motion.g>
      </svg>

      {/* ═══ Layer 4: Orbiting Particles ═══ */}
      {particles.map((p) => (
        <Particle key={p.id} radiusX={p.rx} radiusY={p.ry} duration={isThinking ? p.dur * 0.5 : p.dur}
          delay={p.delay} size={p.sz} color={p.col} glow={p.glow} />
      ))}

      {/* ═══ Layer 5: Central AI Core Chamber ═══ */}
      {/* Outer shell ring */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: px * 0.30, height: px * 0.30,
          border: `${Math.max(1, s * 2)}px solid transparent`,
          background: 'linear-gradient(#0a0a0a, #0a0a0a) padding-box, conic-gradient(from 0deg, rgba(126, 166, 191,0.3), rgba(165,243,252,0.15), rgba(126, 166, 191,0.3), rgba(126, 166, 191,0.3)) border-box',
          boxShadow: `
            0 0 ${px * 0.08}px rgba(126, 166, 191,0.15),
            0 0 ${px * 0.16}px rgba(126, 166, 191,0.06),
            inset 0 0 ${px * 0.04}px rgba(126, 166, 191,0.08)
          `,
        }}
        animate={{ rotate: [0, 360] }}
        transition={{ duration: isThinking ? 6 : 14, repeat: Infinity, ease: 'linear' }}
      />

      {/* Inner structure ring */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: px * 0.24, height: px * 0.24,
          border: `${Math.max(0.5, s)}px solid rgba(126, 166, 191,0.1)`,
        }}
        animate={{ rotate: [360, 0], scale: [1, 1.04, 1] }}
        transition={{ duration: isThinking ? 5 : 10, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Core energy disc — NOT a filled ball, a structured ring */}
      <motion.div
        className="absolute rounded-full flex items-center justify-center"
        style={{
          width: px * 0.17, height: px * 0.17,
          background: 'radial-gradient(circle at 38% 32%, rgba(255,255,255,0.9) 0%, rgba(165,243,252,0.7) 15%, rgba(126, 166, 191,0.35) 45%, rgba(126, 166, 191,0.1) 75%, transparent 100%)',
          boxShadow: `
            0 0 ${px * 0.06}px rgba(126, 166, 191,0.3),
            0 0 ${px * 0.12}px rgba(126, 166, 191,0.1),
            0 0 ${px * 0.02}px rgba(165,243,252,0.5) inset
          `,
        }}
        animate={{
          scale: isThinking ? [1, 1.1, 1, 1.05, 1] : [1, 1.04, 1, 1.02, 1],
        }}
        transition={{ duration: isThinking ? 1.5 : 3.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Inner core bright pinprick */}
        <div className="absolute rounded-full" style={{
          width: '35%', height: '25%', top: '22%', left: '25%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.95), transparent 70%)',
          filter: 'blur(0.3px)',
        }} />
        {/* Center tiny core dot */}
        <div className="absolute rounded-full" style={{
          width: '12%', height: '12%',
          background: 'radial-gradient(circle, rgba(255,255,255,1), rgba(165,243,252,0.6))',
          boxShadow: `0 0 ${Math.max(2, 4 * s)}px rgba(165,243,252,0.6)`,
        }} />
      </motion.div>

      {/* ═══ Layer 6: Radial spoke lines (very subtle) ═══ */}
      <svg className="absolute pointer-events-none" style={{ width: px, height: px }} viewBox={`0 0 ${px} ${px}`}>
        <motion.g
          style={{ transformOrigin: `${c}px ${c}px` }}
          animate={{ rotate: [0, 360] }}
          transition={{ duration: isThinking ? 25 : 50, repeat: Infinity, ease: 'linear' }}
        >
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
            const rad = (Math.PI / 180) * (angle - 90);
            return (
              <line key={angle}
                x1={c + Math.cos(rad) * ring * 0.30}
                y1={c + Math.sin(rad) * ring * 0.30}
                x2={c + Math.cos(rad) * ring * 0.55}
                y2={c + Math.sin(rad) * ring * 0.55}
                stroke="rgba(126, 166, 191,0.025)" strokeWidth={Math.max(0.2, s * 0.35)} strokeLinecap="round" />
            );
          })}
        </motion.g>
      </svg>
    </div>
  );
}
