// RunHistoryPanel — Sprint 1.7 — a project's orchestration history.
//
// Pure presentation over useProjectRuns (GET /v2/orchestrator/runs). No fake
// history; every row is a real backend run. Selecting a row drives the Result
// Details panel. Handles loading (skeletons), empty, error+retry and the
// feature-gate 'disabled' state.
import { RotateCcw, History, Ban } from 'lucide-react';
import type { RunTurn } from '@/hooks/useProjectOrchestrator';
import type { RunsAvailability } from '@/hooks/useProjectRuns';
import { describeStatus } from '@/lib/runStatus';
import { formatRelativeTime } from '@/lib/time';

interface RunHistoryPanelProps {
  runs:          RunTurn[];
  selectedRunId: string | null;
  onSelect:      (runId: string) => void;
  loading:       boolean;
  error:         string | null;
  availability:  RunsAvailability;
  onRetry:       () => void;
}

export default function RunHistoryPanel({
  runs, selectedRunId, onSelect, loading, error, availability, onRetry,
}: RunHistoryPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-cyan-400/60" />
          <span className="text-[12px] font-semibold text-white/70">Run History</span>
          {runs.length > 0 && (
            <span className="text-[10px] text-white/30">{runs.length}</span>
          )}
        </div>
        <button
          onClick={onRetry}
          title="Refresh"
          className="p-1 rounded-md text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Feature gate off */}
        {availability === 'disabled' ? (
          <Notice icon={<Ban className="h-4 w-4 text-amber-400/80" />} title="Orchestrator disabled">
            Run history activates when <code className="text-white/45">ENABLE_PROJECT_ORCHESTRATOR</code> is
            enabled on the backend.
          </Notice>
        ) : error ? (
          <Notice icon={<Ban className="h-4 w-4 text-red-400/80" />} title="Couldn't load runs">
            <p className="mb-2">{error}</p>
            <button onClick={onRetry} className="inline-flex items-center gap-1 text-[11px] text-cyan-400/80 hover:text-cyan-300">
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          </Notice>
        ) : loading && runs.length === 0 ? (
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[52px] rounded-lg bg-white/[0.02] animate-pulse" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <Notice icon={<History className="h-4 w-4 text-white/30" />} title="No runs yet">
            This project has no orchestration runs. Start one from the workspace and it will appear here.
          </Notice>
        ) : (
          <ul className="p-1.5 space-y-1">
            {runs.map((r, i) => {
              const d = describeStatus(r.status);
              const selected = r.run_id === selectedRunId;
              const num = runs.length - i;   // newest first → highest number
              return (
                <li key={r.run_id}>
                  <button
                    onClick={() => onSelect(r.run_id)}
                    className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors border ${
                      selected
                        ? 'bg-cyan-500/[0.06] border-cyan-500/20'
                        : 'bg-transparent border-transparent hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[10px] text-white/35 font-mono">Run #{num}</span>
                      <span className="flex items-center gap-1 text-[10px]" style={{ color: d.dot }}>
                        <d.Icon className={`h-3 w-3 ${d.spin ? 'animate-spin' : ''}`} />
                        {d.label}
                      </span>
                    </div>
                    <p className="text-[12px] text-white/75 truncate">
                      {r.user_request || 'Untitled run'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {r.template_id && (
                        <span className="text-[9px] text-white/30 font-mono truncate max-w-[120px]">{r.template_id}</span>
                      )}
                      <span className="text-[9px] text-white/25">{formatRelativeTime(r.created_at)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-center">
      <div className="flex justify-center mb-2">{icon}</div>
      <p className="text-[12px] font-medium text-white/60 mb-1">{title}</p>
      <div className="text-[11px] text-white/35 leading-relaxed">{children}</div>
    </div>
  );
}
