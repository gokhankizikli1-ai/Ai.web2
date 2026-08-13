// Phase 7 — a compact, truthful run-health strip for the Project Workspace.
//
// Renders backend-reconstructed truth (runner health, pending approvals, the
// task graph with resolved dependencies, and the recommended next action)
// from a RunSnapshot. Pure presentational — all logic lives in the tested
// `projectObservability` derivations, so this component never re-derives
// state or reads localStorage.

import type { RunSnapshot } from '@/hooks/useProjectOrchestrator';
import {
  deriveRunnerHealth,
  deriveTaskGraphView,
  derivePendingApprovals,
  deriveNextAction,
} from '@/lib/projectObservability';

const HEALTH_DOT: Record<string, string> = {
  healthy: '#22C55E',
  error: '#EF4444',
  'not-started': '#FACC15',
  unknown: '#9CA3AF',
};

const STATUS_COLOR: Record<string, string> = {
  completed: '#22C55E',
  running: '#3B82F6',
  failed: '#EF4444',
  queued: '#9CA3AF',
  waiting: '#FACC15',
};

export default function RunObservabilityPanel({ snapshot }: { snapshot: RunSnapshot | null | undefined }) {
  if (!snapshot) return null;

  const health = deriveRunnerHealth(snapshot);
  const tasks = deriveTaskGraphView(snapshot);
  const approvals = derivePendingApprovals(snapshot);
  const nextAction = deriveNextAction(snapshot);

  return (
    <div
      className="max-w-2xl mx-auto mb-3 rounded-lg px-3 py-2.5"
      style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}
      data-testid="run-observability"
    >
      {/* Runner health + next action */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: HEALTH_DOT[health.state] ?? HEALTH_DOT.unknown }}
            title={health.detail}
          />
          <span className="text-[11px] font-medium text-white/70">{health.label}</span>
        </div>
        <span className="text-[11px] text-white/40">{nextAction}</span>
      </div>

      {/* Runner error detail (only when present) */}
      {health.state === 'error' && (
        <div className="mt-1.5 text-[10px] text-[#EF4444]/80">{health.detail}</div>
      )}

      {/* Pending approvals */}
      {approvals.length > 0 && (
        <div className="mt-2 text-[10px] text-[#FACC15]/80">
          {approvals.length} operation{approvals.length > 1 ? 's' : ''} awaiting approval
          {approvals.map((a) => a.capability).filter(Boolean).length > 0 && (
            <span className="text-white/40">
              {' '}({approvals.map((a) => a.capability).filter(Boolean).join(', ')})
            </span>
          )}
        </div>
      )}

      {/* Task graph with resolved dependencies */}
      {tasks.length > 0 && (
        <div className="mt-2 space-y-1">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[10px]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: STATUS_COLOR[t.status] ?? STATUS_COLOR.queued }}
              />
              <span className="text-white/60 truncate">{t.title}</span>
              {t.dependsOn.length > 0 && (
                <span className="text-white/25 truncate">· waits on {t.dependsOn.join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
