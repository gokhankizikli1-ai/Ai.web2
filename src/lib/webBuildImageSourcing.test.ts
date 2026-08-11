import { describe, it, expect } from 'vitest';
import {
  deriveImageNeeds,
  sanitizeImageQuery,
  refineSourcedAssets,
  buildStockSourceRequestBody,
  MAX_SOURCED_IMAGES,
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

describe('webBuildImageSourcing — /stock/source wire body carries bounded art direction (Phase 1)', () => {
  const rich: ImageNeed = {
    slotId: 'hero1', purpose: 'hero', query: 'restaurant interior espresso', orientation: 'landscape',
    required: true, altText: 'cozy restaurant', role: 'hero-signature', subject: 'restaurant interior',
    people: 'avoid', framing: 'wide establishing', lighting: 'warm ambient', tone: 'inviting',
    authenticity: 'authentic-photo-required', aspectRatio: '16:9', focalPoint: 'center',
    negativeSpace: true, loadingPriority: 'eager', noRepeat: true, queryVariants: ['a', 'b'],
  };
  const legacy: ImageNeed = {
    slotId: 'sec1', purpose: 'gallery', query: 'ocean resort', orientation: 'landscape',
    required: false, altText: 'beach',
  };

  it('B/C: a rich need serializes its bounded art-direction fields onto the wire', () => {
    const body = buildStockSourceRequestBody([rich]);
    const n = body.needs[0];
    expect(n.role).toBe('hero-signature');
    expect(n.subject).toBe('restaurant interior');
    expect(n.people).toBe('avoid');
    expect(n.authenticity).toBe('authentic-photo-required');
    expect(n.aspectRatio).toBe('16:9');
    expect(n.negativeSpace).toBe(true);
    expect(n.loadingPriority).toBe('eager');
    expect(n.noRepeat).toBe(true);
    expect(n.queryVariants).toEqual(['a', 'b']);
  });

  it('J: a legacy need (no art direction) sends only the base fields — old behavior preserved', () => {
    const n = buildStockSourceRequestBody([legacy]).needs[0];
    expect(n).toEqual({ slotId: 'sec1', purpose: 'gallery', query: 'ocean resort', orientation: 'landscape', required: false, altText: 'beach' });
    // none of the art-direction keys are present
    for (const k of ['role', 'people', 'framing', 'lighting', 'tone', 'authenticity', 'aspectRatio', 'focalPoint', 'loadingPriority']) {
      expect(k in n).toBe(false);
    }
    // absent booleans are NOT forced onto the wire (only sent when the client set them)
    expect('negativeSpace' in n).toBe(false);
    expect('noRepeat' in n).toBe(false);
  });

  it('L/K: exactly ONE batched request body carries every need + the unchanged maxImages cap', () => {
    const body = buildStockSourceRequestBody([rich, legacy]);
    expect(Array.isArray(body.needs)).toBe(true);
    expect(body.needs.length).toBe(2);           // one batched request for all needs
    expect(body.maxImages).toBe(MAX_SOURCED_IMAGES); // provider-side cap unchanged
  });

  it('never leaks non-art-direction / sensitive keys onto a need (bounded field set only)', () => {
    const n = buildStockSourceRequestBody([rich]).needs[0];
    const allowed = new Set(['slotId', 'purpose', 'query', 'orientation', 'required', 'altText',
      'queryVariants', 'role', 'subject', 'people', 'framing', 'lighting', 'tone', 'authenticity',
      'aspectRatio', 'focalPoint', 'negativeSpace', 'loadingPriority', 'noRepeat']);
    for (const k of Object.keys(n)) expect(allowed.has(k)).toBe(true);
  });
});
