import { describe, it, expect } from 'vitest';
import {
  deriveExperienceIdentityContract,
  renderExperienceIdentityBlock,
  analyzeExperienceIdentity,
  hasBlockingExperienceIdentityFindings,
  experienceIdentityToReviewIssues,
  buildExperienceIdentityDiagnostics,
  type ExperienceIdentityInput,
  type ExperienceIdentityContract,
} from '@/lib/webBuildExperienceIdentity';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}
function input(over: Partial<ExperienceIdentityInput> & { prompt?: string; businessModel?: string } = {}): ExperienceIdentityInput {
  const { businessModel, ...rest } = over;
  return {
    identity: { sector: 'general', businessModel: businessModel as never } as ExperienceIdentityInput['identity'],
    ...rest,
  };
}

describe('webBuildExperienceIdentity — derivation & determinism', () => {
  it('derives a bounded contract and is deterministic', () => {
    const a = deriveExperienceIdentityContract(input({ prompt: 'a personal finance investing platform' }));
    const b = deriveExperienceIdentityContract(input({ prompt: 'a personal finance investing platform' }));
    expect(a).toBeTruthy();
    expect(a!.version).toBe('experience-identity-v1');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('classifies regulated categories and requires disclaimers', () => {
    const fin = deriveExperienceIdentityContract(input({ prompt: 'a personal finance investing and loan platform' }))!;
    const health = deriveExperienceIdentityContract(input({ prompt: 'a healthcare clinic patient care service' }))!;
    expect(fin.trust.stakes).toBe('regulated');
    expect(fin.trust.disclaimersRequired.length).toBeGreaterThan(0);
    expect(health.trust.stakes).toBe('regulated');
  });

  it('does NOT force demonstration onto photography-led categories', () => {
    const hotel = deriveExperienceIdentityContract(input({ prompt: 'a luxury boutique hotel and spa resort' }))!;
    const arch = deriveExperienceIdentityContract(input({ prompt: 'an architecture studio portfolio' }))!;
    expect(hotel.demonstration.required).toBe(false);
    expect(arch.demonstration.required).toBe(false);
  });

  it('requires a demonstration for a self-serve SaaS', () => {
    const saas = deriveExperienceIdentityContract(input({ prompt: 'an AI SaaS automation platform', businessModel: 'subscription-product' }))!;
    expect(saas.demonstration.required).toBe(true);
    expect(saas.demonstration.backendRequired).toBe(false);
    expect(saas.demonstration.frontendSimOk).toBe(true);
  });
});

describe('webBuildExperienceIdentity — category differentiation matrix (Phase 10)', () => {
  const cases: Array<[string, string]> = [
    ['saas', 'an AI SaaS analytics product', 'subscription-product'] as unknown as [string, string],
    ['finance', 'a personal finance budgeting and investing app'],
    ['hospitality', 'a luxury boutique hotel and spa resort'],
    ['architecture', 'an architecture studio design practice'],
    ['developer', 'a developer CLI and API SDK tool'],
  ];
  it('five representative categories diverge on personality, narrative, signature behavior and trust stakes', () => {
    const derived = cases.map((c) => deriveExperienceIdentityContract(input({ prompt: (c as string[])[1], businessModel: (c as string[])[2] }))!);
    const personalities = new Set(derived.map((d) => d.personality));
    const narratives = new Set(derived.map((d) => d.narrativeArchitecture));
    const signatures = new Set(derived.map((d) => d.signatureBehavior));
    const stakes = new Set(derived.map((d) => d.trust.stakes));
    // Deterministic, category-fixed axes must be fully distinct; hash-influenced narrative ≥3.
    expect(personalities.size).toBeGreaterThanOrEqual(4);
    expect(signatures.size).toBe(5);
    expect(narratives.size).toBeGreaterThanOrEqual(3);
    expect(stakes.size).toBeGreaterThanOrEqual(2);
  });
});

describe('webBuildExperienceIdentity — demonstration blueprint (Phases 1–4)', () => {
  it('attaches a concrete, buildable blueprint when a demonstration is required', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'an AI SaaS automation platform', businessModel: 'subscription-product' }))!;
    expect(c.demonstration.required).toBe(true);
    const bp = c.demonstration.blueprint!;
    expect(bp).toBeTruthy();
    expect(bp.controls.length).toBeGreaterThanOrEqual(1);
    expect(bp.controls.length).toBeLessThanOrEqual(3);
    expect(bp.outputs.length).toBeGreaterThanOrEqual(1);
    // every output derives from a real control
    for (const o of bp.outputs) expect(o.derivedFrom.length).toBeGreaterThan(0);
    // a state machine with a real progression + reset
    expect(bp.stateMachine.states.map((s) => s.name)).toContain('result');
    expect(bp.stateMachine.resetBehavior.length).toBeGreaterThan(0);
    // calculation fidelity rules are always present and honest
    expect(bp.computation.fidelityRules.length).toBeGreaterThanOrEqual(3);
    expect(bp.computation.fidelityRules.join(' ')).toMatch(/illustrative|clamp|NaN|empty|live data/i);
  });

  it('gives a numeric calculator category real numeric bounds + divide-by-zero fidelity', () => {
    const fin = deriveExperienceIdentityContract(input({ prompt: 'a personal finance loan and budgeting calculator app', businessModel: 'subscription-product' }))!;
    expect(fin.demonstration.required).toBe(true);
    const bp = fin.demonstration.blueprint!;
    const numeric = bp.controls.filter((ctl) => ctl.kind === 'slider' || ctl.kind === 'number' || ctl.kind === 'stepper');
    expect(numeric.length).toBeGreaterThanOrEqual(1);
    for (const n of numeric) { expect(typeof n.min).toBe('number'); expect(typeof n.max).toBe('number'); expect(n.max!).toBeGreaterThan(n.min!); }
    expect(bp.computation.fidelityRules.join(' ')).toMatch(/divide-by-zero|clamp|NaN/i);
  });

  it('folds real binding control labels into the blueprint (reuses the binding contract)', () => {
    const binding = {
      version: 'binding-requirements-v1',
      requirements: [{
        id: 'r1', kind: 'interactive-experience', label: 'mortgage estimator', required: true, strength: 'explicit', evidence: 'x',
        controls: [{ id: 'c1', label: 'home price', aliases: [] }, { id: 'c2', label: 'down payment', aliases: [] }],
        dynamicOutcome: 'monthly payment',
      }],
      counts: { total: 1, section: 0, interaction: 1, control: 2, dynamicOutcome: 1, behavior: 0, media: 0 },
    } as unknown as ExperienceIdentityInput['binding'];
    const c = deriveExperienceIdentityContract(input({ prompt: 'a mortgage estimator finance app', binding }))!;
    const labels = c.demonstration.blueprint!.controls.map((ctl) => ctl.label.toLowerCase());
    expect(labels).toContain('home price');
    expect(labels).toContain('down payment');
  });

  it('does NOT attach a blueprint for a photography-led category with no demonstration', () => {
    const hotel = deriveExperienceIdentityContract(input({ prompt: 'a luxury boutique hotel and spa resort' }))!;
    expect(hotel.demonstration.required).toBe(false);
    expect(hotel.demonstration.blueprint).toBeUndefined();
  });

  it('is deterministic and JSON-safe including the blueprint', () => {
    const a = deriveExperienceIdentityContract(input({ prompt: 'a developer API SDK tool', businessModel: 'subscription-product' }))!;
    const b = deriveExperienceIdentityContract(input({ prompt: 'a developer API SDK tool', businessModel: 'subscription-product' }))!;
    expect(JSON.stringify(a.demonstration.blueprint)).toBe(JSON.stringify(b.demonstration.blueprint));
    expect(a.demonstration.blueprint).toBeTruthy();
  });

  it('renders the concrete blueprint (controls + computation + fidelity) into the builder block', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'an AI SaaS analytics automation product', businessModel: 'subscription-product' }))!;
    const text = renderExperienceIdentityBlock(c).join('\n');
    expect(text).toMatch(/BUILD THIS — controls:/);
    expect(text).toMatch(/computation \(/);
    expect(text).toMatch(/calculation fidelity/i);
    expect(text).toMatch(/states:/);
  });

  it('surfaces blueprint counts in diagnostics', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'an AI SaaS analytics product', businessModel: 'subscription-product' }))!;
    const d = buildExperienceIdentityDiagnostics(c, analyzeExperienceIdentity([file('a.tsx', '<div/>')], c), 10)!;
    expect(d.demonstrationControlCount).toBeGreaterThanOrEqual(1);
    expect(d.demonstrationOutputCount).toBeGreaterThanOrEqual(1);
    expect(d.demonstrationComputationKind).not.toBe('none');
  });
});

describe('webBuildExperienceIdentity — render block', () => {
  it('renders a hard-bounded block leading with the experience thesis', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'an AI SaaS automation platform', businessModel: 'subscription-product' }))!;
    const lines = renderExperienceIdentityBlock(c);
    expect(lines[0]).toMatch(/^BINDING EXPERIENCE IDENTITY/);
    expect(lines.some((l) => /Experience thesis/.test(l))).toBe(true);
    expect(lines.some((l) => /Narrative architecture/.test(l))).toBe(true);
    expect(lines.join('\n').length).toBeLessThanOrEqual(3200);
  });
  it('renders nothing for a legacy/absent contract', () => {
    expect(renderExperienceIdentityBlock(undefined)).toEqual([]);
    expect(renderExperienceIdentityBlock({ status: 'legacy' } as unknown as ExperienceIdentityContract)).toEqual([]);
  });
});

describe('webBuildExperienceIdentity — acceptance (conservative, non-duplicative, fail-open)', () => {
  it('is legacy pass with no contract; non-legacy pass with no files', () => {
    expect(analyzeExperienceIdentity([file('a.tsx', '<div/>')], undefined).legacy).toBe(true);
    const c = deriveExperienceIdentityContract(input({ prompt: 'a finance investing app' }))!;
    const r = analyzeExperienceIdentity([], c);
    expect(r.legacy).toBe(false);
    expect(r.status).toBe('pass');
  });

  it('BLOCKS a regulated build with no disclaimer language anywhere', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'a personal finance investing and loan platform' }))!;
    expect(c.trust.stakes).toBe('regulated');
    const files = [file('App.tsx', '<main><h1>Grow your wealth</h1><p>Invest smarter today.</p><button>Start now</button></main>')];
    const r = analyzeExperienceIdentity(files, c);
    expect(hasBlockingExperienceIdentityFindings(r)).toBe(true);
    expect(r.issues.some((i) => i.code === 'experience-disclaimer-missing')).toBe(true);
    expect(experienceIdentityToReviewIssues(r).length).toBeGreaterThan(0);
  });

  it('does NOT block a regulated build that includes a disclaimer (false-positive guard)', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'a personal finance investing and loan platform' }))!;
    const files = [
      file('App.tsx', '<main><h1>Grow your wealth</h1><p>Invest smarter.</p></main>'),
      file('Footer.tsx', '<footer><p>This is not financial advice. Figures shown are illustrative examples. Past performance does not guarantee future results.</p></footer>'),
    ];
    const r = analyzeExperienceIdentity(files, c);
    expect(hasBlockingExperienceIdentityFindings(r)).toBe(false);
    expect(r.disclaimerFound).toBe(true);
  });

  it('does NOT block a non-regulated build lacking a disclaimer', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'a luxury boutique hotel and spa resort' }))!;
    expect(c.trust.stakes).not.toBe('regulated');
    const files = [file('App.tsx', '<main><h1>Escape to the coast</h1><img src="https://images.example.com/resort.jpg" alt="resort"/></main>')];
    const r = analyzeExperienceIdentity(files, c);
    expect(hasBlockingExperienceIdentityFindings(r)).toBe(false);
  });

  it('warns (does not block) when a required demonstration is not evidenced', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'a developer API SDK tool', businessModel: 'subscription-product' }))!;
    expect(c.demonstration.required).toBe(true);
    const files = [file('App.tsx', '<main><h1>Ship faster</h1><p>Build APIs quickly.</p></main>')];
    const r = analyzeExperienceIdentity(files, c);
    expect(hasBlockingExperienceIdentityFindings(r)).toBe(false);
    expect(r.issues.some((i) => i.code === 'experience-demonstration-absent')).toBe(true);
  });

  it('fails open on a regulated disclaimer check when a child component may host the copy', () => {
    // A regulated build whose only content is a child component: disclaimer scan still runs on text,
    // but the demonstration warning must fail open. Here we confirm the analyzer never throws.
    const c = deriveExperienceIdentityContract(input({ prompt: 'a healthcare telehealth clinic platform', businessModel: 'appointment-led' }))!;
    const files = [file('App.tsx', '<main><Disclaimer /><HeroSection /></main>')];
    const r = analyzeExperienceIdentity(files, c);
    expect(r.legacy).toBe(false);   // ran, did not throw
    expect(hasBlockingExperienceIdentityFindings(r)).toBe(false);   // fails open on thin/child-hosted copy
  });

  it('produces bounded, truthful diagnostics', () => {
    const c = deriveExperienceIdentityContract(input({ prompt: 'an AI SaaS analytics product', businessModel: 'subscription-product' }))!;
    const chars = renderExperienceIdentityBlock(c).join('\n').length;
    const r = analyzeExperienceIdentity([file('App.tsx', '<main><input/><button onClick={()=>{}}>Run</button></main>')], c);
    const d = buildExperienceIdentityDiagnostics(c, r, chars)!;
    expect(d.version).toBe('experience-identity-v1');
    expect(d.category).toBe('software-saas');
    expect(d.contractRenderedToFrontendBuilder).toBe(true);
    expect(d.contractUsedByAcceptance).toBe(true);
    expect(d.promptCharCount).toBeGreaterThan(0);
    expect(d.demonstrationPattern).toBe('input-to-output-transformation');
  });
});
