// ExecutionTimeline — Sprint 1.7 — PURE visualization of the orchestration
// pipeline. No fake timing, no new data: stage states are DERIVED from the
// run's real status + the resolved result status.
//
//   Product Intelligence → Blueprint → Bridge → Orchestrator → Deliverable Result
//
// A run only exists because Product Intelligence → Blueprint → Bridge already
// produced it, so those three are 'done' by definition. The Orchestrator and
// Result stages reflect live status.
import { CheckCircle2, Loader2, XCircle, Circle, type LucideIcon } from 'lucide-react';
import { describeStatus } from '@/lib/runStatus';
import type { ResultStatus } from '@/types/preview';

type StageState = 'done' | 'current' | 'pending' | 'error';

interface ExecutionTimelineProps {
  runStatus:     string;
  resultStatus?: ResultStatus | null;
}

const STAGE_META: Record<StageState, { Icon: LucideIcon; color: string; spin: boolean }> = {
  done:    { Icon: CheckCircle2, color: 'rgb(52,211,153)',  spin: false },
  current: { Icon: Loader2,      color: 'rgb(34,211,238)',  spin: true  },
  error:   { Icon: XCircle,      color: 'rgb(248,113,113)', spin: false },
  pending: { Icon: Circle,       color: 'rgb(100,116,139)', spin: false },
};

function deriveStages(runStatus: string, resultStatus?: ResultStatus | null): StageState[] {
  const run = describeStatus(runStatus);
  const runFailed = run.key === 'failed';
  const runCancelled = run.key === 'cancelled';
  const runDone = run.key === 'completed';
  const runActive = !run.terminal; // running / pending / partial

  // Orchestrator stage.
  let orchestrator: StageState = 'pending';
  if (runDone) orchestrator = 'done';
  else if (runFailed || runCancelled) orchestrator = 'error';
  else if (runActive) orchestrator = 'current';

  // Result stage.
  let result: StageState = 'pending';
  const r = resultStatus ? describeStatus(resultStatus) : null;
  if (r) {
    if (r.key === 'completed' || r.key === 'completed_no_artifact' || r.key === 'artifact_not_found') result = 'done';
    else if (r.key === 'failed') result = 'error';
    else if (!r.terminal) result = runFailed || runCancelled ? 'pending' : 'current';
  } else if (runDone) {
    result = 'current';   // run done, result still resolving/unknown
  } else if (runFailed || runCancelled) {
    result = 'pending';
  }

  // PI / Blueprint / Bridge are implied-complete once a run exists.
  return ['done', 'done', 'done', orchestrator, result];
}

const STAGES = ['Product Intelligence', 'Blueprint', 'Bridge', 'Orchestrator', 'Deliverable Result'];

export default function ExecutionTimeline({ runStatus, resultStatus }: ExecutionTimelineProps) {
  const states = deriveStages(runStatus, resultStatus);
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
