import { motion } from 'framer-motion';
import {
  CalendarCheck, Flame, ListChecks, Search, Users,
} from 'lucide-react';

const EXAMPLES = [
  'AI support tools',
  'Restaurant POS',
  'Shopify returns',
  'Student productivity',
  'Creator tools',
];

const DELIVERABLES = [
  { icon: Flame, label: 'Complaint clusters' },
  { icon: Search, label: 'Competitor weaknesses' },
  { icon: ListChecks, label: 'MVP wedge' },
  { icon: Users, label: 'First 100 customers' },
  { icon: CalendarCheck, label: '7-day validation plan' },
];

interface Props {
  /** Current query text — example chips only show while it's empty so
   * they never compete with what the user is actually typing. */
  query: string;
  onPickExample: (query: string) => void;
}

/** Pre-analysis surface: what the radar does and example niches to try.
 * No fake stats — nothing here pretends to be data. Recent analyses live
 * in their own collapsible section (RecentAnalyses). */
export default function RadarEmptyState({ query, onPickExample }: Props) {
  const showExamples = query.trim().length === 0;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-5">
        <h3 className="text-[15px] font-semibold text-slate-100">Find angry markets before you build.</h3>
        <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
          Korvix scans public signals, clusters complaints, and turns them into startup wedges.
        </p>

        {/* Example niches — gone the moment the user starts typing */}
        {showExamples && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => onPickExample(ex)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-300 border border-white/[0.06] bg-white/[0.015] hover:text-amber-200 hover:border-amber-500/30 hover:bg-amber-500/[0.06] transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* What you'll get */}
        <div className="mt-5">
          <span className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">
            What you'll get
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {DELIVERABLES.map((d) => (
              <div
                key={d.label}
                className="flex flex-col items-start gap-1.5 rounded-xl border border-white/[0.04] bg-white/[0.008] px-3 py-2.5"
              >
                <d.icon className="h-3.5 w-3.5 text-amber-400/70" />
                <span className="text-[11px] text-slate-300 leading-tight">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
