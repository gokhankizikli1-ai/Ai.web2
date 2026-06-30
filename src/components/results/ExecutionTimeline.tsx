// ExecutionTimeline — Sprint 1.7/1.8 — PURE visualization of the orchestration
// pipeline. Stage states are DERIVED (see lib/runStages) from the run's real
// status + the resolved result status — no fake timing, no clock animation.
// Re-renders live when the hook's status/result update.
//
//   Product Intelligence → Blueprint → Bridge → Orchestrator → Deliverable Result
import { STAGES, STAGE_META, deriveStages, type StageState } from '@/lib/runStages';
import type { ResultStatus } from '@/types/preview';

interface ExecutionTimelineProps {
  runStatus:     string;
  resultStatus?: ResultStatus | null;
  // Optional pre-derived stages (when the caller already has them from the
  // live hook) — avoids recomputing; falls back to deriving here.
  stages?:       StageState[];
}

export default function ExecutionTimeline({ runStatus, resultStatus, stages }: ExecutionTimelineProps) {
  const states = stages ?? deriveStages(runStatus, resultStatus);
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {STAGES.map((label, i) => {
        const st = states[i];
        const m = STAGE_META[st];
        return (
          <div key={label} className="flex items-center gap-1 shrink-0">
            <div className="flex flex-col items-center gap-1 min-w-[64px]">
              <m.Icon className={`h-4 w-4 ${m.spin ? 'animate-spin' : ''}`} style={{ color: m.color }} />
              <span
                className="text-[9px] text-center leading-tight max-w-[72px]"
                style={{ color: st === 'pending' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)' }}
              >
                {label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className="h-px w-5"
                style={{ background: states[i] === 'done' ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.08)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
