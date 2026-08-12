import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { resolveVisualIntelligenceNeed } from '@/lib/webBuildVisualIntelligence';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

function spec(prompt: string, buildType: 'app' | 'web'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [{ id: 'home', name: 'Home' }, { id: 'detail', name: 'Detail' }];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

describe('Phase 4 — skip unused visual-intelligence for no-photography apps', () => {
  it('A. an internal app (CRM/analytics/task) uses no photography → call is SKIPPED', () => {
    for (const p of ['Build a CRM for a sales team', 'Build a SaaS analytics dashboard', 'Build a productivity task manager']) {
      const s = spec(p, 'app');
      expect(s.appVisual?.imageStrategy?.usePhotography).toBe(false); // sanity: functional app, no photos
      const need = resolveVisualIntelligenceNeed(s);
      expect(need.needed).toBe(false);
      expect(need.skipReason).toMatch(/no photography|unused/i);
    }
  });

  it('B. a consumer app that uses photography → call is PRESERVED', () => {
    for (const p of ['Build a fitness coaching app with programs and progress', 'Build a media content browsing app']) {
      const s = spec(p, 'app');
      expect(s.appVisual?.imageStrategy?.usePhotography).toBe(true); // consumer app, photography allowed
      expect(resolveVisualIntelligenceNeed(s).needed).toBe(true);
    }
  });

  it('C. a WEB build always runs visual intelligence (unchanged)', () => {
    expect(resolveVisualIntelligenceNeed(spec('Build a bakery landing page', 'web')).needed).toBe(true);
    expect(resolveVisualIntelligenceNeed(spec('Build an ecommerce store', 'web')).needed).toBe(true);
  });

  it('D. conservative fallbacks — no spec / failed-open / undefined photography → run', () => {
    expect(resolveVisualIntelligenceNeed(undefined).needed).toBe(true);
    const s = spec('Build a CRM', 'app');
    // If image-coverage required photos, keep the call even for an otherwise no-photo app.
    const withPhotoCoverage = { ...s, imageCoverage: { mode: 'required', explicitNoPhoto: false } } as unknown as FrontendBuildSpecification;
    expect(resolveVisualIntelligenceNeed(withPhotoCoverage).needed).toBe(true);
    // Missing appVisual (defensive) → run.
    const noAppVisual = { ...s, appVisual: undefined } as unknown as FrontendBuildSpecification;
    expect(resolveVisualIntelligenceNeed(noAppVisual).needed).toBe(true);
  });
});
