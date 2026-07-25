/**
 * Tests — Hard Generation Contract (PR #519, Part A).
 *
 * Deterministic build of the binding contract from the existing plan, the binding prompt block,
 * static enforcement findings, and the repair adapter. Flag-off = byte-for-byte parity.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildGenerationContract, renderGenerationContractBlock, evaluateContractCompliance,
  contractFindingsToReviewIssues, isHardGenerationContractEnabled,
} from '@/lib/webBuildGenerationContract';
import type {
  ExperienceArchitecturePlan, ExperienceSectionContract, ExperienceVisualMedium,
  FrontendGeneratedFile,
} from '@/lib/webBuildAgents';

function section(id: string, medium: ExperienceVisualMedium, proof = false): ExperienceSectionContract {
  return { id, purpose: `${id}`, requiredContent: [], visualMedium: medium, textDensity: 'medium', ...(proof ? { proofRequirement: 'real product/data proof' } : {}) };
}
function plan(over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType: 'product-demonstration',
    entryPattern: 'interactive-demo', landingRequired: true, heroPattern: 'product UI preview',
    heroContentPriority: 'interaction', textDensity: 'medium', primaryVisualMedium: 'product_ui',
    sectionSequence: ['demo', 'how-it-works', 'get-started'],
    sectionContracts: [section('demo', 'interactive_demo', true)],
    forbiddenPatterns: ['generic centered SaaS hero', 'three identical feature cards'],
    userDirectives: [], ...over,
  };
}
function file(content: string): FrontendGeneratedFile {
  return { path: 'App.tsx', language: 'tsx', content, charCount: content.length, lineCount: 1 };
}

const ON = () => vi.stubEnv('VITE_ENABLE_HARD_GENERATION_CONTRACT', 'true');
afterEach(() => vi.unstubAllEnvs());

/* ── 9. Flag off = byte-for-byte ──────────────────────────────────────────────*/
describe('flag gating', () => {
  it('off by default → no contract, empty block', () => {
    expect(isHardGenerationContractEnabled()).toBe(false);
    expect(buildGenerationContract(plan())).toBeUndefined();
    expect(renderGenerationContractBlock(undefined)).toBe('');
  });
});

/* ── 1–8, 10. Per-business contract build ─────────────────────────────────────*/
describe('contract build', () => {
  it('1. product-first SaaS → first viewport is a functional product experience', () => {
    ON();
    const c = buildGenerationContract(plan())!;
    expect(c.entryRequirement.toLowerCase()).toContain('functional product');
    expect(c.dominantFirstViewportElement.toLowerCase()).toContain('demo');
    expect(c.requiredVisualMedia.join(' ')).toContain('product ui');
  });
  it('2. app-first / no landing → open into the app, not marketing', () => {
    ON();
    const c = buildGenerationContract(plan({ landingRequired: false, entryPattern: 'app-first', heroContentPriority: 'none' }))!;
    expect(c.entryRequirement.toLowerCase()).toContain('do not build a marketing landing');
    expect(c.heroRequirement.toLowerCase()).toContain('do not invent a hero');
  });
  it('3. luxury restaurant → atmosphere entry, photography', () => {
    ON();
    const c = buildGenerationContract(plan({ experienceType: 'atmosphere-editorial', entryPattern: 'atmosphere-first', heroContentPriority: 'media', primaryVisualMedium: 'photography', sectionContracts: [section('menu', 'photography', true)] }))!;
    expect(c.entryRequirement.toLowerCase()).toContain('atmosphere');
    expect(c.requiredVisualMedia.join(' ').toLowerCase()).toContain('photography');
  });
  it('4. portfolio → work-first', () => {
    ON();
    const c = buildGenerationContract(plan({ experienceType: 'work-showcase', entryPattern: 'work-first', heroContentPriority: 'media' }))!;
    expect(c.entryRequirement.toLowerCase()).toContain('work');
  });
  it('6. no-image typography-first → no required media (never force images)', () => {
    ON();
    const c = buildGenerationContract(plan({ textDensity: 'low', primaryVisualMedium: 'typography', heroContentPriority: 'text', sectionContracts: [section('intro', 'typography')], userDirectives: ['Minimal'] }))!;
    expect(c.requiredVisualMedia).toEqual([]);
  });
  it('10. forbidden generic SaaS fallbacks are always listed', () => {
    ON();
    const c = buildGenerationContract(plan())!;
    const f = c.forbiddenPatterns.join(' ').toLowerCase();
    expect(f).toContain('two cta buttons');
    expect(f).toContain('three-identical-card');
    expect(f).toContain('dark-purple');
    expect(f).toContain('neon');
  });
});

/* ── Binding block + leak safety ──────────────────────────────────────────────*/
describe('binding block', () => {
  it('renders binding imperative language, no scores/reasoning', () => {
    ON();
    const block = renderGenerationContractBlock(buildGenerationContract(plan())).toLowerCase();
    expect(block).toContain('generation contract — binding');
    expect(block).toContain('forbidden');
    for (const bad of ['confidence:', 'score', 'matched', 'reasoning', 'chain-of-thought', '0.']) {
      expect(block).not.toContain(bad);
    }
  });
});

/* ── Static enforcement ───────────────────────────────────────────────────────*/
describe('static enforcement', () => {
  it('headline-first fallback against a product-first plan → major finding', () => {
    const src = '<section><h1 class="text-6xl">The best AI support</h1><p>tagline</p></section>';
    const findings = evaluateContractCompliance([file(src)], plan());
    expect(findings.map((f) => f.code)).toContain('contract-headline-first-vs-product-first');
    expect(findings.find((f) => f.code === 'contract-headline-first-vs-product-first')!.severity).toBe('major');
  });
  it('hero generated despite heroPattern none → major', () => {
    const p = plan({ heroContentPriority: 'none', heroPattern: 'no hero' });
    const src = '<section class="min-h-screen"><h1>Welcome</h1></section>';
    expect(evaluateContractCompliance([file(src)], p).map((f) => f.code)).toContain('contract-hero-when-none');
  });
  it('11. missing required proof (decorative) → major', () => {
    const p = plan({ sectionContracts: [section('stats', 'data_visualization', true)] });
    const src = '<section data-id="stats"><div class="animate-pulse h-6"></div></section>';
    expect(evaluateContractCompliance([file(src)], p).map((f) => f.code)).toContain('contract-decorative-proof');
  });
  it('missing required photography medium → major', () => {
    const p = plan({ primaryVisualMedium: 'photography', heroContentPriority: 'media', sectionContracts: [section('hero', 'photography')] });
    const src = '<section><h2>Our story</h2><p>text only</p></section>';
    expect(evaluateContractCompliance([file(src)], p).map((f) => f.code)).toContain('contract-missing-required-medium');
  });
  it('12. no false positives for an intentionally minimal design', () => {
    const p = plan({ textDensity: 'low', primaryVisualMedium: 'typography', heroContentPriority: 'text', entryPattern: 'value-first', sectionContracts: [section('intro', 'typography')], forbiddenPatterns: [], userDirectives: ['Minimal'] });
    const src = '<section><h1>Jane Doe</h1><p>Writer.</p></section>';
    expect(evaluateContractCompliance([file(src)], p)).toEqual([]);
  });
  it('fail-open: no plan / no files → []', () => {
    expect(evaluateContractCompliance([file('<div/>')], undefined)).toEqual([]);
    expect(evaluateContractCompliance([], plan())).toEqual([]);
  });
});

/* ── Explicit user intent overrides generic anti-template defaults (Issue 2) ──── */
describe('explicit user intent', () => {
  it('explicit purple/dark request → dark-purple is NOT forbidden (neon still is)', () => {
    ON();
    const c = buildGenerationContract(plan(), 'Give the landing page a dark purple theme')!;
    const f = c.forbiddenPatterns.join(' ').toLowerCase();
    expect(f).not.toContain('dark-purple');
    expect(f).toContain('neon');       // not requested → still forbidden
  });
  it('generic AI prompt (no explicit palette) still forbids purple + neon', () => {
    ON();
    const c = buildGenerationContract(plan(), 'Build an AI SaaS product for support teams')!;
    const f = c.forbiddenPatterns.join(' ').toLowerCase();
    expect(f).toContain('dark-purple');
    expect(f).toContain('neon');
  });
  it('explicit feature-comparison-card request → three-card default not forbidden', () => {
    ON();
    const c = buildGenerationContract(plan({ forbiddenPatterns: [] }), 'Include a feature comparison card grid')!;
    expect(c.forbiddenPatterns.join(' ').toLowerCase()).not.toContain('three-identical-card');
  });
  it('does NOT infer explicit intent from experienceType alone', () => {
    ON();
    // No explicit request → the generic purple default remains in force.
    const c = buildGenerationContract(plan({ experienceType: 'product-demonstration' }))!;
    expect(c.forbiddenPatterns.join(' ').toLowerCase()).toContain('dark-purple');
  });
  it('explicit pricing/testimonials request → not flagged as unrequested', () => {
    const p = plan({ sectionSequence: ['demo'], sectionContracts: [] });
    const src = '<section><h2>Pricing</h2><p>$9/mo</p></section><section><h2>Testimonials</h2><p>Great tool</p></section>';
    const codes = evaluateContractCompliance([file(src)], p, 'Add a pricing section and testimonials').map((f) => f.code);
    expect(codes).not.toContain('contract-auto-pricing');
    expect(codes).not.toContain('contract-auto-testimonials');
  });
  it('unrequested pricing/testimonials → minor findings (no explicit request)', () => {
    const p = plan({ sectionSequence: ['demo'], sectionContracts: [] });
    const src = '<section><h2>Pricing</h2><p>$9/mo</p></section><section><h2>Testimonials</h2><p>Great</p></section>';
    const codes = evaluateContractCompliance([file(src)], p).map((f) => f.code);
    expect(codes).toContain('contract-auto-pricing');
    expect(codes).toContain('contract-auto-testimonials');
  });
});

/* ── Conservative first-viewport check (Issue 4) ──────────────────────────────── */
function fileAt(path: string, content: string): FrontendGeneratedFile {
  return { path, language: path.endsWith('.css') ? 'css' : 'tsx', content, charCount: content.length, lineCount: 1 };
}
describe('conservative first-viewport evidence', () => {
  it('uncertain multi-file ordering → NO false headline-first finding', () => {
    // App composes child components; the headline lives in a separate file. Source order across
    // files is NOT rendered order → defer (no first-viewport blocker).
    const app = fileAt('src/App.tsx', 'export default function App(){return (<div><Hero/><Demo/></div>);}');
    const hero = fileAt('src/Hero.tsx', 'export const Hero=()=> <section><h1 className="text-6xl">Big headline</h1></section>;');
    const codes = evaluateContractCompliance([app, hero], plan()).map((f) => f.code);
    expect(codes).not.toContain('contract-headline-first-vs-product-first');
  });
  it('strong same-file evidence → still detects headline-first', () => {
    const app = fileAt('src/App.tsx', 'export default ()=> <main><section><h1 className="text-6xl">Headline</h1><p>x</p></section></main>;');
    const codes = evaluateContractCompliance([app], plan()).map((f) => f.code);
    expect(codes).toContain('contract-headline-first-vs-product-first');
  });
  it('entry inlines a product demo first → no headline-first finding', () => {
    const app = fileAt('src/App.tsx', 'export default ()=> <main><section><button onClick={()=>{}}>Run</button><h1>Later</h1></section></main>;');
    const codes = evaluateContractCompliance([app], plan()).map((f) => f.code);
    expect(codes).not.toContain('contract-headline-first-vs-product-first');
  });
});

/* ── Repair adapter ───────────────────────────────────────────────────────────*/
describe('repair adapter', () => {
  it('maps findings to review issues (severity preserved, category dedup)', () => {
    const findings = evaluateContractCompliance([file('<section><h1 class="text-6xl">x</h1></section>')], plan());
    const issues = contractFindingsToReviewIssues(findings);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].id.startsWith('contract:')).toBe(true);
    expect(issues.some((i) => i.severity === 'major')).toBe(true);
    // dedup by category.
    const cats = issues.map((i) => i.category);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
