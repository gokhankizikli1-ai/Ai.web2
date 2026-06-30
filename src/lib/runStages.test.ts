import { describe, it, expect } from 'vitest';
import { deriveStages } from '@/lib/runStages';

// PI / Blueprint / Bridge are always done once a run exists.
const PRELUDE = ['done', 'done', 'done'];

describe('deriveStages', () => {
  it('running run, no result yet → orchestrator current, result pending', () => {
    expect(deriveStages('running', null)).toEqual([...PRELUDE, 'current', 'pending']);
  });

  it('queued/pending run → orchestrator current', () => {
    expect(deriveStages('pending', null)).toEqual([...PRELUDE, 'current', 'pending']);
  });

  it('completed run, completed result → both done', () => {
    expect(deriveStages('finished', 'completed')).toEqual([...PRELUDE, 'done', 'done']);
  });

  it('completed run, result still resolving → orchestrator done, result current', () => {
    expect(deriveStages('completed', null)).toEqual([...PRELUDE, 'done', 'current']);
  });

  it('failed run → orchestrator error, result pending', () => {
    expect(deriveStages('errored', null)).toEqual([...PRELUDE, 'error', 'pending']);
  });

  it('cancelled run → orchestrator cancelled', () => {
    expect(deriveStages('cancelled', null)).toEqual([...PRELUDE, 'cancelled', 'pending']);
  });

  it('partial result while running → result current', () => {
    expect(deriveStages('running', 'partial')).toEqual([...PRELUDE, 'current', 'current']);
  });

  it('completed_no_artifact result counts as done', () => {
    expect(deriveStages('finished', 'completed_no_artifact')).toEqual([...PRELUDE, 'done', 'done']);
  });

  it('failed result → result error', () => {
    expect(deriveStages('finished', 'failed')).toEqual([...PRELUDE, 'done', 'error']);
  });

  it('always returns exactly five stages', () => {
    expect(deriveStages('whatever-unknown', null)).toHaveLength(5);
  });
});
