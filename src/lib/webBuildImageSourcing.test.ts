import { describe, it, expect } from 'vitest';
import {
  deriveImageNeeds,
  sanitizeImageQuery,
  refineSourcedAssets,
  type ImageNeed,
} from '@/lib/webBuildImageSourcing';
import type { FrontendBuildSpecification, SourcedImageAsset } from '@/lib/webBuildAgents';

/** Minimal spec builder with image slots + optional visualConcept image roles. */
function spec(over: Partial<FrontendBuildSpecification> = {}): FrontendBuildSpecification {
  return {
    identity: { sector: 'clinic-healthcare', subsector: 'dental clinic' },
    assets: { imageSlots: [{ id: 'hero1', kind: 'hero-image', source: 'stock', target: 'hero' }] },
    ...over,
  } as unknown as FrontendBuildSpecification;
}
const heroRole = {
  slotId: 'hero1', sectionId: 'hero', role: 'hero-signature', required: true,
  narrativePurpose: 'hero', subject: 'friendly dentist reassuring a patient in a bright modern clinic',
  medium: 'photography', orientation: 'landscape', aspectRatio: '16:9', crop: 'wide', focalPoint: 'upper third',
  placement: 'first viewport', mobileCrop: 'tighter', lighting: 'soft even daylight', tone: 'reassuring, warm',
  peoplePresent: 'required', devicesUseful: false, authenticity: 'authentic-photo-required',
  remoteAllowed: true, fallbackAllowed: false, loadingPriority: 'eager', altIntent: 'dentist and patient',
  noRepeat: true, expectedContribution: 'trust',
};
function asset(over: Partial<SourcedImageAsset>): SourcedImageAsset {
  return { slotId: 'x', url: 'https://images.example.com/a.jpg', altText: 'a', width: 1600, height: 900, ...over };
}

describe('webBuildImageSourcing — sanitizeImageQuery', () => {
  it('strips hex colours, urls, marketing jargon and noise; bounds length', () => {
    const out = sanitizeImageQuery('revolutionize your #FF00AA workflow https://x.com <b>now</b> cutting-edge synergy dental clinic');
    expect(out).not.toMatch(/#|https?:|<|>|revolutioni|cutting-edge|synerg/i);
    expect(out).toMatch(/dental clinic/);
    expect(out.length).toBeLessThanOrEqual(140);
  });
  it('never throws on empty/undefined', () => {
    expect(sanitizeImageQuery(undefined)).toBe('');
    expect(sanitizeImageQuery('')).toBe('');
  });
});

describe('webBuildImageSourcing — art-direction-aware needs', () => {
  it('consumes visualConcept image-role art direction into the query plan', () => {
    const s = spec({ visualConcept: { imageRoles: [heroRole] } } as never);
    const needs = deriveImageNeeds(s);
    expect(needs.length).toBe(1);
    const n = needs[0];
    expect(n.slotId).toBe('hero1');
    // primary query is composed from the concrete subject + framing + lighting + orientation.
    expect(n.query).toMatch(/dentist/);
    expect(n.query).toMatch(/wide horizontal composition|negative space|focal/);
    expect(n.queryVariants && n.queryVariants.length).toBeGreaterThanOrEqual(2);
    expect(n.people).toBe('required');
    expect(n.authenticity).toBe('authentic-photo-required');
    expect(n.loadingPriority).toBe('eager');
    expect(n.noRepeat).toBe(true);
    // query variants are bounded and sanitized.
    for (const v of n.queryVariants!) { expect(v.length).toBeLessThanOrEqual(160); expect(v).not.toMatch(/#[0-9a-f]{3}/i); }
    expect(n.queryVariants!.length).toBeLessThanOrEqual(4);
  });

  it('is deterministic', () => {
    const s = spec({ visualConcept: { imageRoles: [heroRole] } } as never);
    expect(JSON.stringify(deriveImageNeeds(s))).toBe(JSON.stringify(deriveImageNeeds(s)));
  });

  it('works WITHOUT visualConcept (backward-compatible; still produces a usable need)', () => {
    const needs = deriveImageNeeds(spec());
    expect(needs.length).toBe(1);
    expect(needs[0].slotId).toBe('hero1');
    expect(needs[0].query.length).toBeGreaterThan(0);
    // no art direction available → optional fields undefined, but the need is still valid.
    expect(needs[0].queryVariants === undefined || Array.isArray(needs[0].queryVariants)).toBe(true);
  });

  it('respects an explicit no-photo spec by producing zero needs', () => {
    const s = spec({ assets: { imageSlots: [] } } as never);
    expect(deriveImageNeeds(s).length).toBe(0);
  });
});

describe('webBuildImageSourcing — refineSourcedAssets (filter + cross-role dedup)', () => {
  const needs: ImageNeed[] = [
    { slotId: 'hero1', purpose: 'hero', query: 'q', orientation: 'landscape', required: true, altText: 'h' },
    { slotId: 'g1', purpose: 'gallery', query: 'q', orientation: 'landscape', required: false, altText: 'g' },
    { slotId: 'g2', purpose: 'gallery', query: 'q', orientation: 'landscape', required: false, altText: 'g' },
  ];

  it('prevents the same asset from filling two distinct roles (exact + normalized + provider-id)', () => {
    const assets = [
      asset({ slotId: 'hero1', url: 'https://cdn/x.jpg?w=1600', provider: 'pexels', providerImageId: '1' }),
      asset({ slotId: 'g1', url: 'https://cdn/x.jpg?w=800', provider: 'pexels', providerImageId: '1' }),   // same normalized url + provider id
      asset({ slotId: 'g2', url: 'https://cdn/x.jpg', provider: 'pexels', providerImageId: '1' }),          // exact/norm dup
    ];
    const r = refineSourcedAssets(needs, assets);
    expect(r.assets.length).toBe(1);
    expect(r.assets[0].slotId).toBe('hero1');   // first claimant (hero) wins
    expect(r.diagnostics.roleReuseDuplicatesPrevented).toBe(2);
  });

  it('rejects malformed URLs and placeholder/logo assets', () => {
    const assets = [
      asset({ slotId: 'hero1', url: 'not a url' }),
      asset({ slotId: 'g1', url: 'https://cdn/placeholder.png' }),
      asset({ slotId: 'g2', url: 'https://cdn/company-logo.svg' }),
    ];
    const r = refineSourcedAssets(needs, assets);
    expect(r.assets.length).toBe(0);
    expect(r.diagnostics.malformedRejected).toBe(1);
    expect(r.diagnostics.placeholderOrLogoRejected).toBe(2);
  });

  it('keeps assets but NOTES orientation/resolution issues (never a hard drop)', () => {
    const assets = [
      asset({ slotId: 'hero1', url: 'https://cdn/portrait.jpg', width: 600, height: 1200 }),   // portrait + low-res for a landscape hero
    ];
    const r = refineSourcedAssets(needs, assets);
    expect(r.assets.length).toBe(1);   // kept — builder can object-fit crop; coverage owns the hard block
    expect(r.diagnostics.orientationMismatchNoted).toBe(1);
    expect(r.diagnostics.lowResolutionNoted).toBe(1);
  });

  it('keeps distinct real assets and records provider distribution', () => {
    const assets = [
      asset({ slotId: 'hero1', url: 'https://cdn/a.jpg', provider: 'pexels', providerImageId: '1' }),
      asset({ slotId: 'g1', url: 'https://cdn/b.jpg', provider: 'unsplash', providerImageId: '2' }),
    ];
    const r = refineSourcedAssets(needs, assets);
    expect(r.assets.length).toBe(2);
    expect(r.diagnostics.providerDistribution).toEqual({ pexels: 1, unsplash: 1 });
    expect(r.diagnostics.roleReuseDuplicatesPrevented).toBe(0);
  });

  it('fails open on empty/garbage input', () => {
    expect(refineSourcedAssets([], []).assets).toEqual([]);
    expect(() => refineSourcedAssets(needs, [null as unknown as SourcedImageAsset])).not.toThrow();
  });
});
