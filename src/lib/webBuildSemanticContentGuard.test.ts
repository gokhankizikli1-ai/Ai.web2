/**
 * Tests — Semantic Content Guard (PR #515).
 *
 * Deterministic, static, SUGGESTIONS-ONLY check of whether generated sections carry meaningful
 * semantic value vs decorative filler (no model call). Covers detectors, per-business proof
 * coverage, intent-awareness (minimal sites stay valid; whitespace not punished), flag-off and
 * fail-open.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { evaluateSemanticContent, isSemanticContentGuardEnabled } from '@/lib/webBuildSemanticContentGuard';
import type {
  FrontendGeneratedFile, FrontendBuildSpecification, ExperienceArchitecturePlan,
  ExperienceSectionContract, LayoutStrategy,
} from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function file(content: string, path = 'App.tsx'): FrontendGeneratedFile {
  return { path, language: path.endsWith('.css') ? 'css' : 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}

function section(id: string, proof = false): ExperienceSectionContract {
  return { id, purpose: `${id} purpose`, requiredContent: [], visualMedium: 'photography', textDensity: 'medium', ...(proof ? { proofRequirement: 'real proof' } : {}) };
}

function plan(over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType: 'catalog-commerce',
    entryPattern: 'product-first', landingRequired: true, heroPattern: 'hero', heroContentPriority: 'catalog',
    textDensity: 'medium', primaryVisualMedium: 'photography', sectionSequence: [], sectionContracts: [],
    forbiddenPatterns: [], userDirectives: [], ...over,
  };
}

function layout(pageStructure: LayoutStrategy['pageStructure'], contentDensity: LayoutStrategy['contentDensity'] = 'balanced'): LayoutStrategy {
  return { version: 'layout-strategy-v1', basis: 'derived', pageStructure, sectionFlow: [], heroStyle: 'minimal', contentDensity, avoidPatterns: [], userDirectives: [] };
}

function spec(p?: ExperienceArchitecturePlan, didUseRealSources = false): FrontendBuildSpecification {
  return { experienceArchitecture: p, researchEvidence: { didUseRealSources } } as unknown as FrontendBuildSpecification;
}

const ON = () => vi.stubEnv('VITE_ENABLE_SEMANTIC_CONTENT_GUARD', 'true');
afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating + fail open ──────────────────────────────────────────────────*/
describe('feature flag / fail open', () => {
  it('off by default → undefined', () => {
    expect(isSemanticContentGuardEnabled()).toBe(false);
    expect(evaluateSemanticContent([file('<div/>')], spec(plan()))).toBeUndefined();
  });

  it('no files → undefined; malformed → no throw', () => {
    ON();
    expect(evaluateSemanticContent([], spec(plan()))).toBeUndefined();
    expect(() => evaluateSemanticContent(undefined as never, spec(plan()))).not.toThrow();
  });

  it('typed shape when enabled', () => {
    ON();
    const r = evaluateSemanticContent([file('<section><h1>Hi</h1></section>')], spec(plan()))!;
    expect(r.version).toBe('semantic-content-v1');
    expect(Array.isArray(r.sectionFindings)).toBe(true);
    expect(['meaningful', 'acceptable', 'weak']).toContain(r.contentQuality);
    expect(['strong', 'partial', 'missing']).toContain(r.proofCoverage);
    expect(typeof r.genericPatternDetected).toBe('boolean');
  });
});

/* ── Detectors ────────────────────────────────────────────────────────────────*/
describe('detectors', () => {
  it('placeholder content', () => {
    ON();
    const p = plan({ sectionContracts: [section('about')] });
    const r = evaluateSemanticContent([file('<section data-id="about"><h2>About</h2><p>Lorem ipsum dolor sit amet placeholder</p></section>')], spec(p))!;
    expect(r.sectionFindings.map((f) => f.issueType)).toContain('placeholder-content');
  });

  it('decorative proof (skeleton where real proof required)', () => {
    ON();
    const p = plan({ sectionContracts: [section('stats', true)] });
    const src = '<section data-id="stats"><div class="animate-pulse h-6 w-24"></div><div class="animate-pulse h-6 w-24"></div></section>';
    const r = evaluateSemanticContent([file(src)], spec(p))!;
    const f = r.sectionFindings.find((x) => x.issueType === 'decorative-proof');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
  });

  it('generic feature cards without evidence + genericPatternDetected', () => {
    ON();
    const card = '<div class="rounded-2xl border border-slate-200 p-6"><h3>Fast</h3><p>Very fast</p></div>';
    const src = `<section class="grid grid-cols-3">${card}${card}${card}</section>`;
    const r = evaluateSemanticContent([file(src)], spec(plan({ sectionContracts: [] })))!;
    expect(r.sectionFindings.map((f) => f.issueType)).toContain('generic-feature-cards');
    expect(r.genericPatternDetected).toBe(true);
  });

  it('fake statistics when there is no real source behind the build', () => {
    ON();
    const src = '<section><h2>10,000+ customers and 99% uptime</h2></section>';
    const r = evaluateSemanticContent([file(src)], spec(plan(), /*didUseRealSources*/ false))!;
    expect(r.sectionFindings.map((f) => f.issueType)).toContain('fake-statistics');
  });

  it('every finding is a suggestion (non-empty suggestion + valid severity)', () => {
    ON();
    const p = plan({ sectionContracts: [section('about')] });
    const r = evaluateSemanticContent([file('<section data-id="about"><h2>About</h2><p>lorem ipsum</p></section>')], spec(p))!;
    for (const f of r.sectionFindings) {
      expect(f.suggestion.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(f.severity);
    }
  });
});

/* ── Per-business proof coverage ──────────────────────────────────────────────*/
describe('business proof coverage', () => {
  it('ecommerce with no product proof → missing/partial + missing-business-proof', () => {
    ON();
    const r = evaluateSemanticContent([file('<section><h1>Welcome to our brand</h1><p>We are great</p></section>')], spec(plan({ experienceType: 'catalog-commerce' })))!;
    expect(['partial', 'missing']).toContain(r.proofCoverage);
    expect(r.sectionFindings.map((f) => f.issueType)).toContain('missing-business-proof');
  });

  it('ecommerce WITH price + variants + trust → strong, no missing-proof finding', () => {
    ON();
    const src = '<section><h1>Sneakers</h1><p>Price $120</p><p>Sizes: 8, 9, 10 — color options</p><p>4.8 rating, 30-day returns, secure checkout</p><img src="a"/></section>';
    const r = evaluateSemanticContent([file(src)], spec(plan({ experienceType: 'catalog-commerce' })))!;
    expect(r.proofCoverage).toBe('strong');
    expect(r.sectionFindings.map((f) => f.issueType)).not.toContain('missing-business-proof');
  });

  it('dashboard/app → marketing sections flagged as unnecessary; proof coverage strong (app proves itself)', () => {
    ON();
    const p = plan({ experienceType: 'product-demonstration', layoutStrategy: layout('application') });
    const src = '<section>Trusted by 100 companies</section><section>Pricing plan</section><section><button>Open workspace</button></section>';
    const r = evaluateSemanticContent([file(src)], spec(p))!;
    expect(r.sectionFindings.map((f) => f.issueType)).toContain('unnecessary-section');
    expect(r.proofCoverage).toBe('strong');
  });
});

/* ── Intent awareness (never force content / punish whitespace) ───────────────*/
describe('intent awareness', () => {
  it('minimal design → spare section NOT flagged empty, not called weak for being spare', () => {
    ON();
    const p = plan({ experienceType: 'work-showcase', textDensity: 'low', layoutStrategy: layout('showcase', 'minimal'), userDirectives: ['Minimal'], sectionContracts: [section('hero')] });
    const r = evaluateSemanticContent([file('<section data-id="hero"><h1>Jane Doe</h1></section>')], spec(p))!;
    expect(r.sectionFindings.map((f) => f.issueType)).not.toContain('empty-marketing-section');
    expect(r.sectionFindings.map((f) => f.issueType)).not.toContain('missing-business-proof');
    expect(r.contentQuality).not.toBe('weak');
  });

  it('no plan → conservative: still returns a report, no per-section/proof false positives', () => {
    ON();
    const r = evaluateSemanticContent([file('<section class="py-32"><h1>Hi</h1></section>')], spec(undefined))!;
    expect(r.version).toBe('semantic-content-v1');
    expect(r.sectionFindings.map((f) => f.issueType)).not.toContain('missing-business-proof');
  });
});

/* ── Determinism ──────────────────────────────────────────────────────────────*/
describe('determinism', () => {
  it('repeatable', () => {
    ON();
    const files = [file('<section class="grid grid-cols-3"><div class="rounded-2xl border p-6"><h3>x</h3></div></section>')];
    expect(evaluateSemanticContent(files, spec(plan()))).toEqual(evaluateSemanticContent(files, spec(plan())));
  });
});
