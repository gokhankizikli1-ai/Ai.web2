/**
 * Tests — Site Depth & Completeness (Phase 2).
 *
 * A deterministic, GENERAL, site-type-aware depth contract owned by the content authority. It answers
 * whether a generated site is a COMPLETE, usable website of its own type (enough browse/choice/decision
 * surface) rather than a landing page that ends before the visitor can decide.
 *
 * Covered here (the exit gate):
 *  - Depth is NOT a universal section count: different site types get materially DIFFERENT profiles.
 *  - Intentionally-minimal sites are respected (never forced into browse depth, never faulted).
 *  - Acceptance (conservative, structural): a heading-only core surface is caught; a real/dynamic one
 *    is not; the site-level "decision unreachable" case fires only with strong evidence.
 *  - Deterministic + fail-open.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveSiteDepthContract, renderSiteDepthBlock, analyzeSiteDepth, siteDepthToReviewIssues,
  hasBlockingSiteDepthFindings, type SiteDepthContract, type ContentNarrativeInput,
} from '@/lib/webBuildContentNarrative';
import type {
  FrontendGeneratedFile, FrontendSpecIdentity, FrontendSpecSection,
} from '@/lib/webBuildAgents';

/* ── Factories ────────────────────────────────────────────────────────────── */
function sec(id: string, order: number, purpose: string, over: Partial<FrontendSpecSection> = {}): FrontendSpecSection {
  return { id, name: id, order, purpose, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [], ...over };
}
function file(path: string, content: string): FrontendGeneratedFile {
  return { path, content } as unknown as FrontendGeneratedFile;
}
function input(identity: Partial<FrontendSpecIdentity>, sections: FrontendSpecSection[]): ContentNarrativeInput {
  return { identity: { siteType: 'site', ...identity } as FrontendSpecIdentity, sections } as unknown as ContentNarrativeInput;
}

const RESTAURANT = () => input(
  { siteType: 'restaurant website', sector: 'restaurant-hospitality', businessModel: 'reservation-led', primaryConcept: 'fine dining restaurant' },
  [sec('hero', 0, 'hero intro'), sec('menu', 1, 'our menu dishes'), sec('about', 2, 'our story'), sec('reserve', 3, 'book a table contact')],
);
const SAAS = () => input(
  { siteType: 'SaaS product', sector: 'ai-saas', businessModel: 'subscription-product', primaryConcept: 'analytics SaaS' },
  [sec('hero', 0, 'hero'), sec('features', 1, 'product features'), sec('how', 2, 'how it works'), sec('pricing', 3, 'pricing plans'), sec('faq', 4, 'faq'), sec('signup', 5, 'sign up')],
);
const ECOMMERCE = () => input(
  { siteType: 'online store', sector: 'furniture-interiors', businessModel: 'inventory-led-sales', primaryConcept: 'furniture store' },
  [sec('hero', 0, 'hero'), sec('products', 1, 'product catalog'), sec('categories', 2, 'shop by category'), sec('cart', 3, 'checkout')],
);
const PORTFOLIO = () => input(
  { siteType: 'portfolio', sector: 'portfolio-agency', businessModel: 'project-inquiry', primaryConcept: 'design studio portfolio' },
  [sec('hero', 0, 'hero'), sec('work', 1, 'selected work projects'), sec('about', 2, 'about the studio'), sec('contact', 3, 'get in touch')],
);
const DASHBOARD = () => input(
  { siteType: 'admin dashboard', sector: 'ai-saas', pageScreenModel: 'dashboard app ui', primaryConcept: 'analytics dashboard' },
  [sec('nav', 0, 'nav'), sec('metrics', 1, 'metrics panel'), sec('table', 2, 'data table')],
);
const MINIMAL = () => input(
  { siteType: 'waitlist landing page', primaryConcept: 'coming soon waitlist', businessModel: 'unknown' },
  [sec('hero', 0, 'hero offer'), sec('signup', 1, 'join waitlist')],
);

function profileKey(c: SiteDepthContract): string {
  return `${c.archetype}|${c.browseSurface}|${c.decisionSupport}|${c.trustDepth}|${c.contentDepth}`;
}

describe('site depth — GENERAL site-type-aware profiles (not a universal section count)', () => {
  it('different site types get materially DIFFERENT depth profiles', () => {
    const contracts = [RESTAURANT(), SAAS(), ECOMMERCE(), PORTFOLIO(), DASHBOARD(), MINIMAL()]
      .map((i) => deriveSiteDepthContract(i)!);
    for (const c of contracts) expect(c && c.status).toBe('derived');
    const distinct = new Set(contracts.map(profileKey));
    // 6 site types → at least 5 distinct depth profiles (never all identical).
    expect(distinct.size).toBeGreaterThanOrEqual(5);
    // The archetypes themselves are distinct across these types.
    expect(new Set(contracts.map((c) => c.archetype)).size).toBeGreaterThanOrEqual(5);
  });

  it('assigns archetype-appropriate profiles', () => {
    expect(deriveSiteDepthContract(SAAS())!.archetype).toBe('evaluate-product');
    expect(deriveSiteDepthContract(SAAS())!.decisionSupport).toBe('rich');
    expect(deriveSiteDepthContract(ECOMMERCE())!.archetype).toBe('browse-catalog');
    expect(deriveSiteDepthContract(ECOMMERCE())!.browseSurface).toBe('rich');
    expect(deriveSiteDepthContract(PORTFOLIO())!.archetype).toBe('showcase-work');
    expect(deriveSiteDepthContract(RESTAURANT())!.archetype).toBe('book-service');
  });

  it('identifies core browse/decision surfaces per site type', () => {
    expect(deriveSiteDepthContract(RESTAURANT())!.coreDecisionSurfaces).toContain('menu');
    expect(deriveSiteDepthContract(SAAS())!.coreDecisionSurfaces).toEqual(expect.arrayContaining(['features', 'pricing', 'faq']));
    expect(deriveSiteDepthContract(ECOMMERCE())!.coreDecisionSurfaces).toContain('products');
    expect(deriveSiteDepthContract(PORTFOLIO())!.coreDecisionSurfaces).toContain('work');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(deriveSiteDepthContract(SAAS()))).toBe(JSON.stringify(deriveSiteDepthContract(SAAS())));
  });

  it('does NOT count a navigation "menu" as a core browse/decision surface', () => {
    // A nav module carries the token "menu" but routes to content — it is not itself a browse surface.
    const c = deriveSiteDepthContract(input(
      { siteType: 'coffee shop', sector: 'restaurant-hospitality', businessModel: 'reservation-led' },
      [sec('hero', 0, 'hero'), sec('nav', 1, 'mobile navigation menu'), sec('menu', 2, 'coffee menu drinks')],
    ))!;
    expect(c.coreDecisionSurfaces).toContain('menu');
    expect(c.coreDecisionSurfaces).not.toContain('nav');
  });

  it('renders a bounded, implementable builder block for a developed site', () => {
    const block = renderSiteDepthBlock(deriveSiteDepthContract(RESTAURANT()));
    expect(block.length).toBeGreaterThan(0);
    expect(block.join('\n')).toMatch(/SITE DEPTH & COMPLETENESS/);
    expect(block.join('\n').length).toBeLessThanOrEqual(2800);
  });
});

describe('site depth — intentionally-minimal sites are respected', () => {
  it('a waitlist landing is intentionally minimal, not forced into browse depth', () => {
    const c = deriveSiteDepthContract(MINIMAL())!;
    expect(c.intentionallyMinimal).toBe(true);
    expect(c.browseSurface).toBe('minimal');
    expect(c.coreDecisionReachedRequired).toBe(false);
  });

  it('never faults a minimal site in acceptance', () => {
    const c = deriveSiteDepthContract(MINIMAL())!;
    const res = analyzeSiteDepth([file('Hero.tsx', '<section id="hero"><h1>Coming soon</h1></section>')], c);
    expect(res.status).toBe('pass');
    expect(res.intentionallyMinimal).toBe(true);
    expect(hasBlockingSiteDepthFindings(res)).toBe(false);
  });
});

describe('site depth — conservative structural acceptance', () => {
  const rest = () => deriveSiteDepthContract(RESTAURANT())!;

  it('catches a heading-only core browse surface (menu)', () => {
    const files = [
      file('Hero.tsx', '<section id="hero"><h1>La Maison</h1><p>Fine dining crafted daily.</p></section>'),
      file('Menu.tsx', '<section id="menu"><h2>Our Menu</h2></section>'),
      file('About.tsx', '<section id="about"><h2>Story</h2><p>Founded in 1998 serving seasonal Italian cuisine from local farms.</p></section>'),
      file('Reserve.tsx', '<section id="reserve"><a>Book a table</a></section>'),
    ];
    const res = analyzeSiteDepth(files, rest());
    expect(res.status).toBe('fail');
    expect(res.issues.map((i) => i.code)).toContain('depth-core-surface-thin');
    // reaches the repair set as a non-minor review issue
    expect(siteDepthToReviewIssues(res).length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT flag a real (multi-item) menu', () => {
    const files = [
      file('Hero.tsx', '<section id="hero"><h1>La Maison</h1></section>'),
      file('Menu.tsx', '<section id="menu"><h2>Our Menu</h2><ul><li>Risotto — saffron, parmesan</li><li>Branzino — sea bass, fennel</li><li>Tiramisu — mascarpone, espresso</li></ul></section>'),
      file('About.tsx', '<section id="about"><p>Founded 1998 serving seasonal Italian cuisine from local farms every day.</p></section>'),
      file('Reserve.tsx', '<section id="reserve"><a>Book a table</a></section>'),
    ];
    const res = analyzeSiteDepth(files, rest());
    expect(res.status).not.toBe('fail');
    expect(res.coreSurfacesSubstantive).toBeGreaterThanOrEqual(1);
  });

  it('treats a dynamic (.map) menu as satisfied — fail-open, never a false block', () => {
    const files = [
      file('Hero.tsx', '<section id="hero"><h1>La Maison</h1></section>'),
      file('Menu.tsx', '<section id="menu"><h2>Menu</h2>{dishes.map(d => <Dish key={d.id} {...d} />)}</section>'),
      file('About.tsx', '<section id="about"><p>Founded 1998 serving seasonal Italian cuisine locally.</p></section>'),
      file('Reserve.tsx', '<section id="reserve"><a>Book a table</a></section>'),
    ];
    const res = analyzeSiteDepth(files, rest());
    expect(res.status).not.toBe('fail');
  });

  it('fires "decision unreachable" only when NO core surface renders anything real', () => {
    const files = [
      file('Hero.tsx', '<section id="hero"><h1>La Maison</h1></section>'),
      file('Menu.tsx', '<section id="menu"><h2>Menu</h2></section>'),          // core surface, empty
      file('Reserve.tsx', '<section id="reserve"><a>Book a table</a></section>'),
    ];
    const res = analyzeSiteDepth(files, rest());
    expect(res.status).toBe('fail');
    expect(res.issues.map((i) => i.code)).toContain('depth-decision-unreachable');
  });

  it('fails open (legacy pass) on empty inputs', () => {
    expect(analyzeSiteDepth(undefined, rest()).legacy).toBe(false);
    expect(analyzeSiteDepth([], rest()).status).toBe('pass');
    expect(analyzeSiteDepth([file('x.tsx', '<div/>')], undefined).status).toBe('pass');
  });
});
