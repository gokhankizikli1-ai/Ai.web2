/**
 * Tests — UI polish (Phase 2): substance-to-space fit, composition variety, CTA visual hierarchy
 * (webBuildExperienceQuality) and domain-native public labels (webBuildContentNarrative).
 *
 * Whitespace is welcome but must be EARNED; page length may not be manufactured by dead space or
 * repeated template structure; a browse section's public heading must be domain-native. All checks are
 * deterministic, conservative, and fail open on dynamic/child regions.
 */
import { describe, it, expect } from 'vitest';
import { deriveExperienceQualityContract, analyzeExperienceQuality } from '@/lib/webBuildExperienceQuality';
import { deriveContentNarrativeContract, analyzeContentNarrative } from '@/lib/webBuildContentNarrative';
import type { FrontendGeneratedFile, FrontendSpecSection } from '@/lib/webBuildAgents';

function sec(id: string, order: number, purpose: string, over: Partial<FrontendSpecSection> = {}): FrontendSpecSection {
  return { id, name: id, order, purpose, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [], ...over };
}
function file(path: string, content: string): FrontendGeneratedFile {
  return { path, content } as unknown as FrontendGeneratedFile;
}
function eq(sections: FrontendSpecSection[], files: FrontendGeneratedFile[]) {
  const c = deriveExperienceQualityContract({ identity: { siteType: 's', sector: 'general' } as never, sections } as never);
  const r = analyzeExperienceQuality(files, c);
  return { status: r.status, codes: r.issues.map((i) => `${i.code}:${i.severity}`), eff: r.sourceEfficiency };
}

describe('substance-to-space fit — whitespace must be earned', () => {
  it('B: a generous/full-height section with almost no substance and no anchor is flagged (major)', () => {
    const r = eq([sec('filler', 0, 'spacer')],
      [file('Filler.tsx', '<section id="filler" className="min-h-screen py-40"><h2 className="text-2xl">Elevate</h2></section>')]);
    expect(r.codes).toContain('experience-dead-space:major');
  });
  it('C: an image-led sparse hero is NOT penalized (dominant media anchor)', () => {
    const r = eq([sec('hero', 0, 'hero')],
      [file('Hero.tsx', '<section id="hero" className="min-h-screen py-32"><img src="/hero.jpg" className="w-full"/><h1 className="text-6xl">Move Better</h1></section>')]);
    expect(r.codes.some((x) => x.includes('dead-space'))).toBe(false);
  });
  it('D: a product-demo sparse section with a real control is NOT penalized (interaction anchor)', () => {
    const r = eq([sec('demo', 0, 'product demo tool')],
      [file('Demo.tsx', 'export default function D(){const[v,setV]=useState(0);return(<section id="demo" className="py-32 min-h-screen"><button onClick={()=>setV(1)} aria-pressed={v===1}>Run</button>{v===1&&<p>Result</p>}</section>);}')]);
    expect(r.codes.some((x) => x.includes('dead-space'))).toBe(false);
  });
  it('A: a spacious editorial section with substantial narrative content is NOT penalized', () => {
    const long = 'Our studio began in a small garage in 2015 with a single rack of weights and a belief that training should feel personal, considered, and genuinely welcoming to every body that walks through the door each and every morning of the week.';
    const r = eq([sec('story', 0, 'our story about')],
      [file('Story.tsx', `<section id="story" className="py-40"><h2 className="text-4xl">Our Story</h2><p>${long}</p></section>`)]);
    expect(r.codes.some((x) => x.includes('dead-space'))).toBe(false);
  });
});

describe('composition variety + CTA hierarchy', () => {
  const grid = (id: string) => file(`${id}.tsx`, `<section id="${id}"><div className="grid grid-cols-3 gap-6"><div className="card">a</div><div className="card">b</div><div className="card">c</div></div></section>`);
  it('E: the same card-grid silhouette across ≥3 unrelated sections is detectable', () => {
    const r = eq([sec('a', 0, 'programs'), sec('b', 1, 'trainers'), sec('c', 2, 'testimonials')], [grid('a'), grid('b'), grid('c')]);
    expect(r.codes.some((x) => x.startsWith('experience-repeated-composition'))).toBe(true);
  });
  it('E: two grids alone are not over-flagged', () => {
    const r = eq([sec('a', 0, 'programs'), sec('b', 1, 'trainers')], [grid('a'), grid('b')]);
    expect(r.codes.some((x) => x.includes('repeated-composition'))).toBe(false);
  });
  it('H: a flat CTA hierarchy (identical treatments, no dominant primary) is surfaced', () => {
    const cta = 'px-6 py-3 bg-blue-600 rounded';
    const r = eq([sec('c', 0, 'contact conversion')],
      [file('C.tsx', `<section id="c"><a className="${cta}">Join</a><a className="${cta}">Book</a><a className="${cta}">Call</a></section>`)]);
    expect(r.codes.some((x) => x.includes('cta-weight'))).toBe(true);
  });
});

describe('domain-native public labels', () => {
  function cn(identity: Record<string, unknown>, sections: FrontendSpecSection[], files: FrontendGeneratedFile[]) {
    const composition = { sections: sections.map((s) => ({ id: s.id, family: 'catalog-index', narrativeRole: 'enable-decision', density: 'balanced' })) };
    const c = deriveContentNarrativeContract({ identity: identity as never, sections, composition: composition as never } as never)!;
    const r = analyzeContentNarrative(files, c);
    return { portfolio: c.portfolioContext, codes: r.issues.map((i) => `${i.code}:${i.severity}`) };
  }
  it('F: portfolio vocabulary heading over a non-portfolio browse section is detected', () => {
    const r = cn({ siteType: 'fitness studio', sector: 'local-service', primaryConcept: 'fitness studio' },
      [sec('programs', 0, 'programs classes browse')],
      [file('Programs.tsx', '<section id="programs"><h2>Selected Work</h2><ul><li>Strength</li><li>HIIT</li></ul></section>')]);
    expect(r.portfolio).toBe(false);
    expect(r.codes.some((x) => x.includes('content-domain-label'))).toBe(true);
  });
  it('G: an actual portfolio site keeps portfolio vocabulary', () => {
    const r = cn({ siteType: 'design portfolio', sector: 'portfolio-agency', primaryConcept: 'design studio' },
      [sec('work', 0, 'selected work projects')],
      [file('Work.tsx', '<section id="work"><h2>Selected Work</h2><ul><li>Project A</li><li>Project B</li></ul></section>')]);
    expect(r.portfolio).toBe(true);
    expect(r.codes.some((x) => x.includes('content-domain-label'))).toBe(false);
  });
});

describe('source-output efficiency — spend tokens on visible quality, not redundant source', () => {
  const card = '<div className="rounded-lg border p-6 shadow-sm">x</div>';
  it('A: ≥6 hand-written near-identical sibling blocks (no .map) are flagged', () => {
    const cards = Array.from({ length: 8 }, () => card).join('');
    const r = eq([sec('programs', 0, 'programs')], [file('P.tsx', `<section id="programs"><div className="grid">${cards}</div></section>`)]);
    expect(r.codes).toContain('experience-repeated-jsx:major');
  });
  it('B: the same cards rendered data-driven (.map) are NOT flagged', () => {
    const r = eq([sec('programs', 0, 'programs')], [file('P.tsx',
      'export default function P(){const items=[1,2,3,4,5,6,7,8];return(<section id="programs"><div className="grid">{items.map(i=><div key={i} className="rounded-lg border p-6 shadow-sm">{i}</div>)}</div></section>);}')]);
    expect(r.codes.some((x) => x.includes('repeated-jsx'))).toBe(false);
  });
  it('C: bespoke varied sections are not falsely treated as duplication', () => {
    const r = eq([sec('hero', 0, 'hero'), sec('story', 1, 'story'), sec('cta', 2, 'cta')], [
      file('Hero.tsx', '<section id="hero"><h1 className="text-6xl">Big</h1><img src="/a.jpg"/></section>'),
      file('Story.tsx', '<section id="story"><div className="flex gap-8"><img src="/b.jpg"/><p className="prose">A long bespoke story paragraph with real substance and detail written here.</p></div></section>'),
      file('Cta.tsx', '<section id="cta"><h2 className="text-3xl">Join</h2><a className="px-6 py-3 bg-black rounded">Sign up</a></section>'),
    ]);
    expect(r.codes.some((x) => x.includes('repeated-jsx'))).toBe(false);
  });
  it('D: a giant inline SVG path is flagged (huge-inline) and counted', () => {
    const bigPath = 'M' + '1 2 3 4 5 '.repeat(700);
    const r = eq([sec('deco', 0, 'decoration')], [file('D.tsx',
      `<section id="deco"><svg><path d="${bigPath}"/></svg><p>Real content padding padding padding padding padding padding padding padding padding padding padding.</p></section>`)]);
    expect(r.codes).toContain('experience-huge-inline:major');
    expect((r.eff?.largeSvgSignal ?? 0)).toBeGreaterThanOrEqual(1);
  });
  it('E: obviously-dead React state is flagged', () => {
    const r = eq([sec('x', 0, 'section')], [file('X.tsx',
      'export default function X(){const [open,setOpen]=useState(false);return(<section id="x"><p>Content with plenty of words here so it is not flagged as dead space at all really truly indeed.</p></section>);}')]);
    expect(r.codes).toContain('experience-unused-state:minor');
  });
  it('F: a working interaction state is NOT penalized as unused', () => {
    const r = eq([sec('x', 0, 'faq accordion')], [file('X.tsx',
      'export default function X(){const [open,setOpen]=useState(false);return(<section id="x"><button onClick={()=>setOpen(!open)} aria-expanded={open}>Q</button>{open&&<p>A</p>}</section>);}')]);
    expect(r.codes.some((x) => x.includes('unused-state'))).toBe(false);
  });
});
