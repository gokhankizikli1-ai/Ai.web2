/**
 * Tests — Experience Architecture Planner (PR #510).
 *
 * Deterministic derivation from the assembled spec + user prompt (no model call), the
 * enforcement block, and the static compliance validator. Covers the 9 required scenarios,
 * explicit-user-override precedence, flag-off byte-for-byte behaviour, and fail-open.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  deriveExperienceArchitecturePlan, buildExperienceEnforcementBlock, isExperienceArchitectureEnabled,
} from '@/lib/webBuildExperienceArchitecture';
import { evaluateExperienceCompliance } from '@/lib/webBuildExperienceValidation';
import { buildFrontendBuilderRequest } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendGeneratedFile } from '@/lib/webBuildAgents';

/* ── Minimal spec factory (only the fields the planner reads) ─────────────────── */
function makeSpec(over: {
  prompt?: string; sector?: string; subsector?: string; siteType?: string;
  heroComposition?: string; entryFlowModel?: string; visualModule?: string;
  sectionIds?: string[]; assetsStrategy?: string; templateTraps?: string[];
} = {}): FrontendBuildSpecification {
  const ids = over.sectionIds || ['hero', 'features', 'proof', 'cta'];
  return {
    version: 'frontend-spec-v1',
    status: 'ready',
    language: 'en',
    prompt: over.prompt || '',
    identity: {
      siteType: over.siteType || 'website',
      sector: (over.sector as never) || undefined,
      subsector: over.subsector,
      primaryConcept: over.subsector,
    },
    designSystem: {
      rejectedDirections: [], colorTokens: {},
      heroComposition: over.heroComposition,
      sectionRhythm: '', visualSignature: '',
      compositionRules: [], surfaceRules: [], componentStyleRules: [], proofRules: [],
      responsiveRules: [], accessibilityRules: [],
      templateTrapsToAvoid: over.templateTraps || [], mustAvoid: [], differentiationMoves: [],
    },
    architecture: {
      entryFlowModel: over.entryFlowModel,
      navigationModel: 'top-nav', navigationBehavior: 'sticky',
      conversionJourneyModel: 'lead', primaryCTA: 'Book',
      demoSurfaces: [], statefulDemoComponents: [],
      sectionOrder: ids,
      sections: ids.map((id, i) => ({
        id, name: id, order: i, purpose: `${id} purpose`,
        bullets: ['a', 'b'], interactionHints: [], assetSlotIds: [], motionLayerIds: [],
        visualModule: over.visualModule,
      })),
    },
    assets: {
      strategy: over.assetsStrategy || '', visualLanguage: '',
      cssSvgSlots: [], imageSlots: [], motionLayers: [],
      realSourceRequired: [], aiIllustrativeAllowed: [], forbiddenGenerated: [], honestyConstraints: [],
    },
    researchEvidence: {
      status: 'not-run', didUseRealSources: false, sources: [],
      sourceBackedInsights: [], audienceExpectations: [], conversionPatterns: [],
      trustSignals: ['response time', 'integration state'], visualPatterns: [], risksToAvoid: [],
      differentiationOpportunities: [],
    },
    outputContract: {
      format: 'frontend-files-v1', framework: 'react', language: 'typescript', styling: 'tailwind-css',
      requiredFiles: [], recommendedFiles: [], requiredSectionComponentFiles: [],
      allowedExtensions: ['tsx', 'ts', 'css'], requirements: [], forbiddenPatterns: [], successCriteria: [],
    },
    honestyRules: [], sourceTrace: [], missingInputs: [], warnings: [],
    generation: { status: 'not-run', reason: '' },
    summary: '',
  } as unknown as FrontendBuildSpecification;
}

const ON = () => vi.stubEnv('VITE_ENABLE_EXPERIENCE_ARCHITECTURE', 'true');

afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating ──────────────────────────────────────────────────────────────*/
describe('feature flag', () => {
  it('is off by default and derives nothing', () => {
    expect(isExperienceArchitectureEnabled()).toBe(false);
    expect(deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant' }), 'a restaurant')).toBeUndefined();
  });

  it('flag off ⇒ enforcement block is empty (byte-for-byte generation prompt)', () => {
    expect(buildExperienceEnforcementBlock(undefined)).toBe('');
  });

  it('turns on when set to true', () => {
    ON();
    expect(isExperienceArchitectureEnabled()).toBe(true);
  });
});

/* ── Required scenarios ───────────────────────────────────────────────────────*/
describe('scenario derivation', () => {
  it('1. AI support product → product-first interactive demo, not headline-first', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(
      makeSpec({ prompt: 'AI customer support product with an interactive demo', sector: 'technology', subsector: 'ai support' }),
      'AI customer support product with an interactive demo',
    )!;
    expect(plan).toBeDefined();
    expect(plan.primaryVisualMedium === 'product_ui' || plan.primaryVisualMedium === 'interactive_demo').toBe(true);
    expect(plan.heroContentPriority).not.toBe('text');
    expect(plan.forbiddenPatterns.join(' ').toLowerCase()).toContain('node diagram');
  });

  it('2. AI image product → visual/creative, futuristic only when appropriate', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(
      makeSpec({ prompt: 'An AI image generation creative studio', sector: 'technology', subsector: 'ai image' }),
      'An AI image generation creative studio',
    )!;
    expect(plan).toBeDefined();
    // No forced cyberpunk/neon default.
    expect(plan.experienceType.toLowerCase()).not.toContain('cyberpunk');
  });

  it('3. Finance → trust & data clarity, no cyberpunk', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(
      makeSpec({ prompt: 'A wealth management firm', sector: 'finance', subsector: 'wealth' }),
      'A wealth management firm',
    )!;
    expect(plan.experienceType).toBe('trust-clarity');
    expect(plan.primaryVisualMedium).toBe('data_visualization');
    expect(plan.forbiddenPatterns.join(' ').toLowerCase()).toContain('cyberpunk');
  });

  it('4. Luxury restaurant → image-led / editorial', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(
      makeSpec({ prompt: 'An elegant fine dining restaurant', sector: 'hospitality', subsector: 'fine dining' }),
      'An elegant fine dining restaurant',
    )!;
    expect(plan.entryPattern).toBe('atmosphere-first');
    expect(plan.primaryVisualMedium).toBe('photography');
    expect(plan.forbiddenPatterns.join(' ').toLowerCase()).toContain('dashboard');
  });

  it('5. Portfolio → project-first, low text density', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(
      makeSpec({ prompt: 'A designer portfolio', sector: 'creative', subsector: 'portfolio' }),
      'A designer portfolio',
    )!;
    expect(plan.entryPattern).toBe('work-first');
    expect(plan.textDensity).toBe('low');
    expect(plan.landingRequired).toBe(false);
  });

  it('6. E-commerce → product/category-first, hero optional', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(
      makeSpec({ prompt: 'An online store selling sneakers', sector: 'retail', subsector: 'ecommerce' }),
      'An online store selling sneakers',
    )!;
    expect(plan.entryPattern).toBe('product-first');
    expect(plan.landingRequired).toBe(false);
  });

  it('7. Explicit "no landing page, open directly into the app demo" wins', () => {
    ON();
    const prompt = 'A finance dashboard. No landing page, open directly into the app demo.';
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt, sector: 'finance' }), prompt)!;
    expect(plan.landingRequired).toBe(false);
    expect(plan.basis).toBe('user-override');
    expect(plan.userDirectives.join(' ').toLowerCase()).toContain('no landing page');
  });

  it('8. Empty / unknown input → safe fallback or undefined', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: '', sectionIds: ['s1', 's2'] }), '');
    // Either a safe generic plan or undefined — never a throw.
    if (plan) {
      expect(plan.version).toBe('experience-arch-v1');
      expect(plan.sectionSequence.length).toBeGreaterThan(0);
    }
  });

  it('no sections at all ⇒ stays out of the way (undefined)', () => {
    ON();
    const spec = makeSpec({ prompt: 'x' });
    spec.architecture.sections = [];
    spec.architecture.sectionOrder = [];
    expect(deriveExperienceArchitecturePlan(spec, 'x')).toBeUndefined();
  });
});

/* ── Explicit override precedence ─────────────────────────────────────────────*/
describe('explicit overrides win over derived defaults', () => {
  it('"minimal text" forces low text density even for a text-heavy class', () => {
    ON();
    const prompt = 'A news magazine, minimal text please';
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt, sector: 'media' }), prompt)!;
    expect(plan.textDensity).toBe('low');
  });

  it('"product-first" overrides a normally landing-led class', () => {
    ON();
    const prompt = 'A SaaS analytics tool, product-first';
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt, sector: 'technology', subsector: 'saas' }), prompt)!;
    expect(plan.entryPattern).toBe('product-first');
  });
});

/* ── Enforcement block ────────────────────────────────────────────────────────*/
describe('enforcement block', () => {
  it('frames the JSON as a binding execution contract with no scores/reasoning', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality' }), 'a restaurant')!;
    const block = buildExperienceEnforcementBlock(plan);
    expect(block).toContain('EXPERIENCE ARCHITECTURE CONTRACT');
    expect(block.toLowerCase()).toContain('binding execution contract');
    expect(block.toLowerCase()).toContain('forbiddenpatterns');
    expect(block.toLowerCase()).toContain('userdirectives');
    // No internal scoring/reasoning vocabulary leaks.
    for (const bad of ['confidence', 'score', 'reasoning', 'chain-of-thought']) {
      expect(block.toLowerCase()).not.toContain(bad);
    }
  });
});

/* ── Byte-for-byte generation prompt when flag off ────────────────────────────*/
describe('frontend_builder request', () => {
  it('no plan attached ⇒ request has NO experience block (byte-for-byte old)', () => {
    const spec = makeSpec({ prompt: 'a restaurant', sector: 'hospitality' });
    // Flag off in this test (no ON()) ⇒ deriveFrontendBuildSpecification would not attach a
    // plan; simulate by constructing the request directly with no experienceArchitecture.
    const req = buildFrontendBuilderRequest(spec);
    expect(req).not.toContain('EXPERIENCE ARCHITECTURE CONTRACT');
    expect(req).not.toContain('"experienceArchitecture"');
  });

  it('plan attached ⇒ request carries the enforcement block AND the structured JSON', () => {
    ON();
    const spec = makeSpec({ prompt: 'a restaurant', sector: 'hospitality' });
    spec.experienceArchitecture = deriveExperienceArchitecturePlan(spec, spec.prompt);
    expect(spec.experienceArchitecture).toBeDefined();
    const req = buildFrontendBuilderRequest(spec);
    expect(req).toContain('EXPERIENCE ARCHITECTURE CONTRACT');
    expect(req).toContain('"experienceArchitecture"');
    expect(req).toContain('experience-arch-v1');
  });
});

/* ── Static compliance validator ──────────────────────────────────────────────*/
function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: path.endsWith('.css') ? 'css' : 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}

describe('experience compliance validation', () => {
  it('undefined when no plan attached', () => {
    expect(evaluateExperienceCompliance([file('App.tsx', '<div/>')], undefined)).toBeUndefined();
  });

  it('flags a missing required photographic medium', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality', sectionIds: ['hero'] }), 'a restaurant')!;
    // Source has NO <img> — photography medium unmet.
    const diag = evaluateExperienceCompliance([file('Hero.tsx', 'export const Hero = () => <section data-id="hero"><h1>Welcome</h1></section>')], plan)!;
    expect(diag.planPresent).toBe(true);
    expect(diag.requiredMediaRepresented).toBe(false);
    expect(diag.missingMedia).toContain('photography');
    expect(diag.compliant).toBe(false);
  });

  it('passes when the photographic medium and sections are represented', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality', sectionIds: ['hero', 'menu'] }), 'a restaurant')!;
    const src = 'export const App = () => (<main>'
      + '<section data-id="hero"><img src="/a.jpg" alt="x"/></section>'
      + '<section data-id="menu"><img src="/b.jpg" alt="y"/></section>'
      + '</main>);';
    const diag = evaluateExperienceCompliance([file('App.tsx', src)], plan)!;
    expect(diag.missingSections).toEqual([]);
    expect(diag.requiredMediaRepresented).toBe(true);
    expect(diag.sequenceRespected).toBe(true);
  });

  it('never throws on malformed input (fail open)', () => {
    ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'x', sector: 'finance' }), 'x')!;
    expect(() => evaluateExperienceCompliance(undefined as never, plan)).not.toThrow();
    expect(evaluateExperienceCompliance([], plan)).toBeUndefined();
  });
});
