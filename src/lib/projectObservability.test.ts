import { describe, it, expect } from 'vitest';
import {
  deriveRunnerHealth,
  deriveTaskGraphView,
  derivePendingApprovals,
  deriveBuildArtifacts,
  deriveNextAction,
} from './projectObservability';
import type { RunSnapshot } from '@/hooks/useProjectOrchestrator';

function snap(partial: Partial<RunSnapshot>): RunSnapshot {
  return {
    run_id: 'r1',
    status: 'running',
    template_id: null,
    panel_id: null,
    workflow: null,
    deliverables: [],
    task_graph: { run_id: 'r1', tasks: [], counts: {}, total_count: 0 },
    ...partial,
  };
}

describe('deriveRunnerHealth', () => {
  it('reports error truthfully', () => {
    const h = deriveRunnerHealth(snap({ runner_error: 'ENABLE_WORKFLOW_RUNNER is false' }));
    expect(h.state).toBe('error');
    expect(h.detail).toContain('ENABLE_WORKFLOW_RUNNER');
  });

  it('reports healthy from observability block', () => {
    const h = deriveRunnerHealth(snap({
      observability: { runner_healthy: true, pending_approvals: [], build_artifacts: [], next_action: 'wait_for_run' },
    }));
    expect(h.state).toBe('healthy');
  });

  it('falls back to runner_started', () => {
    expect(deriveRunnerHealth(snap({ runner_started: true })).state).toBe('healthy');
    expect(deriveRunnerHealth(snap({ runner_started: false })).state).toBe('not-started');
  });

  it('handles null snapshot', () => {
    expect(deriveRunnerHealth(null).state).toBe('unknown');
  });
});

describe('deriveTaskGraphView', () => {
  it('resolves dependency ids to titles', () => {
    const rows = deriveTaskGraphView(snap({
      task_graph: {
        run_id: 'r1',
        counts: {},
        total_count: 2,
        tasks: [
          { id: 't1', run_id: 'r1', title: 'Research', assigned_agent: 'researcher', status: 'completed', dependencies: [], result_summary: 'found' },
          { id: 't2', run_id: 'r1', title: 'Product', assigned_agent: 'product', status: 'running', dependencies: ['t1'], result_summary: '' },
        ],
      },
    }));
    expect(rows).toHaveLength(2);
    expect(rows[1].dependsOn).toEqual(['Research']);
    expect(rows[0].resultSummary).toBe('found');
  });

  it('is defensive against a missing task_graph', () => {
    // @ts-expect-error intentionally partial
    expect(deriveTaskGraphView({ run_id: 'r' })).toEqual([]);
  });
});

describe('derive approvals + artifacts', () => {
  it('surfaces pending approvals and build artifacts', () => {
    const s = snap({
      observability: {
        runner_healthy: true,
        pending_approvals: [{ deliverable_id: 'd1', node_id: 'app', capability: 'app', fingerprint: 'fp' }],
        build_artifacts: [{ deliverable_id: 'd2', build_type: 'web', build_status: 'completed', artifact_ref: 'webrun:1', build_ref: 'b1' }],
        next_action: 'approve_pending_operation',
      },
    });
    expect(derivePendingApprovals(s)).toHaveLength(1);
    expect(deriveBuildArtifacts(s)[0].artifact_ref).toBe('webrun:1');
  });

  it('defaults to empty arrays', () => {
    expect(derivePendingApprovals(snap({}))).toEqual([]);
    expect(deriveBuildArtifacts(snap({}))).toEqual([]);
  });
});

describe('deriveNextAction', () => {
  it('uses the backend next_action', () => {
    const s = snap({
      observability: { runner_healthy: false, pending_approvals: [], build_artifacts: [], next_action: 'approve_pending_operation' },
    });
    expect(deriveNextAction(s)).toContain('Approve');
  });

  it('falls back from status when block absent', () => {
    expect(deriveNextAction(snap({ status: 'completed' }))).toContain('Review');
    expect(deriveNextAction(snap({ status: 'errored' }))).toContain('retry');
    expect(deriveNextAction(snap({ runner_error: 'x' }))).toContain('runner');
  });
});
