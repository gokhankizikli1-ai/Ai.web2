import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildGeneratedArtDirection, buildGeneratedImagePrompt, runGeneratedImagery,
  generationKindFor, durableUrl, GENERATED_HONESTY_LABEL,
} from '@/lib/webBuildGeneratedImagery';
import { MAX_GENERATED_IMAGES_PER_BUILD, type ImageSourceDecision } from '@/lib/webBuildImageSourceStrategy';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

/* ── A tiny scriptable backend. Every test asserts on the EXACT calls made, so a hidden
 *    provider call (especially from an app build) is a test failure, not a nuance. ── */
interface Call { url: string; body?: Record<string, unknown> }
function mockBackend(script: { health?: unknown; generate?: unknown | unknown[]; healthStatus?: number }) {
  const calls: Call[] = [];
  const gens = Array.isArray(script.generate) ? [...script.generate] : (script.generate ? [script.generate] : []);
  let lastGen: unknown;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/images/health')) {
      if (script.healthStatus && script.healthStatus >= 400) return { ok: false, status: script.healthStatus } as never;
      return { ok: true, status: 200, json: async () => script.health } as never;
    }
    // Repeat the LAST scripted response for every further call (an empty queue used to yield
    // `undefined`, which silently turned a second attempt into a 'failed' outcome).
    if (gens.length) lastGen = gens.shift();
    return { ok: true, status: 200, json: async () => lastGen } as never;
  }));
  return calls;
}
const HEALTH_OK = { enabled: true, provider: 'openai', configured: true, ownerOnly: false, video: false };

afterEach(() => { vi.unstubAllGlobals(); });

const HERO_ROLE = {
  slotId: 'hero', sectionId: 'hero', role: 'hero-signature', required: true,
  narrativePurpose: 'lead visual', subject: 'a layered abstract field of intersecting data planes',
  medium: 'abstract-generative', orientation: 'landscape', aspectRatio: '16:9',
  crop: 'wide, generous headroom for overlaid copy', focalPoint: 'upper-third calm zone',
  placement: 'first viewport', mobileCrop: 'tighter', lighting: 'cool rim light with a single warm accent',
  tone: 'precise, calm, technical', peoplePresent: 'avoid', devicesUseful: false,
  authenticity: 'generatable', remoteAllowed: true, fallbackAllowed: true,
  loadingPriority: 'eager', altIntent: 'Abstract artwork of intersecting planes', noRepeat: true,
  expectedContribution: 'signature first impression',
};

function spec(over: Partial<FrontendBuildSpecification> = {}): FrontendBuildSpecification {
  return {
    buildType: 'web',
    identity: { primaryConcept: 'a team analytics platform', sector: 'ai-saas' },
    designSystem: { firstImpression: 'calm technical confidence', selectedVisualDirection: 'restrained instrument-grade minimalism' },
    visualConcept: {
      visualThesis: 'intelligence made tangible',
      distinctiveness: 'a living data field, never a floating dashboard on a gradient',
      exclusions: ['three glowing glass cards over a purple gradient'],
      signature: { dominantSubject: 'a living data field', layeringStrategy: 'three depth planes', prohibited: ['fake ticker numbers'] },
      imageRoles: [HERO_ROLE],
      realImageStrategy: { posture: 'graphic-first' },
    },
    ...over,
  } as unknown as FrontendBuildSpecification;
}

const decision = (over: Partial<ImageSourceDecision> = {}): ImageSourceDecision => ({
  slotId: 'hero', sectionId: 'hero', role: 'hero-signature', kind: 'hero-image',
  hero: true, required: true, strategy: 'generated', reason: 'brand-defining-concept',
  basis: ['art-direction'], evidence: [], fallback: ['none'],
  authenticity: 'generatable', medium: 'abstract-generative', aspectRatio: '16:9', ...over,
});

describe('generated imagery — the art-direction contract', () => {
  it('carries every art-direction field the generated route is supposed to receive', () => {
    const ad = buildGeneratedArtDirection(decision(), { spec: spec() });
    expect(ad.subject).toContain('intersecting data planes');
    expect(ad.framing).toContain('headroom');
    expect(ad.composition).toContain('depth planes');
    expect(ad.lighting).toContain('rim light');
    expect(ad.focalPoint).toContain('upper-third');
    expect(ad.negativeSpace).toBe(true);
    expect(ad.textSafeArea).toMatch(/readable/);
    expect(ad.brandTone).toBeTruthy();
    expect(ad.visualStyle).toBeTruthy();
    expect(ad.aspectRatio).toBe('16:9');
    expect(ad.orientation).toBe('landscape');
    expect(ad.sectionRole).toMatch(/first-viewport/);
    expect(ad.altText).toContain('Abstract artwork');
  });

  it('states the fabrication boundary explicitly', () => {
    const ad = buildGeneratedArtDirection(decision(), { spec: spec() });
    const constraints = ad.authenticityConstraints.join(' ').toLowerCase();
    expect(constraints).toMatch(/decorative|illustrative/);
    expect(constraints).toMatch(/certification|award|partnership|customer|metric/);
    const forbidden = ad.forbidden.join(' ').toLowerCase();
    expect(forbidden).toMatch(/logo/);
    expect(forbidden).toMatch(/text|lettering/);
    // The visual concept's own exclusions are carried through, not restated generically.
    expect(forbidden).toMatch(/glass cards/);
  });

  it('is never generic: with no art direction it still names THIS product', () => {
    const bare = { buildType: 'web', identity: { primaryConcept: 'a neighbourhood ceramics studio' } } as unknown as FrontendBuildSpecification;
    const ad = buildGeneratedArtDirection(decision({ role: undefined }), { spec: bare });
    expect(ad.subject).toContain('ceramics studio');
    expect(ad.subject).not.toBe('a modern SaaS image');
  });

  it('renders a specific prompt, and a negative prompt that blocks fabricated proof', () => {
    const p = buildGeneratedImagePrompt(buildGeneratedArtDirection(decision(), { spec: spec() }));
    expect(p.positive).toContain('intersecting data planes');
    expect(p.positive).toMatch(/Composition:/);
    expect(p.positive).toMatch(/Lighting:/);
    expect(p.positive).toMatch(/Negative space:/);
    expect(p.positive).toMatch(/landscape 16:9/);
    expect(p.positive.length).toBeLessThanOrEqual(1200);
    expect(p.negative.toLowerCase()).toMatch(/logo/);
    expect(p.safetyNotes.length).toBeGreaterThan(0);
    expect(p.aspectRatio).toBe('16:9');
  });

  it('only ever asks for an illustrative-safe slot kind', () => {
    expect(generationKindFor(decision({ kind: 'hero-image' }))).toBe('hero-image');
    expect(generationKindFor(decision({ kind: 'gallery-photo' }))).toBe('hero-image');       // hero → safe kind
    expect(generationKindFor(decision({ kind: 'gallery-photo', hero: false }))).toBe('abstract-brand-image');
  });
});

describe('generated imagery — the route', () => {
  it('produces a durable, honestly-labelled asset (ONE health probe + ONE provider call)', async () => {
    const calls = mockBackend({
      health: HEALTH_OK,
      generate: { slotId: 'hero', status: 'ready', url: 'https://cdn.example.com/a.png', assetId: 'as_1', persisted: true, provider: 'openai', honestyLabel: '', promptSummary: '', width: 1792, height: 1024 },
    });
    const res = await runGeneratedImagery([decision()], { spec: spec(), budget: 1 });
    expect(calls.filter((c) => c.url.endsWith('/images/health'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(1);
    expect(res.assets).toHaveLength(1);
    expect(res.assets[0].source).toBe('generated');
    expect(res.assets[0].url).toBe('https://cdn.example.com/a.png');
    expect(res.assets[0].honestyLabel).toBe(GENERATED_HONESTY_LABEL);
    expect(res.diagnostics.produced).toBe(1);
    expect(res.diagnostics.providerCalls).toBe(1);
    // The request asks for durable persistence and carries the real art direction.
    const body = calls.find((c) => c.url.endsWith('/images/generate'))!.body as Record<string, unknown>;
    expect(body.persist).toBe(true);
    expect(body.kind).toBe('hero-image');
    expect(String((body.prompt as { positive: string }).positive)).toContain('intersecting data planes');
  });

  it('refuses a NON-durable result (a session-only data URL is never used)', async () => {
    mockBackend({ health: HEALTH_OK, generate: { slotId: 'hero', status: 'ready', dataUrl: 'data:image/png;base64,AAA', persisted: false, honestyLabel: '', promptSummary: '' } });
    const res = await runGeneratedImagery([decision()], { spec: spec(), budget: 1 });
    expect(res.assets).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('not-persistable');
    expect(res.diagnostics.notPersistable).toBe(1);
  });

  it('reports a provider failure honestly and produces nothing', async () => {
    mockBackend({ health: HEALTH_OK, generate: { slotId: 'hero', status: 'failed', reason: 'provider error', honestyLabel: '', promptSummary: '' } });
    const res = await runGeneratedImagery([decision()], { spec: spec(), budget: 1 });
    expect(res.assets).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('failed');
    expect(res.diagnostics.failed).toBe(1);
  });

  it('skips the whole route — with ZERO provider calls — when generation is not enabled', async () => {
    const calls = mockBackend({ health: { ...HEALTH_OK, enabled: false } });
    const res = await runGeneratedImagery([decision()], { spec: spec(), budget: 1 });
    expect(calls.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('provider-unavailable');
    expect(res.diagnostics.providerCalls).toBe(0);
  });

  it('skips the route when the provider is unconfigured, and when health is unreachable', async () => {
    const c1 = mockBackend({ health: { ...HEALTH_OK, configured: false } });
    expect((await runGeneratedImagery([decision()], { spec: spec(), budget: 1 })).diagnostics.providerCalls).toBe(0);
    expect(c1.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(0);
    vi.unstubAllGlobals();
    const c2 = mockBackend({ healthStatus: 500 });
    expect((await runGeneratedImagery([decision()], { spec: spec(), budget: 1 })).diagnostics.providerCalls).toBe(0);
    expect(c2.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(0);
  });

  it('spends at most the budget, and never more than the product-wide ceiling', async () => {
    const calls = mockBackend({
      health: HEALTH_OK,
      generate: { slotId: 'x', status: 'ready', url: 'https://cdn.example.com/x.png', honestyLabel: '', promptSummary: '' },
    });
    const many = Array.from({ length: 5 }, (_, i) => decision({ slotId: `s${i}` }));
    const res = await runGeneratedImagery(many, { spec: spec(), budget: 99 });
    expect(calls.filter((c) => c.url.endsWith('/images/generate')).length).toBe(MAX_GENERATED_IMAGES_PER_BUILD);
    expect(res.outcomes.filter((o) => o.status === 'over-budget').length).toBe(5 - MAX_GENERATED_IMAGES_PER_BUILD);
  });

  it('makes NO call at all when nothing is routed to it', async () => {
    const calls = mockBackend({ health: HEALTH_OK });
    const res = await runGeneratedImagery([], { spec: spec(), budget: 1 });
    expect(calls).toHaveLength(0);
    expect(res.diagnostics.healthCalls).toBe(0);
  });

  it('refuses a proof-heavy slot locally, before any provider call', async () => {
    const calls = mockBackend({ health: HEALTH_OK });
    const res = await runGeneratedImagery([decision({ kind: 'gallery-photo' })], { spec: spec(), budget: 1 });
    expect(calls.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('unsafe-slot');
  });

  it('APP BUILD: no provider call can originate here, not even a health probe', async () => {
    const calls = mockBackend({ health: HEALTH_OK, generate: { slotId: 'hero', status: 'ready', url: 'https://cdn.example.com/a.png', honestyLabel: '', promptSummary: '' } });
    const res = await runGeneratedImagery([decision()], { spec: spec({ buildType: 'app' }), budget: 2 });
    expect(calls).toHaveLength(0);
    expect(res.assets).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('app-build-excluded');
    expect(res.diagnostics.providerCalls).toBe(0);
    expect(res.diagnostics.healthCalls).toBe(0);
  });

  it('never throws — a hostile backend response is an honest outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/images/health')
      ? ({ ok: true, status: 200, json: async () => HEALTH_OK } as never)
      : ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as never))));
    const res = await runGeneratedImagery([decision()], { spec: spec(), budget: 1 });
    expect(res.assets).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('failed');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL RE-REVIEW regressions.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('generated imagery — adversarial regressions', () => {
  it('refuses a non-https ABSOLUTE url (mixed content would render as a broken image)', () => {
    expect(durableUrl({ url: 'http://cdn.example.com/a.png' })).toBe('');
    expect(durableUrl({ url: '//cdn.example.com/a.png' })).toBe('');
    expect(durableUrl({ url: 'data:image/png;base64,AAA' })).toBe('');
    expect(durableUrl({ url: 'javascript:alert(1)' })).toBe('');
    expect(durableUrl({ url: 'https://cdn.example.com/a.png' })).toBe('https://cdn.example.com/a.png');
    // A RELATIVE asset-route url is ours and is resolved against the API base.
    expect(durableUrl({ url: '/v2/assets/blob/abc.png' })).toMatch(/^https?:\/\/.+\/v2\/assets\/blob\/abc\.png$/);
  });

  it('drops the whole result when a provider returns a plain-http image', async () => {
    mockBackend({ health: HEALTH_OK, generate: { slotId: 'hero', status: 'ready', url: 'http://cdn.example.com/a.png', honestyLabel: '', promptSummary: '' } });
    const res = await runGeneratedImagery([decision()], { spec: spec(), budget: 1 });
    expect(res.assets).toHaveLength(0);
    expect(res.outcomes[0].status).toBe('not-persistable');
  });

  it('never lets ONE image fill two slots, even if the provider returns an identical url', async () => {
    const calls = mockBackend({
      health: HEALTH_OK,
      generate: { slotId: 'x', status: 'ready', url: 'https://cdn.example.com/same.png', honestyLabel: '', promptSummary: '' },
    });
    const res = await runGeneratedImagery(
      [decision({ slotId: 'a' }), decision({ slotId: 'b' })], { spec: spec(), budget: 2 },
    );
    expect(calls.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(2);
    expect(res.assets).toHaveLength(1);                       // the duplicate never becomes an asset
    expect(res.diagnostics.duplicatesPrevented).toBe(1);
    expect(res.outcomes.map((o) => o.status)).toEqual(['ready', 'duplicate']);
  });

  it('stops attempting once the route TOTAL wall-clock budget is spent', async () => {
    const calls = mockBackend({
      health: HEALTH_OK,
      generate: { slotId: 'x', status: 'ready', url: 'https://cdn.example.com/a.png', honestyLabel: '', promptSummary: '' },
    });
    // A clock that jumps past the deadline after the first attempt.
    let t = 0;
    const res = await runGeneratedImagery(
      [decision({ slotId: 'a' }), decision({ slotId: 'b' })],
      { spec: spec(), budget: 2, totalBudgetMs: 5000, now: () => { t += 4000; return t; } },
    );
    expect(calls.filter((c) => c.url.endsWith('/images/generate'))).toHaveLength(1);
    expect(res.diagnostics.timedOut).toBe(1);
    expect(res.outcomes.map((o) => o.status)).toEqual(['ready', 'timed-out']);
  });
});
