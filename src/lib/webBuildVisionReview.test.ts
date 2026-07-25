/**
 * Tests — Rendered Vision Review foundation (PR #519, Part B).
 *
 * The conditional trigger, the untrusted-response sanitizer, and the vision→repair adapter — all
 * deterministic and testable now (the live screenshot + backend call are wired in the follow-up).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  shouldRunVisionReview, sanitizeVisionReview, visionReviewToReviewIssues, isRenderedVisionReviewEnabled,
  buildVisionReviewContext, buildRenderedVisionReviewArtifact, createVisionReviewProducer,
  requestRenderedVisionReview,
} from '@/lib/webBuildVisionReview';
import type {
  FrontendBuilderValidationArtifact, ExperienceArchitecturePlan, RenderedVisionReview,
  FrontendBuildSpecification, RenderedVisualInput, CapturedScreenshot,
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

/* ── Bounded review context (PR #521) ─────────────────────────────────────────*/
function spec(over: Partial<ExperienceArchitecturePlan> = {}): FrontendBuildSpecification {
  return { prompt: 'a support tool', experienceArchitecture: plan(over) } as unknown as FrontendBuildSpecification;
}
const shot = (partial = false): CapturedScreenshot => ({ dataUrl: 'data:image/webp;base64,AAAA', mimeType: 'image/webp', byteLength: 3000, partial });

describe('buildVisionReviewContext', () => {
  it('summarizes the plan + contract + runtime findings (no source/secrets)', () => {
    const rendered: RenderedVisualInput = {
      screenshots: [{ viewport: 'desktop', width: 1440, height: 900, blank: false, horizontalOverflow: true, heroVisible: false }],
      capturedScreenshot: shot(true),
    };
    const ctx = buildVisionReviewContext(spec({ forbiddenPatterns: ['generic centered SaaS hero'] }), rendered);
    expect(ctx.planSummary).toContain('product-demonstration');
    expect(ctx.contractSummary.toLowerCase()).toContain('first viewport');
    expect(ctx.contractSummary.toLowerCase()).toContain('forbidden');
    expect(ctx.runtimeFindings.join(' ')).toContain('Horizontal scroll overflow');
    expect(ctx.runtimeFindings.join(' ')).toContain('partial');   // honest capture caveat
    // No raw prompt / source leaks.
    expect(`${ctx.planSummary} ${ctx.contractSummary}`).not.toContain('a support tool');
  });
  it('no plan → empty summaries, never throws', () => {
    const ctx = buildVisionReviewContext(undefined, undefined);
    expect(ctx.contractSummary).toBe('');
    expect(ctx.planSummary).toBe('');
    expect(ctx.runtimeFindings).toEqual([]);
  });
});

/* ── Observability artifact honesty (PR #521) ─────────────────────────────────*/
describe('buildRenderedVisionReviewArtifact', () => {
  it('screenshotReviewed is exactly what the caller asserts (honest)', () => {
    const a = buildRenderedVisionReviewArtifact({
      triggered: true, captureSucceeded: true, reviewSucceeded: true, screenshotReviewed: true,
      issueCount: 2, verdict: 'needs-repair', repairTriggered: true, note: 'vision review needs-repair',
    });
    expect(a.version).toBe('rendered-vision-review-artifact-v1');
    expect(a.screenshotReviewed).toBe(true);
    expect(a.issueCount).toBe(2);
  });
  it('a captured-but-not-reviewed screenshot does NOT claim screenshotReviewed', () => {
    const a = buildRenderedVisionReviewArtifact({
      triggered: true, captureSucceeded: true, reviewSucceeded: false, screenshotReviewed: false,
      issueCount: 0, repairTriggered: false, note: 'vision call returned no usable review',
    });
    expect(a.captureSucceeded).toBe(true);
    expect(a.screenshotReviewed).toBe(false);
  });
});

/* ── Backend caller + producer factory (PR #521) ──────────────────────────────*/
describe('createVisionReviewProducer / requestRenderedVisionReview', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('flag off → no producer (byte-for-byte: pipeline gets nothing)', () => {
    expect(createVisionReviewProducer('run-1')).toBeUndefined();
  });
  it('flag off → requestRenderedVisionReview never calls the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await requestRenderedVisionReview('run-1', { capturedScreenshot: shot(), contractSummary: '', planSummary: '', runtimeFindings: [] });
    expect(out).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('flag on + ok envelope → returns the raw review', async () => {
    ON();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { ok: true, review: { verdict: 'pass' } } }) })));
    const out = await requestRenderedVisionReview('run-1', { capturedScreenshot: shot(), contractSummary: 'c', planSummary: 'p', runtimeFindings: ['x'] });
    expect(out).toEqual({ verdict: 'pass' });
    expect(createVisionReviewProducer('run-1')).toBeTypeOf('function');
  });
  it('flag on + fail-open envelope (ok:false) → undefined', async () => {
    ON();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { ok: false, review: null } }) })));
    expect(await requestRenderedVisionReview('run-1', { capturedScreenshot: shot(), contractSummary: '', planSummary: '', runtimeFindings: [] })).toBeUndefined();
  });
  it('flag on + non-200 → undefined (fail-open)', async () => {
    ON();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await requestRenderedVisionReview('run-1', { capturedScreenshot: shot(), contractSummary: '', planSummary: '', runtimeFindings: [] })).toBeUndefined();
  });
  it('flag on + network throw → undefined (never blocks the build)', async () => {
    ON();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await requestRenderedVisionReview('run-1', { capturedScreenshot: shot(), contractSummary: '', planSummary: '', runtimeFindings: [] })).toBeUndefined();
  });
});
