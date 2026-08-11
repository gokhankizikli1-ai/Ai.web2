/**
 * Tests — Experience Quality, Phase 3 (module-derived functional interaction depth).
 *
 * Extends the ONE interaction authority (webBuildExperienceQuality) so a MODULE that semantically
 * requires frontend interaction (mobile/hamburger nav, accordion/FAQ, category tabs, gallery/carousel,
 * filter/sort, modal/lightbox, frontend-only form) carries that obligation on its own — not only when an
 * explicit binding requirement names it. Acceptance detects DEAD/decorative controls and dead in-page nav
 * targets, while never forcing a genuinely static section to become interactive.
 */
import { describe, it, expect } from 'vitest';
import { deriveExperienceQualityContract, analyzeExperienceQuality } from '@/lib/webBuildExperienceQuality';
import type { FrontendGeneratedFile, FrontendSpecSection } from '@/lib/webBuildAgents';

function sec(id: string, order: number, purpose: string, over: Partial<FrontendSpecSection> = {}): FrontendSpecSection {
  return { id, name: id, order, purpose, bullets: [], interactionHints: [], assetSlotIds: [], motionLayerIds: [], ...over };
}
function file(path: string, content: string): FrontendGeneratedFile {
  return { path, content } as unknown as FrontendGeneratedFile;
}
function contractFor(sections: FrontendSpecSection[]) {
  return deriveExperienceQualityContract({ identity: { siteType: 'site', sector: 'general' } as never, sections } as never);
}
function analyze(sections: FrontendSpecSection[], files: FrontendGeneratedFile[]) {
  return analyzeExperienceQuality(files, contractFor(sections));
}
function codes(res: ReturnType<typeof analyzeExperienceQuality>): string[] {
  return res.issues.map((i) => `${i.code}:${i.severity}`);
}

describe('experience interaction — module-derived obligations', () => {
  it('marks module-semantic interactions from the module itself (no binding requirement)', () => {
    const c = contractFor([sec('faq', 0, 'faq accordion'), sec('nav', 1, 'main navigation menu'), sec('gallery', 2, 'photo gallery carousel')])!;
    const byId = Object.fromEntries((c.sections || []).map((s) => [s.id, s.interaction]));
    expect(byId.faq?.kind).toBe('disclosure');
    expect(byId.faq?.semanticInteraction).toBe(true);
    expect(byId.faq?.required).toBe(false);           // derived from the module, not a binding requirement
    expect(byId.nav?.kind).toBe('navigation');
    expect(byId.nav?.semanticInteraction).toBe(true);
    expect(byId.gallery?.kind).toBe('gallery');
    expect(byId.gallery?.semanticInteraction).toBe(true);
  });
});

describe('experience interaction — working interactions pass', () => {
  it('a working accordion (aria-expanded + conditional render) is not flagged', () => {
    const res = analyze([sec('faq', 0, 'faq accordion toggle')], [file('Faq.tsx',
      `export default function Faq(){const [open,setOpen]=useState(0);return(<section id="faq"><button onClick={()=>setOpen(1)} aria-expanded={open===1}>Q1</button>{open===1 && <p>Answer</p>}</section>);}`)]);
    expect(codes(res).some((x) => x.includes('no-feedback'))).toBe(false);
  });

  it('a working mobile nav (toggle + real target) is not flagged', () => {
    const res = analyze([sec('nav', 0, 'mobile navigation hamburger menu')], [
      file('Nav.tsx', `export default function Nav(){const [o,setO]=useState(false);return(<nav id="nav"><button onClick={()=>setO(!o)} aria-expanded={o}>Menu</button>{o && <a href="#about">About</a>}</nav>);}`),
      file('About.tsx', '<section id="about"><h2>About</h2></section>'),
    ]);
    expect(codes(res).some((x) => x.includes('no-feedback') || x.includes('dead-target'))).toBe(false);
  });

  it('working category tabs (active state read back) are not flagged', () => {
    const res = analyze([sec('tabs', 0, 'category tabs filter')], [file('Tabs.tsx',
      `export default function Tabs(){const [active,setActive]=useState('a');return(<section id="tabs"><button onClick={()=>setActive('a')}>A</button><button onClick={()=>setActive('b')}>B</button><div>{active==='a'?<p>A</p>:<p>B</p>}</div></section>);}`)]);
    expect(codes(res).some((x) => x.includes('no-feedback'))).toBe(false);
  });

  it('a working frontend-only form (submit feedback) is not flagged', () => {
    const res = analyze([sec('contact', 0, 'contact form frontend')], [file('Form.tsx',
      `export default function Form(){const [sent,setSent]=useState(false);return(<form id="contact" onSubmit={(e)=>{e.preventDefault();setSent(true);}}><input/><button>Send</button>{sent && <p role="status">Thanks!</p>}</form>);}`)]);
    expect(codes(res).some((x) => x.includes('no-feedback'))).toBe(false);
  });
});

describe('experience interaction — dead controls & dead nav targets are caught', () => {
  it('a dead accordion control (state written, never read) is a major finding', () => {
    const res = analyze([sec('faq', 0, 'faq accordion toggle')], [file('Faq.tsx',
      `export default function Faq(){const [open,setOpen]=useState(false);return(<section id="faq"><button onClick={()=>setOpen(true)}>Q1</button><p>Answer always shown</p></section>);}`)]);
    expect(codes(res)).toContain('experience-interaction-no-feedback:major');
    expect(res.status).toBe('fail');
  });

  it('dead in-page nav targets (href="#" / missing id, no handler) are a major finding', () => {
    const res = analyze([sec('nav', 0, 'main navigation menu')], [
      file('Nav.tsx', '<nav id="nav"><a href="#">Home</a><a href="#missing">Gone</a><a href="#about">About</a></nav>'),
      file('About.tsx', '<section id="about"><h2>About</h2></section>'),
    ]);
    expect(codes(res)).toContain('experience-nav-dead-target:major');
  });

  it('nav links that resolve to real sections are not flagged', () => {
    const res = analyze([sec('nav', 0, 'main navigation menu')], [
      file('Nav.tsx', '<nav id="nav"><a href="#about">About</a><a href="#contact">Contact</a></nav>'),
      file('About.tsx', '<section id="about"></section>'), file('Contact.tsx', '<section id="contact"></section>'),
    ]);
    expect(codes(res).some((x) => x.includes('dead-target'))).toBe(false);
  });
});

describe('experience interaction — never forces static sites interactive', () => {
  it('a static FAQ (no controls) is not forced interactive', () => {
    const res = analyze([sec('faq', 0, 'faq questions answers')], [file('Faq.tsx',
      '<section id="faq"><h2>FAQ</h2><div><h3>Q1</h3><p>A1</p></div><div><h3>Q2</h3><p>A2</p></div></section>')]);
    expect(res.status).not.toBe('fail');
  });

  it('a child-hosted interactive region fails open (control may live in the child)', () => {
    const res = analyze([sec('nav', 0, 'navigation menu')], [file('Nav.tsx', '<nav id="nav"><MobileMenu /></nav>')]);
    expect(res.status).not.toBe('fail');
  });
});
