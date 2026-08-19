import { describe, it, expect } from 'vitest';
import { deriveDesignIntelligence } from '@/lib/webBuildDesignIntelligence';
import { deriveImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import { deriveVisualConceptContract } from '@/lib/webBuildVisualConcept';
import { deriveExperienceIntelligence } from '@/lib/experienceIntelligence';
import {
  deriveImageSourceStrategy, deriveImageSourceStrategyForSpec, decisionForSlot,
  applyGeneratedBudget, resolveGeneratedBudget, buildImageSourceStrategyDiagnostics,
  resolveImageRoleForSlot, MAX_GENERATED_IMAGES_PER_BUILD,
  type ImageSourceDecision, type ImageSourceStrategy,
} from '@/lib/webBuildImageSourceStrategy';
import { findSpecSlotForTarget, type ImageCoverageTarget } from '@/lib/webBuildImageCoverage';
import type {
  FrontendBuildSpecification, FrontendSpecImageSlot, FrontendSpecSection,
} from '@/lib/webBuildAgents';

/* ────────────────────────────────────────────────────────────────────────────
 * Fixtures are built through the REAL upstream authorities (site archetype →
 * image coverage → visual concept → experience intelligence) and only then
 * routed, so these tests pin the behaviour of the actual pipeline rather than
 * of hand-written contracts that could drift away from it.
 * ──────────────────────────────────────────────────────────────────────────── */
function sec(name: string, order: number): FrontendSpecSection {
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, order, bullets: [] } as unknown as FrontendSpecSection;
}
function slot(id: string, kind: string, target: string, purpose = ''): FrontendSpecImageSlot {
  return { id, target, kind, source: 'provider-ready', purpose, manualUploadRecommended: false, providerReady: true };
}

interface Case {
  label: string;
  prompt: string;
  sector?: string;
  subsector?: string;
  sectionNames?: string[];
  slots: FrontendSpecImageSlot[];
  buildType?: 'web' | 'app';
}

export function buildFixtureSpec(c: Case): FrontendBuildSpecification {
  const sections = (c.sectionNames || ['Hero', 'Features', 'About']).map(sec);
  const built = {
    buildType: c.buildType || 'web',
    prompt: c.prompt,
    identity: {
      siteType: 'website', sector: c.sector, subsector: c.subsector,
      primaryConcept: c.subsector || 'website',
    },
    architecture: { sections },
    assets: { imageSlots: c.slots },
    designSystem: {},
  } as unknown as FrontendBuildSpecification;
  built.designIntelligence = deriveDesignIntelligence({
    prompt: c.prompt, identity: built.identity, sections, briefText: '',
  });
  built.imageCoverage = deriveImageCoverageRequirement(built);
  built.visualConcept = deriveVisualConceptContract({
    identity: built.identity, sections, imageCoverage: built.imageCoverage,
    imageSlots: c.slots, prompt: c.prompt,
  });
  built.experienceIntelligence = deriveExperienceIntelligence({
    prompt: c.prompt, buildType: built.buildType || 'web', identity: built.identity, sections,
    designIntelligence: built.designIntelligence, imageCoverage: built.imageCoverage, imageSlots: c.slots,
  });
  return built;
}

const HERO = slot('hero', 'hero-image', 'section:hero', 'hero');

/** label → { slotId → expected strategy }. One row per required regression fixture. */
const MATRIX: Array<Case & { expect: Record<string, ImageSourceStrategy> }> = [
  {
    label: 'restaurant — the room and the food are real',
    prompt: 'Build a website for a neighbourhood Italian restaurant with the menu, the dining room and reservations',
    sector: 'restaurant-hospitality', subsector: 'italian restaurant',
    sectionNames: ['Hero', 'Menu', 'About'],
    slots: [HERO, slot('dish1', 'food-photo', 'section:menu', 'gallery'), slot('room', 'restaurant-space', 'section:about', 'about')],
    expect: { hero: 'stock', dish1: 'stock', room: 'stock' },
  },
  {
    label: 'photography portfolio — the work IS the argument',
    prompt: 'A portfolio website for a documentary photographer showing selected work and commissions',
    sector: 'portfolio-agency', subsector: 'documentary photographer',
    sectionNames: ['Hero', 'Work', 'About'],
    slots: [HERO, slot('w1', 'portfolio-work-image', 'section:work', 'gallery')],
    expect: { hero: 'stock', w1: 'stock' },
  },
  {
    label: 'local service — real premises and real work',
    prompt: 'A website for a local plumbing company with services, areas served and booking',
    sector: 'local-service', subsector: 'plumbing company',
    sectionNames: ['Hero', 'Services', 'Work'],
    slots: [HERO, slot('work', 'before-after-pair', 'section:work', 'gallery')],
    expect: { hero: 'stock', work: 'stock' },
  },
  {
    label: 'ecommerce / product brand — the goods must be seen',
    prompt: 'An online shop selling handmade ceramics with collections, materials and shipping',
    sector: 'marketplace', subsector: 'ceramics brand',
    sectionNames: ['Hero', 'Shop', 'Materials'],
    slots: [HERO, slot('p1', 'product-listing-image', 'section:shop', 'product')],
    expect: { hero: 'stock', p1: 'stock' },
  },
  {
    label: 'SaaS — the interface leads; the bespoke visual is generated, never office stock',
    prompt: 'A SaaS landing page for a team analytics platform with pricing and integrations',
    sector: 'ai-saas', subsector: 'analytics saas',
    sectionNames: ['Hero', 'Features', 'Pricing'],
    slots: [HERO, slot('f1', 'abstract-brand-image', 'section:features', 'feature')],
    expect: { hero: 'none', f1: 'generated' },
  },
  {
    label: 'developer tool — code, terminal and docs beat any picture',
    prompt: 'A developer product website for an open-source CLI with docs, api reference, install and changelog',
    sector: 'ai-saas', subsector: 'developer cli',
    sectionNames: ['Hero', 'Docs', 'Install'],
    slots: [HERO],
    expect: { hero: 'none' },
  },
  {
    label: 'editorial — reportage photography is real photography',
    prompt: 'An online magazine with articles, columns, contributors and an archive of past issues',
    sector: 'media', subsector: 'online magazine',
    sectionNames: ['Hero', 'Articles', 'Contributors'],
    slots: [HERO, slot('a1', 'gallery-photo', 'section:articles', 'gallery')],
    expect: { hero: 'stock', a1: 'stock' },
  },
  {
    label: 'event / conference — the venue and the speakers exist',
    prompt: 'A conference website with speakers, schedule, venue, tickets and sponsors',
    sector: 'events', subsector: 'tech conference',
    sectionNames: ['Hero', 'Speakers', 'Venue'],
    slots: [HERO, slot('sp', 'team-or-studio-photo', 'section:speakers', 'team')],
    expect: { hero: 'stock', sp: 'stock' },
  },
  {
    label: 'dashboard-like web experience — no photography at all',
    prompt: 'A web dashboard for internal teams to manage records, monitor pipelines, filter tickets, run queries and see reporting — an admin panel, not a marketing site',
    sector: 'ai-saas', subsector: 'internal admin dashboard',
    sectionNames: ['Hero', 'Dashboard', 'Reporting', 'Pricing'],
    slots: [HERO],
    expect: { hero: 'none' },
  },
  {
    label: 'ambiguous short prompt — unchanged, conservative stock',
    prompt: 'make me a site',
    sectionNames: ['Hero', 'About', 'Contact'],
    slots: [HERO],
    expect: { hero: 'stock' },
  },
  {
    label: 'explicit no-photo — nothing is sourced or generated',
    prompt: 'A typography-only landing page with no images at all for a design studio manifesto',
    sector: 'portfolio-agency', subsector: 'design studio',
    sectionNames: ['Hero', 'Manifesto'],
    slots: [HERO],
    expect: { hero: 'none' },
  },
  /* ── Turkish ── */
  {
    label: 'TR restaurant — same verdict as its English twin',
    prompt: 'Bir meyhane için web sitesi yap; menü, salon fotoğrafları ve rezervasyon olsun',
    sector: 'restaurant-hospitality', subsector: 'meyhane',
    sectionNames: ['Hero', 'Menü', 'Hakkımızda'],
    slots: [HERO, slot('d1', 'food-photo', 'section:menü', 'gallery')],
    expect: { hero: 'stock', d1: 'stock' },
  },
  {
    label: 'TR SaaS — same verdict as its English twin',
    prompt: 'Ekipler için bir analitik SaaS ürününün açılış sayfası: fiyatlandırma, entegrasyonlar ve yönetim paneli',
    sector: 'ai-saas', subsector: 'analitik saas',
    sectionNames: ['Hero', 'Özellikler', 'Fiyatlandırma'],
    slots: [HERO],
    expect: { hero: 'none' },
  },
  /* ── German ── */
  {
    label: 'DE restaurant — same verdict as its English twin',
    prompt: 'Eine Website für ein Restaurant mit Speisekarte, Innenraum-Fotos und Reservierung',
    sector: 'restaurant-hospitality', subsector: 'restaurant',
    sectionNames: ['Hero', 'Speisekarte', 'Über uns'],
    slots: [HERO, slot('d1', 'food-photo', 'section:speisekarte', 'gallery')],
    expect: { hero: 'stock', d1: 'stock' },
  },
  {
    label: 'DE developer tool — same verdict as its English twin',
    prompt: 'Eine Website für ein Entwickler-Werkzeug mit API, SDK, Dokumentation und Terminal-Beispielen',
    sector: 'ai-saas', subsector: 'entwickler werkzeug',
    sectionNames: ['Hero', 'Dokumentation', 'Installation'],
    slots: [HERO],
    expect: { hero: 'none' },
  },
];

describe('image source strategy — archetype × section-role regression matrix', () => {
  for (const c of MATRIX) {
    it(c.label, () => {
      const spec = buildFixtureSpec(c);
      const contract = deriveImageSourceStrategyForSpec(spec);
      expect(contract, 'a web build must carry a routing contract').toBeTruthy();
      for (const [slotId, want] of Object.entries(c.expect)) {
        const d = decisionForSlot(contract, slotId);
        expect(d, `no decision for slot ${slotId}`).toBeTruthy();
        expect(`${slotId}=${d!.strategy}`).toBe(`${slotId}=${want}`);
        // Every decision is attributable: it names the authority and the reason.
        expect(d!.basis.length).toBeGreaterThan(0);
        expect(d!.reason).toBeTruthy();
      }
    });
  }

  it('is deterministic — the same spec always routes identically', () => {
    const spec = buildFixtureSpec(MATRIX[0]);
    expect(JSON.stringify(deriveImageSourceStrategyForSpec(spec)))
      .toBe(JSON.stringify(deriveImageSourceStrategyForSpec(spec)));
  });

  it('never routes a proof-heavy subject to a generated image', () => {
    for (const c of MATRIX) {
      const contract = deriveImageSourceStrategyForSpec(buildFixtureSpec(c));
      for (const d of contract?.decisions || []) {
        if (d.strategy !== 'generated') continue;
        expect(['gallery-photo', 'product-listing-image', 'portfolio-work-image', 'team-or-studio-photo',
          'restaurant-space', 'before-after-pair', 'archive-scan', 'project-photo']).not.toContain(d.kind);
        expect(d.authenticity).not.toBe('authentic-photo-required');
      }
    }
  });

  it('never exceeds the single product-wide generated ceiling on any fixture', () => {
    for (const c of MATRIX) {
      const contract = deriveImageSourceStrategyForSpec(buildFixtureSpec(c));
      expect(contract?.generatedBudget ?? 0).toBeLessThanOrEqual(MAX_GENERATED_IMAGES_PER_BUILD);
      expect(contract?.generatedCount ?? 0).toBeLessThanOrEqual(MAX_GENERATED_IMAGES_PER_BUILD);
    }
  });

  it('routes an archetype by SECTION ROLE, not by a blanket archetype rule', () => {
    // The same restaurant carries a real-photo gallery AND, when its art direction asks for a
    // bespoke ambient band, a generated one — the archetype alone never decides.
    const spec = buildFixtureSpec(MATRIX[0]);
    spec.assets!.imageSlots = [
      ...(spec.assets!.imageSlots || []),
      slot('brandband', 'abstract-brand-image', 'section:hero', 'background'),
    ];
    spec.visualConcept = {
      ...spec.visualConcept!,
      imageRoles: [
        ...(spec.visualConcept?.imageRoles || []),
        {
          slotId: 'brandband', sectionId: 'hero', role: 'background-atmosphere', required: false,
          narrativePurpose: 'ambient band', subject: 'abstract warm material texture',
          medium: 'abstract-generative', orientation: 'landscape', aspectRatio: '21:9',
          crop: 'wide', focalPoint: 'none', placement: 'behind content', mobileCrop: 'keep',
          lighting: 'warm', tone: 'warm', peoplePresent: 'avoid', devicesUseful: false,
          authenticity: 'generatable', remoteAllowed: true, fallbackAllowed: true,
          loadingPriority: 'lazy', altIntent: 'ambient texture', noRepeat: true,
          expectedContribution: 'atmosphere',
        },
      ],
    };
    const contract = deriveImageSourceStrategyForSpec(spec);
    expect(decisionForSlot(contract, 'dish1')?.strategy).toBe('stock');
    expect(decisionForSlot(contract, 'brandband')?.strategy).toBe('generated');
  });
});

describe('image source strategy — App Build isolation', () => {
  it('derives NO contract for an app build (structural, not a runtime check)', () => {
    const spec = buildFixtureSpec({ ...MATRIX[4], buildType: 'app' });
    expect(deriveImageSourceStrategyForSpec(spec)).toBeUndefined();
    expect(deriveImageSourceStrategy({ buildType: 'app', imageSlots: [HERO] })).toBeUndefined();
  });

  it('ignores an app experience contract even if one is handed in', () => {
    const contract = deriveImageSourceStrategy({
      buildType: 'web',
      imageSlots: [HERO],
      experienceIntelligence: { buildType: 'app', media: { necessity: 'unnecessary' } } as never,
    });
    // The app contract's media verdict is NOT consumed, so the slot is not silently removed.
    expect(contract?.decisions[0].strategy).not.toBe('none');
  });
});

describe('image source strategy — budget + fallback', () => {
  const gen = (id: string, over: Partial<ImageSourceDecision> = {}): ImageSourceDecision => ({
    slotId: id, hero: false, required: false, strategy: 'generated',
    reason: 'conceptual-abstract-visual', basis: ['art-direction'], evidence: [],
    fallback: ['stock', 'none'], ...over,
  });

  it('spends ONE generated image by default and demotes the rest to their fallback', () => {
    const decisions = [gen('a'), gen('b'), gen('c')];
    const budget = resolveGeneratedBudget(decisions);
    expect(budget).toBe(1);
    const out = applyGeneratedBudget(decisions, budget);
    expect(out.filter((d) => d.strategy === 'generated')).toHaveLength(1);
    for (const d of out.filter((x) => x.strategy !== 'generated')) {
      expect(d.strategy).toBe('stock');
      expect(d.reason).toBe('generated-budget-exhausted');
      expect(d.basis).toContain('budget');
    }
  });

  it('prefers the required lead visual when the budget cannot cover every candidate', () => {
    const out = applyGeneratedBudget([gen('side'), gen('lead', { hero: true, required: true, role: 'hero-signature' })], 1);
    expect(out.find((d) => d.slotId === 'lead')?.strategy).toBe('generated');
    expect(out.find((d) => d.slotId === 'side')?.strategy).toBe('stock');
  });

  it('demotes to NO IMAGE when stock is not an honest fallback for that slot', () => {
    const out = applyGeneratedBudget([gen('keep'), gen('drop', { fallback: ['none'] })], 1);
    expect(out.find((d) => d.slotId === 'drop')?.strategy).toBe('none');
  });

  it('never spends more than the ceiling even with many required candidates', () => {
    const many = Array.from({ length: 6 }, (_, i) => gen(`r${i}`, { required: true, fallback: ['none'] }));
    expect(resolveGeneratedBudget(many)).toBe(MAX_GENERATED_IMAGES_PER_BUILD);
  });

  it('a generated decision whose subject cannot be photographed honestly has no stock fallback', () => {
    const spec = buildFixtureSpec(MATRIX[4]);
    const d = decisionForSlot(deriveImageSourceStrategyForSpec(spec), 'f1');
    expect(d?.strategy).toBe('generated');
    // Its fallback chain always ENDS in 'none' — never an irrelevant substitute image.
    expect(d?.fallback[d!.fallback.length - 1]).toBe('none');
  });
});

describe('image source strategy — contract hygiene', () => {
  it('fails open (undefined) rather than throwing on garbage input', () => {
    expect(deriveImageSourceStrategy(undefined)).toBeUndefined();
    expect(deriveImageSourceStrategy({} as never)).toBeUndefined();
    expect(deriveImageSourceStrategyForSpec(undefined)).toBeUndefined();
    expect(deriveImageSourceStrategyForSpec({ buildType: 'web' } as never)).toBeUndefined();
  });

  it('is JSON-safe and carries only counts + codes in its diagnostics', () => {
    const contract = deriveImageSourceStrategyForSpec(buildFixtureSpec(MATRIX[0]));
    expect(() => JSON.parse(JSON.stringify(contract))).not.toThrow();
    const diag = buildImageSourceStrategyDiagnostics(contract);
    const serialized = JSON.stringify(diag);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(diag!.decisionCount).toBe(contract!.decisions.length);
    expect(diag!.stockCount + diag!.generatedCount + diag!.noneCount).toBe(diag!.decisionCount);
  });

  it('resolves art direction through ONE shared lookup (exact slot id, then role)', () => {
    const spec = buildFixtureSpec(MATRIX[0]);
    expect(resolveImageRoleForSlot(spec.visualConcept, 'hero', 'hero')?.slotId).toBe('hero');
    expect(resolveImageRoleForSlot(spec.visualConcept, 'unknown-slot', 'hero')?.role).toBe('hero-signature');
    expect(resolveImageRoleForSlot(undefined, 'hero', 'hero')).toBeUndefined();
  });

  it('a REQUIRED coverage target is never routed to "none"', () => {
    for (const c of MATRIX) {
      const contract = deriveImageSourceStrategyForSpec(buildFixtureSpec(c));
      for (const d of contract?.decisions || []) {
        if (d.required) expect(d.strategy).not.toBe('none');
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL RE-REVIEW regressions. Each test below pins a defect found by
 * attacking the first implementation of this contract.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('image source strategy — adversarial regressions', () => {
  it('pairs a required coverage target to a slot through the EXISTING pairing authority', () => {
    // Defect: the router re-implemented the pairing slot-first with a hero/non-hero heuristic,
    // while the sourcing pipeline pairs target-first via findSpecSlotForTarget. Two orderings of
    // the same assignment drift. Pin that both now agree, slot for slot.
    const spec = buildFixtureSpec(MATRIX[0]);
    const contract = deriveImageSourceStrategyForSpec(spec);
    const used = new Set<string>();
    const expected = new Map<string, string>();   // slotId → targetId, per the AUTHORITY
    for (const t of (spec.imageCoverage?.targets || []).filter((x) => x.required)) {
      const paired = findSpecSlotForTarget(spec, t as ImageCoverageTarget, used);
      if (paired?.id) { used.add(paired.id); expected.set(paired.id, t.id); }
    }
    expect(expected.size).toBeGreaterThan(0);
    for (const d of contract!.decisions) {
      expect(`${d.slotId}:${d.required}`).toBe(`${d.slotId}:${expected.has(d.slotId)}`);
    }
  });

  it('never buys a bespoke visual without positive evidence that imagery earns its place', () => {
    // Defect: with NO media verdict and NO archetype imagery role (a failed-open spec), a
    // UI-native / generative-medium slot still routed to `generated` — paying for a guess.
    const bare = {
      buildType: 'web',
      assets: { imageSlots: [slot('hero', 'hero-image', 'section:hero', 'hero')] },
      visualConcept: {
        realImageStrategy: { posture: 'graphic-first' },
        imageRoles: [{
          slotId: 'hero', sectionId: 'hero', role: 'hero-signature', required: false,
          narrativePurpose: 'lead', subject: 'an abstract field', medium: 'abstract-generative',
          orientation: 'landscape', aspectRatio: '16:9', crop: 'wide', focalPoint: 'upper third',
          placement: 'first viewport', mobileCrop: 'tighter', lighting: 'cool', tone: 'precise',
          peoplePresent: 'avoid', devicesUseful: false, authenticity: 'generatable',
          remoteAllowed: true, fallbackAllowed: true, loadingPriority: 'eager',
          altIntent: 'abstract', noRepeat: true, expectedContribution: 'signature',
        }],
      },
    } as unknown as FrontendBuildSpecification;
    expect(decisionForSlot(deriveImageSourceStrategyForSpec(bare), 'hero')?.strategy).not.toBe('generated');

    // …but the SAME slot on a spec whose archetype rates imagery supporting DOES generate.
    const withRole = { ...bare, designIntelligence: { image: { role: 'supporting' } } } as unknown as FrontendBuildSpecification;
    expect(decisionForSlot(deriveImageSourceStrategyForSpec(withRole), 'hero')?.strategy).toBe('generated');
  });

  it('an editorial publication is NOT reclassified as a tool by incidental interface words', () => {
    // Defect: the interface-evidence override of the editorial archetype fired on interface hits
    // alone, so a magazine that mentions its API and its automation would have been typed as an
    // interface-led product and lost its photographic medium. The override now also requires
    // OPERATIONAL evidence — something a publication does not say about itself.
    const magazine = buildFixtureSpec({
      label: 'magazine with an api',
      prompt: 'An online magazine with articles, columns and contributors; we also offer an API and newsletter automation for syndication partners',
      sector: 'media', subsector: 'online magazine',
      sectionNames: ['Hero', 'Articles', 'Contributors'],
      slots: [HERO],
    });
    expect(magazine.designIntelligence?.archetype).toBe('editorial-media');
    expect(magazine.experienceIntelligence?.experience.lead).toBe('editorial-led');
    expect(decisionForSlot(deriveImageSourceStrategyForSpec(magazine), 'hero')?.strategy).toBe('stock');

    // …while a request that both describes AND operates an interface still overrides it.
    const tool = buildFixtureSpec({
      label: 'dashboard misread as editorial',
      prompt: 'A web dashboard for internal teams to manage records, monitor pipelines, filter tickets, run queries and see reporting — an admin panel, not a marketing site',
      sector: 'ai-saas', subsector: 'internal admin dashboard',
      sectionNames: ['Hero', 'Dashboard', 'Reporting', 'Pricing'],
      slots: [HERO],
    });
    expect(tool.experienceIntelligence?.experience.lead).toBe('interface-led');
    expect(decisionForSlot(deriveImageSourceStrategyForSpec(tool), 'hero')?.strategy).toBe('none');
  });

  it('a real-world product medium is never turned synthetic by a category-level posture', () => {
    // Defect: `posture: graphic-first` alone could route the hero of a product whose medium the
    // classification owner resolved to real-world photography (a restaurant, a shop) to a
    // generated image — a synthetic stand-in for a real place.
    const spec = buildFixtureSpec(MATRIX[0]);
    const forced = {
      ...spec,
      visualConcept: { ...spec.visualConcept!, realImageStrategy: { ...spec.visualConcept!.realImageStrategy, posture: 'graphic-first' } },
    } as unknown as FrontendBuildSpecification;
    expect(forced.experienceIntelligence?.media.primaryKind).toBe('place-photography');
    expect(decisionForSlot(deriveImageSourceStrategyForSpec(forced), 'hero')?.strategy).toBe('stock');
  });
});
