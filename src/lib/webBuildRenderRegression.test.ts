/**
 * Quality V2 — POST-REPAIR RENDERED RE-VERIFICATION.
 *
 * The hole this closes: before Quality V2 the rendered page was inspected exactly once, BEFORE
 * the repair. A repair that fixed the reported issue while breaking the rendered page was
 * invisible to every downstream gate. These tests pin the comparison semantics, and — just as
 * importantly — pin that it fails OPEN, so a build with no measurement is never penalised.
 */
import { describe, it, expect } from 'vitest';
import { compareRenderedEvaluations, rendersWorseAfterRepair } from '@/lib/webBuildRenderRegression';
import type { RenderedVisualEvaluationArtifact, RenderedVisualIssue } from '@/lib/webBuildAgents';

function issue(code: string, severity: RenderedVisualIssue['severity']): RenderedVisualIssue {
  return { code, dimension: 'composition', severity, message: code, suggestion: 'fix it' };
}

function evaluation(
  issues: RenderedVisualIssue[],
  opts?: { runtimeReviewed?: boolean; score?: number },
): RenderedVisualEvaluationArtifact {
  return {
    version: 'rendered-visual-eval-v1',
    score: opts?.score ?? 90,
    passed: issues.length === 0,
    issues,
    screenshotReviewed: false,
    runtimeReviewed: opts?.runtimeReviewed ?? true,
  };
}

describe('rendered regression — detects a repair that broke the page', () => {
  it('flags a NEW high-severity rendered defect as a regression', () => {
    const r = compareRenderedEvaluations(
      evaluation([]),
      evaluation([issue('rendered-horizontal-overflow', 'high')]),
    );
    expect(r.compared).toBe(true);
    expect(r.regressed).toBe(true);
    expect(r.newHighCodes).toEqual(['rendered-horizontal-overflow']);
    expect(rendersWorseAfterRepair(r)).toBe(true);
  });

  it('marks a page that stopped rendering as a runtime failure', () => {
    const r = compareRenderedEvaluations(
      evaluation([]),
      evaluation([issue('rendered-runtime-error', 'high')]),
    );
    expect(r.regressed).toBe(true);
    expect(r.newRuntimeFailure).toBe(true);
    expect(r.reason).toContain('failed to render');
  });

  it('does NOT flag a pre-existing defect the repair simply did not fix', () => {
    const before = evaluation([issue('rendered-hero-missing', 'high')]);
    const after = evaluation([issue('rendered-hero-missing', 'high')]);
    const r = compareRenderedEvaluations(before, after);
    expect(r.compared).toBe(true);
    expect(r.regressed).toBe(false);
    expect(rendersWorseAfterRepair(r)).toBe(false);
  });

  it('records resolved defects as progress, not as a regression', () => {
    const r = compareRenderedEvaluations(
      evaluation([issue('rendered-blank', 'high'), issue('rendered-hero-missing', 'high')]),
      evaluation([]),
    );
    expect(r.regressed).toBe(false);
    expect(r.resolvedHighCodes).toEqual(['rendered-blank', 'rendered-hero-missing']);
    expect(r.beforeHighCount).toBe(2);
    expect(r.afterHighCount).toBe(0);
  });

  it('ignores medium/low churn — only HIGH-severity evidence can reject a repair', () => {
    const r = compareRenderedEvaluations(
      evaluation([]),
      evaluation([issue('rendered-cta-below-fold', 'medium'), issue('rendered-endless-scroll', 'low')]),
    );
    expect(r.regressed).toBe(false);
  });
});

describe('rendered regression — fails open', () => {
  it('reports "not compared" when there is no pre-repair measurement', () => {
    const r = compareRenderedEvaluations(undefined, evaluation([issue('rendered-blank', 'high')]));
    expect(r.compared).toBe(false);
    expect(r.regressed).toBe(false);
    expect(rendersWorseAfterRepair(r)).toBe(false);
  });

  it('reports "not compared" when the post-repair measurement is missing', () => {
    const r = compareRenderedEvaluations(evaluation([]), undefined);
    expect(r.compared).toBe(false);
    expect(r.regressed).toBe(false);
  });

  it('refuses to read "no findings because nothing rendered" as "no regression"', () => {
    // An evaluation that never observed the runtime carries no evidence either way. Treating its
    // empty issue list as health would let a broken repair through on silence.
    const r = compareRenderedEvaluations(
      evaluation([issue('rendered-hero-missing', 'high')]),
      evaluation([], { runtimeReviewed: false }),
    );
    expect(r.compared).toBe(false);
    expect(r.regressed).toBe(false);
  });

  it('ignores a wrong-version artifact rather than trusting it', () => {
    const r = compareRenderedEvaluations(evaluation([]), { version: 'other' } as never);
    expect(r.compared).toBe(false);
    expect(r.regressed).toBe(false);
  });

  it('treats a missing/undefined result as non-blocking', () => {
    expect(rendersWorseAfterRepair(undefined)).toBe(false);
  });
});
