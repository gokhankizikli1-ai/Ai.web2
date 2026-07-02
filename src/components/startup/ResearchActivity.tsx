import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';

// Four plain-language phases that map to what the backend actually does,
// in order. No domains/URLs are invented here — the real pages used are
// listed afterwards under "Sources used".
const PHASES = [
  'Scanning public signals',
  'Finding repeated complaints',
  'Ranking opportunity',
  'Preparing recommendation',
];

// Grounded activity feed — describes the real internal steps, not fake
// site visits. Each line reveals as the matching phase becomes active.
const ACTIVITY = [
  'Searching web sources',
  'Reading founder discussions',
  'Grouping similar complaints',
  'Building validation plan',
];

const PHASE_INTERVAL_MS = 2000;

/** Honest scan-progress card: generic phases advance on a timer; the last
 * phase stays active until the real report lands. A small activity feed
 * mirrors the phases without fabricating specific sources. */
export default function ResearchActivity() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setCurrent((s) => Math.min(s + 1, PHASES.length - 1)),
      PHASE_INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-2xl border border-[#253142] bg-[#111722] p-5"
    >
      <div className="space-y-3">
        {PHASES.map((phase, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={phase} className="flex items-center gap-3">
              <span className="flex h-4 w-4 items-center justify-center shrink-0">
                {done ? (
                  <Check className="h-3.5 w-3.5 text-[#60A5FA]" />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 text-[#60A5FA] animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-white/[0.12]" />
                )}
              </span>
              <span
                className={`text-[13px] transition-colors ${
                  done ? 'text-[#CBD5E1]' : active ? 'text-[#F8FAFC] font-medium' : 'text-[#64748B]'
                }`}
              >
                {phase}
              </span>
            </div>
          );
        })}
      </div>

      {/* Small grounded activity feed */}
      <div className="mt-4 pt-3.5 border-t border-white/[0.05] space-y-1.5">
        {ACTIVITY.slice(0, current + 1).map((line) => (
          <motion.div
            key={line}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-[11px] text-[#94A3B8]"
          >
            <span className="h-1 w-1 rounded-full bg-[#3B82F6]/70 shrink-0" />
            {line}
          </motion.div>
        ))}
      </div>

      <p className="text-[10px] text-[#64748B] mt-3.5">
        Scanning live public sources — the exact pages used appear under “Sources used”.
      </p>
    </motion.div>
  );
}
