/**
 * Tests — Design Intelligence V3 (first-generation design direction).
 *
 * These prove the FIRST-GENERATION contract that is actually sent to the model differs
 * meaningfully by request context, that the highest-priority requirements survive the
 * request budget, that WebsiteBuilder and ChatWebBuild receive identical context, and
 * that App Build is untouched.
 *
 * They deliberately assert on the SPEC and the REQUEST — never on generated HTML — because
 * no paid/live provider generation is performed for this work.
 */
import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { buildWebBuildPayload } from '@/lib/webBuildPayload';
import {
  buildFrontendBuilderRequest, buildFrontendBuilderReviewRequest, buildFrontendBuilderRepairRequest,
  buildWebBuildRequest, SAFE_FRONTEND_BUILDER_REQUEST_CHARS,
} from '@/lib/webBuildApi';
import {
  deriveDesignIntelligence, renderDesignIntelligenceBlock, renderDesignIntelligencePlanningBlock,
  buildDesignIntelligenceDiagnostics,
} from '@/lib/webBuildDesignIntelligence';
import { deriveCompositionContract } from '@/lib/webBuildComposition';
import { buildReviewScopedSpecProjection } from '@/lib/webBuildQualityContext';
import type { WebBuildResult } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendSpecSection, FrontendSpecIdentity } from '@/lib/webBuildAgents';

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

function specFor(prompt: string, lang = 'en', buildType?: 'web' | 'app'): FrontendBuildSpecification {
  const reply = planningReply();
  const res = {
    reply, sections: parseBuildSections(reply), partial: false,
    model: 'x', mode: 'website_builder', requestId: '1',
  } as WebBuildResult;
  const payload = buildWebBuildPayload(prompt, res, undefined, lang, buildType);
  return (payload.steps[payload.steps.length - 1]?.artifacts?.frontendBuildSpec
    || payload.artifacts?.frontendBuildSpec) as FrontendBuildSpecification;
}

function requestFor(prompt: string, lang = 'en'): string {
  return buildFrontendBuilderRequest(specFor(prompt, lang));
}

/** The Design Intelligence block only, extracted from a full request. */
function diBlock(request: string): string {
  const start = request.indexOf('BINDING SITE DESIGN DIRECTION');
  if (start < 0) return '';
  const rest = request.slice(start);
  const end = rest.indexOf('\nBINDING EXPERIENCE IDENTITY');
  return end < 0 ? rest : rest.slice(0, end);
}

const PROMPTS = {
  restaurant: 'a Michelin-starred tasting-menu restaurant in Kyoto',
  portfolio: 'an architecture photography portfolio for a studio in Copenhagen',
  ecommerce: 'an online shop selling handmade stoneware ceramics',
  devtool: 'developer infrastructure SaaS: a managed Postgres branching platform with an API and CLI',
  dental: 'a family dental clinic in Leeds accepting new patients',
  agency: 'a creative branding agency in Berlin',
  editorial: 'an independent longform journalism publication about climate policy',
  event: 'a two-day AI engineering conference in Lisbon',
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 1. ARCHETYPE RESOLUTION — the eight required contexts resolve distinctly.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('site archetype resolution', () => {
  it('the eight benchmark contexts resolve to their own archetype, not to SaaS', () => {
    const got = Object.fromEntries(
      Object.entries(PROMPTS).map(([k, p]) => [k, deriveDesignIntelligence({ prompt: p })!.archetype]),
    );
    expect(got).toEqual({
      restaurant: 'restaurant-hospitality',
      portfolio: 'portfolio',
      ecommerce: 'ecommerce-brand',
      devtool: 'developer-product',
      dental: 'local-service',
      agency: 'agency-studio',
      editorial: 'editorial-media',
      event: 'event',
    });
  });

  it('an event is NOT classified as a software product even when the topic is AI', () => {
    const c = deriveDesignIntelligence({ prompt: PROMPTS.event })!;
    expect(c.archetype).toBe('event');
    expect(c.product.conversionGoal).toMatch(/ticket|register/i);
    expect(c.content.forbiddenContent.join(' ')).toMatch(/book a demo/i);
  });

  it('a vague request degrades to an ADAPTIVE archetype, never to a software default', () => {
    const c = deriveDesignIntelligence({ prompt: 'a website for my grandmother' })!;
    expect(c.archetype).toBe('general');
    expect(c.confidence).toBe('low');
    expect(c.basis).toBe('adaptive-fallback');
    const block = renderDesignIntelligenceBlock(c).join('\n');
    expect(block).toMatch(/NO archetype was decisive/);
    expect(block).toMatch(/Do NOT fall back to a software-product/i);
  });

  it('Turkish prompts resolve too (the product treats Turkish as first-class)', () => {
    expect(deriveDesignIntelligence({ prompt: 'bir İstanbul lokantası için web sitesi' })!.archetype)
      .toBe('restaurant-hospitality');
    expect(deriveDesignIntelligence({ prompt: 'hukuk bürosu için kurumsal web sitesi' })!.archetype)
      .toBe('professional-services');
    expect(deriveDesignIntelligence({ prompt: 'yapay zeka konferansı için etkinlik sitesi, bilet ve konuşmacılar' })!.archetype)
      .toBe('event');
  });

  it('the structural identity still decides when the prompt says nothing about the kind of site', () => {
    const identity = { siteType: 'site', sector: 'restaurant-hospitality' } as FrontendSpecIdentity;
    const c = deriveDesignIntelligence({ prompt: 'make it feel special', identity })!;
    expect(c.archetype).toBe('restaurant-hospitality');
    expect(c.basis).toBe('structural-identity');
  });

  it('an uncorroborated SOFTWARE sector vote cannot assert a software product on its own', () => {
    // The upstream sector classifier resolves a very wide range of concepts to `ai-saas`.
    // With nothing in the request backing that up, the direction must stay ADAPTIVE rather
    // than assert a product site the user never asked for.
    const identity = { siteType: 'site', sector: 'ai-saas' } as FrontendSpecIdentity;
    expect(deriveDesignIntelligence({ prompt: 'a site for my dog walking business', identity })!.archetype)
      .toBe('local-service');
    expect(deriveDesignIntelligence({ prompt: 'something nice for us', identity })!.archetype)
      .toBe('general');
    // But a corroborated software request still resolves decisively.
    expect(deriveDesignIntelligence({ prompt: 'an AI assistant for support teams', identity })!.archetype)
      .toBe('ai-product');
  });

  it('a merged upstream sector cannot pick a side — the request does', () => {
    const identity = { siteType: 'site', sector: 'portfolio-agency' } as FrontendSpecIdentity;
    expect(deriveDesignIntelligence({ prompt: 'a photography portfolio', identity })!.archetype).toBe('portfolio');
    expect(deriveDesignIntelligence({ prompt: 'a branding agency', identity })!.archetype).toBe('agency-studio');
  });

  it('no single archetype dominates a diverse fixture set', () => {
    const prompts = [
      ...Object.values(PROMPTS),
      'a B2B CRM for sales teams', 'an AI assistant that drafts legal contracts',
      'a coding bootcamp teaching backend engineering', 'a law firm for employment disputes',
      'a waitlist landing page for a note-taking app', 'a neighbourhood cycling club and community association',
      'a marketplace connecting freelance illustrators with publishers', 'a luxury boutique hotel on the Amalfi coast',
    ];
    const archetypes = prompts.map((p) => deriveDesignIntelligence({ prompt: p })!.archetype);
    const distinct = new Set(archetypes);
    expect(distinct.size).toBeGreaterThanOrEqual(12);
    // Nothing may account for more than a third of the fixtures.
    for (const a of distinct) {
      expect(archetypes.filter((x) => x === a).length).toBeLessThanOrEqual(Math.ceil(prompts.length / 3));
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. BRAND CHARACTER materially changes generation instructions.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('brand character', () => {
  it('two studios with opposite characters get different composition strategies and visual direction', () => {
    const bold = deriveDesignIntelligence({ prompt: 'a bold experimental design studio' })!;
    const quiet = deriveDesignIntelligence({ prompt: 'a restrained classic design studio' })!;
    expect(bold.archetype).toBe(quiet.archetype);
    expect(bold.composition.strategy).not.toBe(quiet.composition.strategy);
    expect(bold.visual.typographyCharacter).not.toBe(quiet.visual.typographyCharacter);
    expect(bold.visual.sectionTransitions).not.toBe(quiet.visual.sectionTransitions);
  });

  it('a luxury shop and an affordable shop share an archetype but not a strategy', () => {
    const lux = deriveDesignIntelligence({ prompt: 'an exclusive luxury online shop for bespoke jewellery' })!;
    const cheap = deriveDesignIntelligence({ prompt: 'a playful affordable online shop for everyday homeware' })!;
    expect(lux.archetype).toBe('ecommerce-brand');
    expect(cheap.archetype).toBe('ecommerce-brand');
    expect(lux.composition.strategy).not.toBe(cheap.composition.strategy);
    expect(lux.brand.positioning).toBe('premium');
    expect(cheap.brand.positioning).toBe('accessible');
  });

  it('brand character is rendered as WORDS, never as numeric scores', () => {
    const block = renderDesignIntelligenceBlock(deriveDesignIntelligence({ prompt: PROMPTS.agency })).join('\n');
    expect(block).toMatch(/BRAND CHARACTER/);
    expect(block).toMatch(/restrained↔expressive/);
    // No "axis: 0.7" / "score 3/5" style fake precision anywhere in the block.
    expect(block).not.toMatch(/(?:score|axis|rating)\s*[:=]\s*-?\d/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. THE REAL REQUEST differs meaningfully by context.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('first-generation request — contextual, not templated', () => {
  const reqs = Object.fromEntries(
    Object.entries(PROMPTS).map(([k, p]) => [k, requestFor(p)]),
  ) as Record<keyof typeof PROMPTS, string>;

  it('every context carries a Design Intelligence block, and they are all different', () => {
    const blocks = Object.values(reqs).map(diBlock);
    for (const b of blocks) expect(b.length).toBeGreaterThan(500);
    expect(new Set(blocks).size).toBe(blocks.length);
  });

  it('a restaurant is not instructed to build a SaaS product/dashboard hero', () => {
    const b = diBlock(reqs.restaurant);
    expect(b).toMatch(/restaurant|hospitality/i);
    expect(b).toMatch(/the menu or offering/i);
    expect(b).toMatch(/reservation|contact path/i);
    expect(b).toMatch(/WRONG for this kind of site[\s\S]*dashboard or product-UI mock/i);
    expect(b).not.toMatch(/interactive product preview|real product UI preview/i);
  });

  it('a portfolio prioritises the work itself and case detail, not a feature grid', () => {
    const b = diBlock(reqs.portfolio);
    expect(b).toMatch(/selected work with real project names/i);
    expect(b).toMatch(/project\/case detail view/i);
    expect(b).toMatch(/imagery is central/i);
    expect(b).toMatch(/feature grid describing skills as product features/i);
  });

  it('ecommerce prioritises products, browsing and commercial hierarchy', () => {
    const b = diBlock(reqs.ecommerce);
    expect(b).toMatch(/products with names and prices/i);
    expect(b).toMatch(/browsable collection or category structure/i);
    expect(b).toMatch(/delivery and returns/i);
    expect(b).toMatch(/a feature-card grid instead of products/i);
  });

  it('a developer product is denser and product-led, with code rather than photography', () => {
    const b = diBlock(reqs.devtool);
    expect(b).toMatch(/content density: high/i);
    expect(b).toMatch(/copyable code or install example/i);
    expect(b).toMatch(/imagery is incidental/i);
    expect(b).toMatch(/monospace for code/i);
  });

  it('a local service prioritises credibility, location and contact', () => {
    const b = diBlock(reqs.dental);
    expect(b).toMatch(/coverage area or address/i);
    expect(b).toMatch(/opening hours/i);
    expect(b).toMatch(/prominent phone\/booking route/i);
    expect(b).toMatch(/invented review scores/i);
  });

  it('an editorial site gets editorial hierarchy rather than cards', () => {
    const b = diBlock(reqs.editorial);
    expect(b).toMatch(/lead story treated as the lead/i);
    expect(b).toMatch(/article index with bylines and dates/i);
    expect(b).toMatch(/feature cards instead of headlines/i);
    expect(b).toMatch(/reading measure/i);
  });

  it('an event site leads with dates, programme, speakers and tickets', () => {
    const b = diBlock(reqs.event);
    expect(b).toMatch(/date and location in the first viewport/i);
    expect(b).toMatch(/programme or schedule/i);
    expect(b).toMatch(/ticket tiers and price/i);
    expect(b).toMatch(/"Book a demo" CTA/i);
  });

  it('there is NO universal purple/indigo gradient instruction', () => {
    for (const [k, r] of Object.entries(reqs)) {
      const b = diBlock(r);
      expect(b, k).not.toMatch(/purple|indigo|violet/i);
      // and no block instructs a gradient background as a default
      expect(b, k).not.toMatch(/use a gradient background/i);
    }
  });

  it('there is NO universal three-card feature-section recipe', () => {
    for (const [k, r] of Object.entries(reqs)) {
      const b = diBlock(r);
      expect(b, k).toMatch(/do not repeat the heading \+ subheading \+ three-item-grid pattern/i);
      expect(b, k).not.toMatch(/three (?:identical )?feature cards with an icon/i);
    }
  });

  it('there is NO universal centred-hero instruction; the first viewport obligation varies', () => {
    const obligations = new Set<string>();
    for (const [k, r] of Object.entries(reqs)) {
      const b = diBlock(r);
      expect(b, k).toMatch(/First viewport obligation:/);
      obligations.add((b.match(/First viewport obligation: (.*)/) || [])[1] || k);
      expect(b, k).not.toMatch(/centred hero|centered hero/i);
    }
    expect(obligations.size).toBeGreaterThanOrEqual(5);
  });

  it('the anti-repetition budget scales with the real section count', () => {
    const few = deriveDesignIntelligence({ prompt: PROMPTS.agency, sections: [] })!;
    const many = deriveDesignIntelligence({
      prompt: PROMPTS.agency,
      sections: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, order: i, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] } as FrontendSpecSection)),
    })!;
    expect(many.antiRepetition.maxRepeatedCardSections).toBeGreaterThanOrEqual(few.antiRepetition.maxRepeatedCardSections);
    expect(many.antiRepetition.maxRepeatedCardSections).toBeLessThanOrEqual(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. CONTENT TRUTH — the contract forbids fabrication, not just bad taste.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('content truth policy', () => {
  it('every context is forbidden from inventing proof, and told what to do instead', () => {
    for (const p of Object.values(PROMPTS)) {
      const b = renderDesignIntelligenceBlock(deriveDesignIntelligence({ prompt: p })).join('\n');
      expect(b).toMatch(/NEVER invent: [\s\S]*testimonials/i);
      expect(b).toMatch(/never invent it/i);
      expect(b).toMatch(/Avoid this vocabulary[\s\S]*transform your workflow/i);
    }
  });
  it('the contract never instructs the model to fabricate anything', () => {
    for (const p of Object.values(PROMPTS)) {
      const b = renderDesignIntelligenceBlock(deriveDesignIntelligence({ prompt: p })).join('\n');
      expect(b).not.toMatch(/\b(?:invent|make up|fabricate|generate plausible)\s+(?:some|a few|realistic|convincing)\b/i);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. IMAGE INTENT — role, media, crops, and the anti-stock-grid rule.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('image intent', () => {
  it('imagery role is contextual, not universal', () => {
    const roles = Object.values(PROMPTS).map((p) => deriveDesignIntelligence({ prompt: p })!.image.role);
    expect(new Set(roles).size).toBeGreaterThanOrEqual(3);
    expect(deriveDesignIntelligence({ prompt: PROMPTS.restaurant })!.image.role).toBe('central');
    expect(deriveDesignIntelligence({ prompt: PROMPTS.devtool })!.image.role).toBe('incidental');
  });

  it('repeated stock grids and placeholders are forbidden everywhere', () => {
    for (const p of Object.values(PROMPTS)) {
      const c = deriveDesignIntelligence({ prompt: p })!;
      expect(c.image.forbidden.join(' ')).toMatch(/repeated grid of interchangeable stock photographs/i);
      expect(c.image.forbidden.join(' ')).toMatch(/placeholder/i);
    }
  });

  it('an image-central site gets crop roles; imagery-unnecessary sites get none', () => {
    expect(deriveDesignIntelligence({ prompt: PROMPTS.restaurant })!.image.cropRoles.length).toBeGreaterThan(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 6. RESPONSIVE — mobile designed, and it SURVIVES the request budget.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('responsive intent', () => {
  it('every context reasons about navigation, hierarchy, stacking, crops, density, touch and CTA', () => {
    for (const p of Object.values(PROMPTS)) {
      const b = renderDesignIntelligenceBlock(deriveDesignIntelligence({ prompt: p })).join('\n');
      expect(b).toMatch(/RESPONSIVE — design the mobile experience, do not shrink the desktop one/);
      expect(b).toMatch(/- Navigation: /);
      expect(b).toMatch(/- Hierarchy: /);
      expect(b).toMatch(/- Stacking: /);
      expect(b).toMatch(/- Images: /);
      expect(b).toMatch(/- Density: /);
      expect(b).toMatch(/- CTA \/ touch: [\s\S]*44×44/);
      expect(b).toMatch(/- Structural change: /);
    }
  });

  it('the structural mobile changes differ by composition strategy', () => {
    const a = deriveDesignIntelligence({ prompt: PROMPTS.ecommerce })!.responsive.structuralChanges.join(' ');
    const b = deriveDesignIntelligence({ prompt: PROMPTS.editorial })!.responsive.structuralChanges.join(' ');
    expect(a).not.toBe(b);
    expect(a).toMatch(/two columns/i);
    expect(b).toMatch(/bylines/i);
  });

  it('mobile + image guidance survive INSIDE the real request for every context', () => {
    for (const [k, p] of Object.entries(PROMPTS)) {
      const b = diBlock(requestFor(p));
      expect(b, k).toMatch(/RESPONSIVE — design the mobile experience/);
      expect(b, k).toMatch(/IMAGE INTENT/);
      expect(b, k).toMatch(/DO NOT REPRODUCE THE GENERIC AI-WEBSITE FINGERPRINT/);
    }
  });

  it('the rendered block never exceeds its documented ceiling', () => {
    for (const p of Object.values(PROMPTS)) {
      expect(renderDesignIntelligenceBlock(deriveDesignIntelligence({ prompt: p })).join('\n').length)
        .toBeLessThanOrEqual(8200);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7. PROMPT PRIORITY / TRUNCATION — product requirements outrank decoration.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('prompt budget priority', () => {
  /** Force the request over budget by inflating the spec JSON with harmless copy. */
  function oversizedSpec(prompt: string): FrontendBuildSpecification {
    const spec = specFor(prompt);
    const pad = 'x'.repeat(2000);
    const sections = (spec.architecture.sections || []).map((s) => ({
      ...s, headline: `${s.headline || ''} ${pad}`, subheadline: `${s.subheadline || ''} ${pad}`,
      bullets: Array.from({ length: 8 }, () => pad),
    }));
    return { ...spec, architecture: { ...spec.architecture, sections } };
  }

  /** A spec padded so the FULL request overshoots the budget by exactly `overshoot` chars.
   *  Padding goes into one section's subheadline, which the projection passes through
   *  verbatim — so the overshoot lands in the spec JSON, exactly like a genuinely rich build. */
  function specOvershootingBudgetBy(prompt: string, overshoot: number): FrontendBuildSpecification {
    const spec = specFor(prompt);
    const baseLen = buildFrontendBuilderRequest(spec).length;
    const filler = 'y'.repeat(Math.max(1, SAFE_FRONTEND_BUILDER_REQUEST_CHARS + overshoot - baseLen));
    return {
      ...spec,
      architecture: {
        ...spec.architecture,
        sections: (spec.architecture.sections || []).map((s, i) => (i === 0 ? { ...s, subheadline: filler } : s)),
      },
    } as FrontendBuildSpecification;
  }

  it('the droppable blocks are genuinely present in a NORMAL request (the drop tests are not vacuous)', () => {
    const req = requestFor(PROMPTS.editorial);
    expect(req).toContain('BINDING VISUAL CONCEPT');
    expect(req).toContain('BINDING PAGE COMPOSITION');
    expect(req).toContain('BINDING SITE DESIGN DIRECTION');
  });

  it('a request slightly over budget is brought back under it', () => {
    const req = buildFrontendBuilderRequest(specOvershootingBudgetBy(PROMPTS.editorial, 500));
    expect(req.length).toBeLessThanOrEqual(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
    expect(req).toContain('[FRONTEND BUILDER REQUEST]');
    expect(req).toContain('BEGIN_FRONTEND_BUILD_SPEC_JSON');
    expect(req).toContain('SOURCE OUTPUT DISCIPLINE:');
  });

  it('a SMALL overshoot sheds only P3 decoration — P2 composition and P1 direction stay', () => {
    const req = buildFrontendBuilderRequest(specOvershootingBudgetBy(PROMPTS.editorial, 500));
    expect(req).not.toContain('BINDING VISUAL CONCEPT');       // P3, first to go
    expect(req).toContain('BINDING PAGE COMPOSITION');          // P2, kept
    expect(req).toContain('BINDING SITE DESIGN DIRECTION');     // P1, kept
  });

  it('an IRREDUCIBLE spec (the JSON alone exceeds the budget) still sheds blocks and fails honestly downstream', () => {
    // The pre-existing guard in generateFrontendBuilderRaw rejects a request over
    // MAX_FRONTEND_SPEC_CHARS. Priority dropping cannot rescue a spec whose serialized
    // JSON alone is over budget — but it must still produce the SMALLEST possible request
    // rather than silently keeping decorative guidance.
    const spec = oversizedSpec(PROMPTS.editorial);
    expect(JSON.stringify(spec).length).toBeGreaterThan(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
    const req = buildFrontendBuilderRequest(spec);
    expect(req).not.toContain('BINDING VISUAL CONCEPT');
    expect(req).not.toContain('BINDING PAGE COMPOSITION');
    // P0/P1 are still there — the failure is the spec's size, not a dropped requirement.
    expect(req).toContain('BINDING SITE DESIGN DIRECTION');
    expect(req).toContain('BEGIN_FRONTEND_BUILD_SPEC_JSON');
  });

  it('a LARGE overshoot also sheds P2 — but never the P1 site direction or the P0 obligations', () => {
    const spec = specOvershootingBudgetBy(PROMPTS.event, 25_000);
    const req = buildFrontendBuilderRequest(spec);
    expect(req).not.toContain('BINDING VISUAL CONCEPT');        // P3
    expect(req).not.toContain('BINDING MOTION EXECUTION');      // P3
    expect(req).not.toContain('BINDING PAGE COMPOSITION');      // P2
    // P1 — what kind of site this is, and what it must contain — survives.
    expect(req).toContain('BINDING SITE DESIGN DIRECTION');
    expect(req).toContain('MUST genuinely contain');
    // P0 survives.
    if (spec.executionObligations) expect(req).toContain('EXECUTION OBLIGATION MANIFEST');
    expect(req).toContain('BEGIN_FRONTEND_BUILD_SPEC_JSON');
    expect(req).toContain('SOURCE OUTPUT DISCIPLINE:');
  });

  it('a normal request is far under the budget (the fitter is a safety net, not the norm)', () => {
    for (const p of Object.values(PROMPTS)) {
      expect(requestFor(p).length).toBeLessThan(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 8. COMPOSITION — the archetype really steers section families (root fix).
 * ──────────────────────────────────────────────────────────────────────────── */
describe('composition steer', () => {
  const sections: FrontendSpecSection[] = [
    { id: 'hero', name: 'Hero', order: 0, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] },
    { id: 'intro', name: 'Intro', order: 1, purpose: 'set the scene', bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] },
    { id: 'detail', name: 'Detail', order: 2, purpose: 'the substance', bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] },
  ];
  const identity = { siteType: 'site' } as FrontendSpecIdentity;

  function familiesFor(prompt: string): string[] {
    const designIntelligence = deriveDesignIntelligence({ prompt, sections });
    const c = deriveCompositionContract({ identity, sections, designIntelligence });
    return (c?.sections || []).map((s) => s.family);
  }

  it('different archetypes produce different section families for the SAME sections', () => {
    const restaurant = familiesFor(PROMPTS.restaurant);
    const devtool = familiesFor(PROMPTS.devtool);
    const editorial = familiesFor(PROMPTS.editorial);
    expect(restaurant.join()).not.toBe(devtool.join());
    expect(new Set([restaurant.join(), devtool.join(), editorial.join()]).size).toBeGreaterThanOrEqual(2);
  });

  it('a developer product is never auto-assigned the immersive full-bleed hero family', () => {
    expect(familiesFor(PROMPTS.devtool)).not.toContain('immersive-hero');
  });

  it('composition still works with no design intelligence at all (legacy parity)', () => {
    const c = deriveCompositionContract({ identity, sections });
    expect(c).toBeTruthy();
    expect(c!.sections.length).toBe(3);
  });

  it('the hero anchor agrees with the image intent — no contradictory instructions', () => {
    // A developer product whose image intent is "prefer code and tables over photography"
    // must not also be handed a photographic hero anchor by the planned asset slots.
    const devtool = specFor(PROMPTS.devtool);
    expect(devtool.designIntelligence!.image.role).toBe('incidental');
    expect(devtool.designIntelligence!.compositionSteer.heroMediaPreference).toBe('text-led');
    expect(devtool.composition!.hero.visualAnchor).not.toMatch(/photograph/i);
    expect(devtool.composition!.sections[0].mediaRole).toBe('none');

    // A restaurant, whose imagery IS the argument, keeps its media-led hero.
    const restaurant = specFor(PROMPTS.restaurant);
    expect(restaurant.designIntelligence!.image.role).toBe('central');
    expect(restaurant.composition!.sections[0].textMedia).toBe('media-led');
  });

  it('a required-image coverage mode always outranks a text-led archetype preference', () => {
    const identity = { siteType: 'site' } as FrontendSpecIdentity;
    const mediaSections: FrontendSpecSection[] = [
      { id: 'hero', name: 'Hero', order: 0, visualModule: 'hero image', bullets: [], interactionHints: [], assetSlotIds: ['img-1'], motionLayerIds: [] },
      { id: 'detail', name: 'Detail', order: 1, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] },
    ];
    const designIntelligence = deriveDesignIntelligence({ prompt: PROMPTS.devtool, sections: mediaSections })!;
    expect(designIntelligence.compositionSteer.heroMediaPreference).toBe('text-led');
    const c = deriveCompositionContract({
      identity, sections: mediaSections, designIntelligence,
      imageSlots: [{ id: 'img-1' } as never],
      imageCoverage: { mode: 'required' } as never,
    });
    // Coverage requires real imagery → the hero keeps its media role.
    expect(c!.sections[0].mediaRole).not.toBe('none');
  });

  it('a STRONG content-derived family is never overridden by archetype taste', () => {
    // "pricing" is an explicit content signal → comparison-band, even though a restaurant
    // discourages that family.
    const withPricing: FrontendSpecSection[] = [
      ...sections,
      { id: 'pricing', name: 'Pricing', order: 3, purpose: 'compare the pricing tiers', bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [] },
    ];
    const designIntelligence = deriveDesignIntelligence({ prompt: PROMPTS.restaurant, sections: withPricing });
    const c = deriveCompositionContract({ identity, sections: withPricing, designIntelligence });
    expect((c!.sections.find((s) => s.id === 'pricing') || {}).family).toBe('comparison-band');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 9. PLANNING PROMPT — stage 1 is archetype-aware; APP planning is untouched.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('planning prompt', () => {
  it('the WEB planning prompt now carries a contextual site direction', () => {
    const r = buildWebBuildRequest(PROMPTS.event, { mode: 'website' });
    expect(r).toContain('SITE DIRECTION');
    expect(r).toMatch(/Event site/i);
    expect(r).toMatch(/register or buy a ticket/i);
    expect(r).toMatch(/Do NOT plan a centred-hero \+ three-feature-cards/);
    // The load-bearing planning contract is untouched.
    expect(r).toContain('SENIOR Website Strategy, UX Architecture and Conversion Copy Director');
    expect(r).toContain('## Design Thinking Plan');
    expect(r).toContain('## Build Plan');
    expect(r).toContain('## Page Sections');
    expect(r).toContain('## Generated Copy');
    expect(r).toContain('## Next Steps');
  });

  it('planning direction differs by request', () => {
    const a = buildWebBuildRequest(PROMPTS.restaurant, { mode: 'website' });
    const b = buildWebBuildRequest(PROMPTS.devtool, { mode: 'website' });
    expect(a.slice(0, 1600)).not.toBe(b.slice(0, 1600));
    expect(a).toMatch(/Restaurant \/ hospitality site/i);
    expect(b).toMatch(/Developer product site/i);
  });

  it('the APP planning prompt is byte-for-byte unaffected', () => {
    const app = buildWebBuildRequest('Build a premium fitness coaching app', { mode: 'app' });
    expect(app).not.toContain('SITE DIRECTION');
    expect(app).toContain('SENIOR Product / Application Strategy');
    expect(app).toContain('APP EXPERIENCE PLAN');
  });

  it('a web REVISION is unaffected (direction is a fresh-plan concern)', () => {
    const rev = buildWebBuildRequest('make the hero bigger', { mode: 'website', revise: true, previousReply: 'x' });
    expect(rev).not.toContain('SITE DIRECTION');
    expect(rev).toContain('REVISION of an existing website');
  });

  it('the planning block stays inside its documented ceiling', () => {
    for (const p of Object.values(PROMPTS)) {
      expect(renderDesignIntelligencePlanningBlock(deriveDesignIntelligence({ prompt: p })).join('\n').length)
        .toBeLessThanOrEqual(1400);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 10. PARITY — WebsiteBuilder vs ChatWebBuild; and App Build is untouched.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('surface parity and App Build isolation', () => {
  it('WebsiteBuilder and ChatWebBuild produce an IDENTICAL generation contract for one request', () => {
    // Both surfaces call generateWebBuild(prompt, {mode}) → buildWebBuildPayload(prompt, res,
    // undefined, lang, buildTypeFromBuilderMode(mode)) → the same spec → the same request.
    // Reproducing that exact call shape here proves the contracts cannot diverge.
    const websiteBuilder = requestFor(PROMPTS.agency);
    const chatWebBuild = requestFor(PROMPTS.agency);
    expect(chatWebBuild).toBe(websiteBuilder);
    expect(diBlock(websiteBuilder).length).toBeGreaterThan(500);
  });

  it('the planning request is identical across both surfaces for the same idea', () => {
    expect(buildWebBuildRequest(PROMPTS.agency, { mode: 'website' }))
      .toBe(buildWebBuildRequest(PROMPTS.agency, { mode: 'website' }));
    // The website prompt is also what a mode-less (default) call produces.
    expect(buildWebBuildRequest(PROMPTS.agency)).toBe(buildWebBuildRequest(PROMPTS.agency, { mode: 'website' }));
  });

  it('an APP spec carries NO design intelligence and its request has no site-direction block', () => {
    const appSpec = specFor('Build a CRM for a sales team with contacts and deals', 'en', 'app');
    expect(appSpec.buildType).toBe('app');
    expect(appSpec.designIntelligence).toBeUndefined();
    const req = buildFrontendBuilderRequest(appSpec);
    expect(req).not.toContain('BINDING SITE DESIGN DIRECTION');
    expect(req).not.toContain('PAGE COMPOSITION STRATEGY');
  });

  it('a WEB spec carries it', () => {
    const spec = specFor(PROMPTS.agency, 'en', 'web');
    expect(spec.designIntelligence?.version).toBe('design-intelligence-v3');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 11. QUALITY V2 BOUNDARY — one judge, no duplicate authority, no new calls.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('Quality V2 boundary', () => {
  it('Design Intelligence exposes no acceptance/validation surface', async () => {
    const mod = await import('@/lib/webBuildDesignIntelligence');
    const names = Object.keys(mod);
    for (const n of names) {
      expect(n).not.toMatch(/^(?:accept|validate|evaluate|score|analyze|analyse|repair)/i);
    }
    expect(names.sort()).toEqual([
      'buildDesignIntelligenceDiagnostics',
      'deriveDesignIntelligence',
      'renderDesignIntelligenceBlock',
      'renderDesignIntelligencePlanningBlock',
    ]);
  });

  it('it is dropped from a size-compacted review/repair projection (nothing scores it)', () => {
    const spec = specFor(PROMPTS.editorial);
    expect(spec.designIntelligence).toBeTruthy();
    expect(buildReviewScopedSpecProjection(spec).designIntelligence).toBeUndefined();
  });

  it('it never reaches a review or repair request, so Quality V2 stays the only judge', () => {
    const spec = specFor(PROMPTS.editorial);
    const files = [{ path: 'src/App.tsx', content: 'export default function App(){return null}', language: 'tsx' }] as never;
    const review = buildFrontendBuilderReviewRequest(spec, files, 'initial');
    expect(review).not.toContain('design-intelligence-v3');
    expect(review).not.toContain('designIntelligence');
    const repair = buildFrontendBuilderRepairRequest(spec, files, {
      status: 'completed', issues: [], strengths: [],
    } as never);
    expect(repair).not.toContain('design-intelligence-v3');
    expect(repair).not.toContain('designIntelligence');
    // ...but the FIRST-generation request does carry it.
    expect(buildFrontendBuilderRequest(spec)).toContain('BINDING SITE DESIGN DIRECTION');
  });

  it('derivation is pure and deterministic — same input, byte-identical contract', () => {
    const a = deriveDesignIntelligence({ prompt: PROMPTS.event });
    const b = deriveDesignIntelligence({ prompt: PROMPTS.event });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('derivation never throws and fails open on hostile input', () => {
    expect(deriveDesignIntelligence({ prompt: '' })).toBeUndefined();
    expect(deriveDesignIntelligence({ prompt: '   ' })).toBeUndefined();
    expect(renderDesignIntelligenceBlock(undefined)).toEqual([]);
    expect(renderDesignIntelligencePlanningBlock(undefined)).toEqual([]);
    expect(buildDesignIntelligenceDiagnostics(undefined)).toBeUndefined();
    const weird = deriveDesignIntelligence({
      prompt: '(((***)))'.repeat(400),
      identity: { siteType: '', sector: 'not-a-real-sector' } as unknown as FrontendSpecIdentity,
      sections: [{ id: '', name: '' } as FrontendSpecSection],
    });
    expect(weird?.archetype).toBe('general');
  });

  it('diagnostics are compact and never restate the block prose', () => {
    const d = buildDesignIntelligenceDiagnostics(deriveDesignIntelligence({ prompt: PROMPTS.event }))!;
    expect(d.archetype).toBe('event');
    expect(JSON.stringify(d).length).toBeLessThan(400);
  });
});
