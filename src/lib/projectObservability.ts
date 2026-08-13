// Phase 7 — pure derivations for the project workspace observability surface.
//
// The workspace must render TRUTH reconstructed from the backend RunSnapshot
// (runner health, the task graph with dependencies, pending approvals, build
// artifacts, and a recommended next action) — never from localStorage. These
// are pure functions over the snapshot so they can be unit-tested and reused
// by ProjectRunCenter / RunResultDetails / BuildInspector without duplicating
// the logic in each component.

import type {
  RunSnapshot,
  TaskView,
  PendingApproval,
  BuildArtifactRef,
} from '@/hooks/useProjectOrchestrator';

export type RunnerHealth = 'healthy' | 'error' | 'not-started' | 'unknown';

export interface RunnerHealthView {
  state: RunnerHealth;
  label: string;
  detail: string;
}

/**
 * Derive a truthful runner-health view. Prefers the backend observability
 * block (reconstructed from durable state), falls back to the raw
 * runner_started / runner_error fields, so it works on both the start
 * response and a reloaded snapshot.
 */
export function deriveRunnerHealth(snapshot: RunSnapshot | null | undefined): RunnerHealthView {
  if (!snapshot) {
    return { state: 'unknown', label: 'Unknown', detail: 'No run loaded.' };
  }
  const err = snapshot.runner_error;
  if (err) {
    return { state: 'error', label: 'Runner error', detail: err };
  }
  const healthy = snapshot.observability?.runner_healthy ?? snapshot.runner_started;
  if (healthy) {
    return { state: 'healthy', label: 'Runner active', detail: 'The workflow runner is processing this run.' };
  }
  if (snapshot.runner_started === false) {
    return { state: 'not-started', label: 'Not started', detail: 'The workflow runner has not started this run.' };
  }
  return { state: 'unknown', label: 'Unknown', detail: 'Runner state is not yet known.' };
}

export interface TaskGraphRow {
  id: string;
  title: string;
  status: string;
  assigned_agent: string;
  /** Human-readable dependency titles (resolved from ids), or [] if none. */
  dependsOn: string[];
  resultSummary: string;
}

/**
 * Project the task graph into renderable rows, resolving dependency ids to
 * their task titles so the UI can show "waits on: Research" instead of an
 * opaque id. Pure and defensive against a missing/partial task_graph.
 */
export function deriveTaskGraphView(snapshot: RunSnapshot | null | undefined): TaskGraphRow[] {
  const tasks: TaskView[] = snapshot?.task_graph?.tasks ?? [];
  const titleById = new Map<string, string>();
  for (const t of tasks) titleById.set(t.id, t.title);
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assigned_agent: t.assigned_agent,
    dependsOn: (t.dependencies ?? []).map((d) => titleById.get(d) ?? d),
    resultSummary: t.result_summary ?? '',
  }));
}

export function derivePendingApprovals(snapshot: RunSnapshot | null | undefined): PendingApproval[] {
  return snapshot?.observability?.pending_approvals ?? [];
}

export function deriveBuildArtifacts(snapshot: RunSnapshot | null | undefined): BuildArtifactRef[] {
  return snapshot?.observability?.build_artifacts ?? [];
}

const NEXT_ACTION_LABELS: Record<string, string> = {
  resolve_runner_error: 'Resolve the runner error to continue.',
  approve_pending_operation: 'Approve the pending operation to proceed.',
  review_failure: 'Review the failure and retry.',
  review_deliverables: 'Review the generated deliverables.',
  wait_for_run: 'The run is in progress.',
};

/** Human-readable recommended next action, derived from backend truth. */
export function deriveNextAction(snapshot: RunSnapshot | null | undefined): string {
  const key = snapshot?.observability?.next_action;
  if (key && NEXT_ACTION_LABELS[key]) return NEXT_ACTION_LABELS[key];
  // Fallback derivation when the backend omitted the block (older snapshot).
  if (snapshot?.runner_error) return NEXT_ACTION_LABELS.resolve_runner_error;
  const status = snapshot?.status ?? '';
  if (status === 'completed' || status === 'finished') return NEXT_ACTION_LABELS.review_deliverables;
  if (status === 'failed' || status === 'errored') return NEXT_ACTION_LABELS.review_failure;
  return NEXT_ACTION_LABELS.wait_for_run;
}
