import { describe, it, expect } from 'vitest';
import { describeStatus } from '@/lib/runStatus';
import { isResultTerminal } from '@/types/preview';
import { isRunTerminal } from '@/hooks/useProjectOrchestrator';

describe('describeStatus', () => {
  it('covers every backend result status with a real descriptor', () => {
    const statuses = [
      'running', 'pending', 'partial', 'completed', 'completed_no_artifact',
      'artifact_not_found', 'failed', 'cancelled', 'no_run', 'not_found',
    ];
    for (const s of statuses) {
      const d = describeStatus(s);
      expect(d.key).toBe(s);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it('normalises raw orchestrator aliases', () => {
    expect(describeStatus('finished').key).toBe('completed');
    expect(describeStatus('errored').key).toBe('failed');
    expect(describeStatus('queued').key).toBe('pending');
    expect(describeStatus('in_progress').key).toBe('running');
    expect(describeStatus('canceled').key).toBe('cancelled');
  });

  it('offers retry only on failed/cancelled', () => {
    expect(describeStatus('failed').canRetry).toBe(true);
    expect(describeStatus('cancelled').canRetry).toBe(true);
    expect(describeStatus('completed').canRetry).toBe(false);
    expect(describeStatus('running').canRetry).toBe(false);
  });

  it('marks terminal vs non-terminal correctly', () => {
    expect(describeStatus('running').terminal).toBe(false);
    expect(describeStatus('pending').terminal).toBe(false);
    expect(describeStatus('partial').terminal).toBe(false);
    expect(describeStatus('completed').terminal).toBe(true);
    expect(describeStatus('failed').terminal).toBe(true);
  });

  it('falls back to a neutral descriptor for unknown input (never throws)', () => {
    const d = describeStatus('something-from-the-future');
    expect(d.key).toBe('unknown');
    expect(d.label.length).toBeGreaterThan(0);
  });

  it('tolerates null/undefined', () => {
    expect(describeStatus(null).key).toBe('unknown');
    expect(describeStatus(undefined).key).toBe('unknown');
  });
});

describe('terminal detection (stops polling/streaming)', () => {
  it('isResultTerminal: non-terminal result statuses keep polling', () => {
    expect(isResultTerminal('pending')).toBe(false);
    expect(isResultTerminal('running')).toBe(false);
    expect(isResultTerminal('partial')).toBe(false);
  });
  it('isResultTerminal: terminal result statuses stop', () => {
    expect(isResultTerminal('completed')).toBe(true);
    expect(isResultTerminal('failed')).toBe(true);
    expect(isResultTerminal('cancelled')).toBe(true);
    expect(isResultTerminal('not_found')).toBe(true);
    expect(isResultTerminal('completed_no_artifact')).toBe(true);
  });
  it('isRunTerminal: run statuses', () => {
    expect(isRunTerminal('running')).toBe(false);
    expect(isRunTerminal('queued')).toBe(false);
    expect(isRunTerminal('finished')).toBe(true);
    expect(isRunTerminal('errored')).toBe(true);
    expect(isRunTerminal('cancelled')).toBe(true);
    expect(isRunTerminal('completed')).toBe(true);
  });
});
