import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Presentational FX primitives for the institutional trading UI.
 * Pure visual wrappers around REAL values — they never invent or alter
 * data; if a value is absent they render a neutral placeholder.
 */

// Smoothly tweens a numeric display between updates (rAF, ~420ms).
export function AnimatedNumber({
  value, format, className = '',
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  className?: string;
}) {
  const fmt = format || ((n: number) => `${n}`);
  const [display, setDisplay] = useState<number | null>(
    typeof value === 'number' && Number.isFinite(value) ? value : null,
  );
  const fromRef = useRef<number>(typeof value === 'number' ? value : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      setDisplay(null);
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();
    const dur = 420;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = from + (to - from) * eased;
      setDisplay(cur);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  if (display === null) return <span className={className}>—</span>;
  return <span className={className}>{fmt(display)}</span>;
}

// Briefly flashes its children when `trigger` changes (live-update pulse).
export function Pulse({ trigger, children, className = '' }: {
  trigger: string | number | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOn(true);
    const id = window.setTimeout(() => setOn(false), 650);
    return () => window.clearTimeout(id);
  }, [trigger]);
  return (
    <span className={`transition-colors duration-700 rounded ${on ? 'bg-cyan-400/[0.12]' : 'bg-transparent'} ${className}`}>
      {children}
    </span>
  );
}

// Volatility heat strip from a REAL number (ATR/vol %), or a tier label.
export function HeatBar({ pct, tier }: { pct?: number | null; tier?: 'low' | 'medium' | 'high' }) {
  let level: number; // 0..1
  if (typeof pct === 'number' && Number.isFinite(pct)) {
    level = Math.max(0, Math.min(1, pct / 8));
  } else if (tier) {
    level = tier === 'high' ? 0.85 : tier === 'medium' ? 0.5 : 0.2;
  } else {
    return null;
  }
  const color = level > 0.66 ? 'bg-red-500/60' : level > 0.33 ? 'bg-amber-500/55' : 'bg-emerald-500/55';
  return (
    <span className="inline-flex items-center gap-1" title={typeof pct === 'number' ? `Volatility ${pct}%` : `Volatility ${tier}`}>
      <span className="relative h-1.5 w-10 rounded-full bg-white/[0.06] overflow-hidden">
        <span className={`absolute inset-y-0 left-0 ${color} rounded-full`} style={{ width: `${Math.round(level * 100)}%` }} />
      </span>
    </span>
  );
}

// Lightweight accessible tooltip (no deps). Hover/focus reveals content.
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex group/tt" tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-[60] whitespace-nowrap rounded-md border border-white/[0.08] bg-[#0b0b0c]/95 px-2 py-1 text-[10px] text-slate-300 opacity-0 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-opacity duration-150 group-hover/tt:opacity-100 group-focus/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
