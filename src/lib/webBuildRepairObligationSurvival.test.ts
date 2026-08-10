import { describe, it, expect } from 'vitest';
import { buildFrontendBuilderRepairRequest } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderReviewArtifact } from '@/lib/webBuildAgents';

/**
 * Phase 2 — architecture-fidelity obligation survives spec projection/compaction.
 *
 * The remove-unplanned-section rule is built by buildArchitectureFidelityObligation from
 * spec.architecture.sectionOrder. Under the size fitter, the spec handed to the request builder can be
 * the review-scoped projection with sectionOrder dropped. The fix precomputes the obligation from the
 * ORIGINAL full spec (like the authority digest) and threads it in, so the rule is not lost.
 *
 * Pure: no model/provider call, no network, no live build. We assert on the request STRING only.
 */

const review = { status: 'completed', issues: [], strengths: [] } as unknown as FrontendBuilderReviewArtifact;

/** A full spec carrying an authoritative ordered section list. */
function fullSpec(): FrontendBuildSpecification {
  return {
    status: 'ok',
    architecture: { sectionOrder: ['hero', 'features', 'pricing', 'cta'], sections: [] },
    outputContract: { requiredSectionComponentFiles: ['src/sections/Hero.tsx', 'src/sections/Cta.tsx'] },
  } as unknown as FrontendBuildSpecification;
}
/** The SAME spec after review-scoped projection dropped the heavy authorities (no sectionOrder). */
function projectedSpec(): FrontendBuildSpecification {
  return { status: 'ok', architecture: { sections: [] } } as unknown as FrontendBuildSpecification;
}

describe('architecture-fidelity obligation survival (Phase 2)', () => {
  it('is present when derived from a full spec (backward-compatible fallback path)', () => {
    const req = buildFrontendBuilderRepairRequest(fullSpec(), [], review);
    expect(req).toContain('"architectureFidelity"');
    expect(req).toContain('"authoritativeSectionOrder"');
    expect(req).toContain('hero');
    expect(req).toContain('pricing');
  });

  it('is LOST when the request spec is projected and nothing is threaded (proves the gap)', () => {
    const req = buildFrontendBuilderRepairRequest(projectedSpec(), [], review);
    expect(req).not.toContain('"authoritativeSectionOrder"');
  });

  it('SURVIVES projection when the original-spec obligation is threaded in (the fix)', () => {
    // Precompute from the ORIGINAL full spec (as the call site now does) and thread it through even
    // though the request spec is the projected one.
    const threaded = {
      authoritativeSectionOrder: ['hero', 'features', 'pricing', 'cta'],
      authoritativeSectionComponents: ['src/sections/Hero.tsx'],
      rule: 'Render EXACTLY these sections … REMOVE any extra/unplanned section …',
    };
    const req = buildFrontendBuilderRepairRequest(projectedSpec(), [], review, undefined, undefined, undefined, threaded);
    expect(req).toContain('"architectureFidelity"');
    expect(req).toContain('"authoritativeSectionOrder"');
    expect(req).toContain('pricing');
  });
});
