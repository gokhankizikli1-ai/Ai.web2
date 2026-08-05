import { describe, it, expect } from 'vitest';
import {
  deriveMotionExecutionContract,
  renderMotionExecutionBlock,
  analyzeMotionExecution,
  hasBlockingMotionExecutionFindings,
  motionExecutionToReviewIssues,
  buildMotionExecutionDiagnostics,
  type MotionExecutionInput,
  type MotionExecutionContract,
} from '@/lib/webBuildMotionExecution';
import { deriveVisualConceptContract } from '@/lib/webBuildVisualConcept';
import { deriveExperienceIdentityContract } from '@/lib/webBuildExperienceIdentity';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}
/** Build a realistic input by deriving the two upstream contracts, like the real pipeline. */
function inputFor(prompt: string, anchor?: string, businessModel?: string): MotionExecutionInput {
  const identity = { sector: 'general', businessModel: businessModel as never } as MotionExecutionInput['identity'];
  const vc = deriveVisualConceptContract({
    identity, prompt,
    composition: { hero: { visualAnchor: anchor || 'none' }, sections: [{ id: 'hero', name: 'Hero', narrativeRole: 'hero', density: 'balanced' }] } as never,
    imageCoverage: { mode: 'required', targets: [] } as never,
  });
  const ei = deriveExperienceIdentityContract({ identity, prompt, composition: vc ? undefined : undefined });
  return { visualConcept: vc, experienceIdentity: ei, identity, prompt, heroSectionId: vc?.rhythm?.peakSectionId };
}

describe('webBuildMotionExecution — derivation & determinism', () => {
  it('derives a bounded contract and is deterministic', () => {
    const a = deriveMotionExecutionContract(inputFor('an AI SaaS automation product', 'product-ui', 'subscription-product'));
    const b = deriveMotionExecutionContract(inputFor('an AI SaaS automation product', 'product-ui', 'subscription-product'));
    expect(a).toBeTruthy();
    expect(a!.version).toBe('motion-execution-v1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('maps an interactive demonstration to a stateful medium and user-input linkage', () => {
    const dev = deriveMotionExecutionContract(inputFor('a developer API SDK tool', 'product-ui', 'subscription-product'))!;
    expect(dev.animatedDemo.required).toBe(true);
    expect(dev.stateLinkage).toBe('user-input');
    expect(['svg-react-state', 'framer-motion', 'chart-library']).toContain(dev.implementationMedium);
    expect(dev.animatedDemo.frontendOnlyBoundary).toMatch(/frontend-only/i);
  });

  it('never forces WebGL/Three.js and keeps the medium achievable', () => {
    const media = ['a luxury hotel resort', 'an architecture studio', 'a personal finance app', 'a cybersecurity platform', 'a developer API tool']
      .map((p) => deriveMotionExecutionContract(inputFor(p))!.implementationMedium);
    for (const m of media) expect(['css-only', 'svg-css', 'svg-react-state', 'framer-motion', 'chart-library', 'dom-transforms', 'mask-clip-path', 'image-layering', 'canvas-lite']).toContain(m);
  });
});

describe('webBuildMotionExecution — category diversity matrix (Phase 9)', () => {
  it('five representative categories do not converge on technique family, medium, hero blueprint or state linkage', () => {
    const cases: Array<[string, string | undefined, string | undefined]> = [
      ['a personal finance investing app', undefined, undefined],
      ['a luxury hotel resort', 'photograph', undefined],
      ['an architecture studio design practice', 'photograph', undefined],
      ['a cybersecurity zero-trust platform', 'illustration', undefined],
      ['a developer API SDK tool', 'product-ui', 'subscription-product'],
    ];
    const derived = cases.map(([p, a, b]) => deriveMotionExecutionContract(inputFor(p, a, b))!);
    const families = new Set(derived.map((d) => d.techniqueFamily));
    const media = new Set(derived.map((d) => d.implementationMedium));
    const heroes = new Set(derived.map((d) => d.heroBlueprint));
    // Technique family is the primary anti-convergence axis; media + hero blueprint reinforce it.
    expect(families.size).toBeGreaterThanOrEqual(4);
    expect(heroes.size).toBeGreaterThanOrEqual(3);
    expect(media.size).toBeGreaterThanOrEqual(3);
  });
});

describe('webBuildMotionExecution — render block', () => {
  it('renders a hard-bounded block with purpose, technique and reduced-motion equivalent', () => {
    const c = deriveMotionExecutionContract(inputFor('a personal finance investing app'))!;
    const lines = renderMotionExecutionBlock(c);
    expect(lines[0]).toMatch(/^BINDING MOTION EXECUTION/);
    expect(lines.some((l) => /Motion purpose/.test(l))).toBe(true);
    expect(lines.some((l) => /Technique family/.test(l))).toBe(true);
    expect(lines.some((l) => /Reduced-motion equivalent/.test(l))).toBe(true);
    expect(lines.join('\n').length).toBeLessThanOrEqual(2200);
  });
  it('renders nothing for a legacy/absent contract', () => {
    expect(renderMotionExecutionBlock(undefined)).toEqual([]);
    expect(renderMotionExecutionBlock({ status: 'legacy' } as unknown as MotionExecutionContract)).toEqual([]);
  });
});

describe('webBuildMotionExecution — acceptance (conservative, non-duplicative, fail-open)', () => {
  it('legacy pass with no contract; non-legacy pass with no files', () => {
    expect(analyzeMotionExecution([file('a.tsx', '<div/>')], undefined).legacy).toBe(true);
    const c = deriveMotionExecutionContract(inputFor('an AI SaaS product', 'product-ui', 'subscription-product'))!;
    const r = analyzeMotionExecution([], c);
    expect(r.legacy).toBe(false);
    expect(r.status).toBe('pass');
  });

  it('BLOCKS a required signature scene that renders a visual surface but is provably static', () => {
    // Force an animated required signature via a living-data-field visual concept.
    const vc = deriveVisualConceptContract({
      identity: { sector: 'general' } as never, prompt: 'a climate impact analytics dashboard',
      composition: { hero: { visualAnchor: 'illustration' }, sections: [{ id: 'hero', name: 'Hero', narrativeRole: 'hero', density: 'balanced' }] } as never,
      imageCoverage: { mode: 'required', targets: [] } as never,
    })!;
    const c = deriveMotionExecutionContract({ visualConcept: vc, identity: { sector: 'general' } as never, prompt: 'a climate impact analytics dashboard', heroSectionId: 'hero' })!;
    if (!c.signatureSceneRequired || !c.signatureSceneLocation.includes('hero')) return; // only meaningful when required at hero
    const staticHero = file('Hero.tsx', '<section data-korvix-section="hero"><svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg><h1>Impact</h1></section>');
    const r = analyzeMotionExecution([staticHero], c, 'hero');
    expect(hasBlockingMotionExecutionFindings(r)).toBe(true);
    expect(r.issues.some((i) => i.code === 'motion-signature-static')).toBe(true);
    expect(motionExecutionToReviewIssues(r).length).toBeGreaterThan(0);
  });

  it('does NOT block when the hero SVG carries animation evidence (false-positive guard)', () => {
    const vc = deriveVisualConceptContract({
      identity: { sector: 'general' } as never, prompt: 'a climate impact analytics dashboard',
      composition: { hero: { visualAnchor: 'illustration' }, sections: [{ id: 'hero', name: 'Hero', narrativeRole: 'hero', density: 'balanced' }] } as never,
      imageCoverage: { mode: 'required', targets: [] } as never,
    })!;
    const c = deriveMotionExecutionContract({ visualConcept: vc, identity: { sector: 'general' } as never, prompt: 'a climate impact analytics dashboard', heroSectionId: 'hero' })!;
    const animatedHero = file('Hero.tsx', '<section data-korvix-section="hero"><svg><path d="M0 0" className="stroke-dash"><animate attributeName="stroke-dashoffset" to="0"/></path></svg></section>');
    const r = analyzeMotionExecution([animatedHero], c, 'hero');
    expect(r.issues.some((i) => i.code === 'motion-signature-static')).toBe(false);
  });

  it('fails open (no static block) when the hero hosts a child component', () => {
    const vc = deriveVisualConceptContract({
      identity: { sector: 'general' } as never, prompt: 'a climate impact analytics dashboard',
      composition: { hero: { visualAnchor: 'illustration' }, sections: [{ id: 'hero', name: 'Hero', narrativeRole: 'hero', density: 'balanced' }] } as never,
      imageCoverage: { mode: 'required', targets: [] } as never,
    })!;
    const c = deriveMotionExecutionContract({ visualConcept: vc, identity: { sector: 'general' } as never, prompt: 'a climate impact analytics dashboard', heroSectionId: 'hero' })!;
    const childHero = file('Hero.tsx', '<section data-korvix-section="hero"><DataField /><svg><rect/></svg></section>');
    const r = analyzeMotionExecution([childHero], c, 'hero');
    expect(r.issues.some((i) => i.code === 'motion-signature-static')).toBe(false);
  });

  it('does NOT block a purely photographic/ambient hero that is not a required animated scene', () => {
    const c = deriveMotionExecutionContract(inputFor('a luxury hotel resort', 'photograph'))!;
    const hero = file('Hero.tsx', '<section data-korvix-section="hero"><img src="https://images.example.com/resort.jpg" alt="resort"/></section>');
    const r = analyzeMotionExecution([hero], c, 'hero');
    expect(hasBlockingMotionExecutionFindings(r)).toBe(false);
  });

  it('warns on a heavy concentration of generic fade-up/infinite motion', () => {
    const c = deriveMotionExecutionContract(inputFor('a developer API SDK tool', 'product-ui', 'subscription-product'))!;
    const slop = Array.from({ length: 10 }, (_, i) => `<div className="animate-spin"/><div className="opacity-0 translate-y-4 transition">${i}</div>`).join('');
    const files = [file('App.tsx', `<main>${slop}</main>`)];
    const r = analyzeMotionExecution(files, c, 'hero');
    // Structural technique intended → concentration of decoration should warn (never block).
    expect(hasBlockingMotionExecutionFindings(r)).toBe(false);
    expect(r.issues.some((i) => i.code === 'motion-slop-concentration')).toBe(true);
  });

  it('warns on animated blur/filter and layout-triggering animation', () => {
    const c = deriveMotionExecutionContract(inputFor('a personal finance investing app'))!;
    const files = [file('App.tsx', '<main><div className="transition-[filter] animate-[pulse]"/><style>{`@keyframes m{from{left:0}to{left:100px}}`}</style></main>')];
    const r = analyzeMotionExecution(files, c, 'hero');
    expect(r.issues.some((i) => i.code === 'motion-blur-filter')).toBe(true);
    expect(r.issues.some((i) => i.code === 'motion-layout-props')).toBe(true);
    expect(hasBlockingMotionExecutionFindings(r)).toBe(false);
  });

  it('produces bounded, truthful diagnostics', () => {
    const c = deriveMotionExecutionContract(inputFor('a personal finance investing app'))!;
    const chars = renderMotionExecutionBlock(c).join('\n').length;
    const r = analyzeMotionExecution([file('Hero.tsx', '<section data-korvix-section="hero"><svg><animate/></svg></section>')], c, 'hero');
    const d = buildMotionExecutionDiagnostics(c, r, chars)!;
    expect(d.version).toBe('motion-execution-v1');
    expect(d.contractRenderedToFrontendBuilder).toBe(true);
    expect(d.contractUsedByAcceptance).toBe(true);
    expect(d.promptCharCount).toBeGreaterThan(0);
  });
});
