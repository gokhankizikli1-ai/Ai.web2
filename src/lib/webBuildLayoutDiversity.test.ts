/**
 * Tests — Layout Diversity Intelligence Layer (PR #514).
 *
 * Deterministic derivation of the LayoutStrategy from an already-built ExperienceArchitecture
 * Plan (+ Signature + Asset Strategy) + user prompt (no model call), rule enforcement,
 * explicit-override precedence, flag-off behaviour, fail-open, and integration onto the plan.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  deriveLayoutStrategy, isLayoutDiversityEnabled, layoutStrategyEnforcementLines,
} from '@/lib/webBuildLayoutDiversity';
import { deriveExperienceArchitecturePlan } from '@/lib/webBuildExperienceArchitecture';
import type { ExperienceArchitecturePlan, FrontendBuildSpecification } from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function makePlan(experienceType: string, over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType,
    entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero',
    heroContentPriority: 'content', textDensity: 'medium', primaryVisualMedium: 'mixed',
    sectionSequence: ['hero', 'body'], sectionContracts: [], forbiddenPatterns: [], userDirectives: [], ...over,
  };
}

function makeSpec(over: { prompt?: string; sector?: string } = {}): FrontendBuildSpecification {
  return {
    version: 'frontend-spec-v1', status: 'ready', language: 'en', prompt: over.prompt || '',
    identity: { siteType: 'website', sector: (over.sector as never) || undefined },
    designSystem: { rejectedDirections: [], colorTokens: {}, compositionRules: [], surfaceRules: [], componentStyleRules: [], proofRules: [], responsiveRules: [], accessibilityRules: [], templateTrapsToAvoid: [], mustAvoid: [], differentiationMoves: [] },
    architecture: { navigationModel: 'top', navigationBehavior: 'sticky', conversionJourneyModel: 'lead', primaryCTA: 'Go', demoSurfaces: [], statefulDemoComponents: [], sectionOrder: ['hero', 'body'], sections: ['hero', 'body'].map((id, i) => ({ id, name: id, order: i, purpose: id, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] })) },
    assets: { strategy: '', visualLanguage: '', cssSvgSlots: [], imageSlots: [], motionLayers: [], realSourceRequired: [], aiIllustrativeAllowed: [], forbiddenGenerated: [], honestyConstraints: [] },
    researchEvidence: { status: 'not-run', didUseRealSources: false, sources: [], sourceBackedInsights: [], audienceExpectations: [], conversionPatterns: [], trustSignals: [], visualPatterns: [], risksToAvoid: [], differentiationOpportunities: [] },
    outputContract: { format: 'frontend-files-v1', framework: 'react', language: 'typescript', styling: 'tailwind-css', requiredFiles: [], recommendedFiles: [], requiredSectionComponentFiles: [], allowedExtensions: ['tsx', 'ts', 'css'], requirements: [], forbiddenPatterns: [], successCriteria: [] },
    honestyRules: [], sourceTrace: [], missingInputs: [], warnings: [], generation: { status: 'not-run', reason: '' }, summary: '',
  } as unknown as FrontendBuildSpecification;
}

const ON = () => vi.stubEnv('VITE_ENABLE_LAYOUT_DIVERSITY', 'true');
const ARCH_ON = () => vi.stubEnv('VITE_ENABLE_EXPERIENCE_ARCHITECTURE', 'true');

afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating ──────────────────────────────────────────────────────────────*/
describe('feature flag', () => {
  it('off by default → derives nothing', () => {
    expect(isLayoutDiversityEnabled()).toBe(false);
    expect(deriveLayoutStrategy(makePlan('atmosphere-editorial'), 'a restaurant')).toBeUndefined();
  });

  it('enforcement lines empty with no strategy (prompt byte-for-byte)', () => {
    expect(layoutStrategyEnforcementLines(undefined)).toEqual([]);
  });
});

/* ── The generic stack is never the default ───────────────────────────────────*/
describe('never the generic AI landing template', () => {
  it('always lists the generic hero/features/cards/CTA stack as an avoid, with a business flow', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('atmosphere-editorial'), 'a restaurant')!;
    const avoid = st.avoidPatterns.join(' ').toLowerCase();
    expect(avoid).toContain('hero');
    expect(avoid).toContain('cta');
    expect(avoid).toContain('card');
    // The section flow is business-specific, not the generic stack.
    expect(st.sectionFlow).not.toContain('features');
    expect(st.sectionFlow.length).toBeGreaterThan(2);
  });
});

/* ── Business type changes structure ──────────────────────────────────────────*/
describe('business type changes structure', () => {
  it('SaaS → product_first + product_demo (prioritises product demonstration)', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('product-demonstration'), 'A SaaS analytics platform')!;
    expect(st.pageStructure).toBe('product_first');
    expect(st.heroStyle).toBe('product_demo');
  });

  it('ecommerce → product_first', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('catalog-commerce'), 'An online store')!;
    expect(st.pageStructure).toBe('product_first');
  });

  it('portfolio → showcase', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('work-showcase'), 'A portfolio')!;
    expect(st.pageStructure).toBe('showcase');
  });

  it('finance → conversion/narrative (not editorial), no cyberpunk', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('trust-clarity'), 'A retail bank')!;
    expect(['conversion', 'narrative']).toContain(st.pageStructure);
  });

  it('two different businesses get different structures', () => {
    ON();
    const saas = deriveLayoutStrategy(makePlan('product-demonstration'), 'A SaaS tool')!;
    const resto = deriveLayoutStrategy(makePlan('atmosphere-editorial'), 'A restaurant')!;
    expect(saas.pageStructure).not.toBe(resto.pageStructure);
    expect(saas.sectionFlow).not.toEqual(resto.sectionFlow);
  });
});

/* ── Rules ────────────────────────────────────────────────────────────────────*/
describe('rules', () => {
  it('dashboard / app → application layout, NOT a marketing landing', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('product-demonstration'), 'An internal analytics dashboard app interface')!;
    expect(st.pageStructure).toBe('application');
    expect(st.avoidPatterns.join(' ').toLowerCase()).toContain('marketing landing');
    expect(st.sectionFlow).toContain('app-shell');
    expect(st.basis).toBe('user-override');
  });

  it('app-first plan (no landing) → application even without a keyword', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('product-demonstration', { landingRequired: false, entryPattern: 'app-first' }), 'A tool')!;
    expect(st.pageStructure).toBe('application');
  });

  it('luxury → editorial/showcase structure', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('trust-clarity'), 'A luxury private bank')!;
    expect(['editorial', 'showcase']).toContain(st.pageStructure);
    expect(st.heroStyle).toBe('editorial');
  });

  it('explicit user intent overrides (product-first on a normally editorial class)', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('content-editorial'), 'A magazine but product-first please')!;
    expect(st.pageStructure).toBe('product_first');
  });

  it('content density follows the plan text density', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('work-showcase', { textDensity: 'low' }), 'A portfolio')!;
    expect(st.contentDensity).toBe('minimal');
  });
});

/* ── Enforcement lines ────────────────────────────────────────────────────────*/
describe('enforcement lines', () => {
  it('describe the layout with no scores/reasoning leaked', () => {
    ON();
    const st = deriveLayoutStrategy(makePlan('atmosphere-editorial'), 'a restaurant')!;
    const lines = layoutStrategyEnforcementLines(st).join('\n').toLowerCase();
    expect(lines).toContain('page structure');
    expect(lines).toContain('section flow');
    for (const bad of ['confidence:', 'score', 'matched', 'reasoning', 'chain-of-thought', '0.']) {
      expect(lines).not.toContain(bad);
    }
  });
});

/* ── Integration onto the plan ────────────────────────────────────────────────*/
describe('integration with ExperienceArchitecturePlan', () => {
  it('layout flag off ⇒ plan has NO layoutStrategy (byte-for-byte prior plan)', () => {
    ARCH_ON();   // architecture on, layout OFF
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality' }), 'a restaurant');
    expect(plan).toBeDefined();
    expect(plan!.layoutStrategy).toBeUndefined();
  });

  it('both flags on ⇒ layoutStrategy nested on the plan', () => {
    ARCH_ON(); ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a fine dining restaurant', sector: 'hospitality' }), 'a fine dining restaurant');
    expect(plan!.layoutStrategy).toBeDefined();
    expect(plan!.layoutStrategy!.version).toBe('layout-strategy-v1');
  });
});

/* ── Fail open ────────────────────────────────────────────────────────────────*/
describe('fail open', () => {
  it('undefined plan ⇒ undefined, no throw', () => {
    ON();
    expect(() => deriveLayoutStrategy(undefined, 'x')).not.toThrow();
    expect(deriveLayoutStrategy(undefined, 'x')).toBeUndefined();
  });

  it('deterministic / repeatable', () => {
    ON();
    const plan = makePlan('catalog-commerce');
    expect(deriveLayoutStrategy(plan, 'a store')).toEqual(deriveLayoutStrategy(plan, 'a store'));
  });
});
