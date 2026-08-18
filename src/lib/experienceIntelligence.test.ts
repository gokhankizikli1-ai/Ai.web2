/**
 * Tests — EXPERIENCE INTELLIGENCE (the shared pre-generation experience / media / content /
 * optimization direction) and its two build-type adapters.
 *
 * They assert on the CONTRACT and on the REQUEST BYTES that are actually sent — never on
 * generated HTML — because no paid/live provider generation is performed for this work.
 *
 * The four things these must prove:
 *   1. unrelated products do NOT collapse into one composition family
 *   2. App Build never inherits web hero/marketing direction, and Web Build never inherits
 *      app navigation direction
 *   3. media / content decisions come from request EVIDENCE, in English and in Turkish
 *   4. optimization can never remove required media, the primary CTA, key navigation or a
 *      product-defining interaction
 */
import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { buildWebBuildPayload } from '@/lib/webBuildPayload';
import {
  buildFrontendBuilderRequest, buildFrontendBuilderReviewRequest, buildFrontendBuilderRepairRequest,
  SAFE_FRONTEND_BUILDER_REQUEST_CHARS,
} from '@/lib/webBuildApi';
import {
  deriveExperienceIntelligence, renderExperienceCoreBlock, renderExperienceOptimizationBlock,
  renderExperienceAntiPatternBlock, buildOptimizationGuardPolicy, buildExperienceRepairDigest,
  buildExperienceIntelligenceDiagnostics,
  EXPERIENCE_INTELLIGENCE_WEB_CHAR_CEILING, EXPERIENCE_INTELLIGENCE_APP_CHAR_CEILING,
} from '@/lib/experienceIntelligence';
import { renderWebExperienceBlock } from '@/lib/experienceIntelligenceWeb';
import { renderAppExperienceBlock } from '@/lib/experienceIntelligenceApp';
import { buildRepairAuthorityDigest } from '@/lib/webBuildQualityContext';
import type { WebBuildResult } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderReviewArtifact } from '@/lib/webBuildAgents';

/* ── Harness — the REAL production spine: planning reply → payload → spec → request ── */
const SECTIONS = ['hero', 'overview', 'detail', 'offering', 'proof', 'faq', 'contact', 'footer'];

function planningReply(): string {
  const l = ['## Build Plan', 'Website type: site', 'Audience: visitors', 'Goal: convert', '', '## Page Sections'];
  for (const s of SECTIONS) l.push(`- ${s}: the ${s} section of the page`);
  l.push('', '## Generated Copy');
  for (const s of SECTIONS) {
    l.push(`### ${s}`);
    l.push(`Headline: ${s} headline for this concept`);
    l.push(`Subheadline: ${s} supporting line with a concrete detail`);
    for (let i = 0; i < 4; i += 1) l.push(`- ${s} point ${i}`);
    l.push(`CTA: Continue from ${s}`);
    l.push('');
  }
  l.push('## Next Steps', '- ship');
  return l.join('\n');
}

function specFor(prompt: string, lang = 'en', buildType: 'web' | 'app' = 'web'): FrontendBuildSpecification {
  const reply = planningReply();
  const res = {
    reply, sections: parseBuildSections(reply), partial: false,
    model: 'x', mode: 'website_builder', requestId: '1',
  } as WebBuildResult;
  const payload = buildWebBuildPayload(prompt, res, undefined, lang, buildType);
  return (payload.steps[payload.steps.length - 1]?.artifacts?.frontendBuildSpec
    || payload.artifacts?.frontendBuildSpec) as FrontendBuildSpecification;
}

const xiFor = (prompt: string, lang = 'en', buildType: 'web' | 'app' = 'web') =>
  specFor(prompt, lang, buildType).experienceIntelligence;

/** The FULL Experience Intelligence direction as it actually reaches the model. */
function xiTextFor(prompt: string, lang = 'en', buildType: 'web' | 'app' = 'web'): string {
  const spec = specFor(prompt, lang, buildType);
  const xi = spec.experienceIntelligence;
  expect(xi, `${prompt}: spec carries experience intelligence`).toBeTruthy();
  const request = buildFrontendBuilderRequest(spec);
  const tiers = [
    renderExperienceCoreBlock(xi).join('\n'),
    (buildType === 'web' ? renderWebExperienceBlock(xi?.web) : renderAppExperienceBlock(xi?.app)).join('\n'),
    renderExperienceOptimizationBlock(xi).join('\n'),
    renderExperienceAntiPatternBlock(xi).join('\n'),
  ];
  for (const tier of tiers) {
    expect(tier.length, `${prompt}: tier is non-empty`).toBeGreaterThan(50);
    expect(request.includes(tier.trim()), `${prompt}: tier present in request`).toBe(true);
  }
  return tiers.join('\n');
}

const WEB_PROMPTS = {
  devtool: 'developer infrastructure SaaS: a managed Postgres branching platform with an API and CLI',
  ecommerce: 'an online shop selling handmade stoneware ceramics',
  restaurant: 'a Michelin-starred tasting-menu restaurant in Kyoto',
  portfolio: 'an architecture photography portfolio for a studio in Copenhagen',
  editorial: 'an independent longform journalism publication about climate policy',
  localService: 'a family dental clinic in Leeds accepting new patients',
  agency: 'a creative branding agency in Berlin',
  event: 'a two-day AI engineering conference in Lisbon',
} as const;

const APP_PROMPTS = {
  crm: 'a CRM for a small sales team with contacts, deals and a pipeline',
  dashboard: 'an analytics dashboard app with KPI metrics and reporting charts',
  productivity: 'a simple task manager app with projects and a kanban board',
  fitness: 'a mobile fitness app for workout tracking and progress',
  contentApp: 'a content app for browsing and reading long articles offline',
  utility: 'a tip calculator utility',
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 1. THE CONTRACT EXISTS, IS BOUNDED, AND IS DERIVED FROM EVIDENCE
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — contract', () => {
  it('is derived for every web and app build on the real spine', () => {
    for (const p of Object.values(WEB_PROMPTS)) {
      const xi = xiFor(p);
      expect(xi?.version, p).toBe('experience-intelligence-v1');
      expect(xi?.buildType, p).toBe('web');
    }
    for (const p of Object.values(APP_PROMPTS)) {
      const xi = xiFor(p, 'en', 'app');
      expect(xi?.version, p).toBe('experience-intelligence-v1');
      expect(xi?.buildType, p).toBe('app');
    }
  });

  it('is JSON-safe, deterministic and fail-open', () => {
    const a = deriveExperienceIntelligence({ prompt: WEB_PROMPTS.restaurant, buildType: 'web' });
    const b = deriveExperienceIntelligence({ prompt: WEB_PROMPTS.restaurant, buildType: 'web' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    // Fail-open: garbage in, `undefined` out — never a throw.
    expect(deriveExperienceIntelligence(undefined as never)).toBeUndefined();
    expect(deriveExperienceIntelligence({ prompt: '', buildType: 'nope' as never })).toBeUndefined();
    expect(deriveExperienceIntelligence({ prompt: '', buildType: 'web' })).toBeTruthy();
  });

  it('records WHICH authority owns the archetype instead of re-deriving one', () => {
    const web = xiFor(WEB_PROMPTS.restaurant);
    expect(web?.experience.archetypeRef.owner).toBe('designIntelligence');
    expect(web?.experience.archetypeRef.value).toBe('restaurant-hospitality');
    const app = xiFor(APP_PROMPTS.crm, 'en', 'app');
    expect(app?.experience.archetypeRef.owner).toBe('appArchitecture');
    expect(app?.experience.archetypeRef.value).toBe('crm');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. UNRELATED PRODUCTS DO NOT COLLAPSE INTO ONE COMPOSITION FAMILY
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — no collapse', () => {
  it('gives eight unrelated websites materially different signatures', () => {
    const sigs: Array<[string, string]> = Object.entries(WEB_PROMPTS).map(([k, p]) => {
      const xi = xiFor(p);
      const parts: string[] = [
        String(xi?.experience.lead), String(xi?.experience.density), String(xi?.experience.hierarchy),
        String(xi?.experience.composition), String(xi?.experience.primaryInteraction),
        String(xi?.media.necessity), String(xi?.media.primaryKind), String(xi?.web?.heroMedia),
      ];
      return [k, parts.join('|')];
    });
    const distinct = new Set(sigs.map(([, s]) => s));
    // Eight unrelated products must not share a handful of signatures.
    expect(distinct.size, JSON.stringify(sigs, null, 1)).toBeGreaterThanOrEqual(7);
  });

  it('gives six unrelated apps materially different signatures', () => {
    const sigs: Array<[string, string]> = Object.entries(APP_PROMPTS).map(([k, p]) => {
      const xi = xiFor(p, 'en', 'app');
      const parts: string[] = [
        String(xi?.experience.lead), String(xi?.experience.density), String(xi?.experience.hierarchy),
        String(xi?.experience.composition), String(xi?.experience.primaryInteraction),
        String(xi?.media.primaryKind), String(xi?.app?.chromeBudget),
      ];
      return [k, parts.join('|')];
    });
    const distinct = new Set(sigs.map(([, s]) => s));
    expect(distinct.size, JSON.stringify(sigs, null, 1)).toBeGreaterThanOrEqual(5);
  });

  it('does not send the same rendered direction to two unrelated products', () => {
    const a = xiTextFor(WEB_PROMPTS.restaurant);
    const b = xiTextFor(WEB_PROMPTS.devtool);
    const c = xiTextFor(WEB_PROMPTS.editorial);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it('the same archetype with different request evidence yields a different verdict', () => {
    // Two software products. One asks for real customer photography, the other for an API.
    const withPhotos = xiFor('a SaaS platform for restaurants — include photography of the restaurants and their kitchens we work with');
    const withoutPhotos = xiFor('a SaaS platform with an API, a CLI and a webhook integration guide');
    expect(withPhotos?.media.primaryKind).not.toBe(withoutPhotos?.media.primaryKind);
    expect(withPhotos?.media.necessity).not.toBe(withoutPhotos?.media.necessity);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. ISOLATION — no direction leaks across build types
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — web/app isolation', () => {
  it('a web contract never carries app direction, and vice versa', () => {
    for (const p of Object.values(WEB_PROMPTS)) {
      const xi = xiFor(p);
      expect(xi?.web, p).toBeTruthy();
      expect(xi?.app, p).toBeUndefined();
    }
    for (const p of Object.values(APP_PROMPTS)) {
      const xi = xiFor(p, 'en', 'app');
      expect(xi?.app, p).toBeTruthy();
      expect(xi?.web, p).toBeUndefined();
    }
  });

  it('the APP adapter block contains no page/hero/marketing vocabulary at all', () => {
    // "scrolling" stays allowed: an app screen legitimately scrolls. Everything else here is
    // page/marketing vocabulary an application must never be handed.
    const WEB_ONLY = /\bhero\b|\bpage\b|\bsections?\b|landing|marketing|above the fold|masthead|visitor/i;
    for (const p of Object.values(APP_PROMPTS)) {
      const block = renderAppExperienceBlock(xiFor(p, 'en', 'app')?.app).join('\n');
      expect(block.length, p).toBeGreaterThan(50);
      const hit = block.match(WEB_ONLY);
      expect(hit, `${p}: app adapter leaked web vocabulary (${hit?.[0]}):\n${block}`).toBeNull();
    }
  });

  it('the WEB adapter block contains no screen/navigation/app-shell vocabulary at all', () => {
    const APP_ONLY = /\bscreens?\b|bottom tabs?|\btab bar\b|nav rail|app shell|routed view|drill-in|chrome budget|\broutes?\b|\bsidebar\b/i;
    for (const p of Object.values(WEB_PROMPTS)) {
      const block = renderWebExperienceBlock(xiFor(p)?.web).join('\n');
      expect(block.length, p).toBeGreaterThan(50);
      const hit = block.match(APP_ONLY);
      expect(hit, `${p}: web adapter leaked app vocabulary (${hit?.[0]}):\n${block}`).toBeNull();
    }
  });

  it('in the SHARED blocks, an app is only ever told a hero is WRONG — never to build one', () => {
    for (const p of Object.values(APP_PROMPTS)) {
      const xi = xiFor(p, 'en', 'app');
      // The anti-pattern tier is a list of things to AVOID; its header carries the negation, so
      // it is asserted as a whole rather than line by line.
      const anti = renderExperienceAntiPatternBlock(xi).join('\n');
      expect(anti, p).toMatch(/must NOT reproduce these generic AI-design signatures/);
      const shared = [renderExperienceCoreBlock(xi).join('\n'), renderExperienceOptimizationBlock(xi).join('\n')].join('\n');
      const lines = shared.split('\n').filter((l) => /\bhero\b/i.test(l));
      for (const line of lines) {
        expect(/WRONG for this product|must NOT|never|forbidden|Avoid/i.test(line), `${p}: positive hero instruction reached an app: ${line}`).toBe(true);
      }
    }
  });

  it('in the SHARED blocks, a website only ever hears "screen" as a viewport width', () => {
    for (const p of Object.values(WEB_PROMPTS)) {
      const lines = xiTextFor(p).split('\n').filter((l) => /\bscreens?\b/i.test(l));
      for (const line of lines) {
        expect(/narrow screen|phone|width|768px|390px/i.test(line), `${p}: app screen vocabulary reached a website: ${line}`).toBe(true);
      }
    }
  });

  it('the app request carries the app adapter block and never the web adapter block', () => {
    const appSpec = specFor(APP_PROMPTS.crm, 'en', 'app');
    const req = buildFrontendBuilderRequest(appSpec);
    expect(req).toContain('APP EXPERIENCE DIRECTION');
    expect(req).not.toContain('PAGE DIRECTION —');
    const webSpec = specFor(WEB_PROMPTS.restaurant);
    const webReq = buildFrontendBuilderRequest(webSpec);
    expect(webReq).toContain('PAGE DIRECTION —');
    expect(webReq).not.toContain('APP EXPERIENCE DIRECTION');
  });

  it('an app never receives a required lead visual, and a functional app forbids one', () => {
    for (const [k, p] of Object.entries(APP_PROMPTS)) {
      const xi = xiFor(p, 'en', 'app');
      expect(xi?.media.leadVisual, k).not.toBe('required');
    }
    expect(xiFor(APP_PROMPTS.crm, 'en', 'app')?.media.leadVisual).toBe('forbidden');
    expect(xiFor(APP_PROMPTS.utility, 'en', 'app')?.media.leadVisual).toBe('forbidden');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. MEDIA INTELLIGENCE — is an image actually useful, and which one?
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — media verdict', () => {
  it('imagery is CORE for a photography portfolio and a restaurant', () => {
    for (const p of [WEB_PROMPTS.portfolio, WEB_PROMPTS.restaurant]) {
      const xi = xiFor(p);
      expect(xi?.media.necessity, p).toBe('required');
      expect(xi?.media.leadVisual, p).toBe('required');
      expect(xi?.media.imageryPriority, p).toBe('lead');
      expect(xi?.experience.lead, p).toBe('image-led');
    }
  });

  it('a ceramics shop leads with PRODUCT imagery, not a stock hero', () => {
    const xi = xiFor(WEB_PROMPTS.ecommerce);
    expect(xi?.media.primaryKind).toBe('product-photography');
    expect(xi?.web?.heroMedia).toBe('catalogue');
  });

  it('a developer product prefers real interface evidence over photography', () => {
    const xi = xiFor(WEB_PROMPTS.devtool);
    expect(xi?.media.primaryKind).toBe('interface-preview');
    expect(xi?.media.forbiddenKinds).toContain('hero-photography');
    expect(xi?.web?.heroMedia).toBe('interface');
    expect(xi?.media.strongerWithoutMedia.join(' ')).toMatch(/real, labelled interface/i);
  });

  it('an explicit "no images" request makes imagery UNNECESSARY and the lead visual FORBIDDEN', () => {
    const xi = xiFor('a typography-only text site for a poetry press, no images at all');
    expect(xi?.media.necessity).toBe('unnecessary');
    expect(xi?.media.leadVisual).toBe('forbidden');
    expect(xi?.media.primaryKind).toBe('none');
    expect(xi?.web?.heroMedia).toBe('typographic');
    expect(xi?.optimization.lazyLoading).toBe('not-applicable');
    expect(xi?.optimization.aboveFold.maxMediaAssets).toBe(0);
  });

  it('a media FLOOR outranks a broadly-worded exclusion (and "avoid stock photography" is not an exclusion)', () => {
    // "avoid stock photography" asks for REAL photos, not for no photos — reading it as an
    // exclusion would have stripped required imagery from exactly the products that need it.
    const realPhotos = xiFor('a Michelin-starred tasting-menu restaurant in Kyoto — avoid stock photography, we will supply our own');
    expect(realPhotos?.media.necessity).toBe('required');
    expect(realPhotos?.media.leadVisual).toBe('required');
  });

  it('a negated media phrase is a prohibition, never a required media requirement', () => {
    // Cross-authority regression: the binding-requirements extractor captured up to two words
    // before a media noun, so "no images at all" became REQUIRED media "no images" and the
    // request told the model to include imagery the user had just excluded.
    const spec = specFor('a typography-only text site for a poetry press, no images at all');
    const media = (spec.bindingRequirements?.requirements || []).filter((r) => r.kind === 'media');
    expect(media).toEqual([]);
    expect(buildFrontendBuilderRequest(spec)).not.toMatch(/REQUIRED media "no images"/);
  });

  it('never lowers the image-coverage floor it does not own', () => {
    const spec = specFor(WEB_PROMPTS.restaurant);
    // The coverage authority requires photography; the verdict agrees rather than overriding it.
    expect(spec.imageCoverage?.mode === 'required' || spec.imageCoverage?.mode === 'image-led').toBe(true);
    expect(spec.experienceIntelligence?.media.necessity).toBe('required');
    expect(spec.experienceIntelligence?.media.deferralNote).toMatch(/never lowers that floor/i);
  });

  it('defers the imagery VOCABULARY to the web image-intent authority instead of restating it', () => {
    const xi = xiFor(WEB_PROMPTS.restaurant);
    expect(xi?.media.vocabularyOwnedElsewhere).toBe(true);
    const core = renderExperienceCoreBlock(xi).join('\n');
    expect(core).not.toMatch(/^Supporting media:/m);
    // An APP has no such owner, so it states the vocabulary itself.
    const appXi = xiFor(APP_PROMPTS.crm, 'en', 'app');
    expect(appXi?.media.vocabularyOwnedElsewhere).toBe(false);
    expect(renderExperienceCoreBlock(appXi).join('\n')).toMatch(/Supporting media:/);
  });

  it('a content app carries item imagery; a working tool does not', () => {
    const content = xiFor(APP_PROMPTS.contentApp, 'en', 'app');
    expect(content?.media.primaryKind).toBe('content-thumbnail');
    expect(content?.media.surfaces.some((s) => s.policy !== 'none')).toBe(true);
    const crm = xiFor(APP_PROMPTS.crm, 'en', 'app');
    expect(crm?.media.surfaces.every((s) => s.policy === 'none')).toBe(true);
  });

  it('charts are justified only where the product measures something', () => {
    expect(xiFor(APP_PROMPTS.dashboard, 'en', 'app')?.experience.chartsJustified).toBe(true);
    expect(xiFor(APP_PROMPTS.utility, 'en', 'app')?.experience.chartsJustified).toBe(false);
    expect(xiFor(WEB_PROMPTS.restaurant)?.experience.chartsJustified).toBe(false);
    const restaurantText = xiTextFor(WEB_PROMPTS.restaurant);
    expect(restaurantText).toMatch(/invented metric is a fabrication/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. CONTENT INTELLIGENCE — roles, never invented facts
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — content honesty', () => {
  it('web content roles are adopted from the owning authority, never restated', () => {
    const xi = xiFor(WEB_PROMPTS.restaurant);
    expect(xi?.content.rolesOwnedElsewhere).toBe(true);
    expect(renderExperienceCoreBlock(xi).join('\n')).not.toMatch(/CONTENT DIRECTION —/);
  });

  it('App Build gains the same honesty boundary the web build already had', () => {
    for (const p of Object.values(APP_PROMPTS)) {
      const xi = xiFor(p, 'en', 'app');
      expect(xi?.content.rolesOwnedElsewhere, p).toBe(false);
      expect(xi?.content.requiredContentRoles.length, p).toBeGreaterThan(0);
      expect(xi?.content.factualPolicy, p).toMatch(/never present it as a real user|never fabricate a real person/i);
      expect(xi?.content.additionalNeverFabricate.join(' '), p).toMatch(/real user account|real backend/i);
      const text = xiTextFor(p, 'en', 'app');
      expect(text, p).toMatch(/NEVER invent/);
      expect(text, p).toMatch(/SAMPLE local data/);
    }
  });

  it('content roles are STRUCTURE, never invented facts', () => {
    const roles = Object.values(APP_PROMPTS).flatMap((p) => xiFor(p, 'en', 'app')?.content.requiredContentRoles || []);
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) {
      // No currency amounts, no invented proper nouns presented as data.
      expect(r, r).not.toMatch(/[$€£]\s?\d|\b\d{2,}%|\bAcme\b|\bJohn\b/);
      expect(r, r).toMatch(/model|vocabulary|history|state|target|structure|taxonomy|summary|definition|comparison|basis|dimension|presentation|availability|resource|attributes|grouping|units/i);
    }
  });

  it('filler content shapes are scoped to the product, not banned globally', () => {
    // A product that never mentioned pricing is told not to invent a pricing comparison…
    expect(xiFor(WEB_PROMPTS.restaurant)?.content.avoidPatterns.join(' ')).toMatch(/pricing\/plan comparison/i);
    // …while a product that genuinely has plans is not.
    const withPricing = xiFor('a subscription analytics product — include the pricing plans page');
    expect(withPricing?.content.avoidPatterns.join(' ')).not.toMatch(/pricing\/plan comparison/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. TURKISH — a first-class prompt language, not an English-only lexicon
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — Turkish requests', () => {
  it('a Turkish restaurant request reaches the same media verdict as its English peer', () => {
    const tr = xiFor('İstanbul Kadıköy’de bir meyhane için web sitesi yap, menü ve mekan fotoğrafları olsun', 'tr');
    expect(tr?.media.necessity).toBe('required');
    expect(tr?.media.primaryKind).toBe('place-photography');
    expect(tr?.experience.lead).toBe('image-led');
  });

  it('a Turkish appointment app classifies as a booking app, not a generic shell', () => {
    const spec = specFor('küçük bir işletme için randevu yönetimi uygulaması', 'tr', 'app');
    expect(spec.appArchitecture?.appType).toBe('booking');
    // …and one repeated Turkish word is not counted as two pieces of purchase evidence.
    expect(spec.experienceIntelligence?.experience.primaryInteraction).toBe('operate');
  });

  it('Turkish "no photography" is honoured', () => {
    const tr = xiFor('bir şiir yayınevi için görselsiz, sadece tipografi kullanan bir site', 'tr');
    expect(tr?.media.necessity).toBe('unnecessary');
    expect(tr?.media.leadVisual).toBe('forbidden');
  });

  it('a derived brief cannot state an appetite the user never expressed', () => {
    // The inferred brief routinely contains generic adjectives ("clean", "modern"). Only the
    // user's own words may make a build sparse — otherwise a dense CRM reads as minimal.
    expect(xiFor(APP_PROMPTS.crm, 'en', 'app')?.experience.density).toBe('dense');
    expect(xiFor('a deliberately minimal, simple CRM for one person', 'en', 'app')?.experience.density).toBe('sparse');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. OPTIMIZATION STRATEGY — first-class, and never destructive
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — optimization strategy', () => {
  it('states the binding priority order with performance FOURTH', () => {
    for (const [k, p] of [...Object.entries(WEB_PROMPTS), ...Object.entries(APP_PROMPTS)]) {
      const isApp = k in APP_PROMPTS;
      const xi = xiFor(p, 'en', isApp ? 'app' : 'web');
      const order = xi?.optimization.priorityOrder || [];
      expect(order.length, p).toBe(5);
      expect(order[0], p).toMatch(/product & experience correctness/i);
      expect(order[1], p).toMatch(/visual quality/i);
      expect(order[2], p).toMatch(/usability & accessibility/i);
      expect(order[3], p).toMatch(/performance/i);
      expect(order[4], p).toMatch(/cleanliness/i);
    }
  });

  it('protects required media, the primary CTA / navigation and requested interactions', () => {
    const web = xiFor(WEB_PROMPTS.restaurant);
    const protectedText = (web?.optimization.protectedElements || []).join(' ');
    expect(protectedText).toMatch(/primary call to action/i);
    expect(protectedText).toMatch(/required image[\s\S]*never removed/i);
    expect(protectedText).toMatch(/every planned section/i);

    const app = xiFor(APP_PROMPTS.crm, 'en', 'app');
    const appProtected = (app?.optimization.protectedElements || []).join(' ');
    expect(appProtected).toMatch(/primary navigation/i);
    expect(appProtected).toMatch(/product-defining interaction/i);
    expect(appProtected).toMatch(/every planned screen/i);
  });

  it('the rendered optimization block leads with the protections, so a ceiling cut cannot remove them', () => {
    for (const [k, p] of [...Object.entries(WEB_PROMPTS), ...Object.entries(APP_PROMPTS)]) {
      const isApp = k in APP_PROMPTS;
      const block = renderExperienceOptimizationBlock(xiFor(p, 'en', isApp ? 'app' : 'web')).join('\n');
      expect(block, p).toMatch(/NEVER ALLOWED TO DAMAGE THE PRODUCT/);
      expect(block, p).toMatch(/Never remove, weaken or replace with a placeholder/);
      // The protections appear before the tactical directives.
      expect(block.indexOf('Never remove, weaken'), p).toBeLessThan(block.indexOf('- Images:'));
    }
  });

  it('protects the planned component files by path', () => {
    const spec = specFor(WEB_PROMPTS.restaurant);
    const files = spec.experienceIntelligence?.optimization.protectedFiles || [];
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual(spec.outputContract.requiredSectionComponentFiles.slice(0, files.length));
    const appSpec = specFor(APP_PROMPTS.crm, 'en', 'app');
    expect((appSpec.experienceIntelligence?.optimization.protectedFiles || []).some((f) => f.includes('screens/'))).toBe(true);
  });

  it('budgets vary with the product rather than being one global setting', () => {
    const utility = xiFor(APP_PROMPTS.utility, 'en', 'app')?.optimization;
    const restaurant = xiFor(WEB_PROMPTS.restaurant)?.optimization;
    expect(utility?.motion.level).toBe('minimal');
    expect(utility?.visualComplexity.maxBlurLayers).toBe(0);
    expect(restaurant?.motion.maxSimultaneousAnimations).toBeGreaterThan(utility!.motion.maxSimultaneousAnimations);
    // An explicit "no animation" request drops the budget to zero.
    expect(xiFor('a static brochure site for a law firm, no animation')?.optimization.motion.level).toBe('none');
    // An explicitly cinematic request raises it.
    expect(xiFor('an immersive animated cinematic site for a film studio')?.optimization.motion.level).toBe('expressive');
  });

  it('never proposes adding a dependency (the runtime allowlist is the enforcing authority)', () => {
    const text = xiTextFor(WEB_PROMPTS.devtool);
    expect(text).toMatch(/Do NOT introduce a new package/i);
    expect(text).toMatch(/runtime import allowlist rejects it/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8. REQUEST INTEGRATION — size, priority, and what the quality tasks see
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — request integration', () => {
  it('every rendered tier stays inside its documented ceiling', () => {
    for (const [k, p] of [...Object.entries(WEB_PROMPTS), ...Object.entries(APP_PROMPTS)]) {
      const isApp = k in APP_PROMPTS;
      const xi = xiFor(p, 'en', isApp ? 'app' : 'web');
      const total = [
        renderExperienceCoreBlock(xi).join('\n'),
        (isApp ? renderAppExperienceBlock(xi?.app) : renderWebExperienceBlock(xi?.web)).join('\n'),
        renderExperienceOptimizationBlock(xi).join('\n'),
        renderExperienceAntiPatternBlock(xi).join('\n'),
      ].reduce((n, t) => n + t.length, 0);
      const ceiling = isApp ? EXPERIENCE_INTELLIGENCE_APP_CHAR_CEILING : EXPERIENCE_INTELLIGENCE_WEB_CHAR_CEILING;
      expect(total, `${p}: ${total} > ${ceiling}`).toBeLessThanOrEqual(ceiling);
    }
  });

  it('the generation request stays under the safe request budget', () => {
    for (const [k, p] of [...Object.entries(WEB_PROMPTS), ...Object.entries(APP_PROMPTS)]) {
      const isApp = k in APP_PROMPTS;
      const req = buildFrontendBuilderRequest(specFor(p, 'en', isApp ? 'app' : 'web'));
      expect(req.length, p).toBeLessThan(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
    }
  });

  it('a budget cut sheds the optimization + signature tiers before the media verdict', () => {
    const spec = specFor(WEB_PROMPTS.restaurant);
    const xi = spec.experienceIntelligence;
    // Force the request over the safe budget with legitimate P2/P3 material.
    const bloated: FrontendBuildSpecification = {
      ...spec,
      architecture: {
        ...spec.architecture,
        sections: spec.architecture.sections.map((s) => ({
          ...s,
          purpose: 'x'.repeat(4000),
          interactionHints: Array.from({ length: 8 }, () => 'y'.repeat(2000)),
        })),
      },
    };
    const shed = buildFrontendBuilderRequest(bloated);
    expect(shed.length).toBeGreaterThan(0);
    const core = renderExperienceCoreBlock(xi).join('\n').trim();
    const anti = renderExperienceAntiPatternBlock(xi).join('\n').trim();
    // P1 survives; P4 is gone.
    expect(shed.includes(core)).toBe(true);
    expect(shed.includes(anti)).toBe(false);
  });

  it('an OVERSIZED app request gives back ONLY this layer, keeping every pre-existing app block', () => {
    const spec = specFor(APP_PROMPTS.crm, 'en', 'app');
    const xi = spec.experienceIntelligence;
    const bloated: FrontendBuildSpecification = {
      ...spec,
      architecture: {
        ...spec.architecture,
        sections: spec.architecture.sections.map((s) => ({
          ...s, purpose: 'x'.repeat(6000), interactionHints: Array.from({ length: 8 }, () => 'y'.repeat(3000)),
        })),
      },
    };
    const shed = buildFrontendBuilderRequest(bloated);
    // App requests are still never re-prioritised: every block the app carried before this layer
    // survives at any size. The ONLY thing given back is the direction this layer added, so it
    // can never be the reason an app request that used to generate is rejected for size.
    const normal = buildFrontendBuilderRequest(spec);
    for (const marker of ['[APP ARCHITECTURE]', 'BEGIN_FRONTEND_BUILD_SPEC_JSON', 'SOURCE OUTPUT DISCIPLINE:',
      'BINDING PREMIUM VISUAL SYSTEM', 'RESEARCH-GROUNDED SECTOR DIRECTION'].filter((m) => normal.includes(m))) {
      expect(shed, marker).toContain(marker);
    }
    expect(shed.includes(renderExperienceCoreBlock(xi).join('\n').trim())).toBe(false);
    expect(shed.includes(renderAppExperienceBlock(xi?.app).join('\n').trim())).toBe(false);
    expect(shed.includes(renderExperienceAntiPatternBlock(xi).join('\n').trim())).toBe(false);
  });

  it('quality tasks never receive the full contract — the bounded digest carries it instead', () => {
    const spec = specFor(WEB_PROMPTS.restaurant);
    const review = buildFrontendBuilderReviewRequest(spec, [{ path: 'src/App.tsx', content: 'x', language: 'tsx' } as never], 'initial');
    expect(review).not.toContain('experience-intelligence-v1');
    const digest = buildRepairAuthorityDigest(spec) as Record<string, unknown>;
    const dir = digest.experienceDirection as Record<string, unknown>;
    expect(dir).toBeTruthy();
    expect(dir.mediaNecessity).toBe('required');
    expect(dir.leadVisual).toBe('required');
    expect(String(dir.optimizationPriority)).toMatch(/experience correctness > visual quality/);
    expect(Array.isArray(dir.neverRemove)).toBe(true);
  });

  it('the repair request tells the model it may not trade the direction for performance', () => {
    const spec = specFor(WEB_PROMPTS.restaurant);
    const review = { status: 'completed', passed: false, issues: [], strengths: [] } as unknown as FrontendBuilderReviewArtifact;
    const req = buildFrontendBuilderRepairRequest(spec, [], review, undefined, undefined, buildRepairAuthorityDigest(spec));
    expect(req).toContain('EXPERIENCE DIRECTION');
    expect(req).toMatch(/must be skipped, not applied/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8b. REVISIONS — a change request refines the direction, it does not replace it
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — revisions', () => {
  /** Run a second turn on top of a first, exactly as the production spine does. */
  function revisionSpec(first: string, revision: string): FrontendBuildSpecification {
    const reply = planningReply();
    const res = {
      reply, sections: parseBuildSections(reply), partial: false,
      model: 'x', mode: 'website_builder', requestId: '1',
    } as WebBuildResult;
    const base = buildWebBuildPayload(first, res, undefined, 'en', 'web');
    const next = buildWebBuildPayload(revision, res, base, 'en', 'web');
    return (next.steps[next.steps.length - 1]?.artifacts?.frontendBuildSpec
      || next.artifacts?.frontendBuildSpec) as FrontendBuildSpecification;
  }

  it('a cosmetic revision does not erase what the product is', () => {
    const spec = revisionSpec(WEB_PROMPTS.restaurant, 'make the headline bigger');
    // Without carrying the first turn's request, this would be derived from four words about a
    // headline and the restaurant's photography verdict would silently disappear.
    expect(spec.experienceIntelligence?.media.necessity).toBe('required');
    expect(spec.experienceIntelligence?.media.primaryKind).toBe('place-photography');
  });

  it('a revision CAN still change the direction when it says something new', () => {
    const spec = revisionSpec(WEB_PROMPTS.restaurant, 'actually remove all photography — no images at all, typography only');
    expect(spec.experienceIntelligence?.media.necessity).toBe('unnecessary');
    expect(spec.experienceIntelligence?.media.leadVisual).toBe('forbidden');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 9. DIAGNOSTICS — bounded, secret-free, and honest
 * ──────────────────────────────────────────────────────────────────────────── */
describe('experience intelligence — diagnostics', () => {
  it('are bounded enums and counts only, and carry no score', () => {
    const d = buildExperienceIntelligenceDiagnostics(xiFor(WEB_PROMPTS.restaurant));
    expect(d).toBeTruthy();
    expect(d?.adapter).toBe('web');
    expect(buildExperienceIntelligenceDiagnostics(xiFor(APP_PROMPTS.crm, 'en', 'app'))?.adapter).toBe('app');
    for (const v of Object.values(d as unknown as Record<string, unknown>)) {
      expect(typeof v === 'string' || typeof v === 'number').toBe(true);
      if (typeof v === 'string') expect(v.length).toBeLessThan(64);
    }
    expect(Object.keys(d as object)).not.toContain('score');
    expect(buildExperienceIntelligenceDiagnostics(undefined)).toBeUndefined();
  });

  it('the guard policy and repair digest are absent without a contract', () => {
    expect(buildOptimizationGuardPolicy(undefined)).toBeUndefined();
    expect(buildExperienceRepairDigest(undefined)).toBeUndefined();
  });
});
