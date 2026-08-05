import { describe, it, expect } from 'vitest';
import {
  deriveVisualConceptContract,
  classifyVisualCategory,
  renderVisualConceptBlock,
  analyzeVisualContribution,
  hasBlockingVisualFindings,
  visualToReviewIssues,
  buildVisualConceptDiagnostics,
  type VisualConceptInput,
  type VisualConceptContract,
} from '@/lib/webBuildVisualConcept';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

/* ── tiny builders ─────────────────────────────────────────────────────────── */
function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}
function input(over: Partial<VisualConceptInput> & { prompt?: string; anchor?: string; targets?: unknown[] } = {}): VisualConceptInput {
  const { anchor, targets, ...rest } = over;
  return {
    identity: { sector: 'general', primaryConcept: '' } as VisualConceptInput['identity'],
    composition: { hero: { visualAnchor: anchor || 'none' }, sections: [{ id: 'hero', name: 'Hero', narrativeRole: 'hero', density: 'balanced' }] } as unknown as VisualConceptInput['composition'],
    imageCoverage: { mode: 'required', targets: targets || [] } as unknown as VisualConceptInput['imageCoverage'],
    ...rest,
  };
}

describe('webBuildVisualConcept — classification & derivation', () => {
  it('classifies categories from prompt/concept keywords deterministically', () => {
    expect(classifyVisualCategory(input({ prompt: 'a personal finance budgeting and investing app' }))).toBe('finance');
    expect(classifyVisualCategory(input({ prompt: 'a developer CLI and API SDK for building services' }))).toBe('developer-tool');
    expect(classifyVisualCategory(input({ prompt: 'a luxury boutique hotel and spa resort' }))).toBe('hospitality-luxury');
    expect(classifyVisualCategory(input({ prompt: 'a cybersecurity zero-trust threat platform' }))).toBe('security');
    expect(classifyVisualCategory(input({ prompt: 'something entirely unspecified' }))).toBe('generic');
  });

  it('is deterministic — same input yields an identical contract', () => {
    const a = deriveVisualConceptContract(input({ prompt: 'a fintech investing platform', anchor: 'product-ui' }));
    const b = deriveVisualConceptContract(input({ prompt: 'a fintech investing platform', anchor: 'product-ui' }));
    expect(a).toBeTruthy();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces category-diverse signatures (anti-template) across categories', () => {
    const hotel = deriveVisualConceptContract(input({ prompt: 'a luxury hotel resort', anchor: 'photograph' }))!;
    const dev = deriveVisualConceptContract(input({ prompt: 'a developer API SDK tool', anchor: 'product-ui' }))!;
    const security = deriveVisualConceptContract(input({ prompt: 'a cybersecurity threat platform', anchor: 'illustration' }))!;
    expect(hotel.category).not.toBe(dev.category);
    // Signature medium/family should differ across clearly different categories.
    const families = new Set([hotel.signature.family, dev.signature.family, security.signature.family]);
    expect(families.size).toBeGreaterThanOrEqual(2);
    // Hotel is photo-first; developer tool is not.
    expect(hotel.realImageStrategy.posture).toBe('photo-first');
    expect(dev.realImageStrategy.posture).toBe('none');
  });

  it('honours the composition hero anchor when selecting the signature medium', () => {
    const photo = deriveVisualConceptContract(input({ prompt: 'a generic site', anchor: 'photograph' }))!;
    const ui = deriveVisualConceptContract(input({ prompt: 'a generic site', anchor: 'product-ui' }))!;
    expect(photo.signature.photographic).toBe(true);
    expect(ui.signature.medium).toBe('product-ui');
    expect(ui.signature.photographic).toBe(false);
  });
});

describe('webBuildVisualConcept — render block', () => {
  it('renders a hard-bounded builder block that leads with the thesis & signature', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a fintech investing platform', anchor: 'product-ui' }))!;
    const lines = renderVisualConceptBlock(c);
    expect(lines[0]).toMatch(/^BINDING VISUAL CONCEPT/);
    expect(lines.some((l) => /Visual thesis/.test(l))).toBe(true);
    expect(lines.some((l) => /Signature visual/.test(l))).toBe(true);
    expect(lines.join('\n').length).toBeLessThanOrEqual(2800);
  });
  it('renders nothing for a legacy/absent contract', () => {
    expect(renderVisualConceptBlock(undefined)).toEqual([]);
    expect(renderVisualConceptBlock({ status: 'legacy' } as unknown as VisualConceptContract)).toEqual([]);
  });
});

describe('webBuildVisualConcept — acceptance (conservative, non-duplicative, fail-open)', () => {
  it('is legacy (pass) with no contract and non-legacy pass with no files', () => {
    expect(analyzeVisualContribution([file('a.tsx', '<div/>')], undefined).legacy).toBe(true);
    const c = deriveVisualConceptContract(input({ prompt: 'x', anchor: 'photograph' }))!;
    const r = analyzeVisualContribution([], c);
    expect(r.legacy).toBe(false);
    expect(r.status).toBe('pass');
  });

  it('BLOCKS a required non-photographic signature that is absent in the hero', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a developer API SDK tool', anchor: 'product-ui' }))!;
    expect(c.signature.photographic).toBe(false);
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><div className="bg-gradient-to-b from-black to-gray-900"><h1>Ship faster</h1><p>Build APIs</p></div></section>');
    const r = analyzeVisualContribution([hero], c);
    expect(hasBlockingVisualFindings(r)).toBe(true);
    expect(r.issues.some((i) => i.code === 'visual-signature-missing')).toBe(true);
    expect(visualToReviewIssues(r).length).toBeGreaterThan(0);
  });

  it('does NOT block when the non-photographic signature IS present as an svg/canvas', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a developer API SDK tool', anchor: 'product-ui' }))!;
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><div><h1>Ship faster</h1><svg viewBox="0 0 100 100"><path d="M0 0h100v100H0z"/></svg></div></section>');
    const r = analyzeVisualContribution([hero], c);
    expect(r.issues.some((i) => i.code === 'visual-signature-missing')).toBe(false);
  });

  it('fails OPEN (no signature-missing block) when the hero hosts a child component', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a developer API SDK tool', anchor: 'product-ui' }))!;
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><HeroCanvas /><h1>Ship faster</h1></section>');
    const r = analyzeVisualContribution([hero], c);
    expect(r.issues.some((i) => i.code === 'visual-signature-missing')).toBe(false);
  });

  it('does NOT block a typographic signature that is intentionally text-only (false-positive guard)', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a minimal studio', anchor: 'typographic' }))!;
    expect(c.signature.medium).toBe('typographic');
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><div className="py-40"><h1 className="text-8xl">We build calm</h1><p>Studio for considered work</p></div></section>');
    const r = analyzeVisualContribution([hero], c);
    expect(r.issues.some((i) => i.code === 'visual-signature-missing')).toBe(false);
  });

  it('does NOT block a rich div-built product-ui hero mock (element-dense; false-positive guard)', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a developer API SDK tool', anchor: 'product-ui' }))!;
    expect(c.signature.medium).toBe('product-ui');
    const mock = '<section data-korvix-section="hero"><div className="rounded-xl border"><div className="toolbar"><span/><span/><span/></div>' +
      '<div className="row"><div className="cell">GET /v1</div><div className="cell">200</div></div>' +
      '<div className="row"><div className="cell">POST /v1</div><div className="cell">201</div></div>' +
      '<button>Run</button><input placeholder="key"/></div></section>';
    const hero = file('Hero.tsx', mock);
    const r = analyzeVisualContribution([hero], c);
    expect(r.issues.some((i) => i.code === 'visual-signature-missing')).toBe(false);
  });

  it('BLOCKS a hero signature rendered as a placeholder image', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a luxury hotel resort', anchor: 'photograph' }))!;
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><img src="https://placehold.co/1600x900" alt="hero"/></section>');
    const r = analyzeVisualContribution([hero], c);
    expect(hasBlockingVisualFindings(r)).toBe(true);
    expect(r.issues.some((i) => i.code === 'visual-signature-placeholder')).toBe(true);
  });

  it('does NOT block a photographic hero with a real image', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a luxury hotel resort', anchor: 'photograph' }))!;
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><img src="https://images.example.com/resort-pool.jpg" alt="ocean resort at golden hour"/></section>');
    const r = analyzeVisualContribution([hero], c);
    expect(hasBlockingVisualFindings(r)).toBe(false);
  });

  it('BLOCKS one image reused across ≥2 distinct required roles', () => {
    const targets = [
      { purpose: 'hero', required: true, hero: true, orientation: 'landscape', altText: 'hero' },
      { purpose: 'team', required: true, hero: false, orientation: 'square', altText: 'team' },
    ];
    const c = deriveVisualConceptContract(input({ prompt: 'a local plumbing service', anchor: 'photograph', targets }))!;
    const dup = 'https://images.example.com/only-one.jpg';
    const files = [
      file('Hero.tsx', `<section data-korvix-section="hero"><img src="${dup}" alt="hero"/></section>`),
      file('Team.tsx', `<section data-korvix-section="team"><img src="${dup}" alt="team"/></section>`),
    ];
    const r = analyzeVisualContribution(files, c);
    expect(r.issues.some((i) => i.code === 'visual-role-collapse')).toBe(true);
    expect(hasBlockingVisualFindings(r)).toBe(true);
  });

  it('does NOT flag a repeated logo/icon as a role collapse (false-positive guard)', () => {
    const targets = [
      { purpose: 'hero', required: true, hero: true, orientation: 'landscape', altText: 'hero' },
      { purpose: 'team', required: true, hero: false, orientation: 'square', altText: 'team' },
    ];
    const c = deriveVisualConceptContract(input({ prompt: 'a local plumbing service', anchor: 'photograph', targets }))!;
    const logo = 'https://images.example.com/brand-logo.svg';
    const files = [
      file('Header.tsx', `<header><img src="${logo}" alt="logo"/></header>`),
      file('Footer.tsx', `<footer><img src="${logo}" alt="logo"/></footer>`),
    ];
    const r = analyzeVisualContribution(files, c);
    expect(r.issues.some((i) => i.code === 'visual-role-collapse')).toBe(false);
  });

  it('produces bounded, truthful diagnostics', () => {
    const c = deriveVisualConceptContract(input({ prompt: 'a fintech investing platform', anchor: 'product-ui' }))!;
    const chars = renderVisualConceptBlock(c).join('\n').length;
    const r = analyzeVisualContribution([file('Hero.tsx', '<section data-korvix-section="hero"><svg><path d="M0 0"/></svg></section>')], c);
    const d = buildVisualConceptDiagnostics(c, r, chars)!;
    expect(d.version).toBe('visual-concept-v1');
    expect(d.category).toBe('finance');
    expect(d.contractRenderedToFrontendBuilder).toBe(true);
    expect(d.contractUsedByAcceptance).toBe(true);
    expect(d.agentsActuallyConsumingContract).toContain('frontend-builder-prompt');
    expect(d.promptCharCount).toBeGreaterThan(0);
  });
});
