import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';

// Generic, HONEST pipeline steps — these describe what the backend
// actually does, in order. No domains/URLs are shown here because the
// frontend genuinely doesn't know them until the report returns; the
// real pages appear afterwards in the Evidence trail.
const STEPS = [
  'Preparing market scan',
  'Searching public web evidence',
  'Checking founder/community discussion sources',
  'Extracting complaint language',
  'Grouping repeated pain patterns',
  'Scoring opportunity',
];

const STEP_INTERVAL_MS = 1800;

/** Perplexity-style research progress, without the fakery: generic
 * pipeline stages advance on a timer; the last stage stays active until
 * the real response lands. */
export default function ResearchActivity() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setCurrent((s) => Math.min(s + 1, STEPS.length - 1)),
      STEP_INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-5"
    >
      <div className="space-y-2.5">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={step} className="flex items-center gap-2.5">
              <span className="flex h-4 w-4 items-center justify-center shrink-0">
                {done ? (
                  <Check className="h-3.5 w-3.5 text-[#8FB4CC]" />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 text-[#8FB4CC] animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-white/[0.12]" />
                )}
              </span>
              <span
                className={`text-[12px] transition-colors ${
                  done ? 'text-[#A9B7C6]' : active ? 'text-slate-100 font-medium' : 'text-[#7F8FA3]'
                }`}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#7F8FA3] mt-4">
        Scanning live public sources — the exact pages used will be listed in the evidence trail.
      </p>
    </motion.div>
  );
}
