import { describe, it, expect } from 'vitest';
import { buildRepairAuthorityDigest, buildReviewScopedSpecProjection } from '@/lib/webBuildQualityContext';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

/**
 * Finding 2/5 regression: the size-fitting `spec-compacted` level drops the 11 heavy authority fields
 * from the spec, but the post-repair analyzers still evaluate them. The bounded repairAuthorityDigest,
 * built from the ORIGINAL full spec, must carry the hard acceptance-critical requirements so a
 * compacted repair cannot regress a rule it never saw — and it must stay small (never re-introduce 99k).
 */

// A synthetic spec carrying the authority fields the digest extracts (only the sub-fields it reads).
function specWithAuthorities(): FrontendBuildSpecification {
  return {
    bindingRequirements: { requirements: [
      { required: true, kind: 'interactive-experience', label: 'Booking tool', controls: [{ label: 'date picker' }], dynamicOutcome: 'confirmation' },
      { required: false, kind: 'section', label: 'ignored (not required)' },
    ] },
    researchDirection: {
      requiredPatterns: ['booking system', 'service menu'],
      artDirection: { forbiddenModules: ['pricing tiers'] },
      forbiddenClaims: ['award-winning'],
      sector: 'restaurant',
    },
    composition: { sections: [{ id: 'hero', family: 'text-media' }, { id: 'menu', family: 'catalog' }] },
    visualSystem: { sectionFamilies: { hero: 'text-media', menu: 'catalog' } },
    contentNarrative: { sections: [{ id: 'hero' }, { id: 'menu' }], primaryCtaRole: 'reserve', voiceProhibitions: ['synergy'] },
    experienceQuality: { sections: [{ id: 'booking', interaction: { required: true, kind: 'tool', requiredOutcome: 'confirmation' } }] },
    visualConcept: { imageRoles: [{ role: 'hero-scene', required: true }], signature: { family: 'scene', medium: 'svg', animated: true }, requiredAnimatedVisualCount: 1, rhythm: { peakSectionId: 'hero' } },
    experienceIdentity: { trust: { stakes: 'regulated', disclaimersRequired: ['allergen notice'] } },
    motionExecution: { signatureSceneRequired: true, signatureSceneLocation: 'hero', techniqueFamily: 'parallax', implementationMedium: 'css' },
    executionObligations: { obligations: [
      { priority: 'required', type: 'hero-signature', requirement: 'animated hero', targetScope: 'src/components/Hero.tsx' },
      { priority: 'recommended', type: 'ignored', requirement: 'x', targetScope: 'y' },
    ] },
    experienceArchitecture: { landingRequired: true, entryPattern: 'marketing', heroContentPriority: 'headline', heroPattern: 'scene', primaryVisualMedium: 'svg', sectionSequence: ['hero', 'menu', 'booking'], forbiddenPatterns: ['generic-feature-cards'] },
    architecture: { sectionOrder: ['hero', 'menu', 'booking'] },
  } as unknown as FrontendBuildSpecification;
}

describe('buildRepairAuthorityDigest — bounded acceptance-authority extract', () => {
  it('extracts the hard requirement sub-fields from every dropped authority', () => {
    const d = buildRepairAuthorityDigest(specWithAuthorities());
    expect(d).toBeTruthy();
    const dig = d as Record<string, any>;
    expect(dig.requiredBindings?.[0]?.kind).toBe('interactive-experience');       // only required=true bindings
    expect(dig.requiredBindings).toHaveLength(1);
    expect(dig.research?.requiredPatterns).toEqual(['booking system', 'service menu']);
    expect(dig.research?.forbiddenModules).toEqual(['pricing tiers']);
    expect(dig.sectionComposition?.[0]).toEqual({ id: 'hero', family: 'text-media' });
    expect(dig.content?.primaryCtaRole).toBe('reserve');
    expect(dig.requiredInteractions?.[0]?.id).toBe('booking');
    expect(dig.visual?.requiredImageRoles).toEqual(['hero-scene']);
    expect(dig.regulatedDisclaimers).toEqual(['allergen notice']);
    expect(dig.motion?.signatureSceneRequired).toBe(true);
    expect(dig.requiredObligations).toHaveLength(1);                              // only priority==='required'
    expect(dig.requiredObligations?.[0]?.type).toBe('hero-signature');
    expect(dig.experienceArchitecture?.sectionSequence).toEqual(['hero', 'menu', 'booking']);
  });

  it('is bounded (a few KB), never re-introducing the full spec', () => {
    const d = buildRepairAuthorityDigest(specWithAuthorities());
    expect(JSON.stringify(d).length).toBeLessThan(8000);
  });

  it('is derived from the ORIGINAL spec — survives the review-scoped projection that drops those fields', () => {
    const spec = specWithAuthorities();
    const projected = buildReviewScopedSpecProjection(spec);
    // The projection drops the authorities from the spec...
    expect((projected as unknown as Record<string, unknown>).researchDirection).toBeUndefined();
    expect((projected as unknown as Record<string, unknown>).bindingRequirements).toBeUndefined();
    // ...but the digest built from the ORIGINAL spec still carries them.
    const d = buildRepairAuthorityDigest(spec) as Record<string, any>;
    expect(d.research?.requiredPatterns?.length).toBeGreaterThan(0);
    expect(d.requiredBindings?.length).toBeGreaterThan(0);
  });

  it('fails open to undefined when no authority carries a hard requirement', () => {
    expect(buildRepairAuthorityDigest({} as FrontendBuildSpecification)).toBeUndefined();
  });
});
