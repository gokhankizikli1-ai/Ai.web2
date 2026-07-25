/**
 * Tests — Rendered Vision Review foundation (PR #519, Part B).
 *
 * The conditional trigger, the untrusted-response sanitizer, and the vision→repair adapter — all
 * deterministic and testable now (the live screenshot + backend call are wired in the follow-up).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  shouldRunVisionReview, sanitizeVisionReview, visionReviewToReviewIssues, isRenderedVisionReviewEnabled,
} from '@/lib/webBuildVisionReview';
import type {
  FrontendBuilderValidationArtifact, ExperienceArchitecturePlan, RenderedVisionReview,
} from '@/lib/webBuildAgents';

function validation(over: Partial<FrontendBuilderValidationArtifact> = {}): FrontendBuilderValidationArtifact {
  return { status: 'valid', readyForConsumption: true, ...over } as unknown as FrontendBuilderValidationArtifact;
}
function plan(over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType: 'product-demonstration',
    entryPattern: 'interactive-demo', landingRequired: true, heroPattern: 'x', heroContentPriority: 'interaction',
    textDensity: 'medium', primaryVisualMedium: 'product_ui', sectionSequence: [], sectionContracts: [],
    forbiddenPatterns: [], userDirectives: [], ...over,
  };
}

const ON = () => vi.stubEnv('VITE_ENABLE_RENDERED_VISION_REVIEW', 'true');
afterEach(() => vi.unstubAllEnvs());

/* ── Conditional trigger (13/14) ──────────────────────────────────────────────*/
describe('conditional trigger', () => {
  it('flag off → never triggers', () => {
    expect(isRenderedVisionReviewEnabled()).toBe(false);
    expect(shouldRunVisionReview({ validation: validation(), plan: plan() })).toBe(false);
  });
  it('structurally invalid build → no trigger', () => {
    ON();
    expect(shouldRunVisionReview({ validation: validation({ status: 'invalid' } as never), plan: plan() })).toBe(false);
  });
  it('13. triggers when product_ui is required', () => {
    ON();
    expect(shouldRunVisionReview({ validation: validation(), plan: plan() })).toBe(true);
  });
  it('13. triggers on a template warning', () => {
    ON();
    const v = validation({ semanticContent: { version: 'semantic-content-v1', sectionFindings: [], contentQuality: 'acceptable', proofCoverage: 'partial', genericPatternDetected: true } });
    expect(shouldRunVisionReview({ validation: v, plan: plan({ primaryVisualMedium: 'photography', heroContentPriority: 'media' }) })).toBe(true);
  });
  it('13. owner force → triggers', () => {
    ON();
    expect(shouldRunVisionReview({ validation: validation(), plan: plan({ primaryVisualMedium: 'typography', heroContentPriority: 'text' }), forceOwner: true })).toBe(true);
  });
  it('14. clean minimal typography-first site → no trigger', () => {
    ON();
    const p = plan({ primaryVisualMedium: 'typography', heroContentPriority: 'text', textDensity: 'low', signature: { version: 'experience-signature-v1', basis: 'derived', signatureMoment: 'x', emotionalGoal: 'y', interactionPattern: 'minimal_static', motionIntensity: 'subtle', attentionStrategy: 'hero_first', userDirectives: [] } });
    const v = validation({ semanticContent: { version: 'semantic-content-v1', sectionFindings: [], contentQuality: 'meaningful', proofCoverage: 'partial', genericPatternDetected: false } });
    expect(shouldRunVisionReview({ validation: v, plan: p })).toBe(false);
  });
});

/* ── Response sanitizer (21/22) ───────────────────────────────────────────────*/
describe('sanitizer', () => {
  it('21. valid typed response', () => {
    const r = sanitizeVisionReview({
      verdict: 'needs-repair', score: 42,
      issues: [{ code: 'template', area: 'composition', severity: 'major', message: 'looks generic', repairInstruction: 'differentiate' }, { severity: 'bogus', message: 'm' }],
      templateSimilaritySignals: ['purple gradient hero', 123], proofAssessment: 'weak', hierarchyAssessment: 'flat', compositionAssessment: 'ok',
    })!;
    expect(r.version).toBe('rendered-vision-review-v1');
    expect(r.verdict).toBe('needs-repair');
    expect(r.score).toBe(42);
    expect(r.issues).toHaveLength(2);
    expect(r.issues[1].severity).toBe('minor');   // bogus → minor
    expect(r.templateSimilaritySignals).toEqual(['purple gradient hero']);  // non-string dropped
  });
  it('22. malformed → undefined (fail-open)', () => {
    expect(sanitizeVisionReview(null)).toBeUndefined();
    expect(sanitizeVisionReview({ score: 5 })).toBeUndefined();          // no verdict
    expect(sanitizeVisionReview({ verdict: 'maybe' })).toBeUndefined();  // bad verdict
  });
  it('clamps score + bounds', () => {
    expect(sanitizeVisionReview({ verdict: 'pass', score: 999 })!.score).toBe(100);
    expect(sanitizeVisionReview({ verdict: 'pass' })!.score).toBe(0);
  });
});

/* ── Verdict normalization invariants (Issue 5) ───────────────────────────────── */
describe('verdict normalization', () => {
  const issue = (severity: string) => ({ code: 'c', area: 'composition', severity, message: 'm', repairInstruction: 'r' });
  it('provider "pass" but a major finding → needs-repair (pass cannot hide a defect)', () => {
    expect(sanitizeVisionReview({ verdict: 'pass', score: 90, issues: [issue('major')] })!.verdict).toBe('needs-repair');
  });
  it('a blocker finding → needs-repair', () => {
    expect(sanitizeVisionReview({ verdict: 'pass', score: 90, issues: [issue('blocker')] })!.verdict).toBe('needs-repair');
  });
  it('provider "needs-repair" but only minor findings → pass (advisory, no empty repair)', () => {
    expect(sanitizeVisionReview({ verdict: 'needs-repair', score: 50, issues: [issue('minor')] })!.verdict).toBe('pass');
  });
  it('provider "needs-repair" with zero issues → pass', () => {
    expect(sanitizeVisionReview({ verdict: 'needs-repair', score: 10, issues: [] })!.verdict).toBe('pass');
  });
});

/* ── Vision → repair adapter (27/28) ──────────────────────────────────────────*/
describe('vision → repair adapter', () => {
  const review = (issues: RenderedVisionReview['issues']): RenderedVisionReview => ({
    version: 'rendered-vision-review-v1', verdict: 'needs-repair', score: 40, issues,
    templateSimilaritySignals: [], proofAssessment: '', hierarchyAssessment: '', compositionAssessment: '',
  });
  it('27. major/blocker findings enter the repair (mapped severity + category)', () => {
    const issues = visionReviewToReviewIssues(review([
      { code: 'generic-template', area: 'composition', severity: 'major', message: 'generic SaaS', repairInstruction: 'differentiate' },
      { code: 'weak-proof', area: 'proof', severity: 'blocker', message: 'fake panel', repairInstruction: 'use real proof' },
    ]));
    expect(issues).toHaveLength(2);
    expect(issues.find((i) => i.category === 'generic-template')!.severity).toBe('major');
    expect(issues.find((i) => i.category === 'contract-fidelity')!.severity).toBe('blocker');
    expect(issues.every((i) => i.id.startsWith('vision:'))).toBe(true);
  });
  it('28. minor-only findings do not enter the repair', () => {
    expect(visionReviewToReviewIssues(review([
      { code: 'nit', area: 'typography', severity: 'minor', message: 'tighten', repairInstruction: 'x' },
    ]))).toEqual([]);
  });
  it('empty / wrong version → []', () => {
    expect(visionReviewToReviewIssues(undefined)).toEqual([]);
    expect(visionReviewToReviewIssues({ version: 'x' } as never)).toEqual([]);
  });

  /* ── Multiple findings per category preserved, not discarded (Issue 6) ──────── */
  it('multiple same-category majors are MERGED into one bounded issue (none lost)', () => {
    const issues = visionReviewToReviewIssues(review([
      { code: 'generic-1', area: 'composition', severity: 'major', message: 'generic hero', repairInstruction: 'differentiate the hero' },
      { code: 'generic-2', area: 'composition', severity: 'major', message: 'generic cards', repairInstruction: 'replace the card trio' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe('generic-template');
    expect(issues[0].evidence).toContain('generic hero');
    expect(issues[0].evidence).toContain('generic cards');       // second finding NOT discarded
    expect(issues[0].repairInstruction).toContain('differentiate the hero');
    expect(issues[0].repairInstruction).toContain('replace the card trio');
  });
  it('a blocker in a category escalates the merged issue to blocker', () => {
    const issues = visionReviewToReviewIssues(review([
      { code: 'p1', area: 'proof', severity: 'major', message: 'weak proof', repairInstruction: 'a' },
      { code: 'p2', area: 'proof', severity: 'blocker', message: 'fake panel', repairInstruction: 'b' },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('blocker');
  });
  it('distinct categories stay distinct (one merged issue each)', () => {
    const issues = visionReviewToReviewIssues(review([
      { code: 'g', area: 'composition', severity: 'major', message: 'generic', repairInstruction: 'x' },
      { code: 'h', area: 'hierarchy', severity: 'major', message: 'flat', repairInstruction: 'y' },
    ]));
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((i) => i.category)).size).toBe(2);
  });
});
