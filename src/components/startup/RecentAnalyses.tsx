import { ChevronRight, Clock3, Target, Trash2 } from 'lucide-react';
import type { RadarHistoryEntry } from '@/lib/startupRadarHistory';

const CONFIDENCE_TONE: Record<string, string> = {
  high: 'text-[#86A08F]',
  medium: 'text-[#637B90]',
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
  /** Expanded by default in the empty state, collapsed when a report is
   * already on screen so it never crowds the main result. */
  defaultOpen: boolean;
  onRestore: (entry: RadarHistoryEntry) => void;
  onClearHistory: () => void;
}

/** Compact collapsible list of the last local analyses. Restoring never
 * re-fetches — it shows the exact stored report. */
export default function RecentAnalyses({ history, defaultOpen, onRestore, onClearHistory }: Props) {
  if (history.length === 0) return null;
  return (
    // key on defaultOpen so switching contexts (empty ↔ report visible)
    // remounts with the right initial state without fighting user toggles.
    <details
      key={defaultOpen ? 'open' : 'closed'}
      open={defaultOpen || undefined}
      className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-4 group"
    >
      <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 text-slate-500 transition-transform group-open:rotate-90" />
        <Clock3 className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[13px] font-semibold text-slate-100">Recent analyses</span>
        <span className="text-[11px] text-slate-500">({history.length})</span>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClearHistory(); }}
          className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 hover:text-[#C98A93] transition-colors"
        >
          <Trash2 className="h-3 w-3" /> Clear history
        </button>
      </summary>
      <div className="space-y-1 mt-2.5">
        {history.map((entry) => (
          <button
            key={`${entry.report.query}-${entry.savedAt}`}
            onClick={() => onRestore(entry)}
            className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-lg border border-white/[0.03] bg-white/[0.008] hover:bg-white/[0.03] hover:border-white/[0.08] transition-all group/item"
          >
            <Target className="h-3 w-3 text-slate-500 group-hover/item:text-[#637B90] shrink-0 transition-colors" />
            <span className="flex-1 min-w-0 text-[12px] text-slate-200 truncate">{entry.report.query}</span>
            <span className="shrink-0 text-[11px] font-semibold text-slate-100">
              {entry.report.summary.opportunity_score}
              <span className="text-[9px] font-normal text-slate-500">/100</span>
            </span>
            <span className={`shrink-0 text-[10px] ${CONFIDENCE_TONE[entry.report.summary.confidence] || 'text-slate-400'}`}>
              {entry.report.summary.confidence}
            </span>
            <span className="shrink-0 text-[10px] text-slate-500 hidden sm:inline">{timeAgo(entry.savedAt)}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">Stored locally in this browser — restoring does not re-fetch data.</p>
    </details>
  );
}
