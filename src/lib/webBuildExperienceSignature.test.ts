/**
 * Tests — Experience Signature Layer (PR #511).
 *
 * Deterministic derivation of the memorable first-interaction signature from an already-built
 * ExperienceArchitecturePlan + user prompt (no model call), explicit-override precedence,
 * flag-off behaviour, fail-open, and integration onto the plan.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  deriveExperienceSignature, isExperienceSignatureEnabled, experienceSignatureEnforcementLines,
} from '@/lib/webBuildExperienceSignature';
import { deriveExperienceArchitecturePlan } from '@/lib/webBuildExperienceArchitecture';
import type { ExperienceArchitecturePlan, FrontendBuildSpecification } from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────────*/
function makePlan(experienceType: string, over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1',
    basis: 'derived',
    experienceType,
    entryPattern: 'value-first',
    landingRequired: true,
    heroPattern: 'hero',
    heroContentPriority: 'content',
    textDensity: 'medium',
    primaryVisualMedium: 'mixed',
    signatureMoment: undefined,
    sectionSequence: ['hero', 'body'],
    sectionContracts: [],
    forbiddenPatterns: [],
    userDirectives: [],
    ...over,
  };
}

function makeSpec(over: { prompt?: string; sector?: string; subsector?: string } = {}): FrontendBuildSpecification {
  return {
    version: 'frontend-spec-v1', status: 'ready', language: 'en', prompt: over.prompt || '',
    identity: { siteType: 'website', sector: (over.sector as never) || undefined, subsector: over.subsector, primaryConcept: over.subsector },
    designSystem: {
      rejectedDirections: [], colorTokens: {}, heroComposition: 'hero', sectionRhythm: '', visualSignature: '',
      compositionRules: [], surfaceRules: [], componentStyleRules: [], proofRules: [], responsiveRules: [],
      accessibilityRules: [], templateTrapsToAvoid: [], mustAvoid: [], differentiationMoves: [],
    },
    architecture: {
      navigationModel: 'top', navigationBehavior: 'sticky', conversionJourneyModel: 'lead', primaryCTA: 'Go',
      demoSurfaces: [], statefulDemoComponents: [], sectionOrder: ['hero', 'body'],
      sections: ['hero', 'body'].map((id, i) => ({ id, name: id, order: i, purpose: id, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] })),
    },
    assets: { strategy: '', visualLanguage: '', cssSvgSlots: [], imageSlots: [], motionLayers: [], realSourceRequired: [], aiIllustrativeAllowed: [], forbiddenGenerated: [], honestyConstraints: [] },
    researchEvidence: { status: 'not-run', didUseRealSources: false, sources: [], sourceBackedInsights: [], audienceExpectations: [], conversionPatterns: [], trustSignals: [], visualPatterns: [], risksToAvoid: [], differentiationOpportunities: [] },
    outputContract: { format: 'frontend-files-v1', framework: 'react', language: 'typescript', styling: 'tailwind-css', requiredFiles: [], recommendedFiles: [], requiredSectionComponentFiles: [], allowedExtensions: ['tsx', 'ts', 'css'], requirements: [], forbiddenPatterns: [], successCriteria: [] },
    honestyRules: [], sourceTrace: [], missingInputs: [], warnings: [], generation: { status: 'not-run', reason: '' }, summary: '',
  } as unknown as FrontendBuildSpecification;
}

const SIG_ON = () => vi.stubEnv('VITE_ENABLE_EXPERIENCE_SIGNATURE', 'true');
const ARCH_ON = () => vi.stubEnv('VITE_ENABLE_EXPERIENCE_ARCHITECTURE', 'true');

afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating ──────────────────────────────────────────────────────────────*/
describe('feature flag', () => {
  it('is off by default → derives nothing', () => {
    expect(isExperienceSignatureEnabled()).toBe(false);
    expect(deriveExperienceSignature(makePlan('atmosphere-editorial'), 'a restaurant')).toBeUndefined();
  });

  it('enforcement lines are empty with no signature (prompt byte-for-byte)', () => {
    expect(experienceSignatureEnforcementLines(undefined)).toEqual([]);
  });
});

/* ── Required scenarios ───────────────────────────────────────────────────────*/
describe('scenario derivation', () => {
  it('luxury restaurant → cinematic reveal, restrained motion, story-first', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('atmosphere-editorial'), 'An elegant fine dining restaurant')!;
    expect(sig.signatureMoment.toLowerCase()).toContain('cinematic');
    expect(sig.interactionPattern).toBe('cinematic_scroll');
    expect(['subtle', 'medium']).toContain(sig.motionIntensity);
    expect(sig.attentionStrategy).toBe('story_first');
  });

  it('SaaS → interactive product demonstration, medium motion, product-first', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('product-demonstration'), 'A SaaS analytics platform')!;
    expect(sig.signatureMoment.toLowerCase()).toContain('product');
    expect(sig.interactionPattern).toBe('interactive_demo');
    expect(sig.motionIntensity).toBe('medium');
    expect(sig.attentionStrategy).toBe('product_first');
  });

  it('ecommerce → product discovery & conversion flow, product-first', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('catalog-commerce'), 'An online sneaker store')!;
    expect(sig.signatureMoment.toLowerCase()).toContain('product');
    expect(sig.interactionPattern).toBe('product_reveal');
    expect(sig.attentionStrategy).toBe('product_first');
    expect(['subtle', 'medium']).toContain(sig.motionIntensity);
  });

  it('portfolio → visual work showcase, subtle motion, story-first', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('work-showcase'), 'A designer portfolio')!;
    expect(sig.signatureMoment.toLowerCase()).toContain('work');
    expect(sig.interactionPattern).toBe('immersive_gallery');
    expect(sig.motionIntensity).toBe('subtle');
    expect(sig.attentionStrategy).toBe('story_first');
  });
});

/* ── Explicit overrides (never force cinematic) ───────────────────────────────*/
describe('explicit user overrides win', () => {
  it('"no animation" → motion none, and never cinematic even for a cinematic class', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('atmosphere-editorial'), 'A restaurant, no animation please')!;
    expect(sig.motionIntensity).toBe('none');
    expect(sig.basis).toBe('user-override');
    expect(sig.userDirectives.join(' ').toLowerCase()).toContain('no animation');
  });

  it('"minimal" caps motion and avoids a cinematic pattern', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('atmosphere-editorial'), 'A minimal restaurant site')!;
    expect(['none', 'subtle']).toContain(sig.motionIntensity);
    expect(sig.interactionPattern).not.toBe('cinematic_scroll');
  });

  it('"dashboard / app interface" → interaction-first, restrained motion, not cinematic', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('product-demonstration'), 'Open into the app interface dashboard')!;
    expect(sig.interactionPattern).toBe('interactive_demo');
    expect(sig.attentionStrategy).toBe('interaction_first');
    expect(['none', 'subtle']).toContain(sig.motionIntensity);
  });

  it('"simple landing" → minimal static, hero-first', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('adaptive'), 'Just a simple landing page')!;
    expect(sig.interactionPattern).toBe('minimal_static');
    expect(sig.attentionStrategy).toBe('hero_first');
    expect(['none', 'subtle']).toContain(sig.motionIntensity);
  });
});

/* ── Enforcement lines ────────────────────────────────────────────────────────*/
describe('enforcement lines', () => {
  it('describe the signature with no scores/reasoning leaked', () => {
    SIG_ON();
    const sig = deriveExperienceSignature(makePlan('product-demonstration'), 'A SaaS tool')!;
    const lines = experienceSignatureEnforcementLines(sig).join('\n').toLowerCase();
    expect(lines).toContain('signature moment');
    expect(lines).toContain('motion intensity');
    expect(lines).toContain('attention strategy');
    // No internal SCORING / reasoning vocabulary. ("confidence" as an emotional-goal word is
    // legitimate user-facing prose; a leaked confidence SCORE would look like "confidence:" /
    // a bare "0.x" — those must never appear.)
    for (const bad of ['confidence:', 'score', 'matched', 'reasoning', 'chain-of-thought', '0.']) {
      expect(lines).not.toContain(bad);
    }
  });
});

/* ── Integration onto the plan ────────────────────────────────────────────────*/
describe('integration with ExperienceArchitecturePlan', () => {
  it('signature flag off ⇒ plan has NO signature (byte-for-byte PR #509 plan)', () => {
    ARCH_ON();  // architecture on, signature OFF
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a restaurant', sector: 'hospitality' }), 'a restaurant');
    expect(plan).toBeDefined();
    expect(plan!.signature).toBeUndefined();
  });

  it('both flags on ⇒ signature nested on the plan', () => {
    ARCH_ON(); SIG_ON();
    const plan = deriveExperienceArchitecturePlan(makeSpec({ prompt: 'a fine dining restaurant', sector: 'hospitality' }), 'a fine dining restaurant');
    expect(plan!.signature).toBeDefined();
    expect(plan!.signature!.version).toBe('experience-signature-v1');
    expect(plan!.signature!.interactionPattern).toBe('cinematic_scroll');
  });
});

/* ── Fail open ────────────────────────────────────────────────────────────────*/
describe('fail open', () => {
  it('undefined plan ⇒ undefined, no throw', () => {
    SIG_ON();
    expect(() => deriveExperienceSignature(undefined, 'x')).not.toThrow();
    expect(deriveExperienceSignature(undefined, 'x')).toBeUndefined();
  });

  it('deterministic / repeatable', () => {
    SIG_ON();
    const p = makePlan('catalog-commerce');
    expect(deriveExperienceSignature(p, 'a store')).toEqual(deriveExperienceSignature(p, 'a store'));
  });
});
