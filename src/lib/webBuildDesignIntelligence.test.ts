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
  renderDesignIntelligenceP1Block, renderDesignIntelligenceP2Block,
  renderDesignIntelligenceP3Block, renderDesignIntelligenceP4Block,
  buildDesignIntelligenceDiagnostics, DESIGN_INTELLIGENCE_CHAR_CEILING,
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

/**
 * The Design Intelligence direction as it ACTUALLY reaches the model, for a given prompt.
 * The four priority tiers are emitted at four different points of the request, so this
 * re-renders them from the spec AND asserts each one really is present in the request —
 * which keeps every content assertion below tied to the bytes that get sent.
 */
function diTextFor(prompt: string, lang = 'en'): string {
  const spec = specFor(prompt, lang);
  const request = buildFrontendBuilderRequest(spec);
  const di = spec.designIntelligence;
  expect(di, `${prompt}: spec carries design intelligence`).toBeTruthy();
  const tiers = [
    renderDesignIntelligenceP1Block(di).join('\n'),
    renderDesignIntelligenceP2Block(di).join('\n'),
    renderDesignIntelligenceP3Block(di).join('\n'),
    renderDesignIntelligenceP4Block(di).join('\n'),
  ];
  for (const tier of tiers) {
    expect(tier.length, `${prompt}: tier is non-empty`).toBeGreaterThan(50);
    expect(request.includes(tier.trim()), `${prompt}: tier present in request`).toBe(true);
  }
  return tiers.join('\n');
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

  it('Turkish and English classifiers are symmetric about bare "studio"/"stüdyo"', () => {
    // English already refuses bare "studio" as an agency signal; Turkish must match, or a
    // yoga/photography/recording studio silently becomes a creative agency.
    expect(deriveDesignIntelligence({ prompt: 'yoga stüdyosu için web sitesi' })!.archetype)
      .toBe('local-service');
    expect(deriveDesignIntelligence({ prompt: 'pilates stüdyosu için site' })!.archetype)
      .toBe('local-service');
    expect(deriveDesignIntelligence({ prompt: 'fotoğraf stüdyosu portföy sitesi' })!.archetype)
      .toBe('portfolio');
    // A QUALIFIED studio still resolves to an agency, in both languages.
    expect(deriveDesignIntelligence({ prompt: 'tasarım stüdyosu için web sitesi' })!.archetype)
      .toBe('agency-studio');
    expect(deriveDesignIntelligence({ prompt: 'reklam ajansı için web sitesi' })!.archetype)
      .toBe('agency-studio');
    expect(deriveDesignIntelligence({ prompt: 'a yoga studio' })!.archetype).toBe('local-service');
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

  it('Turkish character language steers the design, exactly as English does', () => {
    // Without Turkish cues these all fell back to the archetype baseline, so a Turkish user
    // could describe the character precisely and change nothing.
    type Axis = 'expression' | 'emphasis' | 'demeanour' | 'spacing' | 'temperature' | 'convention' | 'positioning';
    const cases: Array<[string, Axis, string]> = [
      ['minimal ve sade bir lokanta sitesi', 'expression', 'restrained'],
      ['cesur ve çarpıcı bir ajans sitesi', 'expression', 'expressive'],
      ['eğlenceli bir online mağaza', 'demeanour', 'playful'],
      ['ciddi ve kurumsal bir hukuk bürosu sitesi', 'demeanour', 'serious'],
      ['ferah bir portföy sitesi', 'spacing', 'spacious'],
      ['yoğun ve detaylı içerik olan bir dergi sitesi', 'spacing', 'dense'],
      ['sıcak, el yapımı seramik satan bir mağaza', 'temperature', 'warm'],
      ['teknik ve mühendislik odaklı bir geliştirici ürünü sitesi', 'temperature', 'technical'],
      ['deneysel bir tasarım stüdyosu sitesi', 'convention', 'experimental'],
      ['klasik ve geleneksel bir lokanta sitesi', 'convention', 'classic'],
      ['lüks bir otel sitesi', 'positioning', 'premium'],
      ['uygun fiyatlı bir online mağaza', 'positioning', 'accessible'],
    ];
    for (const [prompt, axis, expected] of cases) {
      const c = deriveDesignIntelligence({ prompt })!;
      expect(c.brand[axis], `${prompt} → ${axis}`).toBe(expected);
    }
  });

  it('Turkish character cues change the generated instructions, not just the stored axis', () => {
    const quiet = deriveDesignIntelligence({ prompt: 'minimal ve sade bir tasarım stüdyosu sitesi' })!;
    const bold = deriveDesignIntelligence({ prompt: 'cesur ve çarpıcı bir tasarım stüdyosu sitesi' })!;
    expect(quiet.archetype).toBe(bold.archetype);
    expect(quiet.brand.expression).toBe('restrained');
    expect(bold.brand.expression).toBe('expressive');
    expect(quiet.visual.scaleHierarchy).not.toBe(bold.visual.scaleHierarchy);
    expect(quiet.visual.motionRestraint).not.toBe(bold.visual.motionRestraint);
    // The whole rendered P2 tier differs, so the model really is told something different.
    expect(renderDesignIntelligenceP2Block(quiet).join('\n'))
      .not.toBe(renderDesignIntelligenceP2Block(bold).join('\n'));
  });

  it('a Turkish positioning cue flips the composition strategy, as the English one does', () => {
    const lux = deriveDesignIntelligence({ prompt: 'lüks bir online mağaza' })!;
    const cheap = deriveDesignIntelligence({ prompt: 'uygun fiyatlı bir online mağaza' })!;
    expect(lux.archetype).toBe('ecommerce-brand');
    expect(cheap.archetype).toBe('ecommerce-brand');
    expect(lux.composition.strategy).not.toBe(cheap.composition.strategy);
  });

  it('a Turkish cue never moves two axes at once (no cross-axis collisions)', () => {
    // "samimi" is a demeanour cue only; "sıcak" is a temperature cue only — one word must
    // never quietly move two axes, which is how a bounded lexicon turns into a keyword dump.
    const playful = deriveDesignIntelligence({ prompt: 'samimi bir topluluk sitesi' })!;
    expect(playful.brand.demeanour).toBe('playful');
    const warm = deriveDesignIntelligence({ prompt: 'sıcak bir topluluk sitesi' })!;
    expect(warm.brand.temperature).toBe('warm');
    expect(warm.brand.demeanour).not.toBe('playful');
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
  const dis = Object.fromEntries(
    Object.entries(PROMPTS).map(([k, p]) => [k, diTextFor(p)]),
  ) as Record<keyof typeof PROMPTS, string>;

  it('every context carries a Design Intelligence direction, and they are all different', () => {
    const blocks = Object.values(dis);
    for (const b of blocks) expect(b.length).toBeGreaterThan(500);
    expect(new Set(blocks).size).toBe(blocks.length);
  });

  it('a restaurant is not instructed to build a SaaS product/dashboard hero', () => {
    const b = dis.restaurant;
    expect(b).toMatch(/restaurant|hospitality/i);
    expect(b).toMatch(/a menu or offering structured by real courses\/categories/i);
    expect(b).toMatch(/reservation|contact path/i);
    expect(b).toMatch(/WRONG for this kind of site[\s\S]*dashboard or product-UI mock/i);
    expect(b).not.toMatch(/interactive product preview|real product UI preview/i);
  });

  it('a portfolio prioritises the work itself and case detail, not a feature grid', () => {
    const b = dis.portfolio;
    expect(b).toMatch(/a selected-work index with a title \/ year \/ discipline slot/i);
    expect(b).toMatch(/a project or case detail view/i);
    expect(b).toMatch(/imagery is central/i);
    expect(b).toMatch(/feature grid describing skills as product features/i);
  });

  it('ecommerce prioritises products, browsing and commercial hierarchy', () => {
    const b = dis.ecommerce;
    expect(b).toMatch(/a product grid whose tiles have real name \/ image \/ price slots/i);
    expect(b).toMatch(/a browsable collection or category structure/i);
    expect(b).toMatch(/a delivery and returns section/i);
    expect(b).toMatch(/a feature-card grid instead of products/i);
  });

  it('a developer product is denser and product-led, with code rather than photography', () => {
    const b = dis.devtool;
    expect(b).toMatch(/content density: high/i);
    expect(b).toMatch(/a copyable code or install example/i);
    expect(b).toMatch(/imagery is incidental/i);
    expect(b).toMatch(/monospace for code/i);
  });

  it('a local service prioritises credibility, location and contact', () => {
    const b = dis.dental;
    expect(b).toMatch(/a coverage-area or address section/i);
    expect(b).toMatch(/an opening-hours block/i);
    expect(b).toMatch(/a prominent phone\/booking route/i);
    expect(b).toMatch(/invented review scores/i);
  });

  it('an editorial site gets editorial hierarchy rather than cards', () => {
    const b = dis.editorial;
    expect(b).toMatch(/a lead story treated as the lead/i);
    expect(b).toMatch(/an article index with a headline \/ byline \/ date \/ standfirst slot/i);
    expect(b).toMatch(/feature cards instead of headlines/i);
    expect(b).toMatch(/reading measure/i);
  });

  it('an event site leads with dates, programme, speakers and tickets', () => {
    const b = dis.event;
    expect(b).toMatch(/a prominent date-and-location block in the first viewport/i);
    expect(b).toMatch(/a programme or schedule structured by day and slot/i);
    expect(b).toMatch(/a ticket section with a tier \/ inclusions \/ price slot/i);
    expect(b).toMatch(/"Book a demo" CTA/i);
  });

  it('there is NO universal purple/indigo gradient instruction', () => {
    for (const [k, b] of Object.entries(dis)) {
      expect(b, k).not.toMatch(/purple|indigo|violet/i);
      // and no block instructs a gradient background as a default
      expect(b, k).not.toMatch(/use a gradient background/i);
    }
  });

  it('there is NO universal three-card feature-section recipe', () => {
    for (const [k, b] of Object.entries(dis)) {
      expect(b, k).toMatch(/do not repeat the heading \+ subheading \+ three-item-grid pattern/i);
      expect(b, k).not.toMatch(/three (?:identical )?feature cards with an icon/i);
    }
  });

  it('there is NO universal centred-hero instruction; the first viewport obligation varies', () => {
    const obligations = new Set<string>();
    for (const [k, b] of Object.entries(dis)) {
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
      // Only the classes the spec's own honesty rules do NOT already cover are restated here.
      expect(b).toMatch(/NEVER invent, in addition to the honesty rules below:/i);
      expect(b).toMatch(/names of people/i);
      expect(b).toMatch(/dates, times, schedules/i);
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
 * 4b. TRUTH POLICY vs REQUIRED STRUCTURE — the contract must never contradict itself.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('required structure never forces fabrication', () => {
  const ALL = [
    'saas-software', 'developer-product', 'ai-product', 'ecommerce-brand', 'marketplace',
    'restaurant-hospitality', 'portfolio', 'agency-studio', 'local-service',
    'professional-services', 'event', 'education', 'editorial-media', 'landing-campaign',
    'community', 'general',
  ] as const;

  /** One entry per archetype: a prompt that resolves to it while supplying NO facts. */
  const UNDERSPECIFIED: Record<string, string> = {
    'saas-software': 'a site for our B2B CRM',
    'developer-product': 'a site for our developer API and CLI',
    'ai-product': 'a site for our AI assistant',
    'ecommerce-brand': 'an online shop selling ceramics',
    marketplace: 'a marketplace for illustrators',
    'restaurant-hospitality': 'a website for a restaurant',
    portfolio: 'a photography portfolio',
    'agency-studio': 'a site for a branding agency',
    'local-service': 'a site for a dental clinic',
    'professional-services': 'a site for a law firm',
    event: 'a site for a conference',
    education: 'a site for a coding bootcamp',
    'editorial-media': 'a site for an online magazine',
    'landing-campaign': 'a waitlist landing page',
    community: 'a site for a cycling club',
    general: 'a website for my grandmother',
  };

  /** A required item names a STRUCTURE. Nouns that make an item structural… */
  const STRUCTURAL = /\b(section|grid|index|block|view|structure|route|sequence|slot|slots|programme|schedule|curriculum|statement|example|list|page|path|architecture|entry point|proposition|action|proof|substance|offering)\b/i;
  /** …and fact nouns that must never appear WITHOUT a structural noun to hold them. */
  const FACT_NOUN = /\b(price|prices|pricing|date|dates|name|names|address|hours|credential|credentials|byline|bylines|figure|figures|number|numbers)\b/i;

  it('every archetype is reachable and its required items are STRUCTURAL, not factual', () => {
    for (const a of ALL) {
      const c = deriveDesignIntelligence({ prompt: UNDERSPECIFIED[a] })!;
      expect(c.archetype, `${a} <- "${UNDERSPECIFIED[a]}"`).toBe(a);
      for (const item of c.content.requiredContent) {
        // A required item may mention a fact ONLY as a slot inside a named structure.
        if (FACT_NOUN.test(item)) {
          expect(item, `${a}: "${item}" mentions a fact, so it must name the structure holding it`)
            .toMatch(STRUCTURAL);
        }
        // And it must never read as "use the REAL <fact>" — that is an instruction to invent.
        expect(item, `${a}: "${item}" must not demand real-world facts`)
          .not.toMatch(/\breal (?:project names|client names|prices|dates|addresses|content)\b/i);
      }
      // Every archetype declares the facts its structures need, plus the policy for them.
      expect(c.content.factualSlots.length, a).toBeGreaterThan(0);
      expect(c.content.factualPolicy).toMatch(/Use ONLY facts the request supplied/);
      expect(c.content.factualPolicy).toMatch(/provisional label/);
      expect(c.content.factualPolicy).toMatch(/never delete a required section/i);
    }
  });

  it('the rendered P1 tier states the structure/fact split explicitly', () => {
    for (const a of ALL) {
      const b = renderDesignIntelligenceP1Block(deriveDesignIntelligence({ prompt: UNDERSPECIFIED[a] })).join('\n');
      expect(b, a).toMatch(/STRUCTURAL obligations/);
      expect(b, a).toMatch(/NEVER an instruction to invent the facts inside them/);
      expect(b, a).toMatch(/Facts these sections need:/);
      expect(b, a).toMatch(/Use ONLY facts the request supplied/);
    }
  });

  it('the specific facts a build must never invent are named for the risky archetypes', () => {
    const cases: Array<[string, RegExp]> = [
      ['ecommerce-brand', /product names[\s\S]*prices/i],
      ['restaurant-hospitality', /dish and drink names[\s\S]*prices[\s\S]*opening hours/i],
      ['event', /dates and times[\s\S]*venue name and address[\s\S]*speaker names/i],
      ['professional-services', /practitioner names[\s\S]*registration numbers[\s\S]*fees/i],
      ['local-service', /address, phone number and coverage area[\s\S]*opening hours/i],
    ];
    for (const [a, re] of cases) {
      const c = deriveDesignIntelligence({ prompt: UNDERSPECIFIED[a] })!;
      expect(c.archetype).toBe(a);
      expect(c.content.factualSlots.join('; '), a).toMatch(re);
    }
  });

  it('the global never-invent list covers prices, dates, names and catalogue items', () => {
    const never = deriveDesignIntelligence({ prompt: PROMPTS.event })!.content.neverFabricate.join('; ');
    for (const re of [/prices, fees/i, /dates, times, schedules/i, /names of people/i,
      /product, dish, course, session or listing names/i, /opening hours/i]) {
      expect(never).toMatch(re);
    }
  });

  it('an underspecified build is still told to BUILD the section, not to drop it', () => {
    for (const a of ['ecommerce-brand', 'restaurant-hospitality', 'event', 'professional-services', 'local-service']) {
      const b = renderDesignIntelligenceP1Block(deriveDesignIntelligence({ prompt: UNDERSPECIFIED[a] })).join('\n');
      expect(b, a).toMatch(/never delete a required section because its facts are missing/i);
      expect(b, a).toMatch(/obviously provisional label/i);
    }
  });

  it('the planning prompt carries the same structure/fact split', () => {
    const r = buildWebBuildRequest('a website for a restaurant', { mode: 'website' });
    expect(r).toMatch(/Those are STRUCTURAL requirements/);
    expect(r).toMatch(/never invent the business facts inside them/);
    expect(r).toMatch(/plan a provisional label the owner replaces/);
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
      expect(b).toMatch(/- CTA: /);
      // The mechanical floor (touch-target size, column collapse, minimum type) belongs to the
      // integrated-experience authority — Design Intelligence defers to it instead of restating it.
      expect(b).toMatch(/owns the mechanical floor/);
      expect(b).not.toMatch(/44×44/);
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
      const b = diTextFor(p);
      expect(b, k).toMatch(/RESPONSIVE — design the mobile experience/);
      expect(b, k).toMatch(/IMAGE INTENT/);
      expect(b, k).toMatch(/DO NOT REPRODUCE THE GENERIC AI-WEBSITE FINGERPRINT/);
    }
  });

  it('the rendered block never exceeds its documented ceiling', () => {
    for (const p of Object.values(PROMPTS)) {
      expect(renderDesignIntelligenceBlock(deriveDesignIntelligence({ prompt: p })).join('\n').length)
        .toBeLessThanOrEqual(DESIGN_INTELLIGENCE_CHAR_CEILING);
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

  /* The exact drop ladder. Each canonical authority is paired with the Design Intelligence
   * tier that sits at the SAME priority, and every case asserts BOTH directions: a canonical
   * authority is never dropped while its DI peer survives, and vice-versa. This is the
   * regression that the original single-block rendering could not have passed — the whole
   * DI direction was priority 1, so composition/visualSystem/visualConcept could be shed
   * while lower-value DI prose stayed. */
  const P4_MARK = 'DO NOT REPRODUCE THE GENERIC AI-WEBSITE FINGERPRINT';
  const P3_MARK = 'IMAGE INTENT — imagery is';
  const P2_MARK = 'BRAND CHARACTER (drives real decisions';
  const P1_MARK = 'BINDING SITE DESIGN DIRECTION';

  it('a TINY overshoot sheds P4 only — every canonical authority and DI tier P1-P3 stay', () => {
    const req = buildFrontendBuilderRequest(specOvershootingBudgetBy(PROMPTS.editorial, 200));
    expect(req.length).toBeLessThanOrEqual(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
    expect(req).not.toContain(P4_MARK);                     // DI P4 — first to go
    expect(req).toContain('BINDING VISUAL CONCEPT');        // canonical P3 — kept
    expect(req).toContain(P3_MARK);                         // DI P3 — kept
    expect(req).toContain('BINDING PAGE COMPOSITION');      // canonical P2 — kept
    expect(req).toContain(P2_MARK);                         // DI P2 — kept
    expect(req).toContain(P1_MARK);
  });

  it('a MEDIUM overshoot sheds the whole P3 tier — canonical AND DI together, P2 intact', () => {
    const req = buildFrontendBuilderRequest(specOvershootingBudgetBy(PROMPTS.editorial, 2_000));
    expect(req.length).toBeLessThanOrEqual(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
    expect(req).not.toContain(P4_MARK);
    expect(req).not.toContain('BINDING VISUAL CONCEPT');    // canonical P3 — gone
    expect(req).not.toContain('BINDING MOTION EXECUTION');  // canonical P3 — gone
    expect(req).not.toContain(P3_MARK);                     // DI P3 — gone WITH them
    expect(req).toContain('BINDING PAGE COMPOSITION');      // canonical P2 — still kept
    expect(req).toContain(P2_MARK);                         // DI P2 — still kept
    expect(req).toContain(P1_MARK);
  });

  it('canonical authorities are NEVER displaced by Design Intelligence prose, at any overshoot', () => {
    for (const overshoot of [200, 1_000, 2_000, 6_000, 20_000, 60_000]) {
      const req = buildFrontendBuilderRequest(specOvershootingBudgetBy(PROMPTS.editorial, overshoot));
      const ctx = `overshoot ${overshoot}`;
      // If a canonical P3 authority was dropped, the DI P3/P4 tiers must be gone too.
      if (!req.includes('BINDING VISUAL CONCEPT')) {
        expect(req, ctx).not.toContain(P3_MARK);
        expect(req, ctx).not.toContain(P4_MARK);
      }
      // If a canonical P2 authority was dropped, the DI P2 tier must be gone too.
      if (!req.includes('BINDING PAGE COMPOSITION')) {
        expect(req, ctx).not.toContain(P2_MARK);
      }
      // And the reverse: DI P2 surviving implies its canonical peers survived.
      if (req.includes(P2_MARK)) {
        expect(req, ctx).toContain('BINDING PAGE COMPOSITION');
        expect(req, ctx).toContain('BINDING PREMIUM VISUAL SYSTEM');
      }
      if (req.includes(P3_MARK)) expect(req, ctx).toContain('BINDING VISUAL CONCEPT');
      // P1 and P0 always survive.
      expect(req, ctx).toContain(P1_MARK);
      expect(req, ctx).toContain('MUST genuinely contain');
      expect(req, ctx).toContain('BEGIN_FRONTEND_BUILD_SPEC_JSON');
      expect(req, ctx).toContain('SOURCE OUTPUT DISCIPLINE:');
    }
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
        .toBeLessThanOrEqual(2000);
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
    expect(diTextFor(PROMPTS.agency).length).toBeGreaterThan(500);
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

  /* The priority fitter lives in the SHARED buildFrontendBuilderRequest. Proving App Build
   * isolation on normal-sized fixtures alone is not enough: the fitter only engages ABOVE the
   * budget, so the oversized path is precisely where a shared code path could change App Build
   * behaviour. Priority shedding is therefore gated to Web, and these tests pin that at size. */
  function appSpecOvershootingBy(overshoot: number): FrontendBuildSpecification {
    const spec = specFor('Build a CRM for a sales team with contacts and deals', 'en', 'app');
    const baseLen = buildFrontendBuilderRequest(spec).length;
    const filler = 'z'.repeat(Math.max(1, SAFE_FRONTEND_BUILDER_REQUEST_CHARS + overshoot - baseLen));
    return {
      ...spec,
      architecture: {
        ...spec.architecture,
        sections: (spec.architecture.sections || []).map((sec, i) => (i === 0 ? { ...sec, subheadline: filler } : sec)),
      },
    } as FrontendBuildSpecification;
  }

  it('an OVERSIZED app request is never re-prioritised — every app authority block survives at any size', () => {
    const normal = buildFrontendBuilderRequest(specFor('Build a CRM for a sales team with contacts and deals', 'en', 'app'));
    // The blocks an app request actually carries, captured from the normal-size request so the
    // test cannot pass vacuously if the app block set ever changes.
    const appMarkers = [
      'BINDING PREMIUM VISUAL SYSTEM', 'RESEARCH-GROUNDED SECTOR DIRECTION',
    ].filter((m) => normal.includes(m));
    expect(appMarkers.length).toBeGreaterThan(0);

    for (const overshoot of [200, 2_000, 20_000, 60_000]) {
      const req = buildFrontendBuilderRequest(appSpecOvershootingBy(overshoot));
      const ctx = `app overshoot ${overshoot}`;
      // NOT re-prioritised: no P1–P4 cut is ever applied to an app request, so every one of these
      // survives at every size. (An oversized app request now gives back the Experience
      // Intelligence tiers — and ONLY those — so that layer can never be the reason a request
      // which used to generate is rejected for size. That is asserted in its own suite.)
      for (const m of appMarkers) expect(req, `${ctx}: ${m}`).toContain(m);
      expect(req, ctx).toContain('BEGIN_FRONTEND_BUILD_SPEC_JSON');
      expect(req, ctx).toContain('SOURCE OUTPUT DISCIPLINE:');
      expect(req, ctx).toContain('[APP ARCHITECTURE]');
      // Still no web-only design direction anywhere.
      expect(req, ctx).not.toContain('BINDING SITE DESIGN DIRECTION');
      expect(req, ctx).not.toContain('PAGE COMPOSITION STRATEGY');
    }
  });

  it('an oversized app request keeps more than the web twin of the same spec', () => {
    // Equivalent statement of the same contract without hard-coding the block list: an app is
    // never re-prioritised, so it retains strictly more than the shed web assembly of the same
    // (oversized) spec.
    const spec = appSpecOvershootingBy(30_000);
    const req = buildFrontendBuilderRequest(spec);
    const webTwin = buildFrontendBuilderRequest({ ...spec, buildType: 'web' } as FrontendBuildSpecification);
    // The web twin of the SAME oversized spec IS shed by priority; the app one is not.
    expect(webTwin.length).toBeLessThan(req.length);
    expect(req.length).toBeGreaterThan(SAFE_FRONTEND_BUILDER_REQUEST_CHARS);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 10b. ONE AUTHORITY PER DECISION — Design Intelligence must not become a second
 * voice on anything composition / visualSystem / experienceQuality / imageCoverage
 * already owns. Where the subjects genuinely touch, DI states precedence in words.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('no duplicated authority', () => {
  const req = () => requestFor(PROMPTS.restaurant);

  it('the mechanical responsive floor is stated ONCE, by the integrated-experience block', () => {
    const r = req();
    // "44px" is an a11y/mechanics fact: the integrated-experience block and the spec's own
    // accessibilityRules own it. The DI tier must not be a third voice.
    const di = renderDesignIntelligenceP2Block(specFor(PROMPTS.restaurant).designIntelligence).join('\n');
    expect(di).not.toMatch(/44/);
    expect(di).toMatch(/owns the mechanical floor/);
    expect(r).toContain('BINDING INTEGRATED EXPERIENCE');
  });

  it('concrete visual TOKENS stay with the visual system; DI states character and defers', () => {
    const di = renderDesignIntelligenceP2Block(specFor(PROMPTS.restaurant).designIntelligence).join('\n');
    // No numeric token values (radius in px/rem, type sizes, hex colours) are re-decided here.
    expect(di).not.toMatch(/#[0-9a-f]{6}/i);
    expect(di).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem)\b/);
    expect(di).toMatch(/that token is[\s\S]*authoritative/);
    expect(req()).toContain('BINDING PREMIUM VISUAL SYSTEM');
  });

  it('per-section composition families stay with the composition block', () => {
    const di = renderDesignIntelligenceP2Block(specFor(PROMPTS.restaurant).designIntelligence).join('\n');
    expect(di).toMatch(/belong to the page-composition block; do not re-decide them here/);
    // DI never names a per-section composition family in its prose.
    for (const fam of ['immersive-hero', 'editorial-split', 'feature-mosaic', 'proof-ledger', 'catalog-index']) {
      expect(di, fam).not.toContain(fam);
    }
    expect(req()).toContain('BINDING PAGE COMPOSITION');
  });

  it('the required-image floor stays with image coverage; DI defers to it explicitly', () => {
    const di = renderDesignIntelligenceP3Block(specFor(PROMPTS.restaurant).designIntelligence).join('\n');
    expect(di).toMatch(/required-image-coverage block below states the mandatory floor/);
    expect(di).toMatch(/it always wins/);
  });

  it('the generic honesty policy is not restated — DI names only the classes it adds', () => {
    const c = deriveDesignIntelligence({ prompt: PROMPTS.restaurant })!;
    const p1 = renderDesignIntelligenceP1Block(c).join('\n');
    // Already owned by the spec's honestyRules / outputContract.forbiddenPatterns.
    for (const owned of ['testimonials', 'metrics', 'logos', 'certifications']) {
      expect(p1.toLowerCase(), owned).not.toContain(`invent, in addition to the honesty rules below: ${owned}`);
    }
    expect(c.content.additionalNeverFabricate.join('; ')).not.toMatch(/testimonial|metric|logo|certification/i);
    // …while the full contract still records the complete list for diagnostics and tests.
    expect(c.content.neverFabricate.join('; ')).toMatch(/testimonials/i);
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
      'DESIGN_INTELLIGENCE_CHAR_CEILING',
      'buildDesignIntelligenceDiagnostics',
      'deriveDesignIntelligence',
      'renderDesignIntelligenceBlock',
      'renderDesignIntelligenceP1Block',
      'renderDesignIntelligenceP2Block',
      'renderDesignIntelligenceP3Block',
      'renderDesignIntelligenceP4Block',
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
