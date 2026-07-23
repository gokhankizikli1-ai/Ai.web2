/**
 * Tests — Asset Intelligence Layer (PR #512).
 *
 * Deterministic derivation of the visual AssetStrategy from an already-built
 * ExperienceArchitecturePlan + spec + user prompt (no model call), explicit-override
 * precedence, flag-off behaviour, fail-open, and integration onto the plan.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  deriveAssetStrategy, isAssetIntelligenceEnabled, assetStrategyEnforcementLines,
} from '@/lib/webBuildAssetIntelligence';
import { deriveExperienceArchitecturePlan } from '@/lib/webBuildExperienceArchitecture';
import type {
  ExperienceArchitecturePlan, ExperienceSectionContract, ExperienceVisualMedium,
  FrontendBuildSpecification,
} from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function section(id: string, medium: ExperienceVisualMedium, proof = false): ExperienceSectionContract {
  return { id, purpose: `${id} purpose`, requiredContent: [], visualMedium: medium, textDensity: 'medium', ...(proof ? { proofRequirement: 'real proof' } : {}) };
}

function makePlan(experienceType: string, over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType,
    entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero',
    heroContentPriority: 'content', textDensity: 'medium', primaryVisualMedium: 'mixed',
    sectionSequence: ['hero'], sectionContracts: [section('hero', 'photography')],
    forbiddenPatterns: [], userDirectives: [], ...over,
  };
}

function makeSpec(over: { prompt?: string; sector?: string; realSourceRequired?: string[] } = {}): FrontendBuildSpecification {
  return {
    version: 'frontend-spec-v1', status: 'ready', language: 'en', prompt: over.prompt || '',
    identity: { siteType: 'website', sector: (over.sector as never) || undefined },
    designSystem: { rejectedDirections: [], colorTokens: {}, compositionRules: [], surfaceRules: [], componentStyleRules: [], proofRules: [], responsiveRules: [], accessibilityRules: [], templateTrapsToAvoid: [], mustAvoid: [], differentiationMoves: [] },
    architecture: { navigationModel: 'top', navigationBehavior: 'sticky', conversionJourneyModel: 'lead', primaryCTA: 'Go', demoSurfaces: [], statefulDemoComponents: [], sectionOrder: ['hero', 'body'], sections: ['hero', 'body'].map((id, i) => ({ id, name: id, order: i, purpose: id, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] })) },
    assets: { strategy: '', visualLanguage: '', cssSvgSlots: [], imageSlots: [], motionLayers: [], realSourceRequired: over.realSourceRequired || [], aiIllustrativeAllowed: [], forbiddenGenerated: [], honestyConstraints: [] },
    researchEvidence: { status: 'not-run', didUseRealSources: false, sources: [], sourceBackedInsights: [], audienceExpectations: [], conversionPatterns: [], trustSignals: [], visualPatterns: [], risksToAvoid: [], differentiationOpportunities: [] },
    outputContract: { format: 'frontend-files-v1', framework: 'react', language: 'typescript', styling: 'tailwind-css', requiredFiles: [], recommendedFiles: [], requiredSectionComponentFiles: [], allowedExtensions: ['tsx', 'ts', 'css'], requirements: [], forbiddenPatterns: [], successCriteria: [] },
    honestyRules: [], sourceTrace: [], missingInputs: [], warnings: [], generation: { status: 'not-run', reason: '' }, summary: '',
  } as unknown as FrontendBuildSpecification;
}

const ON = () => vi.stubEnv('VITE_ENABLE_ASSET_INTELLIGENCE', 'true');
const ARCH_ON = () => vi.stubEnv('VITE_ENABLE_EXPERIENCE_ARCHITECTURE', 'true');

afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating ──────────────────────────────────────────────────────────────*/
describe('feature flag', () => {
  it('off by default → derives nothing', () => {
    expect(isAssetIntelligenceEnabled()).toBe(false);
    expect(deriveAssetStrategy(makePlan('atmosphere-editorial'), makeSpec(), 'a restaurant')).toBeUndefined();
  });

  it('enforcement lines empty with no strategy (prompt byte-for-byte)', () => {
    expect(assetStrategyEnforcementLines(undefined)).toEqual([]);
  });
});

/* ── Required scenarios ───────────────────────────────────────────────────────*/
describe('scenario derivation', () => {
  it('luxury restaurant → photography hero, real assets, avoids generic stock gradients', () => {
    ON();
    const st = deriveAssetStrategy(makePlan('atmosphere-editorial'), makeSpec({ sector: 'hospitality' }), 'An elegant fine dining restaurant')!;
    expect(st.heroAsset).toBe('photography');
    expect(st.assetSourcePreference).toBe('real_assets');
    expect(st.avoidAssets.join(' ').toLowerCase()).toContain('generic stock gradients');
    expect(st.mediaPriority).toBe('storytelling');
  });

  it('SaaS → interactive_demo hero, product/workflow section assets, mixed source', () => {
    ON();
    const plan = makePlan('product-demonstration', {
      sectionContracts: [section('hero', 'interactive_demo'), section('product', 'product_ui', true), section('workflow', 'data_visualization', true)],
    });
    const st = deriveAssetStrategy(plan, makeSpec({ sector: 'technology' }), 'A SaaS analytics platform')!;
    expect(st.heroAsset).toBe('interactive_demo');
    expect(st.assetSourcePreference).toBe('mixed');
    const kinds = st.sectionAssets.map((a) => a.assetType);
    expect(kinds).toContain('product_render');
    expect(kinds).toContain('data_visualization');
    // Real proof preserved, not decorative.
    expect(st.sectionAssets.find((a) => a.sectionId === 'product')!.purpose.toLowerCase()).toContain('proof');
  });

  it('ecommerce → photography hero, conversion priority', () => {
    ON();
    const st = deriveAssetStrategy(makePlan('catalog-commerce'), makeSpec({ sector: 'retail' }), 'An online sneaker store')!;
    expect(st.heroAsset).toBe('photography');
    expect(st.mediaPriority).toBe('conversion');
  });

  it('portfolio → photography WHEN real work exists, else generated_art', () => {
    ON();
    const withWork = deriveAssetStrategy(makePlan('work-showcase'), makeSpec({ realSourceRequired: ['Project photos', 'Case studies'] }), 'A designer portfolio')!;
    expect(withWork.heroAsset).toBe('photography');
    const noWork = deriveAssetStrategy(makePlan('work-showcase'), makeSpec({ realSourceRequired: [] }), 'A designer portfolio')!;
    expect(noWork.heroAsset).toBe('generated_art');
  });
});

/* ── Rules / overrides ────────────────────────────────────────────────────────*/
describe('rules and explicit overrides', () => {
  it('dashboard / app interface → no hero imagery, exploration priority', () => {
    ON();
    const st = deriveAssetStrategy(makePlan('product-demonstration'), makeSpec(), 'An internal analytics dashboard app interface')!;
    expect(st.heroAsset).toBe('none');
    expect(st.mediaPriority).toBe('exploration');
    expect(st.basis).toBe('user-override');
  });

  it('"no images" → hero none, and decorative section images dropped (functional assets kept)', () => {
    ON();
    const plan = makePlan('atmosphere-editorial', {
      sectionContracts: [section('hero', 'photography'), section('gallery', 'photography'), section('data', 'data_visualization', true)],
    });
    const st = deriveAssetStrategy(plan, makeSpec(), 'A restaurant, no images please, text-only')!;
    expect(st.heroAsset).toBe('none');
    const kinds = st.sectionAssets.map((a) => a.assetType);
    expect(kinds).not.toContain('photography');   // decorative photography dropped
    expect(kinds).toContain('data_visualization'); // functional proof asset kept
    expect(st.userDirectives.join(' ').toLowerCase()).toContain('no images');
  });

  it('never forces images: typography/none sections get no asset', () => {
    ON();
    const plan = makePlan('content-editorial', {
      sectionContracts: [section('intro', 'typography'), section('quote', 'none'), section('feature', 'photography')],
    });
    const st = deriveAssetStrategy(plan, makeSpec(), 'A blog')!;
    const ids = st.sectionAssets.map((a) => a.sectionId);
    expect(ids).toEqual(['feature']);   // only the photographic section carries an asset
  });

  it('always protects real product proof in the avoid list', () => {
    ON();
    const st = deriveAssetStrategy(makePlan('product-demonstration'), makeSpec(), 'A SaaS tool')!;
    expect(st.avoidAssets.join(' ').toLowerCase()).toContain('real product proof');
  });
});

/* ── Enforcement lines ────────────────────────────────────────────────────────*/
describe('enforcement lines', () => {
  it('describe the asset strategy with no scores/reasoning leaked', () => {
    ON();
    const st = deriveAssetStrategy(makePlan('atmosphere-editorial'), makeSpec(), 'a restaurant')!;
    const lines = assetStrategyEnforcementLines(st).join('\n').toLowerCase();
    expect(lines).toContain('hero asset');
    expect(lines).toContain('asset source');
    for (const bad of ['confidence:', 'score', 'matched', 'reasoning', 'chain-of-thought', '0.']) {
      expect(lines).not.toContain(bad);
    }
  });
});

/* ── Integration onto the plan ────────────────────────────────────────────────*/
describe('integration with ExperienceArchitecturePlan', () => {
  it('asset flag off ⇒ plan has NO assetStrategy (byte-for-byte prior plan)', () => {
    ARCH_ON();   // architecture on, asset OFF
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality' }), 'a restaurant');
    expect(plan).toBeDefined();
    expect(plan!.assetStrategy).toBeUndefined();
  });

  it('both flags on ⇒ assetStrategy nested on the plan', () => {
    ARCH_ON(); ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a fine dining restaurant', sector: 'hospitality' }), 'a fine dining restaurant');
    expect(plan!.assetStrategy).toBeDefined();
    expect(plan!.assetStrategy!.version).toBe('asset-strategy-v1');
    expect(plan!.assetStrategy!.heroAsset).toBe('photography');
  });
});

/* ── Fail open ────────────────────────────────────────────────────────────────*/
describe('fail open', () => {
  it('undefined plan ⇒ undefined, no throw', () => {
    ON();
    expect(() => deriveAssetStrategy(undefined, makeSpec(), 'x')).not.toThrow();
    expect(deriveAssetStrategy(undefined, makeSpec(), 'x')).toBeUndefined();
  });

  it('deterministic / repeatable', () => {
    ON();
    const plan = makePlan('catalog-commerce');
    const spec = makeSpec();
    expect(deriveAssetStrategy(plan, spec, 'a store')).toEqual(deriveAssetStrategy(plan, spec, 'a store'));
  });
});
