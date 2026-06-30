// runStages — Sprint 1.8 — PURE derivation of the orchestration pipeline
// stages from a run's real status + the resolved result status. Shared by the
// live hook (exposes `phases`) and <ExecutionTimeline/> (renders them) so the
// timeline can never disagree with the hook. No timing, no fabricated data —
// stages are derived, not animated on a clock.
import { CheckCircle2, Loader2, XCircle, Circle, Ban, type LucideIcon } from 'lucide-react';
import { describeStatus } from '@/lib/runStatus';
import type { ResultStatus } from '@/types/preview';

export type StageState = 'done' | 'current' | 'pending' | 'error' | 'cancelled';

export const STAGES = [
  'Product Intelligence', 'Blueprint', 'Bridge', 'Orchestrator', 'Deliverable Result',
] as const;

export const STAGE_META: Record<StageState, { Icon: LucideIcon; color: string; spin: boolean }> = {
  done:      { Icon: CheckCircle2, color: 'rgb(52,211,153)',  spin: false },
  current:   { Icon: Loader2,      color: 'rgb(34,211,238)',  spin: true  },
  error:     { Icon: XCircle,      color: 'rgb(248,113,113)', spin: false },
  cancelled: { Icon: Ban,          color: 'rgb(251,191,36)',  spin: false },
  pending:   { Icon: Circle,       color: 'rgb(100,116,139)', spin: false },
};

/**
 * Derive the five pipeline stage states. A run only exists because Product
 * Intelligence → Blueprint → Bridge already produced it, so those three are
 * `done` by definition. Orchestrator + Result reflect live status.
 */
export function deriveStages(runStatus: string, resultStatus?: ResultStatus | null): StageState[] {
  const run = describeStatus(runStatus);
  const runFailed = run.key === 'failed';
  const runCancelled = run.key === 'cancelled';
  const runDone = run.key === 'completed';
  const runActive = !run.terminal; // running / pending / partial

  // Orchestrator stage.
  let orchestrator: StageState = 'pending';
  if (runDone) orchestrator = 'done';
  else if (runCancelled) orchestrator = 'cancelled';
  else if (runFailed) orchestrator = 'error';
  else if (runActive) orchestrator = 'current';

  // Result stage.
  let result: StageState = 'pending';
  const r = resultStatus ? describeStatus(resultStatus) : null;
  if (r) {
    if (r.key === 'completed' || r.key === 'completed_no_artifact' || r.key === 'artifact_not_found') result = 'done';
    else if (r.key === 'failed') result = 'error';
    else if (r.key === 'cancelled') result = 'cancelled';
    else if (!r.terminal) result = (runFailed || runCancelled) ? 'pending' : 'current';
  } else if (runDone) {
    result = 'current';   // run done, result still resolving/unknown
  }

  // PI / Blueprint / Bridge are implied-complete once a run exists.
  return ['done', 'done', 'done', orchestrator, result];
}
