/**
 * Tests — Preview Measurement Producer (PR #517).
 *
 * The producer core is pure/deterministic/fail-open and drives an injected transport, so
 * timing/stale/cancel/fail-open are all unit-testable without a live browser. Covers the
 * required scenarios: successful desktop+mobile measurement, compile failure, blank, overflow,
 * whitespace, CTA/hero/app-first contract signals, timeout fail-open, stale-run ignored,
 * invalid message ignored, flag-off zero work, missing bridge, feeding the #516 evaluator, and
 * repair-only-on-high — plus acceptance honesty (screenshotReviewed stays false, no pixels).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  produceRenderedVisualInput, buildRenderedVisualInput, deriveMeasureExpectations,
  isPreviewMeasurementEnabled, isRenderedVisualEvaluationEnabled,
  type PreviewMeasurementTransport,
} from '@/lib/webBuildPreviewMeasurement';
import { sanitizeMeasurement } from '@/lib/visualEditProtocol';
import { evaluateRenderedVisual, renderedIssuesToReviewIssues } from '@/lib/webBuildRenderedVisualEvaluation';
import type { VeMeasurement } from '@/lib/visualEditProtocol';
import type { ExperienceArchitecturePlan } from '@/lib/webBuildAgents';

const RUN = 'run-123';

function meas(over: Partial<VeMeasurement> = {}): VeMeasurement {
  return {
    viewport: 'desktop', runId: RUN, width: 1440, height: 900, contentHeight: 2400,
    horizontalOverflow: false, whitespaceRatio: 0.4, blank: false, runtimeCompiled: true, runtimeError: false,
    ...over,
  };
}
function plan(over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType: 'atmosphere-editorial',
    entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero', heroContentPriority: 'media',
    textDensity: 'medium', primaryVisualMedium: 'photography', sectionSequence: [], sectionContracts: [],
    forbiddenPatterns: [], userDirectives: [], ...over,
  };
}
/** A transport that answers each viewport from a provided map, else null (unavailable). */
function transportFrom(map: Partial<Record<string, VeMeasurement | null>>): PreviewMeasurementTransport {
  return { measure: async (req) => (req.viewport in map ? map[req.viewport]! : null) };
}

afterEach(() => vi.unstubAllEnvs());

/* ── 11. Feature flags off = zero work ────────────────────────────────────────*/
describe('feature flags', () => {
  it('both flags default off', () => {
    expect(isPreviewMeasurementEnabled()).toBe(false);
    expect(isRenderedVisualEvaluationEnabled()).toBe(false);
  });
});

/* ── 1. Successful desktop + mobile measurement ───────────────────────────────*/
describe('successful measurement', () => {
  it('produces a RenderedVisualInput with both viewports and runtimeCompiled true', async () => {
    const t = transportFrom({ desktop: meas({ viewport: 'desktop' }), mobile: meas({ viewport: 'mobile', width: 390, height: 844 }) });
    const input = await produceRenderedVisualInput({ transport: t, runId: RUN, plan: plan() });
    if (!input) throw new Error('expected a produced input');
    expect((input.screenshots ?? []).map((s) => s.viewport).sort()).toEqual(['desktop', 'mobile']);
    expect(input.runtimeCompiled).toBe(true);
    // No pixels captured → the input carries no image, so #516 keeps screenshotReviewed false.
    expect((input.screenshots ?? []).every((s) => !s.image)).toBe(true);
  });
});

/* ── 2. Runtime compile failure ───────────────────────────────────────────────*/
describe('runtime compile failure', () => {
  it('runtimeError → runtimeCompiled false and #516 emits a high runtime-error finding', async () => {
    const t = transportFrom({ desktop: meas({ runtimeCompiled: false, runtimeError: true }) });
    const input = await produceRenderedVisualInput({ transport: t, runId: RUN, plan: plan() });
    expect(input!.runtimeCompiled).toBe(false);
    const r = evaluateRenderedVisual(input);
    expect(r.issues.map((i) => i.code)).toContain('rendered-runtime-error');
    expect(r.passed).toBe(false);
  });
});

/* ── 3/4/5. Blank / overflow / whitespace ─────────────────────────────────────*/
describe('layout signals', () => {
  it('blank page → high composition', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ blank: true }) }), runId: RUN, plan: plan() });
    expect(evaluateRenderedVisual(input).issues.map((i) => i.code)).toContain('rendered-blank');
  });
  it('mobile horizontal overflow → high mobile-readiness', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ mobile: meas({ viewport: 'mobile', width: 390, height: 844, horizontalOverflow: true }) }), runId: RUN, plan: plan() });
    const r = evaluateRenderedVisual(input);
    expect(r.issues.some((i) => i.dimension === 'mobile-readiness' && i.severity === 'high')).toBe(true);
  });
  it('excessive whitespace → spacing finding', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ whitespaceRatio: 0.92 }) }), runId: RUN, plan: plan() });
    expect(evaluateRenderedVisual(input).issues.map((i) => i.dimension)).toContain('spacing');
  });
});

/* ── 6/7. CTA + hero + app-first contract (runtime DOM facts) ──────────────────*/
describe('layout-contract signals', () => {
  it('CTA not in first viewport → cta-visibility finding', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ ctaInFirstViewport: false }) }), runId: RUN, plan: plan() });
    expect(evaluateRenderedVisual(input).issues.map((i) => i.dimension)).toContain('cta-visibility');
  });
  it('hero required but not visible → high hero-impact finding', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ heroVisible: false }) }), runId: RUN, plan: plan() });
    const r = evaluateRenderedVisual(input);
    expect(r.issues.some((i) => i.code === 'rendered-hero-missing' && i.severity === 'high')).toBe(true);
  });
  it('app-first plan with a marketing hero → high template-pattern finding', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ marketingHeroOnAppFirst: true }) }), runId: RUN, plan: plan({ landingRequired: false, entryPattern: 'app-first' }) });
    expect(evaluateRenderedVisual(input).issues.map((i) => i.code)).toContain('rendered-marketing-hero-on-app');
  });
  it('derives plan expectations correctly', () => {
    expect(deriveMeasureExpectations(plan())).toEqual({ expectHero: true, expectCta: true, appFirst: false });
    expect(deriveMeasureExpectations(plan({ landingRequired: false }))).toEqual({ expectHero: false, expectCta: false, appFirst: true });
  });
});

/* ── 8. Timeout / unavailable fail-open ───────────────────────────────────────*/
describe('timeout / unavailable fail-open', () => {
  it('transport that never answers → undefined (no measurement), never throws', async () => {
    const t: PreviewMeasurementTransport = { measure: async () => null };
    const input = await produceRenderedVisualInput({ transport: t, runId: RUN, plan: plan() });
    expect(input).toBeUndefined();
  });
  it('transport that throws → fail-open undefined', async () => {
    const t: PreviewMeasurementTransport = { measure: async () => { throw new Error('boom'); } };
    await expect(produceRenderedVisualInput({ transport: t, runId: RUN, plan: plan() })).resolves.toBeUndefined();
  });
  it('already-aborted signal → undefined, no work', async () => {
    const ac = new AbortController(); ac.abort();
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas() }), runId: RUN, plan: plan(), signal: ac.signal });
    expect(input).toBeUndefined();
  });
});

/* ── 9. Stale run ignored ─────────────────────────────────────────────────────*/
describe('stale run safety', () => {
  it('measurements with a different runId are dropped', () => {
    const input = buildRenderedVisualInput([meas({ runId: 'OLD' }), meas({ viewport: 'mobile', runId: RUN })], RUN);
    if (!input) throw new Error('expected a produced input');
    expect((input.screenshots ?? []).map((s) => s.viewport)).toEqual(['mobile']);
  });
  it('all-stale → undefined', () => {
    expect(buildRenderedVisualInput([meas({ runId: 'OLD' })], RUN)).toBeUndefined();
  });
  it('produce drops a stale transport answer (wrong runId) → undefined', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ runId: 'OTHER' }) }), runId: RUN, plan: plan() });
    expect(input).toBeUndefined();
  });
});

/* ── 10. Invalid message ignored ──────────────────────────────────────────────*/
describe('invalid measurement payloads', () => {
  it('sanitizeMeasurement rejects malformed / missing fields', () => {
    expect(sanitizeMeasurement(null)).toBeNull();
    expect(sanitizeMeasurement({ viewport: 'x', runId: 'r', width: 1, height: 1 })).toBeNull();
    expect(sanitizeMeasurement({ viewport: 'desktop', width: 1, height: 1 })).toBeNull(); // no runId
    const ok = sanitizeMeasurement({ viewport: 'mobile', runId: 'r', width: 390, height: 844, whitespaceRatio: 5, horizontalOverflow: true, blank: 'yes' });
    expect(ok).not.toBeNull();
    expect(ok!.whitespaceRatio).toBe(1);       // clamped
    expect(ok!.blank).toBe(false);             // non-boolean → false
    expect(ok!.horizontalOverflow).toBe(true);
  });
});

/* ── 12/13. Missing bridge → old behavior; evaluator receives produced input ───*/
describe('integration', () => {
  it('missing transport answers (bridge unavailable) → undefined (old behavior)', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({}), runId: RUN, plan: plan() });
    expect(input).toBeUndefined();
  });
  it('#516 evaluator consumes the produced input and honesty holds', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ blank: true }) }), runId: RUN, plan: plan() });
    const r = evaluateRenderedVisual(input);
    expect(r.version).toBe('rendered-visual-eval-v1');
    expect(r.screenshotReviewed).toBe(false);  // no pixels captured
    expect(r.runtimeReviewed).toBe(true);       // runtime WAS observed
  });
});

/* ── 14. Existing bounded repair triggered only by high findings ──────────────*/
describe('repair integration', () => {
  it('high produced findings map to major review issues; low do not block', async () => {
    const input = await produceRenderedVisualInput({ transport: transportFrom({ mobile: meas({ viewport: 'mobile', width: 390, height: 844, horizontalOverflow: true }) }), runId: RUN, plan: plan() });
    const r = evaluateRenderedVisual(input);
    const reviewIssues = renderedIssuesToReviewIssues(r);
    expect(reviewIssues.some((i) => i.category === 'responsive-intent' && i.severity === 'major')).toBe(true);
  });
  it('a clean measurement produces a passing eval → no repair-driving issues', async () => {
    const clean = await produceRenderedVisualInput({ transport: transportFrom({ desktop: meas({ heroVisible: true, ctaInFirstViewport: true }) }), runId: RUN, plan: plan() });
    const r = evaluateRenderedVisual(clean);
    expect(r.passed).toBe(true);
    expect(renderedIssuesToReviewIssues(r).every((i) => i.severity !== 'major')).toBe(true);
  });
});
