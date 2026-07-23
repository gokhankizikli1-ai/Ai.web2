/**
 * Tests — Visual Evaluation Layer (PR #514).
 *
 * Deterministic, static, SUGGESTIONS-ONLY evaluation of the generated frontend-files-v1 source
 * (no model call). Covers each detector, intent-awareness (never fights minimal design),
 * flag-off behaviour and fail-open.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { evaluateVisualQuality, isVisualEvaluationEnabled } from '@/lib/webBuildVisualEvaluation';
import type {
  FrontendGeneratedFile, FrontendBuildSpecification, ExperienceArchitecturePlan,
} from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function file(content: string, path = 'App.tsx'): FrontendGeneratedFile {
  return { path, language: path.endsWith('.css') ? 'css' : 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}

function plan(over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType: 'atmosphere-editorial',
    entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero', heroContentPriority: 'media',
    textDensity: 'medium', primaryVisualMedium: 'photography', sectionSequence: [], sectionContracts: [],
    forbiddenPatterns: [], userDirectives: [], ...over,
  };
}

function spec(p?: ExperienceArchitecturePlan): FrontendBuildSpecification {
  return { experienceArchitecture: p } as unknown as FrontendBuildSpecification;
}

const ON = () => vi.stubEnv('VITE_ENABLE_VISUAL_EVALUATION', 'true');
afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating + fail open ──────────────────────────────────────────────────*/
describe('feature flag / fail open', () => {
  it('off by default → returns undefined', () => {
    expect(isVisualEvaluationEnabled()).toBe(false);
    expect(evaluateVisualQuality([file('<div/>')], spec(plan()))).toBeUndefined();
  });

  it('no files → undefined; malformed input → no throw', () => {
    ON();
    expect(evaluateVisualQuality([], spec(plan()))).toBeUndefined();
    expect(() => evaluateVisualQuality(undefined as never, spec(plan()))).not.toThrow();
  });

  it('always returns the six typed arrays when enabled', () => {
    ON();
    const r = evaluateVisualQuality([file('<section><h1>Hi</h1></section>')], spec(plan()))!;
    expect(r.version).toBe('visual-evaluation-v1');
    for (const k of ['overallIssues', 'layoutIssues', 'visualIssues', 'uxIssues', 'mobileIssues'] as const) {
      expect(Array.isArray(r[k])).toBe(true);
    }
    expect(Array.isArray(r.priorityFixes)).toBe(true);
  });
});

/* ── Detectors ────────────────────────────────────────────────────────────────*/
describe('detectors', () => {
  it('hero imbalance + missing visual assets when photography was expected but none rendered', () => {
    ON();
    const src = '<section><h1>Fine Dining</h1><p>Welcome</p></section>';
    const r = evaluateVisualQuality([file(src)], spec(plan({ primaryVisualMedium: 'photography' })))!;
    const codes = r.visualIssues.map((i) => i.code);
    expect(codes).toContain('missing-visual-assets');
    expect(codes).toContain('hero-imbalance');
    expect(r.priorityFixes.length).toBeGreaterThan(0);
  });

  it('repeated AI template pattern (3-col identical cards)', () => {
    ON();
    const card = '<div class="rounded-2xl border border-slate-200 p-6">card</div>';
    const src = `<section class="grid grid-cols-3">${card}${card}${card}</section><img src="x"/>`;
    const r = evaluateVisualQuality([file(src)], spec(plan()))!;
    expect(r.overallIssues.map((i) => i.code)).toContain('repeated-template-pattern');
  });

  it('mobile overflow risk (fixed wide width / non-responsive grid)', () => {
    ON();
    const src = '<div class="w-[1200px]"><div class="grid grid-cols-6">x</div></div><img src="a"/>';
    const r = evaluateVisualQuality([file(src)], spec(plan()))!;
    expect(r.mobileIssues.map((i) => i.code)).toContain('mobile-overflow-risk');
  });

  it('unnecessary animations when a low-motion design was intended', () => {
    ON();
    const src = '<img src="a"/>' + Array.from({ length: 7 }, (_, i) => `<div class="animate-pulse motion.div transition-all">${i}</div>`).join('');
    const p = plan({ motionStrategy: { version: 'motion-strategy-v1', basis: 'derived', motionLevel: 'subtle', interactionStyle: 'hover', heroMotion: 'fade', transitionStyle: 'smooth', avoidMotion: [], userDirectives: [] } });
    const r = evaluateVisualQuality([file(src)], spec(p))!;
    expect(r.overallIssues.map((i) => i.code)).toContain('unnecessary-animation');
  });

  it('every issue is a suggestion (has a non-empty suggestion, never an edit)', () => {
    ON();
    const r = evaluateVisualQuality([file('<section><h1>x</h1></section>')], spec(plan()))!;
    const allIssues = [...r.overallIssues, ...r.layoutIssues, ...r.visualIssues, ...r.uxIssues, ...r.mobileIssues];
    for (const i of allIssues) {
      expect(i.suggestion.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(i.severity);
    }
  });
});

/* ── Intent-awareness (never fight good minimal design / user request) ────────*/
describe('intent awareness', () => {
  it('does NOT flag excessive whitespace or missing images for an intentionally minimal design', () => {
    ON();
    const src = '<section class="py-32"><h1>Minimal</h1></section><section class="py-40"><p>calm</p></section>';
    const minimal = plan({
      textDensity: 'low', primaryVisualMedium: 'typography',
      assetStrategy: { version: 'asset-strategy-v1', basis: 'user-override', heroAsset: 'none', sectionAssets: [], assetSourcePreference: 'mixed', visualAuthenticity: 'abstract', avoidAssets: [], mediaPriority: 'storytelling', userDirectives: ['No images / text-only'] },
      userDirectives: ['Minimal'],
    });
    const r = evaluateVisualQuality([file(src)], spec(minimal))!;
    const codes = [...r.visualIssues, ...r.layoutIssues].map((i) => i.code);
    expect(codes).not.toContain('missing-visual-assets');
    expect(codes).not.toContain('excessive-whitespace');
  });

  it('does NOT ask for a hero CTA when the plan is app-first / no landing', () => {
    ON();
    const src = '<section><h2>Dashboard</h2></section><section><button>Act</button></section><img src="a"/>';
    const appFirst = plan({ landingRequired: false, entryPattern: 'app-first', heroContentPriority: 'interaction' });
    const r = evaluateVisualQuality([file(src)], spec(appFirst))!;
    expect(r.uxIssues.map((i) => i.code)).not.toContain('cta-placement');
  });

  it('no plan → only conservative checks (no intent-driven false positives)', () => {
    ON();
    const src = '<section class="py-32"><h1>Hi</h1></section>';
    const r = evaluateVisualQuality([file(src)], spec(undefined))!;
    // expectsImages is false with no plan → no missing-assets / hero-imbalance.
    const codes = r.visualIssues.map((i) => i.code);
    expect(codes).not.toContain('missing-visual-assets');
    expect(codes).not.toContain('hero-imbalance');
  });
});

/* ── Determinism ──────────────────────────────────────────────────────────────*/
describe('determinism', () => {
  it('repeatable', () => {
    ON();
    const files = [file('<section class="grid grid-cols-3"><div class="rounded-2xl border p-6">a</div></section>')];
    expect(evaluateVisualQuality(files, spec(plan()))).toEqual(evaluateVisualQuality(files, spec(plan())));
  });
});
