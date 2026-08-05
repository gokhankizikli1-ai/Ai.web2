import { describe, it, expect } from 'vitest';
import {
  deriveExecutionObligationRegistry,
  renderObligationManifestBlock,
  buildEvidenceMap,
  analyzeObligationFulfillment,
  compareObligationFulfillment,
  buildObligationDiagnostics,
  type ObligationRegistryInput,
  type ExecutionObligationRegistry,
} from '@/lib/webBuildExecutionObligations';
import { deriveVisualConceptContract } from '@/lib/webBuildVisualConcept';
import { deriveExperienceIdentityContract } from '@/lib/webBuildExperienceIdentity';
import { deriveMotionExecutionContract } from '@/lib/webBuildMotionExecution';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}
/** Build a realistic registry input from the real upstream contracts. */
function registryInput(prompt: string, anchor = 'product-ui', businessModel = 'subscription-product'): ObligationRegistryInput {
  const identity = { sector: 'general', businessModel: businessModel as never } as never;
  const composition = { hero: { visualAnchor: anchor }, sections: [{ id: 'hero', name: 'Hero', narrativeRole: 'hero', density: 'balanced' }] } as never;
  const imageCoverage = { version: 'image-coverage-v1', mode: 'required', targets: [{ purpose: 'hero', label: 'hero', required: true, hero: true, orientation: 'landscape', altText: 'hero' }] } as never;
  const vc = deriveVisualConceptContract({ identity, prompt, composition, imageCoverage });
  const ei = deriveExperienceIdentityContract({ identity, prompt, composition, imageCoverage, visualConcept: vc });
  const me = deriveMotionExecutionContract({ visualConcept: vc, experienceIdentity: ei, identity, prompt, heroSectionId: vc?.rhythm?.peakSectionId });
  return { composition, imageCoverage, visualConcept: vc, experienceIdentity: ei, motionExecution: me, heroSectionId: vc?.rhythm?.peakSectionId };
}

describe('webBuildExecutionObligations — registry & stable ids', () => {
  it('derives obligations with stable, deterministic, position-independent ids', () => {
    const a = deriveExecutionObligationRegistry(registryInput('an AI SaaS analytics product'));
    const b = deriveExecutionObligationRegistry(registryInput('an AI SaaS analytics product'));
    expect(a).toBeTruthy();
    expect(a!.version).toBe('execution-obligations-v1');
    expect(a!.obligations.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const o of a!.obligations) expect(o.obligationId).toMatch(/^obl_[0-9a-f]{8}$/);
    // ids are unique.
    expect(new Set(a!.obligations.map((o) => o.obligationId)).size).toBe(a!.obligations.length);
  });

  it('every blocker-eligible obligation is owner-blocked (no duplicate repair issues by design)', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a personal finance investing app'))!;
    for (const o of r.obligations) if (o.blockerEligible) expect(o.ownerAnalyzerBlocks).toBe(true);
  });

  it('dedups the same requirement across contracts into one obligation with merged source traces', () => {
    const r = deriveExecutionObligationRegistry(registryInput('an AI SaaS analytics product'))!;
    const heroSig = r.obligations.filter((o) => o.type === 'hero-signature');
    expect(heroSig.length).toBeLessThanOrEqual(1);
    if (heroSig[0]) expect(heroSig[0].sourceTrace.length).toBeGreaterThanOrEqual(1);
  });

  it('collects regulated disclaimer + demonstration obligations for a finance build', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a personal finance investing and loan platform'))!;
    expect(r.obligations.some((o) => o.type === 'regulated-disclaimer')).toBe(true);
    expect(r.requiredCount).toBeGreaterThan(0);
  });
});

describe('webBuildExecutionObligations — builder manifest', () => {
  it('renders a hard-bounded, by-id manifest that says it will be checked', () => {
    const r = deriveExecutionObligationRegistry(registryInput('an AI SaaS analytics product'))!;
    const lines = renderObligationManifestBlock(r);
    expect(lines[0]).toMatch(/^EXECUTION OBLIGATION MANIFEST/);
    expect(lines.some((l) => /^\[OBL obl_[0-9a-f]{8}/.test(l))).toBe(true);
    expect(lines.join('\n').length).toBeLessThanOrEqual(2400);
  });
  it('renders nothing for a legacy/absent registry', () => {
    expect(renderObligationManifestBlock(undefined)).toEqual([]);
    expect(renderObligationManifestBlock({ status: 'legacy', obligations: [] } as unknown as ExecutionObligationRegistry)).toEqual([]);
  });
});

describe('webBuildExecutionObligations — evidence map (reuses shared scanner; fails open)', () => {
  it('detects motion, state, images, disclaimer and child components', () => {
    const files = [
      file('Hero.tsx', '<section data-korvix-section="hero"><svg><animate/></svg><img src="https://images.example.com/x.jpg" alt="a"/></section>'),
      file('Calc.tsx', 'import {motion} from "framer-motion"; const [v,setV]=useState(0); <input onChange={e=>setV(e.target.value)}/>'),
      file('Footer.tsx', '<footer>This is not financial advice. Illustrative examples only.</footer>'),
      file('Wrap.tsx', '<main><ChildThing /></main>'),
    ];
    const m = buildEvidenceMap(files, ['hero'], 'hero');
    expect(m.motionEvidence).toBe(true);
    expect(m.hasState).toBe(true);
    expect(m.hasHandler).toBe(true);
    expect(m.realImages.length).toBeGreaterThan(0);
    expect(m.disclaimerEvidence).toBe(true);
    expect(m.anyChildComponent).toBe(true);
  });
  it('never throws on malformed input (fail open)', () => {
    expect(() => buildEvidenceMap(undefined, [])).not.toThrow();
    expect(buildEvidenceMap([], []).fileCount).toBe(0);
  });
});

describe('webBuildExecutionObligations — fulfillment analyzer', () => {
  it('legacy pass with no registry; non-legacy with no files', () => {
    expect(analyzeObligationFulfillment([file('a.tsx', '<div/>')], undefined).legacy).toBe(true);
    const r = deriveExecutionObligationRegistry(registryInput('an AI SaaS analytics product'))!;
    expect(analyzeObligationFulfillment([], r).legacy).toBe(false);
  });

  it('marks hero-signature fulfilled when the hero has an animated surface', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a climate impact analytics dashboard', 'illustration'))!;
    const files = [file('Hero.tsx', '<section data-korvix-section="hero"><svg><path className="stroke-dash"><animate/></path></svg></section>')];
    const res = analyzeObligationFulfillment(files, r);
    const hero = res.evaluations.find((e) => e.type === 'hero-signature');
    expect(hero).toBeTruthy();
    expect(['fulfilled', 'partial']).toContain(hero!.status);
  });

  it('marks a required obligation ambiguous (not missing) when the hero is child-hosted (fail open)', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a climate impact analytics dashboard', 'illustration'))!;
    const files = [file('Hero.tsx', '<section data-korvix-section="hero"><DataScene /></section>')];
    const res = analyzeObligationFulfillment(files, r);
    const hero = res.evaluations.find((e) => e.type === 'hero-signature');
    expect(hero!.status).toBe('ambiguous');
  });

  it('marks regulated-disclaimer missing only with substantial copy and no disclaimer', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a personal finance investing and loan platform'))!;
    const withText = [file('App.tsx', '<main><h1>Grow your wealth</h1><p>' + 'Invest smarter with our tools. '.repeat(6) + '</p></main>')];
    const res = analyzeObligationFulfillment(withText, r);
    const d = res.evaluations.find((e) => e.type === 'regulated-disclaimer');
    expect(d!.status).toBe('missing');
    const withDisc = [file('App.tsx', '<main><p>' + 'Details here. '.repeat(6) + 'This is not financial advice; figures are illustrative.</p></main>')];
    expect(analyzeObligationFulfillment(withDisc, r).evaluations.find((e) => e.type === 'regulated-disclaimer')!.status).toBe('fulfilled');
  });
});

describe('webBuildExecutionObligations — pre/post repair regression (Phase 8)', () => {
  it('flags a regression when a fulfilled required obligation becomes missing after repair', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a climate impact analytics dashboard', 'illustration'))!;
    const good = [file('Hero.tsx', '<section data-korvix-section="hero"><svg><animate/></svg></section>')];
    const broken = [file('Hero.tsx', '<section data-korvix-section="hero"><h1>Impact</h1></section>')]; // surface removed
    const pre = analyzeObligationFulfillment(good, r);
    const post = analyzeObligationFulfillment(broken, r);
    const cmp = compareObligationFulfillment(pre, post);
    expect(cmp.regressionRejectsRepair).toBe(true);
    expect(cmp.regressed.some((x) => x.type === 'hero-signature')).toBe(true);
  });

  it('does NOT flag a regression when everything stays fulfilled', () => {
    const r = deriveExecutionObligationRegistry(registryInput('a climate impact analytics dashboard', 'illustration'))!;
    const good = [file('Hero.tsx', '<section data-korvix-section="hero"><svg><animate/></svg></section>')];
    const cmp = compareObligationFulfillment(analyzeObligationFulfillment(good, r), analyzeObligationFulfillment(good, r));
    expect(cmp.regressionRejectsRepair).toBe(false);
  });

  it('fails open (no rejection) when pre/post comparison is legacy/empty', () => {
    expect(compareObligationFulfillment(undefined, undefined).regressionRejectsRepair).toBe(false);
  });

  it('produces bounded, truthful diagnostics', () => {
    const r = deriveExecutionObligationRegistry(registryInput('an AI SaaS analytics product'))!;
    const chars = renderObligationManifestBlock(r).join('\n').length;
    const res = analyzeObligationFulfillment([file('Hero.tsx', '<section data-korvix-section="hero"><svg><animate/></svg></section>')], r);
    const d = buildObligationDiagnostics(r, res, undefined, undefined, chars)!;
    expect(d.version).toBe('execution-obligations-v1');
    expect(d.totalObligations).toBe(r.obligations.length);
    expect(d.contractRenderedToFrontendBuilder).toBe(true);
    expect(d.contractUsedByAcceptance).toBe(true);
    expect(d.evaluatedCount).toBe(r.obligations.length);
  });
});
