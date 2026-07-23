/**
 * Tests — Motion Intelligence Layer (PR #513).
 *
 * Deterministic derivation of the MotionStrategy from an already-built ExperienceArchitecture
 * Plan (+ Signature + Asset Strategy) + user prompt (no model call), explicit-override
 * precedence, flag-off behaviour, fail-open, and integration onto the plan.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  deriveMotionStrategy, isMotionIntelligenceEnabled, motionStrategyEnforcementLines,
} from '@/lib/webBuildMotionIntelligence';
import { deriveExperienceArchitecturePlan } from '@/lib/webBuildExperienceArchitecture';
import type {
  ExperienceArchitecturePlan, ExperienceMotionIntensity, AssetHeroKind, FrontendBuildSpecification,
} from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function makePlan(experienceType: string, over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType,
    entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero',
    heroContentPriority: 'content', textDensity: 'medium', primaryVisualMedium: 'mixed',
    sectionSequence: ['hero'], sectionContracts: [], forbiddenPatterns: [], userDirectives: [], ...over,
  };
}

function withSignature(plan: ExperienceArchitecturePlan, intensity: ExperienceMotionIntensity): ExperienceArchitecturePlan {
  return { ...plan, signature: { version: 'experience-signature-v1', basis: 'derived', signatureMoment: 'x', emotionalGoal: 'y', interactionPattern: 'minimal_static', motionIntensity: intensity, attentionStrategy: 'hero_first', userDirectives: [] } };
}

function withHeroAsset(plan: ExperienceArchitecturePlan, heroAsset: AssetHeroKind): ExperienceArchitecturePlan {
  return { ...plan, assetStrategy: { version: 'asset-strategy-v1', basis: 'derived', heroAsset, sectionAssets: [], assetSourcePreference: 'mixed', visualAuthenticity: 'branded', avoidAssets: [], mediaPriority: 'storytelling', userDirectives: [] } };
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

const ON = () => vi.stubEnv('VITE_ENABLE_MOTION_INTELLIGENCE', 'true');
const ARCH_ON = () => vi.stubEnv('VITE_ENABLE_EXPERIENCE_ARCHITECTURE', 'true');

afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating ──────────────────────────────────────────────────────────────*/
describe('feature flag', () => {
  it('off by default → derives nothing', () => {
    expect(isMotionIntelligenceEnabled()).toBe(false);
    expect(deriveMotionStrategy(makePlan('atmosphere-editorial'), 'a restaurant')).toBeUndefined();
  });

  it('enforcement lines empty with no strategy (prompt byte-for-byte)', () => {
    expect(motionStrategyEnforcementLines(undefined)).toEqual([]);
  });
});

/* ── Required scenarios ───────────────────────────────────────────────────────*/
describe('scenario derivation', () => {
  it('bank / finance → subtle motion', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('trust-clarity'), 'A retail bank')!;
    expect(st.motionLevel).toBe('subtle');
  });

  it('restaurant → moderate, hero slow_zoom', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('atmosphere-editorial'), 'A restaurant')!;
    expect(st.motionLevel).toBe('moderate');
    expect(st.heroMotion).toBe('slow_zoom');
  });

  it('dashboard → none / subtle (restrained)', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('product-demonstration'), 'An internal analytics dashboard app interface')!;
    expect(['none', 'subtle']).toContain(st.motionLevel);
    expect(st.heroMotion).toBe('none');
    expect(st.basis).toBe('user-override');
  });

  it('portfolio → depends on work style (valid enum, motion present)', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('work-showcase'), 'A designer portfolio')!;
    expect(['subtle', 'moderate', 'immersive']).toContain(st.motionLevel);
    expect(st.interactionStyle).toBe('scroll_reveal');
  });

  it('gaming / creative → immersive allowed', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('creative-showcase'), 'An immersive gaming experience')!;
    expect(st.motionLevel).toBe('immersive');
  });
});

/* ── Rules ────────────────────────────────────────────────────────────────────*/
describe('rules', () => {
  it('never adds motion just because a site is AI — AI product stays restrained', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('product-demonstration'), 'An AI assistant product')!;
    expect(['none', 'subtle', 'moderate']).toContain(st.motionLevel);
    expect(st.motionLevel).not.toBe('immersive');
  });

  it('"no animation" → none across the board', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('atmosphere-editorial'), 'A restaurant, no animation')!;
    expect(st.motionLevel).toBe('none');
    expect(st.heroMotion).toBe('none');
    expect(st.interactionStyle).toBe('static');
    expect(st.transitionStyle).toBe('instant');
  });

  it('luxury → subtle cinematic', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('atmosphere-editorial'), 'A luxury fine dining restaurant')!;
    expect(st.motionLevel).toBe('subtle');
    expect(st.interactionStyle).toBe('cinematic');
  });

  it('always protects accessibility / performance', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('atmosphere-editorial'), 'a restaurant')!;
    const avoid = st.avoidMotion.join(' ').toLowerCase();
    expect(avoid).toContain('prefers-reduced-motion');
    expect(avoid).toContain('performance');
  });

  it('signature motion intensity drives the level (consumes existing output)', () => {
    ON();
    const plan = withSignature(makePlan('atmosphere-editorial'), 'subtle'); // moderate default → subtle
    const st = deriveMotionStrategy(plan, 'A restaurant')!;
    expect(st.motionLevel).toBe('subtle');
  });

  it('hero motion follows the asset strategy hero (video → video_motion)', () => {
    ON();
    const plan = withHeroAsset(makePlan('creative-showcase'), 'video');
    const st = deriveMotionStrategy(plan, 'A studio')!;
    expect(st.heroMotion).toBe('video_motion');
  });
});

/* ── Enforcement lines ────────────────────────────────────────────────────────*/
describe('enforcement lines', () => {
  it('describe the motion strategy with no scores/reasoning leaked', () => {
    ON();
    const st = deriveMotionStrategy(makePlan('atmosphere-editorial'), 'a restaurant')!;
    const lines = motionStrategyEnforcementLines(st).join('\n').toLowerCase();
    expect(lines).toContain('motion level');
    expect(lines).toContain('prefers-reduced-motion');
    for (const bad of ['confidence:', 'score', 'matched', 'reasoning', 'chain-of-thought', '0.']) {
      expect(lines).not.toContain(bad);
    }
  });
});

/* ── Integration onto the plan ────────────────────────────────────────────────*/
describe('integration with ExperienceArchitecturePlan', () => {
  it('motion flag off ⇒ plan has NO motionStrategy (byte-for-byte prior plan)', () => {
    ARCH_ON();   // architecture on, motion OFF
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality' }), 'a restaurant');
    expect(plan).toBeDefined();
    expect(plan!.motionStrategy).toBeUndefined();
  });

  it('both flags on ⇒ motionStrategy nested on the plan', () => {
    ARCH_ON(); ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a fine dining restaurant', sector: 'hospitality' }), 'a fine dining restaurant');
    expect(plan!.motionStrategy).toBeDefined();
    expect(plan!.motionStrategy!.version).toBe('motion-strategy-v1');
  });
});

/* ── Fail open ────────────────────────────────────────────────────────────────*/
describe('fail open', () => {
  it('undefined plan ⇒ undefined, no throw', () => {
    ON();
    expect(() => deriveMotionStrategy(undefined, 'x')).not.toThrow();
    expect(deriveMotionStrategy(undefined, 'x')).toBeUndefined();
  });

  it('deterministic / repeatable', () => {
    ON();
    const plan = makePlan('catalog-commerce');
    expect(deriveMotionStrategy(plan, 'a store')).toEqual(deriveMotionStrategy(plan, 'a store'));
  });
});
