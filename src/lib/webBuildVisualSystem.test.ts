import { describe, it, expect } from 'vitest';
import {
  deriveVisualSystemContract,
  renderVisualSystemBlock,
  analyzeVisualSystem,
  hasBlockingVisualSystemFindings,
  buildVisualSystemDiagnostics,
  type VisualSystemInput,
  type VisualSystemContract,
} from '@/lib/webBuildVisualSystem';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: /\.css$/.test(path) ? 'css' : 'tsx', content, charCount: content.length, lineCount: content.split('\n').length } as FrontendGeneratedFile;
}
function input(over: Partial<VisualSystemInput> = {}): VisualSystemInput {
  return {
    identity: { sector: 'ai-saas', primaryConcept: 'ai workflow platform' } as VisualSystemInput['identity'],
    designSystem: { colorTokens: { background: '#0b0b12', foreground: '#f4f4f8', primary: '#6d5efc' }, paletteDecision: 'sector palette' } as unknown as VisualSystemInput['designSystem'],
    sections: [
      { id: 'hero', name: 'Hero', purpose: 'intro', order: 0 },
      { id: 'features', name: 'Features', purpose: 'features', order: 1 },
      { id: 'demo', name: 'Demo', purpose: 'demonstration', order: 2 },
      { id: 'cta', name: 'CTA', purpose: 'convert', order: 3 },
    ] as unknown as VisualSystemInput['sections'],
    prompt: 'a dark ai saas workflow automation platform',
    ...over,
  };
}

describe('webBuildVisualSystem — whole-page continuity derivation (Phase 1)', () => {
  it('derives a bounded continuity block and is deterministic', () => {
    const a = deriveVisualSystemContract(input())!;
    const b = deriveVisualSystemContract(input())!;
    expect(a.continuity).toBeTruthy();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = a.continuity!;
    expect(c.thesis.length).toBeGreaterThan(0);
    expect(c.anchors.length).toBeGreaterThanOrEqual(3);
    expect(c.anchors.length).toBeLessThanOrEqual(8);
    expect(c.surfaceHierarchy.length).toBeGreaterThanOrEqual(4);
    expect(c.radiusRoles.length).toBeGreaterThanOrEqual(4);
    expect(c.shadowRoles.length).toBeGreaterThanOrEqual(3);
    expect(c.finalPolish.length).toBeGreaterThanOrEqual(4);
    expect(c.footerResolution).toMatch(/footer/i);
    // every role/usage pair is populated
    for (const r of [...c.surfaceHierarchy, ...c.radiusRoles, ...c.shadowRoles]) {
      expect(r.role.length).toBeGreaterThan(0); expect(r.usage.length).toBeGreaterThan(0);
    }
  });

  it('keeps coherence category-TRUE (anchors/motion/image diverge by sector) — coherence ≠ sameness (Phase 9)', () => {
    const saas = deriveVisualSystemContract(input())!.continuity!;
    const travel = deriveVisualSystemContract(input({
      identity: { sector: 'travel-tourism' } as VisualSystemInput['identity'],
      prompt: 'a luxury coastal resort',
    }))!.continuity!;
    const generic = deriveVisualSystemContract(input({
      identity: { sector: 'general' } as VisualSystemInput['identity'],
      prompt: 'a professional services company',
    }))!.continuity!;
    // motion character differs across the three buckets
    const motions = new Set([saas.motionContinuity[0], travel.motionContinuity[0], generic.motionContinuity[0]]);
    expect(motions.size).toBeGreaterThanOrEqual(2);
    // image treatment diverges: image-led sector talks about full-bleed; software talks about product/UI frames
    expect(travel.imageTreatment.join(' ')).toMatch(/full-bleed/i);
    expect(saas.imageTreatment.join(' ')).toMatch(/product|ui|screen/i);
    // anchors are not identical across buckets
    expect(JSON.stringify(saas.anchors)).not.toBe(JSON.stringify(travel.anchors));
  });
});

describe('webBuildVisualSystem — render (continuity + final polish, bounded)', () => {
  it('renders continuity + final-polish lines within the documented ceiling', () => {
    const c = deriveVisualSystemContract(input())!;
    const lines = renderVisualSystemBlock(c);
    const text = lines.join('\n');
    expect(text).toMatch(/WHOLE-PAGE CONTINUITY/);
    expect(text).toMatch(/FINAL POLISH/);
    expect(text).toMatch(/Surface hierarchy/);
    expect(text.length).toBeLessThanOrEqual(4700);
  });

  it('PROMPT-SIZE AUDIT — the whole block stays under the ceiling AND the continuity payload survives', () => {
    const c = deriveVisualSystemContract(input())!;
    const withCont = renderVisualSystemBlock(c).join('\n');
    // Bounded: never exceeds the documented ceiling regardless of continuity.
    expect(withCont.length).toBeLessThanOrEqual(4700);
    // Coherence payload is prioritized so it always renders (placed before the verbose component tail).
    expect(withCont).toMatch(/WHOLE-PAGE CONTINUITY/);
    expect(withCont).toMatch(/FINAL POLISH/);
    // eslint-disable-next-line no-console
    console.log(`[prompt-size] visual-system block (capped) = ${withCont.length} chars, continuity rendered = true`);
  });

  it('renders nothing extra for a legacy/absent contract', () => {
    expect(renderVisualSystemBlock(undefined)).toEqual([]);
    expect(renderVisualSystemBlock({ status: 'legacy' } as unknown as VisualSystemContract)).toEqual([]);
  });
});

describe('webBuildVisualSystem — continuity acceptance evidence (Phases 5–6, warnings only)', () => {
  const contract = () => deriveVisualSystemContract(input({ prompt: 'a light professional services site', identity: { sector: 'general' } as VisualSystemInput['identity'], designSystem: { colorTokens: { background: '#ffffff', foreground: '#111111', primary: '#2563eb' }, paletteDecision: 'sector' } as unknown as VisualSystemInput['designSystem'] }))!;

  it('warns (never blocks) on a fragmented CTA/button system', () => {
    const c = contract();
    const files = [
      file('Hero.tsx', '<section data-korvix-section="hero"><button className="bg-blue-600 rounded">A</button></section>'),
      file('Features.tsx', '<section data-korvix-section="features"><button className="bg-emerald-500 rounded">B</button></section>'),
      file('Demo.tsx', '<section data-korvix-section="demo"><button className="bg-rose-500 rounded">C</button></section>'),
      file('Cta.tsx', '<section data-korvix-section="cta"><button className="bg-amber-500 rounded">D</button></section>'),
    ];
    const r = analyzeVisualSystem(files, c);
    expect(hasBlockingVisualSystemFindings(r)).toBe(false);          // warning only
    expect(r.distinctPrimaryButtonStyleCount).toBeGreaterThanOrEqual(4);
    expect(r.issues.some((i) => i.code === 'visual-system-cta-inconsistent')).toBe(true);
  });

  it('does NOT warn when one primary button colour is reused (false-positive guard)', () => {
    const c = contract();
    const files = [
      file('Hero.tsx', '<section data-korvix-section="hero"><button className="bg-blue-600 rounded">A</button></section>'),
      file('Features.tsx', '<section data-korvix-section="features"><button className="bg-blue-600 rounded">B</button></section>'),
      file('Cta.tsx', '<section data-korvix-section="cta"><button className="bg-blue-600 rounded">C</button></section>'),
    ];
    const r = analyzeVisualSystem(files, c);
    expect(r.issues.some((i) => i.code === 'visual-system-cta-inconsistent')).toBe(false);
  });

  it('warns on a missing footer and on a disconnected pure-black footer for a light page', () => {
    const c = contract();
    const noFooter = [
      file('Hero.tsx', '<section data-korvix-section="hero"><h1>Hi</h1></section>'),
      file('Features.tsx', '<section data-korvix-section="features"><p>f</p></section>'),
      file('Demo.tsx', '<section data-korvix-section="demo"><p>d</p></section>'),
      file('Cta.tsx', '<section data-korvix-section="cta"><p>c</p></section>'),
    ];
    const r1 = analyzeVisualSystem(noFooter, c);
    expect(r1.footerContinuity).toBe('missing');
    expect(r1.issues.some((i) => i.code === 'visual-system-footer-discontinuity')).toBe(true);
    expect(hasBlockingVisualSystemFindings(r1)).toBe(false);

    const blackFooter = [...noFooter, file('Footer.tsx', '<footer className="bg-black text-white"><p>© 2025</p></footer>')];
    const r2 = analyzeVisualSystem(blackFooter, c);
    expect(r2.footerContinuity).toBe('disconnected');
    expect(r2.issues.some((i) => i.code === 'visual-system-footer-discontinuity')).toBe(true);
  });

  it('treats a present, non-black footer as ok', () => {
    const c = contract();
    const files = [
      file('Hero.tsx', '<section data-korvix-section="hero"><h1>Hi</h1></section>'),
      file('Features.tsx', '<section data-korvix-section="features"><p>f</p></section>'),
      file('Demo.tsx', '<section data-korvix-section="demo"><p>d</p></section>'),
      file('Footer.tsx', '<footer className="bg-slate-50 text-slate-600"><p>© 2025</p></footer>'),
    ];
    const r = analyzeVisualSystem(files, c);
    expect(r.footerContinuity).toBe('ok');
    expect(r.issues.some((i) => i.code === 'visual-system-footer-discontinuity')).toBe(false);
  });

  it('fails open (never throws) and surfaces continuity signals in diagnostics', () => {
    const c = contract();
    expect(() => analyzeVisualSystem(undefined, c)).not.toThrow();
    const r = analyzeVisualSystem([file('a.tsx', '<div/>')], c);
    const d = buildVisualSystemDiagnostics(c, r, 100)!;
    expect(d.continuityPresent).toBe(true);
    expect(d.continuityAnchorCount).toBeGreaterThanOrEqual(3);
    expect(d.footerContinuity === undefined || typeof d.footerContinuity === 'string').toBe(true);
  });
});
