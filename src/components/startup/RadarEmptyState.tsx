import { motion } from 'framer-motion';

const EXAMPLES = [
  'AI support tools',
  'Shopify returns',
  'Restaurant POS',
  'Creator tools',
];

interface Props {
  /** Current query text — example chips only show while it's empty so
   * they never compete with what the user is actually typing. */
  query: string;
  onPickExample: (query: string) => void;
}

/** Pre-analysis surface, kept minimal: one headline, one line of intent,
 * four example niches, one quiet line of deliverables. No fake stats. */
export default function RadarEmptyState({ query, onPickExample }: Props) {
  const showExamples = query.trim().length === 0;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-6">
        <h3 className="text-[15px] font-semibold text-slate-100">Find angry markets before you build.</h3>
        <p className="text-[12px] text-[#A9B7C6] mt-1.5 leading-relaxed">
          Korvix scans public signals, clusters complaints, and turns them into startup wedges.
        </p>

        {/* Example niches — gone the moment the user starts typing */}
        {showExamples && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => onPickExample(ex)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-300 border border-white/[0.06] bg-white/[0.015] hover:text-[#9DB0C2] hover:border-[#7EA6BF]/40 hover:bg-[#7EA6BF]/[0.08] transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] text-[#7F8FA3] mt-5">
          You'll get: complaint clusters · competitor weaknesses · MVP wedge · first customers · 7-day validation plan
        </p>
      </div>
    </motion.div>
  );
}
