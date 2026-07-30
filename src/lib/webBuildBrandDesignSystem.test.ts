/**
 * Tests — Brand Design System Compiler (PR #522).
 *
 * Deterministic compilation of the EXISTING plan/spec into a typed design system that DIVERGES by
 * business, preserves explicit user requests, NESTS inside the Hard Generation Contract (never a
 * duplicate block), and adds conservative strong-evidence-only compliance checks. Flag-off parity.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isBrandDesignSystemEnabled, compileBrandDesignSystem, renderBrandDesignSystemBlock,
  readExplicitDesign,
} from '@/lib/webBuildBrandDesignSystem';
import {
  buildGenerationContract, renderGenerationContractBlock, evaluateContractCompliance,
  contractFindingsToReviewIssues,
} from '@/lib/webBuildGenerationContract';
import type {
  ExperienceArchitecturePlan, FrontendBuildSpecification, FrontendGeneratedFile,
} from '@/lib/webBuildAgents';

function plan(over: Partial<ExperienceArchitecturePlan> = {}): ExperienceArchitecturePlan {
  return {
    version: 'experience-arch-v1', basis: 'derived', experienceType: 'product-demonstration',
    entryPattern: 'value-first', landingRequired: true, heroPattern: 'hero', heroContentPriority: 'content',
    textDensity: 'medium', primaryVisualMedium: 'mixed', sectionSequence: ['hero', 'features'],
    sectionContracts: [], forbiddenPatterns: [], userDirectives: [], ...over,
  } as ExperienceArchitecturePlan;
}
function spec(designOver: Record<string, unknown> = {}, identityOver: Record<string, unknown> = {}, prompt = ''): FrontendBuildSpecification {
  return {
    prompt,
    identity: { siteType: 'website', ...identityOver },
    designSystem: {
      rejectedDirections: [], colorTokens: {}, compositionRules: [], surfaceRules: [], componentStyleRules: [],
      proofRules: [], responsiveRules: [], accessibilityRules: [], templateTrapsToAvoid: [], mustAvoid: [],
      differentiationMoves: [], ...designOver,
    },
  } as unknown as FrontendBuildSpecification;
}
function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: path.endsWith('.css') ? 'css' : 'tsx', content, charCount: content.length, lineCount: 1 };
}

const HARD = () => vi.stubEnv('VITE_ENABLE_HARD_GENERATION_CONTRACT', 'true');
const BRAND = () => vi.stubEnv('VITE_ENABLE_BRAND_DESIGN_SYSTEM', 'true');
afterEach(() => vi.unstubAllEnvs());

/* ── Flag gating ──────────────────────────────────────────────────────────────*/
describe('flag gating', () => {
  it('off by default → no system', () => {
    expect(isBrandDesignSystemEnabled()).toBe(false);
    expect(compileBrandDesignSystem(plan())).toBeUndefined();
    expect(renderBrandDesignSystemBlock(undefined)).toBe('');
  });
});

/* ── Divergent design systems per business (1–5, 8, 9) ────────────────────────*/
describe('divergent compiled systems', () => {
  it('1. luxury restaurant → editorial, spacious, sharp, exceptional cards, photography-led', () => {
    BRAND();
    const p = plan({ experienceType: 'atmosphere-editorial', entryPattern: 'atmosphere-first', primaryVisualMedium: 'photography', heroContentPriority: 'media' });
    const sys = compileBrandDesignSystem(p, { spec: spec({}, { sector: 'hospitality', subsector: 'fine dining restaurant' }), explicitRequest: 'a luxury fine dining restaurant' })!;
    expect(sys.typographySystem.personality).toBe('editorial');
    expect(sys.spacingSystem.density).toBe('spacious');
    expect(sys.shapeSystem.radiusStyle).toBe('sharp');
    expect(sys.componentLanguage.cardPolicy).toBe('exceptional');
    expect(sys.componentLanguage.imageTreatment.toLowerCase()).toContain('imagery');
  });
  it('2. AI dashboard is NOT automatically purple/neon/dark', () => {
    BRAND();
    const p = plan({ experienceType: 'application', entryPattern: 'app-first', landingRequired: false, heroContentPriority: 'none', layoutStrategy: { version: 'layout-strategy-v1', basis: 'derived', pageStructure: 'application', sectionFlow: [], heroStyle: 'minimal', contentDensity: 'rich', avoidPatterns: [], userDirectives: [] } });
    const sys = compileBrandDesignSystem(p, { spec: spec({}, { sector: 'technology' }), explicitRequest: 'an AI operations dashboard' })!;
    expect(sys.colorSystem.mode).toBe('light');                    // never assume dark for AI
    expect(sys.typographySystem.personality).toBe('utilitarian');
    expect(sys.spacingSystem.density).toBe('compact');
    expect(sys.componentLanguage.cardPolicy).toBe('functional');
    expect(sys.forbiddenVisualDefaults.join(' ').toLowerCase()).toContain('purple');
  });
  it('3. architecture portfolio → editorial, spacious, low radius, exceptional cards', () => {
    BRAND();
    const p = plan({ experienceType: 'work-showcase', entryPattern: 'work-first', primaryVisualMedium: 'photography', heroContentPriority: 'media' });
    const sys = compileBrandDesignSystem(p, { spec: spec({}, { subsector: 'architecture portfolio' }), explicitRequest: 'an architecture studio portfolio' })!;
    expect(sys.typographySystem.personality).toBe('editorial');
    expect(sys.spacingSystem.density).toBe('spacious');
    expect(['sharp', 'subtle']).toContain(sys.shapeSystem.radiusStyle);
    expect(sys.componentLanguage.cardPolicy).toBe('exceptional');
  });
  it('4. playful education product → playful personality + rounded shapes', () => {
    BRAND();
    const sys = compileBrandDesignSystem(plan({ heroContentPriority: 'content' }), { spec: spec({}, { subsector: 'children learning app' }), explicitRequest: 'a playful learning product for kids' })!;
    expect(sys.typographySystem.personality).toBe('playful');
    expect(sys.shapeSystem.radiusStyle).toBe('rounded');
  });
  it('5. finance/trustworthy → not futuristic, forbids anonymous startup styling', () => {
    BRAND();
    const sys = compileBrandDesignSystem(plan(), { spec: spec({}, { sector: 'finance' }), explicitRequest: 'a trustworthy local financial advisory service' })!;
    expect(sys.colorSystem.mode).toBe('light');
    expect(sys.forbiddenVisualDefaults.join(' ').toLowerCase()).toContain('startup-template');
  });
  it('8. typography-first / no-image → no decorative imagery, minimal cards', () => {
    BRAND();
    const p = plan({ primaryVisualMedium: 'typography', heroContentPriority: 'text', textDensity: 'low' });
    const sys = compileBrandDesignSystem(p, { explicitRequest: 'a typography-first minimal site with no images' })!;
    expect(sys.componentLanguage.imageTreatment.toLowerCase()).toContain('no decorative imagery');
    expect(sys.componentLanguage.cardPolicy).toBe('minimal');
  });
  it('9. compact app dashboard → compact density', () => {
    BRAND();
    const sys = compileBrandDesignSystem(plan(), { explicitRequest: 'a compact data-dense admin dashboard' })!;
    expect(sys.spacingSystem.density).toBe('compact');
  });
});

/* ── Explicit user requests always win (6, 7) ─────────────────────────────────*/
describe('explicit overrides win', () => {
  it('6. explicit dark purple → dark mode, purple NOT forbidden', () => {
    BRAND();
    const sys = compileBrandDesignSystem(plan(), { explicitRequest: 'make it a dark theme with a deep purple accent' })!;
    expect(sys.colorSystem.mode).toBe('dark');
    expect(sys.forbiddenVisualDefaults.join(' ').toLowerCase()).not.toContain('purple');
  });
  it('7. explicit sharp corners → sharp radius even on a playful-ish brand', () => {
    BRAND();
    const sys = compileBrandDesignSystem(plan(), { explicitRequest: 'fun brand but with sharp square corners, no rounded' })!;
    expect(sys.shapeSystem.radiusStyle).toBe('sharp');
  });
  it('readExplicitDesign parses overrides from the real request only', () => {
    const ex = readExplicitDesign('dark theme, sharp corners, typography-first, compact');
    expect(ex.wantsDark).toBe(true);
    expect(ex.wantsSharp).toBe(true);
    expect(ex.typographyFirst).toBe(true);
    expect(ex.compact).toBe(true);
  });
});

/* ── 10/11. Flag-off parity + nests into the hard contract (not a duplicate) ──*/
describe('hard-contract nesting', () => {
  it('10. brand flag OFF (hard contract ON) → contract has no brand system, no BRAND block', () => {
    HARD();                                                        // brand flag stays off
    const c = buildGenerationContract(plan(), 'x', spec())!;
    expect(c.brandDesignSystem).toBeUndefined();
    expect(renderGenerationContractBlock(c)).not.toContain('BRAND DESIGN SYSTEM');
  });
  it('11. both flags ON → ONE block with the brand system nested (not a second GENERATION CONTRACT)', () => {
    HARD(); BRAND();
    const c = buildGenerationContract(plan(), 'a modern SaaS', spec())!;
    expect(c.brandDesignSystem?.version).toBe('brand-design-system-v1');
    const block = renderGenerationContractBlock(c);
    expect(block).toContain('GENERATION CONTRACT — BINDING');
    expect(block).toContain('BRAND DESIGN SYSTEM — BINDING');
    // Nested, not duplicated: exactly one top-level contract header.
    expect(block.match(/GENERATION CONTRACT — BINDING/g)!.length).toBe(1);
    expect(block.toLowerCase()).toContain('single source of truth');
  });
});

/* ── 12–14. Conservative static compliance (strong evidence) ──────────────────*/
describe('static compliance', () => {
  const editorialPlan = plan({ experienceType: 'atmosphere-editorial', entryPattern: 'atmosphere-first', primaryVisualMedium: 'photography', heroContentPriority: 'media' });

  it('12/13. many hardcoded colours + NO central token source → major central-tokens finding', () => {
    HARD(); BRAND();
    const files = [
      file('src/A.tsx', `export const A=()=>(<div><span style={{color:'#112233'}}/><span style={{color:'#445566'}}/><span style={{color:'#778899'}}/></div>)`),
      file('src/B.tsx', `export const B=()=>(<div><span style={{color:'#aa1122'}}/><span style={{color:'#bb3344'}}/><span style={{color:'#cc5566'}}/></div>)`),
      file('src/C.tsx', `export const C=()=>(<div><span style={{color:'#dd7788'}}/><span style={{color:'#ee99aa'}}/></div>)`),
    ];
    const codes = evaluateContractCompliance(files, plan(), 'a clean brand').map((f) => f.code);
    expect(codes).toContain('brand-missing-central-tokens');
  });
  it('14. editorial card policy + 5 identical shadow cards → excessive-cards major', () => {
    HARD(); BRAND();
    const card = '<div className="rounded-2xl shadow-lg border bg-white p-6">x</div>';
    const files = [file('src/styles.css', ':root{--background:0 0% 100%;}'), file('src/App.tsx', `export default ()=>(<main>${card.repeat(5)}</main>)`)];
    const codes = evaluateContractCompliance(files, editorialPlan, 'a luxury restaurant').map((f) => f.code);
    expect(codes).toContain('brand-excessive-cards');
  });
});

/* ── 15–17. No false positives ────────────────────────────────────────────────*/
describe('no false positives', () => {
  it('15. valid editorial layout (central tokens, open composition) → not flagged', () => {
    HARD(); BRAND();
    const files = [
      file('src/styles.css', ':root{ --background:0 0% 100%; --foreground:222 47% 11%; --accent:20 90% 48%; --border:214 32% 91%; }'),
      file('src/App.tsx', 'export default ()=>(<main><section className="bg-background text-foreground"><h1>Osteria</h1><img src="/a.jpg"/></section></main>)'),
    ];
    const p = plan({ experienceType: 'atmosphere-editorial', primaryVisualMedium: 'photography', heroContentPriority: 'media' });
    expect(evaluateContractCompliance(files, p, 'a luxury restaurant')).toEqual([]);
  });
  it('16. user-requested multicolour / brutalist brand → colour checks skipped', () => {
    HARD(); BRAND();
    const files = [
      file('src/A.tsx', `<div style={{color:'#112233'}}/><div style={{color:'#445566'}}/><div style={{color:'#778899'}}/>`),
      file('src/B.tsx', `<div style={{color:'#aa1122'}}/><div style={{color:'#bb3344'}}/><div style={{color:'#cc5566'}}/>`),
      file('src/C.tsx', `<div style={{color:'#dd7788'}}/><div style={{color:'#ee99aa'}}/><div style={{color:'#ff00cc'}}/>`),
    ];
    const codes = evaluateContractCompliance(files, plan(), 'a deliberately colourful, multicolor brutalist brand').map((f) => f.code);
    expect(codes).not.toContain('brand-missing-central-tokens');
  });
  it('17. chart categorical colours are allowed (chart context skipped)', () => {
    HARD(); BRAND();
    const chart = `import { Cell } from 'recharts'; const COLORS=['#112233','#445566','#778899','#aa1122','#bb3344','#cc5566','#dd7788','#ee99aa','#ff00cc']; export const Chart=()=> COLORS.map((c)=> <Cell fill={c}/>);`;
    const codes = evaluateContractCompliance([file('src/Chart.tsx', chart)], plan(), 'a clean brand').map((f) => f.code);
    expect(codes).not.toContain('brand-missing-central-tokens');
  });
});

/* ── 18. Adapter: brand major rides existing repair, not shadowed by a minor ──*/
describe('review-issue adapter', () => {
  it('18. a same-category MAJOR is not shadowed by a MINOR (severity-ordered dedup)', () => {
    const issues = contractFindingsToReviewIssues([
      { code: 'contract-default-purple-neon', severity: 'minor', message: 'purple', repairInstruction: 'x' },
      { code: 'brand-missing-central-tokens', severity: 'major', message: 'tokens', repairInstruction: 'y' },
    ]);
    const palette = issues.find((i) => i.category === 'palette-and-surfaces')!;
    expect(palette.severity).toBe('major');           // major wins the category
    expect(palette.id).toContain('brand-missing-central-tokens');
    // categories stay unique (rides the existing per-category merge → single repair).
    expect(new Set(issues.map((i) => i.category)).size).toBe(issues.length);
  });
});
