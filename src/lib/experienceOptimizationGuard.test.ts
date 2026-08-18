/**
 * Tests — the EXPERIENCE-INTELLIGENCE GUARD on the deterministic optimization pass.
 *
 * The pass is the SAME single optimizer Quality V2 already owned; these prove the guard
 * (a) never changes behaviour when no contract exists, (b) withholds any finding whose only
 * remedy would damage a higher-order goal, and (c) adds the design's own budgets as further
 * ADVISORY findings that still ride one `minor` performance issue.
 */
import { describe, it, expect } from 'vitest';
import { analyzeOptimization, optimizationToReviewIssues } from '@/lib/webBuildOptimizationPass';
import type { OptimizationGuardPolicy } from '@/lib/experienceIntelligence';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

const f = (path: string, content: string, language: 'tsx' | 'ts' | 'css' = 'tsx'): FrontendGeneratedFile =>
  ({ path, content, language } as FrontendGeneratedFile);

const policy = (over: Partial<OptimizationGuardPolicy> = {}): OptimizationGuardPolicy => ({
  protectedFiles: ['src/sections/Menu.tsx'],
  protectedMediaSlotIds: ['korvix-coverage-hero'],
  leadVisualRequired: true,
  maxSimultaneousAnimations: 1,
  maxAboveFoldMedia: 1,
  maxBlurLayers: 0,
  protectedElements: [
    'the primary call to action and the navigation that reaches it',
    'every required image: it may be resized or lazily loaded, never removed or replaced with a placeholder',
  ],
  ...over,
});

/* An unreferenced component that IS a planned surface, and one that is genuinely dead. */
const UNREFERENCED_PROJECT = [
  f('src/App.tsx', 'export default function App() { return <div>x</div>; }'),
  f('src/sections/Menu.tsx', 'export function Menu() { return <section>menu</section>; }'),
  f('src/components/Orphan.tsx', 'export function Orphan() { return <div>orphan</div>; }'),
];

describe('optimization guard — no policy means no behaviour change', () => {
  it('emits no budget codes and no budget measurements without a policy', () => {
    const report = analyzeOptimization(UNREFERENCED_PROJECT);
    expect(report.findings.every((x) => !['above-fold-media-overweight', 'motion-budget-exceeded', 'excessive-visual-effects'].includes(x.code))).toBe(true);
    expect(report.measured.aboveFoldMediaCount).toBeUndefined();
    expect(report.measured.animatedLayerCount).toBeUndefined();
    expect(report.measured.blurLayerCount).toBeUndefined();
    expect(report.measured.guardSuppressedCount).toBeUndefined();
  });

  it('still reports every planned surface as dead when nothing protects it', () => {
    const report = analyzeOptimization(UNREFERENCED_PROJECT);
    const dead = report.findings.find((x) => x.code === 'unreferenced-component');
    expect(dead?.files).toContain('src/sections/Menu.tsx');
    expect(dead?.files).toContain('src/components/Orphan.tsx');
  });
});

describe('optimization guard — protection', () => {
  it('never proposes deleting a PLANNED surface component, but still reports a genuinely dead file', () => {
    const report = analyzeOptimization(UNREFERENCED_PROJECT, { policy: policy() });
    const dead = report.findings.find((x) => x.code === 'unreferenced-component');
    expect(dead?.files).not.toContain('src/sections/Menu.tsx');
    expect(dead?.files).toContain('src/components/Orphan.tsx');
    expect(report.measured.guardSuppressedCount).toBe(1);
  });

  it('never proposes deferring a REQUIRED lead image, but still lazies an ordinary one', () => {
    const files = [
      f('src/sections/Hero.tsx', '<img src="https://cdn/x.jpg" data-korvix-image-slot="korvix-coverage-hero" alt="a" />'),
      f('src/sections/Gallery.tsx', '<img src="https://cdn/y.jpg" data-korvix-image-slot="korvix-gallery-2" alt="b" />'),
    ];
    const guarded = analyzeOptimization(files, { policy: policy() });
    const eager = guarded.findings.find((x) => x.code === 'eager-offscreen-image');
    expect(eager?.files).toEqual(['src/sections/Gallery.tsx']);
    expect(guarded.measured.eagerOffscreenImageCount).toBe(1);
    expect(guarded.measured.guardSuppressedCount).toBe(1);
    // Without the contract, the same project reports both — the guard is the only difference.
    expect(analyzeOptimization(files).measured.eagerOffscreenImageCount).toBe(2);
  });

  it('an oversized REQUIRED image is still resized — protection is not exemption', () => {
    const files = [f('src/sections/Hero.tsx', '<img src="https://cdn/x.jpg?w=4000" data-korvix-image-slot="korvix-coverage-hero" loading="eager" alt="a" />')];
    const report = analyzeOptimization(files, { policy: policy() });
    const over = report.findings.find((x) => x.code === 'oversized-remote-image');
    expect(over, 'a required image may still be resized').toBeTruthy();
    expect(over?.suggestion).toMatch(/Keep the same image — only the requested dimensions change/);
  });

  it('no suggestion ever tells the repair to remove required media, a CTA or navigation', () => {
    const files = [
      f('src/sections/Hero.tsx', '<img src="https://cdn/x.jpg?w=4000" data-korvix-image-slot="korvix-coverage-hero" alt="a" /><nav><a href="#menu">Menu</a></nav><button>Book a table</button>'),
      f('src/sections/Menu.tsx', 'export function Menu() { return <section>menu</section>; }'),
      f('src/components/Orphan.tsx', 'export function Orphan() { return <div>o</div>; }'),
    ];
    const report = analyzeOptimization(files, { policy: policy() });
    for (const x of report.findings) {
      expect(x.suggestion, x.code).not.toMatch(/remove (the )?(image|photo|cta|call to action|nav|navigation|button)/i);
    }
    const [issue] = optimizationToReviewIssues(report, policy());
    expect(issue.severity).toBe('minor');
    expect(issue.category).toBe('performance');
    // The preservation clause leads, so a long fix list cannot truncate it away.
    expect(issue.repairInstruction.startsWith('Do NOT remove or weaken')).toBe(true);
    expect(issue.repairInstruction).toMatch(/primary call to action/);
  });
});

describe('optimization guard — budgets', () => {
  it('reports first-viewport media only when the planned budget is exceeded', () => {
    const heavy = [f('src/sections/Hero.tsx', '<img src="a"/><img src="b"/><img src="c"/>')];
    const overweight = analyzeOptimization(heavy, { heroComponentPath: 'src/sections/Hero.tsx', policy: policy() });
    const finding = overweight.findings.find((x) => x.code === 'above-fold-media-overweight');
    expect(finding?.evidence).toMatch(/loads 3 media asset\(s\); this experience was planned for at most 1/);
    expect(finding?.suggestion).toMatch(/Do NOT delete a required image/);
    expect(overweight.measured.aboveFoldMediaCount).toBe(3);

    const light = [f('src/sections/Hero.tsx', '<img src="a"/>')];
    expect(analyzeOptimization(light, { heroComponentPath: 'src/sections/Hero.tsx', policy: policy() })
      .findings.some((x) => x.code === 'above-fold-media-overweight')).toBe(false);
  });

  it('skips the first-viewport check entirely when no entry file is known', () => {
    // Guessing "the first component file" would be arbitrary — file order carries no meaning —
    // and a confident-but-wrong "your first viewport is too heavy" is worse than silence.
    const heavy = [f('src/sections/Hero.tsx', '<img src="a"/><img src="b"/><img src="c"/>')];
    const report = analyzeOptimization(heavy, { policy: policy() });
    expect(report.measured.aboveFoldMediaCount).toBeUndefined();
    expect(report.findings.some((x) => x.code === 'above-fold-media-overweight')).toBe(false);
    // Naming the file (a website's hero, or an app's entry screen) turns the check on.
    const named = analyzeOptimization(heavy, { policy: policy({ firstViewportPath: 'src/sections/Hero.tsx' }) });
    expect(named.measured.aboveFoldMediaCount).toBe(3);
    expect(named.findings.some((x) => x.code === 'above-fold-media-overweight')).toBe(true);
  });

  it('counts only LOOPING animations against the motion budget', () => {
    const looping = [f('src/App.tsx', '<div className="animate-pulse" /><div className="animate-spin" />')];
    const report = analyzeOptimization(looping, { policy: policy() });
    expect(report.measured.animatedLayerCount).toBe(2);
    expect(report.findings.some((x) => x.code === 'motion-budget-exceeded')).toBe(true);

    // A finite entrance transition is over before the next one starts — never counted.
    const finite = [f('src/App.tsx', '<div className="transition-opacity duration-300" /><div className="animate-[fadeIn_0.3s_ease-out]" />')];
    const ok = analyzeOptimization(finite, { policy: policy() });
    expect(ok.measured.animatedLayerCount).toBe(0);
    expect(ok.findings.some((x) => x.code === 'motion-budget-exceeded')).toBe(false);
  });

  it('reports blur/effect layers only well past the planned budget (under-reports by design)', () => {
    const few = [f('src/App.tsx', '<div className="backdrop-blur-sm" /><div className="blur-lg" />')];
    expect(analyzeOptimization(few, { policy: policy() }).findings.some((x) => x.code === 'excessive-visual-effects')).toBe(false);
    const many = [f('src/App.tsx', '<div className="backdrop-blur-sm blur-lg drop-shadow-2xl" /><div className="backdrop-blur-xl blur-2xl" />')];
    const report = analyzeOptimization(many, { policy: policy() });
    expect(report.measured.blurLayerCount).toBeGreaterThan(2);
    expect(report.findings.some((x) => x.code === 'excessive-visual-effects')).toBe(true);
  });

  it('budget findings never escalate past a single advisory performance issue', () => {
    const busy = [
      f('src/sections/Hero.tsx', '<img src="a"/><img src="b"/><img src="c"/><div className="animate-pulse animate-spin backdrop-blur-sm blur-lg drop-shadow-2xl backdrop-blur-xl" />'),
    ];
    const report = analyzeOptimization(busy, { heroComponentPath: 'src/sections/Hero.tsx', policy: policy() });
    expect(report.findings.length).toBeGreaterThan(2);
    const issues = optimizationToReviewIssues(report, policy());
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('minor');
    expect(issues[0].repairInstruction.length).toBeLessThanOrEqual(360);
  });

  it('fails open on unusable input', () => {
    expect(analyzeOptimization(undefined, { policy: policy() }).findings).toEqual([]);
    expect(analyzeOptimization([], { policy: policy() }).findings).toEqual([]);
    expect(optimizationToReviewIssues(undefined, policy())).toEqual([]);
  });
});
