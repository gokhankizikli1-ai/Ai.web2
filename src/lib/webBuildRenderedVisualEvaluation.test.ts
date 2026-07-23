/**
 * Tests — Rendered Visual Evaluation (PR #516).
 *
 * The evaluator is a pure, deterministic, fail-open function over caller-measured screenshot
 * metadata + the existing static visual evaluation. Covers successful evaluation, evaluator
 * failure fallback, empty screenshot handling, and the repair-integration adapter.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  evaluateRenderedVisual, renderedIssuesToReviewIssues, isRenderedVisualEvaluationEnabled,
} from '@/lib/webBuildRenderedVisualEvaluation';
import type {
  FrontendGeneratedFile, FrontendBuildSpecification, RenderedVisualEvaluationArtifact,
  RenderedScreenshotMeta,
} from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function file(content: string, path = 'App.tsx'): FrontendGeneratedFile {
  return { path, language: 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}
function shot(over: Partial<RenderedScreenshotMeta> = {}): RenderedScreenshotMeta {
  return { viewport: 'desktop', width: 1280, height: 800, ...over };
}
// A spec whose plan expects photography, so the reused static evaluation can fire.
function spec(): FrontendBuildSpecification {
  return {
    experienceArchitecture: {
      version: 'experience-arch-v1', basis: 'derived', experienceType: 'atmosphere-editorial',
      entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero', heroContentPriority: 'media',
      textDensity: 'medium', primaryVisualMedium: 'photography', sectionSequence: [], sectionContracts: [],
      forbiddenPatterns: [], userDirectives: [],
    },
    researchEvidence: { didUseRealSources: false },
  } as unknown as FrontendBuildSpecification;
}

// The reused static visual evaluation is itself flag-gated at the wrapper, but the rendered
// evaluator calls its flag-INDEPENDENT core — so these tests need only the rendered path.
afterEach(() => vi.unstubAllEnvs());

/* ── Flag ─────────────────────────────────────────────────────────────────────*/
describe('feature flag', () => {
  it('flag governs the pipeline, not the pure evaluator; default off', () => {
    expect(isRenderedVisualEvaluationEnabled()).toBe(false);
  });
});

/* ── Successful evaluation ────────────────────────────────────────────────────*/
describe('successful evaluation', () => {
  it('clean metadata measurements → runtimeReviewed true, screenshotReviewed FALSE (no pixels)', () => {
    const files = [file('<section data-id="hero"><img src="/a.jpg" alt="x"/><h1 class="text-6xl">Dine</h1></section>')];
    const r = evaluateRenderedVisual({ screenshots: [shot(), shot({ viewport: 'mobile', width: 390, height: 844 })], files, spec: spec(), runtimeCompiled: true });
    expect(r.version).toBe('rendered-visual-eval-v1');
    // Metadata-only measurements are NOT a screenshot review (honesty).
    expect(r.screenshotReviewed).toBe(false);
    expect(r.runtimeReviewed).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('a captured image → screenshotReviewed true', () => {
    const files = [file('<section data-id="hero"><img src="/a.jpg" alt="x"/><h1 class="text-6xl">Dine</h1></section>')];
    const r = evaluateRenderedVisual({ screenshots: [shot({ image: 'data:image/png;base64,AAAA' })], files, spec: spec() });
    expect(r.screenshotReviewed).toBe(true);
  });

  it('mobile horizontal overflow → high mobile-readiness issue, not passed', () => {
    const files = [file('<section><img src="/a.jpg"/></section>')];
    const r = evaluateRenderedVisual({ screenshots: [shot({ viewport: 'mobile', width: 390, height: 844, horizontalOverflow: true })], files, spec: spec() });
    const dims = r.issues.map((i) => i.dimension);
    expect(dims).toContain('mobile-readiness');
    expect(r.issues.some((i) => i.severity === 'high')).toBe(true);
    expect(r.passed).toBe(false);
  });

  it('blank capture → high composition issue', () => {
    const r = evaluateRenderedVisual({ screenshots: [shot({ blank: true })], files: [file('<div/>')], spec: spec() });
    expect(r.issues.map((i) => i.code)).toContain('rendered-blank');
    expect(r.passed).toBe(false);
  });

  it('reuses the static visual evaluation: missing imagery + template pattern surface as dimensions', () => {
    const card = '<div class="rounded-2xl border p-6">c</div>';
    const files = [file(`<section data-id="hero"><h1>Text only</h1></section><section class="grid grid-cols-3">${card}${card}${card}</section>`)];
    const r = evaluateRenderedVisual({ screenshots: [shot()], files, spec: spec() });
    const dims = r.issues.map((i) => i.dimension);
    expect(dims).toContain('composition');        // missing-visual-assets → composition
    expect(dims).toContain('template-pattern');   // repeated-template-pattern
    expect(dims).toContain('visual-uniqueness');  // derived from template-pattern
  });

  it('deterministic / repeatable', () => {
    const input = { screenshots: [shot({ horizontalOverflow: true, viewport: 'mobile' as const })], files: [file('<div/>')], spec: spec() };
    expect(evaluateRenderedVisual(input)).toEqual(evaluateRenderedVisual(input));
  });
});

/* ── Empty screenshot handling ────────────────────────────────────────────────*/
describe('empty screenshot handling', () => {
  it('no screenshots → screenshotReviewed false, but still evaluates the files (advisory)', () => {
    // Clean files (real imagery + strong heading) → no static findings → passes.
    const clean = [file('<section data-id="hero"><img src="/a.jpg" alt="x"/><h1 class="text-6xl">Dine</h1></section><section data-id="menu"><img src="/b.jpg" alt="y"/></section>')];
    const r = evaluateRenderedVisual({ files: clean, spec: spec() });
    expect(r.screenshotReviewed).toBe(false);
    expect(r.passed).toBe(true);
  });

  it('no input at all → safe passing artifact', () => {
    const r = evaluateRenderedVisual(undefined);
    expect(r.passed).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.screenshotReviewed).toBe(false);
  });

  it('empty screenshots array + no files → safe pass', () => {
    const r = evaluateRenderedVisual({ screenshots: [], files: [] });
    expect(r.passed).toBe(true);
    expect(r.screenshotReviewed).toBe(false);
  });
});

/* ── Evaluator failure fallback ───────────────────────────────────────────────*/
describe('evaluator failure fallback', () => {
  it('never throws on malformed screenshot entries', () => {
    const bad = { screenshots: [null, 42, { viewport: 'mobile' }] as never, files: [file('<div/>')], spec: spec() };
    expect(() => evaluateRenderedVisual(bad)).not.toThrow();
    const r = evaluateRenderedVisual(bad);
    expect(r.version).toBe('rendered-visual-eval-v1');
  });

  it('malformed files do not throw (fail-open safe artifact)', () => {
    const bad = { screenshots: [shot()], files: 'nope' as never };
    expect(() => evaluateRenderedVisual(bad)).not.toThrow();
  });
});

/* ── Repair integration adapter ───────────────────────────────────────────────*/
describe('repair integration (renderedIssuesToReviewIssues)', () => {
  it('maps HIGH rendered issues to review issues (major, mapped category) for the existing repair', () => {
    const artifact: RenderedVisualEvaluationArtifact = {
      version: 'rendered-visual-eval-v1', score: 40, passed: false, screenshotReviewed: true, runtimeReviewed: false,
      issues: [
        { code: 'rendered-horizontal-overflow', dimension: 'mobile-readiness', severity: 'high', message: 'overflow', suggestion: 'fix widths' },
        { code: 'weak-hierarchy', dimension: 'typography', severity: 'medium', message: 'flat', suggestion: 'add scale' },
      ],
    };
    const reviewIssues = renderedIssuesToReviewIssues(artifact);
    const mobile = reviewIssues.find((i) => i.category === 'responsive-intent');
    expect(mobile).toBeDefined();
    expect(mobile!.severity).toBe('major');       // HIGH → major, drives the existing repair
    expect(mobile!.id.startsWith('rendered:')).toBe(true);
    const typo = reviewIssues.find((i) => i.category === 'typography');
    expect(typo!.severity).toBe('minor');         // non-high → minor (advisory, non-blocking)
  });

  it('dedups by category (one issue per review category)', () => {
    const artifact: RenderedVisualEvaluationArtifact = {
      version: 'rendered-visual-eval-v1', score: 50, passed: false, screenshotReviewed: true, runtimeReviewed: false,
      issues: [
        { code: 'a', dimension: 'composition', severity: 'high', message: 'm', suggestion: 's' },
        { code: 'b', dimension: 'spacing', severity: 'high', message: 'm', suggestion: 's' }, // also → layout-rhythm
      ],
    };
    const reviewIssues = renderedIssuesToReviewIssues(artifact);
    expect(reviewIssues.filter((i) => i.category === 'layout-rhythm').length).toBe(1);
  });

  it('empty / wrong-version artifact → no review issues', () => {
    expect(renderedIssuesToReviewIssues(undefined)).toEqual([]);
    expect(renderedIssuesToReviewIssues({ version: 'x' } as never)).toEqual([]);
  });
});
