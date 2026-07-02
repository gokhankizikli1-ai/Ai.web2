import { motion } from 'framer-motion';
import {
  Clock3, Flame, ListChecks, Search, Target, Trash2, Users, CalendarCheck,
} from 'lucide-react';
import type { RadarHistoryEntry } from '@/lib/startupRadarHistory';

const EXAMPLES = [
  'AI customer support tools',
  'Shopify fashion stores',
  'restaurant POS systems',
  'Roblox game tools',
  'crypto portfolio tracking',
];

const DELIVERABLES = [
  { icon: Flame, label: 'Complaint clusters' },
  { icon: Search, label: 'Competitor weaknesses' },
  { icon: ListChecks, label: 'MVP wedge' },
  { icon: Users, label: 'First 100 customers' },
  { icon: CalendarCheck, label: '7-day validation plan' },
];

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-emerald-300',
  medium: 'text-amber-300',
  low: 'text-slate-400',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  history: RadarHistoryEntry[];
  onPickExample: (query: string) => void;
  onRestore: (entry: RadarHistoryEntry) => void;
  onClearHistory: () => void;
}

/** Pre-analysis surface: what the radar does, example niches to try,
 * and recent local analyses. No fake stats — nothing here pretends to
 * be data. */
export default function RadarEmptyState({ history, onPickExample, onRestore, onClearHistory }: Props) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Pitch */}
      <div className="rounded-2xl border border-white/[0.04] bg-white/[0.008] p-5">
        <h3 className="text-[15px] font-semibold text-white">Find angry markets before you build.</h3>
        <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
          Korvix scans public signals, clusters complaints, and turns them into startup wedges.
        </p>

        {/* Example niches */}
        <div className="flex flex-wrap gap-1.5 mt-4">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onPickExample(ex)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 border border-white/[0.05] bg-white/[0.01] hover:text-amber-200 hover:border-amber-500/25 hover:bg-amber-500/[0.04] transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* What you'll get */}
        <div className="mt-5">
          <span className="block text-[10px] font-medium text-slate-600 uppercase tracking-wider mb-2">
            What you'll get
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {DELIVERABLES.map((d) => (
              <div
                key={d.label}
                className="flex flex-col items-start gap-1.5 rounded-xl border border-white/[0.03] bg-white/[0.005] px-3 py-2.5"
              >
                <d.icon className="h-3.5 w-3.5 text-amber-400/60" />
                <span className="text-[10px] text-slate-400 leading-tight">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent analyses */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-white/[0.04] bg-white/[0.008] p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Clock3 className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[12px] font-medium text-white">Recent analyses</span>
            </div>
            <button
              onClick={onClearHistory}
              className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Clear history
            </button>
          </div>
          <div className="space-y-1">
            {history.map((entry) => (
              <button
                key={`${entry.report.query}-${entry.savedAt}`}
                onClick={() => onRestore(entry)}
                className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-lg border border-white/[0.02] bg-white/[0.005] hover:bg-white/[0.02] hover:border-white/[0.06] transition-all group"
              >
                <Target className="h-3 w-3 text-slate-600 group-hover:text-amber-400/60 shrink-0 transition-colors" />
                <span className="flex-1 min-w-0 text-[12px] text-slate-300 truncate">{entry.report.query}</span>
                <span className="shrink-0 text-[11px] font-medium text-white">
                  {entry.report.summary.opportunity_score}
                  <span className="text-[9px] text-slate-600">/100</span>
                </span>
                <span className={`shrink-0 text-[10px] ${CONFIDENCE_TONE[entry.report.summary.confidence] || 'text-slate-500'}`}>
                  {entry.report.summary.confidence}
                </span>
                <span className="shrink-0 text-[10px] text-slate-600 hidden sm:inline">{timeAgo(entry.savedAt)}</span>
              </button>
            ))}
          </div>
          <p className="text-[9px] text-slate-700 mt-2">Stored locally in this browser — restoring does not re-fetch data.</p>
        </div>
      )}
    </motion.div>
  );
}
