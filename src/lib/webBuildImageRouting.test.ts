import { describe, it, expect, vi, afterEach } from 'vitest';
import { sourceStockImagesForPayload, routeImageNeeds, type ImageNeed } from '@/lib/webBuildImageSourcing';
import { deriveImageSourceStrategyForSpec } from '@/lib/webBuildImageSourceStrategy';
import { deriveDesignIntelligence } from '@/lib/webBuildDesignIntelligence';
import { analyzeBindingAcceptance } from '@/lib/webBuildRequirementAnalysis';
import { buildOptimizationGuardPolicy } from '@/lib/experienceIntelligence';
import { analyzeOptimization } from '@/lib/webBuildOptimizationPass';
import { placedMediaIdsForSpec } from '@/lib/webBuildFrontendQuality';
import {
  buildFrontendBuilderRequest, buildFrontendBuilderRevisionRequest,
  buildFrontendBuilderReviewRequest, buildFrontendBuilderRepairRequest,
  SAFE_FRONTEND_BUILDER_REQUEST_CHARS,
} from '@/lib/webBuildApi';
import fs from 'node:fs';
import path from 'node:path';
import type { WebBuildPayload } from '@/lib/webBuildPayload';
import type { FrontendBuildSpecification, FrontendSpecImageSlot } from '@/lib/webBuildAgents';

/* ── Scripted backend. The assertions are about WHICH endpoints were called, so a hidden
 *    provider call (from an app build, or from a build that routed nothing to it) fails. ── */
interface Call { url: string; body?: Record<string, unknown> }
function mockBackend(o: { health?: unknown; generate?: unknown; stock?: unknown } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.endsWith('/images/health')) return { ok: true, status: 200, json: async () => o.health } as never;
    if (u.endsWith('/images/generate')) return { ok: true, status: 200, json: async () => o.generate } as never;
    return { ok: true, status: 200, json: async () => o.stock ?? { status: 'no-results', assets: [], requested: 0, sourced: 0, elapsedMs: 1 } } as never;
  }));
  return calls;
}
const HEALTH_OK = { enabled: true, provider: 'openai', configured: true, ownerOnly: false, video: false };
const GENERATED_OK = {
  slotId: 'hero', status: 'ready', url: 'https://cdn.example.com/gen-hero.png',
  assetId: 'as_1', persisted: true, provider: 'openai', honestyLabel: '', promptSummary: '',
  width: 1792, height: 1024,
};
const urlsOf = (calls: Call[], suffix: string) => calls.filter((c) => c.url.endsWith(suffix));

afterEach(() => { vi.unstubAllGlobals(); });

function slot(id: string, kind: string, target = 'section:hero', purpose = ''): FrontendSpecImageSlot {
  return { id, target, kind, source: 'provider-ready', purpose, manualUploadRecommended: false, providerReady: true };
}

/** A minimal spec whose routing contract is supplied explicitly, so the routing behaviour under
 *  test is the SOURCING integration, not the (separately tested) classification. */
function payloadWith(over: Partial<FrontendBuildSpecification>, slots: FrontendSpecImageSlot[]): WebBuildPayload {
  const spec = {
    buildType: 'web',
    prompt: 'a product website',
    identity: { siteType: 'website', sector: 'ai-saas', subsector: 'analytics platform', primaryConcept: 'a team analytics platform' },
    designSystem: {},
    architecture: { sections: [{ id: 'hero', name: 'Hero', order: 0, bullets: [] }] },
    assets: { imageSlots: slots },
    ...over,
  } as unknown as FrontendBuildSpecification;
  return { artifacts: { frontendBuildSpec: spec } } as unknown as WebBuildPayload;
}

const GEN_HERO_STRATEGY = {
  version: 'image-source-strategy-v1' as const,
  buildType: 'web' as const,
  mediaNecessity: 'beneficial' as const, leadVisual: 'optional' as const,
  primaryMediaKind: 'interface-preview' as const, imageryRole: 'supporting' as const,
  coverageMode: 'optional' as const, photographyPosture: 'graphic-first' as const,
  decisions: [{
    slotId: 'hero', sectionId: 'hero', role: 'hero-signature' as const, kind: 'hero-image',
    hero: true, required: false, strategy: 'generated' as const, reason: 'brand-defining-concept' as const,
    basis: ['art-direction' as const], evidence: [], fallback: ['stock' as const, 'none' as const],
    authenticity: 'generatable' as const, medium: 'abstract-generative' as const, aspectRatio: '16:9',
  }],
  stockCount: 0, generatedCount: 1, noneCount: 0,
  generatedBudget: 1, generatedCeiling: 2, reasons: ['brand-defining-concept' as const],
};

describe('image routing — the generated arm inside the real sourcing pipeline', () => {
  it('places a generated hero: health + ONE generate, and the slot renders like any other image', async () => {
    const calls = mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload, manifest } = await sourceStockImagesForPayload(p);

    expect(urlsOf(calls, '/images/health')).toHaveLength(1);
    expect(urlsOf(calls, '/images/generate')).toHaveLength(1);
    // Nothing was routed to stock, so no stock request was made at all.
    expect(urlsOf(calls, '/stock/source')).toHaveLength(0);

    const enriched = payload.artifacts!.frontendBuildSpec!.assets!.imageSlots![0];
    expect(enriched.url).toBe('https://cdn.example.com/gen-hero.png');
    expect(enriched.imageSource).toBe('generated');
    expect(enriched.honestyLabel).toMatch(/AI-generated/i);
    expect(enriched.domId).toBeTruthy();
    // A generated visual has no photographer/provider to attribute.
    expect(enriched.imageProvider).toBeUndefined();
    expect(enriched.photographer).toBeUndefined();
    expect(manifest.generatedImagery?.produced).toBe(1);
    expect(manifest.sourceStrategy?.generatedCount).toBe(1);
  });

  it('a generated slot never enters the stock request — no search and no vision rerank is paid for it', async () => {
    const mixed = {
      ...GEN_HERO_STRATEGY, stockCount: 1, generatedCount: 1,
      decisions: [
        GEN_HERO_STRATEGY.decisions[0],
        { ...GEN_HERO_STRATEGY.decisions[0], slotId: 'gallery', hero: false, kind: 'gallery-photo', strategy: 'stock' as const, reason: 'proof-heavy-subject' as const, fallback: ['none' as const] },
      ],
    };
    const calls = mockBackend({
      health: HEALTH_OK, generate: GENERATED_OK,
      stock: { status: 'ok', assets: [{ slotId: 'gallery', url: 'https://images.example.com/g.jpg', altText: 'g', width: 1600, height: 900, provider: 'pexels' }], requested: 1, sourced: 1, elapsedMs: 4 },
    });
    const p = payloadWith({ imageSourceStrategy: mixed }, [slot('hero', 'hero-image'), slot('gallery', 'gallery-photo', 'section:gallery', 'gallery')]);
    const { payload } = await sourceStockImagesForPayload(p);
    const stockCall = urlsOf(calls, '/stock/source')[0];
    const sent = (stockCall.body as { needs: Array<{ slotId: string }> }).needs.map((n) => n.slotId);
    expect(sent).toEqual(['gallery']);                    // the hero was generated, not searched
    const slots = payload.artifacts!.frontendBuildSpec!.assets!.imageSlots!;
    expect(slots.find((x) => x.id === 'hero')!.imageSource).toBe('generated');
    expect(slots.find((x) => x.id === 'gallery')!.imageSource).toBe('stock');
    // Distinct images — one source can never duplicate the other's asset.
    expect(slots[0].url).not.toBe(slots[1].url);
    expect(new Set(slots.map((x) => x.domId)).size).toBe(2);
  });

  it('falls back to stock IN THE SAME single stock request when generation fails', async () => {
    const calls = mockBackend({
      health: HEALTH_OK,
      generate: { slotId: 'hero', status: 'failed', reason: 'provider error', honestyLabel: '', promptSummary: '' },
      stock: { status: 'ok', assets: [{ slotId: 'hero', url: 'https://images.example.com/p.jpg', altText: 'a', width: 1600, height: 900, provider: 'pexels' }], requested: 1, sourced: 1, elapsedMs: 5 },
    });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    expect(urlsOf(calls, '/stock/source')).toHaveLength(1);
    const enriched = payload.artifacts!.frontendBuildSpec!.assets!.imageSlots![0];
    expect(enriched.imageSource).toBe('stock');
    expect(enriched.url).toBe('https://images.example.com/p.jpg');
  });

  it('leaves the slot with NO image rather than an irrelevant one when stock is not an honest fallback', async () => {
    const noStockFallback = {
      ...GEN_HERO_STRATEGY,
      decisions: [{ ...GEN_HERO_STRATEGY.decisions[0], fallback: ['none' as const] }],
    };
    const calls = mockBackend({ health: HEALTH_OK, generate: { slotId: 'hero', status: 'failed', honestyLabel: '', promptSummary: '' } });
    const p = payloadWith({ imageSourceStrategy: noStockFallback }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    expect(urlsOf(calls, '/stock/source')).toHaveLength(0);
    expect(payload.artifacts!.frontendBuildSpec!.assets!.imageSlots![0].url).toBeUndefined();
  });

  it('a provider outage never fails the build — the payload still comes back usable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    await expect(sourceStockImagesForPayload(p)).resolves.toBeTruthy();
  });
});

describe('image routing — App Build isolation (proof)', () => {
  it('an app build makes NO generated-image call, not even a health probe', async () => {
    const calls = mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    // Even with a (impossible) routing contract present on the spec, buildType app wins.
    const p = payloadWith({ buildType: 'app', imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    await sourceStockImagesForPayload(p);
    expect(urlsOf(calls, '/images/health')).toHaveLength(0);
    expect(urlsOf(calls, '/images/generate')).toHaveLength(0);
    // The stock path is untouched for an app build.
    expect(urlsOf(calls, '/stock/source')).toHaveLength(1);
  });

  it('an app build never carries a routing contract, so nothing can route it', () => {
    const p = payloadWith({ buildType: 'app' }, [slot('hero', 'hero-image')]);
    expect(deriveImageSourceStrategyForSpec(p.artifacts!.frontendBuildSpec!)).toBeUndefined();
  });

  it('the web-only routing vocabulary never reaches an app generation request', () => {
    const p = payloadWith({ buildType: 'app', imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const req = buildFrontendBuilderRequest(p.artifacts!.frontendBuildSpec!);
    expect(req).not.toMatch(/AI-GENERATED/);
    expect(req).not.toMatch(/imageSource/);
  });
});

describe('image routing — need routing rules', () => {
  const need = (slotId: string, required = false): ImageNeed => ({
    slotId, purpose: 'hero', query: 'q', orientation: 'landscape', required, altText: 'a',
  });

  it('with NO contract every need stays stock (byte-for-byte the previous behaviour)', () => {
    const r = routeImageNeeds([need('a'), need('b')], undefined);
    expect(r.stock).toHaveLength(2);
    expect(r.generated).toHaveLength(0);
    expect(r.suppressed).toHaveLength(0);
  });

  it('a need with no decision stays stock', () => {
    const r = routeImageNeeds([need('unknown')], GEN_HERO_STRATEGY);
    expect(r.stock.map((n) => n.slotId)).toEqual(['unknown']);
  });

  it('"none" suppresses an optional need but can never remove one the COVERAGE FLOOR requires', () => {
    const noneStrategy = {
      ...GEN_HERO_STRATEGY,
      decisions: [
        { ...GEN_HERO_STRATEGY.decisions[0], slotId: 'opt', strategy: 'none' as const, required: false, fallback: [] },
        { ...GEN_HERO_STRATEGY.decisions[0], slotId: 'req', strategy: 'none' as const, required: true, fallback: [] },
      ],
    };
    const r = routeImageNeeds([need('opt'), need('req', true)], noneStrategy);
    expect(r.suppressed.map((n) => n.slotId)).toEqual(['opt']);
    expect(r.stock.map((n) => n.slotId)).toEqual(['req']);
    expect(r.floorProtected).toBe(1);
  });

  it('the deterministic planner\'s own hero marker is NOT a coverage floor', () => {
    // `deriveImageNeeds` marks every hero need `required` — that means "this is the lead slot",
    // not "the coverage authority demands an image". A `none` verdict must still apply.
    const noneStrategy = {
      ...GEN_HERO_STRATEGY, coverageMode: 'optional' as const,
      decisions: [{ ...GEN_HERO_STRATEGY.decisions[0], strategy: 'none' as const, required: false, fallback: [] }],
    };
    const r = routeImageNeeds([need('hero', true)], noneStrategy);
    expect(r.suppressed.map((n) => n.slotId)).toEqual(['hero']);
    // …but an image-led/required coverage mode DOES protect it.
    const enforced = { ...noneStrategy, coverageMode: 'image-led' as const };
    expect(routeImageNeeds([need('hero', true)], enforced).stock.map((n) => n.slotId)).toEqual(['hero']);
  });

  it('a suppressed need is never sent to the stock provider', async () => {
    const noneStrategy = {
      ...GEN_HERO_STRATEGY, generatedCount: 0, noneCount: 1,
      decisions: [{ ...GEN_HERO_STRATEGY.decisions[0], strategy: 'none' as const, fallback: [] }],
    };
    const calls = mockBackend({});
    const p = payloadWith({ imageSourceStrategy: noneStrategy }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    expect(urlsOf(calls, '/stock/source')).toHaveLength(0);
    expect(payload.artifacts!.frontendBuildSpec!.assets!.imageSlots![0].url).toBeUndefined();
  });

  it('routing can never INCREASE the number of images a build asks for', () => {
    const needs = [need('a'), need('b'), need('c')];
    const r = routeImageNeeds(needs, GEN_HERO_STRATEGY);
    expect(r.stock.length + r.generated.length + r.suppressed.length).toBe(needs.length);
  });
});

describe('image routing — Quality V2 and the optimizer', () => {
  const files = [
    { path: 'src/components/Hero.tsx', language: 'tsx', content: '<section><img src="https://images.example.com/a.jpg" alt="a busy office team meeting" /><img src="https://images.example.com/b.jpg" alt="a person at a desk" /></section>' },
    { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){return <div/>;}' },
  ] as never;

  it('flags photography rendered where the routing said the interface IS the visual', () => {
    const routing = {
      ...GEN_HERO_STRATEGY, stockCount: 0, generatedCount: 0, noneCount: 1,
      mediaNecessity: 'unnecessary' as const,
      decisions: [{ ...GEN_HERO_STRATEGY.decisions[0], strategy: 'none' as const, reason: 'interface-native-visual' as const, fallback: [] }],
      reasons: ['interface-native-visual' as const],
    };
    const res = analyzeBindingAcceptance(files, undefined, undefined, undefined, routing);
    const issue = res.issues.find((i) => i.code === 'unnecessary-imagery-used');
    expect(issue).toBeTruthy();
    expect(issue!.severity).toBe('minor');          // advisory — it must never block acceptance
    expect(res.status).not.toBe('fail');
  });

  it('does NOT flag a build that legitimately routed images to stock or generated', () => {
    const res = analyzeBindingAcceptance(files, undefined, undefined, undefined, GEN_HERO_STRATEGY);
    expect(res.issues.find((i) => i.code === 'unnecessary-imagery-used')).toBeUndefined();
  });

  it('adds no finding at all for an app build (no contract is passed)', () => {
    const res = analyzeBindingAcceptance(files, undefined, undefined, undefined, undefined);
    expect(res.issues.find((i) => i.code === 'unnecessary-imagery-used')).toBeUndefined();
  });

  it('the optimizer never proposes lazy-loading a PLACED lead image, whatever its source', () => {
    const contract = {
      buildType: 'web',
      media: { leadVisual: 'required' },
      optimization: {
        protectedFiles: [], protectedMediaSlotIds: [], protectedElements: [],
        motion: { maxSimultaneousAnimations: 2 }, aboveFold: { maxMediaAssets: 1 },
        visualComplexity: { maxBlurLayers: 2 },
      },
    } as never;
    const policy = buildOptimizationGuardPolicy(contract, 'src/components/Hero.tsx', ['home.hero.image']);
    expect(policy!.protectedMediaSlotIds).toContain('home.hero.image');
    const generatedFiles = [
      { path: 'src/components/Feature.tsx', language: 'tsx', content: '<img data-korvix-id="home.hero.image" src="https://cdn.example.com/gen-hero.png" alt="art" />' },
    ] as never;
    const report = analyzeOptimization(generatedFiles, { heroComponentPath: 'src/components/Hero.tsx', policy });
    expect(report?.findings.find((f) => f.code === 'eager-offscreen-image')).toBeUndefined();
    expect(report?.measured?.guardSuppressedCount).toBeGreaterThan(0);
  });
});

describe('image routing — the builder contract', () => {
  it('tells the builder a generated visual is AI artwork, and never attributes a photographer', async () => {
    mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    const req = buildFrontendBuilderRequest(payload.artifacts!.frontendBuildSpec!);
    expect(req).toMatch(/REAL SOURCED IMAGES:/);
    expect(req).toMatch(/AI-GENERATED/);
    expect(req).toMatch(/never attribute a photographer/);
  });

  it('a stock-only build image block is unchanged (no generated clauses)', async () => {
    mockBackend({ stock: { status: 'ok', assets: [{ slotId: 'hero', url: 'https://images.example.com/p.jpg', altText: 'a', width: 1600, height: 900, provider: 'pexels' }], requested: 1, sourced: 1, elapsedMs: 3 } });
    const p = payloadWith({}, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    const req = buildFrontendBuilderRequest(payload.artifacts!.frontendBuildSpec!);
    expect(req).toMatch(/REAL SOURCED IMAGES:/);
    expect(req).not.toMatch(/AI-GENERATED/);
  });
});

describe('image routing — persistence, revision and architecture invariants', () => {
  it('a generated image is DURABLE: it survives the payload round-trip and is never a data: URL', async () => {
    mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload, manifest } = await sourceStockImagesForPayload(p);
    const restored = JSON.parse(JSON.stringify(payload)) as typeof payload;
    const restoredSlot = restored.artifacts!.frontendBuildSpec!.assets!.imageSlots![0];
    expect(restoredSlot.url).toBe('https://cdn.example.com/gen-hero.png');
    expect(restoredSlot.imageSource).toBe('generated');
    // A session-only base64 payload must never reach a persisted build.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/data:image\//);
    expect(manifest.assets.every((a) => /^https?:\/\//.test(a.url))).toBe(true);
  });

  it('a REVISION never re-sources or regenerates: its request carries no image slot at all', async () => {
    mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    vi.unstubAllGlobals();
    const calls = mockBackend({});
    const req = buildFrontendBuilderRevisionRequest({
      revisionPrompt: 'make the headline shorter',
      websiteLanguage: 'en',
      specification: payload.artifacts!.frontendBuildSpec!,
      files: [{ path: 'src/App.tsx', content: '<img src="https://cdn.example.com/gen-hero.png" />' } as never],
      revisionScope: 'narrow' as never,
    });
    // The revision model is handed the SOURCE as the truth; no image slot, no routing contract,
    // and building the request performs no provider call of any kind.
    expect(req).not.toMatch(/imageSlots/);
    expect(req).not.toMatch(/imageSourceStrategy/);
    expect(calls).toHaveLength(0);
  });

  it('there is exactly ONE art-direction resolver (no duplicate purpose→role map)', () => {
    const src = fs.readFileSync(path.resolve('src/lib/webBuildImageSourcing.ts'), 'utf8');
    // The sourcing module must resolve art direction through the strategy module's ONE lookup.
    expect(src).toMatch(/resolveImageRoleForSlot/);
    expect(src).not.toMatch(/PURPOSE_TO_ROLE\s*:/);
  });

  it('the generated route is reachable from exactly ONE module (no parallel image system)', () => {
    const files = fs.readdirSync(path.resolve('src/lib')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const callers = files.filter((f) => /runGeneratedImagery\(/.test(fs.readFileSync(path.resolve('src/lib', f), 'utf8')));
    expect(callers.sort()).toEqual(['webBuildGeneratedImagery.ts', 'webBuildImageSourcing.ts']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL RE-REVIEW regressions.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('image routing — adversarial regressions', () => {
  it('the routing contract never rides a review or repair model call', async () => {
    // Defect: `specForQualityTask` stripped designIntelligence + experienceIntelligence but not
    // the routing contract, so ~1.5–4k chars were resent on EVERY review and repair call and the
    // reviewer was invited to judge against a contract Quality V2 does not own.
    mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    const spec = payload.artifacts!.frontendBuildSpec!;
    expect(spec.imageSourceStrategy).toBeTruthy();     // still persisted on the spec

    const files = [{ path: 'src/App.tsx', content: 'export default function App(){return <div/>;}' }] as never;
    const review = buildFrontendBuilderReviewRequest(spec, files, 'initial' as never);
    const repair = buildFrontendBuilderRepairRequest(
      spec, files, { issues: [], strengths: [] } as never,
    );
    for (const req of [review, repair]) {
      expect(req).not.toMatch(/imageSourceStrategy/);
      expect(req).not.toMatch(/image-source-strategy-v1/);
      expect(req).not.toMatch(/brand-defining-concept/);
    }
    // …but the BUILDER request still carries what the model must honour: the slot url + source.
    const builder = buildFrontendBuilderRequest(spec);
    expect(builder).toMatch(/gen-hero\.png/);
    expect(builder).toMatch(/AI-GENERATED/);
  });

  it('a required target covered by a GENERATED image is not reported as unrendered', () => {
    // Defect: coverage acceptance matched a required target to a rendered image by token overlap
    // only. A generated visual's honest alt ("Illustrative brand artwork…") shares no words with
    // the target's query, so a correctly rendered required image produced a blocking finding.
    const coverage = {
      version: 'image-coverage-v1' as const, mode: 'image-led' as const, minRequired: 1,
      heroRequired: true, stockAllowed: true, stockPreferred: true, aiAllowed: true,
      manualRequired: false, explicitNoPhoto: false, reasons: [],
      targets: [{
        id: 'korvix-coverage-hero', purpose: 'hero' as const, label: 'Hero photography',
        aliases: ['restaurant', 'dining'], required: true, hero: true,
        orientation: 'landscape' as const, query: 'italian restaurant dining room',
        altText: 'Hero photography for an italian restaurant website',
        stockAllowed: true, aiAllowed: true, manualRequired: false,
        authenticityRisk: 'low' as const, slotId: 'hero', matchStatus: 'sourced' as const,
      }],
    };
    const rendered = [{
      path: 'src/components/Hero.tsx',
      language: 'tsx',
      content: '<img src="https://cdn.example.com/gen-hero.png" alt="Illustrative brand artwork" data-korvix-image-slot="hero" data-korvix-id="home.hero.image" />',
    }] as never;
    const res = analyzeBindingAcceptance(rendered, undefined, undefined, coverage);
    expect(res.issues.filter((i) => i.code.startsWith('required-image-'))).toHaveLength(0);
    expect(res.renderedRequiredImageCount).toBe(1);
    expect(res.imageCoverageStatus).toBe('pass');
  });

  it('still fails a required target whose approved asset is NOT rendered', () => {
    const coverage = {
      version: 'image-coverage-v1' as const, mode: 'image-led' as const, minRequired: 1,
      heroRequired: true, stockAllowed: true, stockPreferred: true, aiAllowed: true,
      manualRequired: false, explicitNoPhoto: false, reasons: [],
      targets: [{
        id: 'korvix-coverage-hero', purpose: 'hero' as const, label: 'Hero photography',
        aliases: ['restaurant', 'dining'], required: true, hero: true,
        orientation: 'landscape' as const, query: 'italian restaurant dining room',
        altText: 'Hero photography', stockAllowed: true, aiAllowed: true, manualRequired: false,
        authenticityRisk: 'low' as const, slotId: 'hero', matchStatus: 'sourced' as const,
      }],
    };
    // The url is parked in a constant; no rendered <img> consumes the approved slot.
    const notRendered = [{
      path: 'src/data.ts', language: 'ts',
      content: 'export const HERO = { slot: "hero", url: "https://cdn.example.com/gen-hero.png" };',
    }] as never;
    const res = analyzeBindingAcceptance(notRendered, undefined, undefined, coverage);
    expect(res.issues.some((i) => i.code.startsWith('required-image-'))).toBe(true);
    expect(res.imageCoverageStatus).toBe('fail');
  });

  it('APP BUILD: the optimizer guard is byte-for-byte its previous behaviour', () => {
    // Defect: the "media this build actually placed" guard was computed for every build type,
    // which could change an app build's optimizer findings. It is a web-only fix.
    const appSpec = {
      buildType: 'app',
      assets: { imageSlots: [{ ...slot('hero', 'hero-image'), url: 'https://cdn.example.com/a.png', domId: 'home.hero.image' }] },
      imageCoverage: { targets: [{ id: 't1', required: true, slotId: 'hero' }] },
    } as unknown as FrontendBuildSpecification;
    const webSpec = { ...appSpec, buildType: 'web' } as unknown as FrontendBuildSpecification;
    expect(placedMediaIdsForSpec(appSpec)).toEqual([]);
    expect(placedMediaIdsForSpec(webSpec)).toEqual(['hero', 'home.hero.image']);
  });
});

describe('image routing — the image contract survives priority shedding', () => {
  it('an OVERSIZED request still carries the sourced-image block and its honesty clause', async () => {
    mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    const spec = payload.artifacts!.frontendBuildSpec!;

    // A real Design Intelligence contract gives the request genuine P2/P3/P4 tiers to shed, and a
    // very large section set pushes it far past the safe budget so shedding definitely runs.
    const designIntelligence = deriveDesignIntelligence({
      prompt: 'A SaaS landing page for a team analytics platform with pricing and integrations',
      identity: spec.identity, sections: [], briefText: '',
    });
    const filler = 'x'.repeat(900);
    const bloated = {
      ...spec,
      designIntelligence,
      architecture: {
        ...spec.architecture,
        sections: Array.from({ length: 40 }, (_, i) => ({
          id: `s${i}`, name: `Section ${i}`, order: i, bullets: [filler, filler, filler, filler],
          headline: filler, subheadline: filler, purpose: filler, componentHint: filler,
        })),
      },
    } as unknown as FrontendBuildSpecification;

    const unshed = buildFrontendBuilderRequest({ ...bloated, architecture: spec.architecture } as FrontendBuildSpecification);
    const req = buildFrontendBuilderRequest(bloated);
    expect(req.length).toBeGreaterThan(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);   // shedding ran

    // The P4 tier (the generic fingerprint ban) is dropped first…
    expect(unshed).toMatch(/AI-WEBSITE FINGERPRINTS|FORBIDDEN FINGERPRINTS|fingerprint/i);
    expect(req).not.toMatch(/AI-WEBSITE FINGERPRINTS|FORBIDDEN FINGERPRINTS/i);
    // …while the P1 image contract survives every cut.
    expect(req).toMatch(/REAL SOURCED IMAGES:/);
    expect(req).toMatch(/AI-GENERATED/);
    expect(req).toMatch(/gen-hero\.png/);
  });

  it('the routing verdict itself is never sent to the builder (it is materialized on the slots)', async () => {
    mockBackend({ health: HEALTH_OK, generate: GENERATED_OK });
    const p = payloadWith({ imageSourceStrategy: GEN_HERO_STRATEGY }, [slot('hero', 'hero-image')]);
    const { payload } = await sourceStockImagesForPayload(p);
    const req = buildFrontendBuilderRequest(payload.artifacts!.frontendBuildSpec!);
    expect(req).not.toMatch(/imageSourceStrategy/);
    expect(req).not.toMatch(/image-source-strategy-v1/);
    // What the model actually needs IS there, on the slot.
    expect(req).toMatch(/"imageSource":"generated"/);
  });
});
