/**
 * Quality V2 — PRODUCTION-READINESS VALIDATION.
 *
 * Every test here corresponds to a claim made about Quality V2 in PR #644. They are written as
 * falsifiable statements about behaviour rather than as coverage, so a future change that breaks
 * a claim fails loudly and names the claim it broke.
 *
 * Sections:
 *   A. rendered severity aggregation across viewports (a defect this validation found)
 *   B. repaired-candidate comparison under mixed outcomes
 *   C. OPTIMIZE budget subordination and safety
 *   D. Safe Preview authority — quality must never reach the safe renderer
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateRenderedVisual, renderedIssuesToReviewIssues } from '@/lib/webBuildRenderedVisualEvaluation';
import { compareRenderedEvaluations, rendersWorseAfterRepair } from '@/lib/webBuildRenderRegression';
import { summarizeCandidate, selectBestCandidate, promotesUnapprovedRepair } from '@/lib/webBuildQualityCandidates';
import { analyzeOptimization, optimizationToReviewIssues } from '@/lib/webBuildOptimizationPass';
import { mergeDeterministicIssues } from '@/lib/webBuildFrontendReview';
import { selectBoundedRepairIssues, MAX_REPAIR_ISSUES } from '@/lib/webBuildApi';
import { deriveModelNativeCandidate, resolvePreviewMode, isModelNativeRuntimeFailure } from '@/lib/webBuildRuntimePreview';
import type {
  RenderedScreenshotMeta, RenderedVisualEvaluationArtifact, RenderedVisualIssue,
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderValidationArtifact,
  WebBuildCandidateSummary,
} from '@/lib/webBuildAgents';

/* ══ A. Rendered severity aggregation ═════════════════════════════════════════════════════════
 * Found by running real fixtures through real Chromium: a page overflowing at EVERY viewport
 * scored BETTER than the same page overflowing on mobile alone, because the per-(dimension,code)
 * dedup was first-wins and viewports are measured desktop-first — so desktop's `medium` overflow
 * suppressed mobile's `high`. Worse defect, better score. */

function shot(viewport: RenderedScreenshotMeta['viewport'], over: Partial<RenderedScreenshotMeta> = {}): RenderedScreenshotMeta {
  return {
    viewport,
    width: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : 1440,
    height: 800, contentHeight: 3000,
    horizontalOverflow: false, whitespaceRatio: 0.2, blank: false, runtimeError: false,
    ...over,
  };
}

const evalOf = (shots: RenderedScreenshotMeta[]) =>
  evaluateRenderedVisual({ screenshots: shots, runtimeCompiled: true, files: [] });

describe('A. rendered severity is the WORST observed across viewports', () => {
  it('keeps mobile severity when desktop reports the same defect more mildly', () => {
    const all = evalOf([
      shot('desktop', { horizontalOverflow: true }),
      shot('tablet', { horizontalOverflow: true }),
      shot('mobile', { horizontalOverflow: true }),
    ]);
    const issue = all.issues.find((i) => i.code === 'rendered-horizontal-overflow')!;
    expect(issue.severity).toBe('high');
    expect(all.passed).toBe(false);
  });

  it('never scores a broader defect better than a narrower one', () => {
    const everywhere = evalOf([
      shot('desktop', { horizontalOverflow: true }),
      shot('tablet', { horizontalOverflow: true }),
      shot('mobile', { horizontalOverflow: true }),
    ]);
    const mobileOnly = evalOf([shot('desktop'), shot('tablet'), shot('mobile', { horizontalOverflow: true })]);
    const desktopOnly = evalOf([shot('desktop', { horizontalOverflow: true }), shot('tablet'), shot('mobile')]);
    // Monotonic: overflowing everywhere is never better than overflowing on mobile alone.
    expect(everywhere.score).toBeLessThanOrEqual(mobileOnly.score);
    // Desktop-only remains the mild case.
    expect(desktopOnly.score).toBeGreaterThan(mobileOnly.score);
    expect(desktopOnly.passed).toBe(true);
  });

  it('still emits only ONE issue per defect, not one per viewport', () => {
    const all = evalOf([
      shot('desktop', { horizontalOverflow: true }),
      shot('tablet', { horizontalOverflow: true }),
      shot('mobile', { horizontalOverflow: true }),
    ]);
    expect(all.issues.filter((i) => i.code === 'rendered-horizontal-overflow')).toHaveLength(1);
  });

  it('promotes a mobile overflow to a MAJOR repair obligation, not a minor note', () => {
    const all = evalOf([shot('desktop', { horizontalOverflow: true }), shot('mobile', { horizontalOverflow: true })]);
    const issues = renderedIssuesToReviewIssues(all);
    expect(issues.find((i) => i.category === 'responsive-intent')?.severity).toBe('major');
  });
});

/* ══ B. Repaired-candidate comparison ════════════════════════════════════════════════════════ */

const VALID = {
  status: 'valid', readyForConsumption: true, files: [{ path: 'src/App.tsx' }], fileCount: 6, totalCharCount: 9000,
} as unknown as FrontendBuilderValidationArtifact;

function candidate(
  label: 'initial' | 'repaired',
  o: { blocking?: Record<string, boolean>; severe?: string[]; renderedHigh?: number; score?: number; runtimeFailure?: boolean } = {},
): WebBuildCandidateSummary {
  return summarizeCandidate({
    label, validation: VALID,
    blocking: o.blocking ?? {},
    severeWarningCodes: o.severe ?? [],
    renderedHighFindingCount: o.renderedHigh ?? 0,
    runtimeFailure: o.runtimeFailure ?? false,
    reviewScore: o.score ?? 70,
  });
}

const BASE = {
  strictGateAccepted: false, obligationRegressionRejects: false,
  renderRegressed: false, preservationPassed: true,
};

describe('B. a repair is judged on the whole picture, not on one axis', () => {
  it('RETAINS a repair that fixes several severe findings while leaving a MINOR one behind', () => {
    // The repair resolved three blocking dimensions and two severe rendered defects. It did not
    // reach a clean bill of health (one blocking dimension remains), so the strict gate rejects
    // it — but it is unambiguously the better artifact and must be what the user receives.
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', {
        blocking: { content: true, composition: true, visualSystem: true, visual: true },
        severe: ['shallow-project', 'minimal-styles'], renderedHigh: 3, score: 55,
      }),
      repaired: candidate('repaired', {
        blocking: { visual: true },                 // one leftover, unchanged from before
        severe: [], renderedHigh: 1, score: 78,
      }),
    });
    expect(sel.winner).toBe('repaired');
    expect(sel.reason).toBe('repaired-strictly-better');
    expect(sel.regressedDimensions).toEqual([]);
    expect(promotesUnapprovedRepair(sel)).toBe(true);
  });

  it('REJECTS a repair that fixes minor issues but introduces a SEVERE rendered regression', () => {
    const before = evalOf([shot('desktop'), shot('mobile')]);
    const after = evalOf([shot('desktop', { horizontalOverflow: true }), shot('mobile', { horizontalOverflow: true })]);
    const regression = compareRenderedEvaluations(before, after);
    expect(rendersWorseAfterRepair(regression)).toBe(true);

    const sel = selectBestCandidate({
      ...BASE,
      renderRegressed: true,
      initial: candidate('initial', { severe: ['shallow-section×1'], renderedHigh: 0, score: 70 }),
      repaired: candidate('repaired', { severe: [], renderedHigh: 1, score: 88 }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-render');
    expect(promotesUnapprovedRepair(sel)).toBe(false);
  });

  it('NEVER lets a repair that breaks the runtime win, however much else it fixed', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', {
        blocking: { content: true, composition: true, visualSystem: true },
        severe: ['shallow-project'], renderedHigh: 2, score: 40,
      }),
      repaired: candidate('repaired', {
        blocking: {}, severe: [], renderedHigh: 0, score: 99, runtimeFailure: true,
      }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-render');
  });

  it('NEVER lets a runtime-broken repair win even when the comparison also flags the regression', () => {
    const before = evalOf([shot('desktop'), shot('mobile')]);
    const after = evalOf([shot('desktop', { runtimeError: true }), shot('mobile', { runtimeError: true })]);
    const regression = compareRenderedEvaluations(before, after);
    expect(regression.newRuntimeFailure).toBe(true);

    const sel = selectBestCandidate({
      ...BASE,
      renderRegressed: true,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: {}, runtimeFailure: true, score: 100 }),
    });
    expect(sel.winner).toBe('initial');
  });
});

/* ══ C. OPTIMIZE subordination and safety ════════════════════════════════════════════════════ */

function gf(path: string, content: string): FrontendGeneratedFile {
  return { path, content, language: path.endsWith('.css') ? 'css' : 'tsx', lineCount: content.split('\n').length, charCount: content.length } as FrontendGeneratedFile;
}

/** A project with genuine, measurable waste of several kinds. */
const WASTEFUL = [
  gf('src/components/Gallery.tsx', `import { useEffect, useState, useMemo, useCallback } from 'react';
export default function Gallery() {
  const [n, setN] = useState(0);
  useEffect(() => { setN(1); });
  return <section><img src="https://x.example/a.jpg?w=3200" alt="a" /></section>;
}`),
  gf('src/styles.css', '.a { display:flex; align-items:center; justify-content:space-between; padding:1rem 2rem; }\n.b { display:flex; align-items:center; justify-content:space-between; padding:1rem 2rem; }\n.c { display:flex; align-items:center; justify-content:space-between; padding:1rem 2rem; }'),
];

function blocker(id: string): FrontendBuilderReviewIssue {
  return { id, severity: 'blocker', category: 'contract-fidelity', files: [], evidence: id, repairInstruction: id };
}
function major(id: string, category: FrontendBuilderReviewIssue['category'] = 'component-composition'): FrontendBuilderReviewIssue {
  return { id, severity: 'major', category, files: [], evidence: id, repairInstruction: id, gateCritical: true };
}

describe('C. OPTIMIZE uses only leftover budget and can never outrank real work', () => {
  it('measures concrete deterministic signals, and reports the measurement', () => {
    const r = analyzeOptimization(WASTEFUL);
    const codes = r.findings.map((f) => f.code).sort();
    expect(codes).toContain('oversized-remote-image');
    expect(codes).toContain('unbounded-effect');
    expect(codes).toContain('dead-import');
    expect(codes).toContain('duplicate-css-rule');
    // Every number is measured from the files, not estimated.
    expect(r.measured.deadImportCount).toBeGreaterThan(0);
    expect(r.measured.duplicateCssCharCount).toBeGreaterThan(0);
    expect(r.measured.unboundedEffectCount).toBe(1);
    expect(r.measured.oversizedImageCount).toBe(1);
  });

  it('is DROPPED before reaching the repair when the budget is full of real obligations', () => {
    // There are TWO budgets, and the one that matters is the second: the review may CARRY up to
    // 12 merged issues, but only 8 priority-ordered issues are ever SENT to the repair. So with a
    // full slate of blockers the optimization note survives the merge and is then dropped by the
    // selection — it never reaches the model, and it never costs a real obligation its slot.
    const full = Array.from({ length: MAX_REPAIR_ISSUES }, (_, i) => blocker(`b${i}`));
    const optIssues = optimizationToReviewIssues(analyzeOptimization(WASTEFUL));
    const { issues } = mergeDeterministicIssues(full, optIssues);
    const sent = selectBoundedRepairIssues(issues);
    expect(sent).toHaveLength(MAX_REPAIR_ISSUES);
    expect(sent.some((i) => i.category === 'performance')).toBe(false);
    expect(sent.filter((i) => i.severity === 'blocker')).toHaveLength(MAX_REPAIR_ISSUES);
  });

  it('can never displace an unresolved P0–P5 obligation from the repair selection', () => {
    // A budget-filling set of blockers and gate-critical majors, plus optimization advice.
    const real = [
      ...Array.from({ length: 4 }, (_, i) => blocker(`blk${i}`)),
      ...Array.from({ length: 4 }, (_, i) => major(`maj${i}`)),
    ];
    const optIssues = optimizationToReviewIssues(analyzeOptimization(WASTEFUL));
    const { issues } = mergeDeterministicIssues(real, optIssues);
    const selected = selectBoundedRepairIssues(issues);
    // Every blocker and every gate-critical major survives; optimization does not appear.
    expect(selected.filter((i) => i.severity === 'blocker')).toHaveLength(4);
    expect(selected.filter((i) => i.severity === 'major')).toHaveLength(4);
    expect(selected.some((i) => i.category === 'performance')).toBe(false);
  });

  it('sorts LAST when it does fit, so it is the first thing dropped under pressure', () => {
    const few = [blocker('b0'), major('m0')];
    const optIssues = optimizationToReviewIssues(analyzeOptimization(WASTEFUL));
    const { issues, added } = mergeDeterministicIssues(few, optIssues);
    expect(added).toBe(1);                                   // it fits — budget had room
    const selected = selectBoundedRepairIssues(issues);
    expect(selected[selected.length - 1].category).toBe('performance');
  });

  it('emits ONE advisory issue, so it consumes exactly one slot and never blocks acceptance', () => {
    const optIssues = optimizationToReviewIssues(analyzeOptimization(WASTEFUL));
    expect(optIssues).toHaveLength(1);
    expect(optIssues[0].severity).toBe('minor');
    expect(optIssues[0].gateCritical).toBeUndefined();
  });

  it('adds NO model call — it is a pure function of the files', () => {
    // Determinism is the observable proxy for "no IO": identical input, identical output, and no
    // async surface at all. A function that called a provider could satisfy neither.
    const a = analyzeOptimization(WASTEFUL);
    const b = analyzeOptimization(WASTEFUL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(analyzeOptimization(WASTEFUL)).not.toBeInstanceOf(Promise);
  });

  it('keeps the pre-optimization candidate when analysis fails', () => {
    // A malformed project must yield an empty report rather than throwing, so the caller's
    // existing candidate is untouched.
    const broken = [{ path: 'src/A.tsx' }] as unknown as FrontendGeneratedFile[];
    expect(() => analyzeOptimization(broken)).not.toThrow();
    expect(analyzeOptimization(broken).findings).toEqual([]);
    expect(optimizationToReviewIssues(analyzeOptimization(broken))).toEqual([]);
  });

  it('never rewrites source, and never touches user-uploaded image content', () => {
    const before = JSON.stringify(WASTEFUL);
    const report = analyzeOptimization(WASTEFUL);
    // The analyzer is read-only: the input files are byte-identical afterwards.
    expect(JSON.stringify(WASTEFUL)).toBe(before);
    // It only ever reports an image's REQUESTED dimensions; it never proposes a different asset.
    const img = report.findings.find((f) => f.code === 'oversized-remote-image')!;
    expect(img.suggestion).toContain('Keep the same image');
    expect(img.suggestion).not.toMatch(/replace|swap|different image/i);
  });

  it('instructs the repair not to redesign the site', () => {
    const [issue] = optimizationToReviewIssues(analyzeOptimization(WASTEFUL));
    expect(issue.repairInstruction).toMatch(/without changing the design, layout, copy or any requested visual effect/i);
  });

  it('cannot be delivered if it lowered rendered quality', () => {
    // An "optimized" candidate that renders worse is rejected by the same rendered gate as any
    // other repair — optimization gets no exemption.
    const before = evalOf([shot('desktop'), shot('mobile')]);
    const after = evalOf([shot('desktop'), shot('mobile', { horizontalOverflow: true })]);
    expect(rendersWorseAfterRepair(compareRenderedEvaluations(before, after))).toBe(true);
    const sel = selectBestCandidate({
      ...BASE, renderRegressed: true,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: {} }),
    });
    expect(sel.winner).toBe('initial');
  });
});

/* ══ D. Safe Preview authority ═══════════════════════════════════════════════════════════════
 * The load-bearing invariant: QUALITY MUST NOT CONTROL SAFE PREVIEW. */

function step(o: {
  consumption?: string; validation?: 'valid' | 'invalid'; acceptance?: string;
}) {
  return {
    id: 'run1',
    files: [],
    artifacts: {
      frontendBuilderConsumption: { status: o.consumption ?? 'model-native' },
      frontendBuilderValidation: { status: o.validation ?? 'valid', readyForConsumption: o.validation !== 'invalid' },
      ...(o.acceptance ? { frontendBuilderAcceptance: { status: o.acceptance } } : {}),
    },
  } as never;
}

const entryFiles = () => ([
  { path: 'src/main.tsx', content: 'x', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/App.tsx', content: 'x', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/styles.css', content: 'x', language: 'css', status: 'unchanged', added: 0, removed: 0 },
] as never);

describe('D. quality never controls Safe Preview', () => {
  it('a LOW-QUALITY but renderable model-native project still renders model-native', () => {
    const c = deriveModelNativeCandidate(step({ acceptance: 'manual-review-required' }), entryFiles());
    expect(c.safeToRenderModelNativePreview).toBe(true);
    expect(c.approvedForUserPreview).toBe(false);            // honest: not approved
    expect(resolvePreviewMode(c, false, undefined)).toBe('provisional-model-native');
  });

  it('a REJECTED repair with a healthy previous candidate still renders that model-native candidate', () => {
    // This is the state the pipeline leaves behind when the strict gate rejects and nothing is
    // promoted: acceptance manual-review-required over the initial model-native project.
    const c = deriveModelNativeCandidate(step({ acceptance: 'manual-review-required' }), entryFiles());
    expect(resolvePreviewMode(c, false, undefined)).not.toBe('safe-fallback');
  });

  it('a PROMOTED best candidate also renders model-native, and still as provisional', () => {
    // Promotion swaps the files but leaves the status at manual-review-required.
    const c = deriveModelNativeCandidate(step({ acceptance: 'manual-review-required' }), entryFiles());
    expect(resolvePreviewMode(c, false, undefined)).toBe('provisional-model-native');
    expect(c.approvedForUserPreview).toBe(false);
  });

  it('a STRUCTURAL failure does fall back to Safe', () => {
    const c = deriveModelNativeCandidate(step({ validation: 'invalid', acceptance: 'manual-review-required' }), entryFiles());
    expect(c.safeToRenderModelNativePreview).toBe(false);
    expect(resolvePreviewMode(c, false, undefined)).toBe('safe-fallback');
  });

  it('a CONFIRMED runtime failure is a render failure; a SLOW START is not', () => {
    expect(isModelNativeRuntimeFailure('error')).toBe(true);
    expect(isModelNativeRuntimeFailure('timeout')).toBe(true);
    // A healthy-but-cold sandbox must never be demoted for being slow.
    expect(isModelNativeRuntimeFailure('slow-start')).toBe(false);
    expect(isModelNativeRuntimeFailure('initializing')).toBe(false);
    expect(isModelNativeRuntimeFailure('running')).toBe(false);
  });

  it('a failing rendered evaluation does NOT make a project non-render-safe', () => {
    // The strongest form of the invariant: the rendered evaluator can report a catastrophic
    // score, and render authority is entirely unaffected because it reads validation, not quality.
    const terrible: RenderedVisualEvaluationArtifact = evalOf([
      shot('desktop', { horizontalOverflow: true, whitespaceRatio: 0.95 }),
      shot('mobile', { horizontalOverflow: true, whitespaceRatio: 0.95 }),
    ]);
    expect(terrible.passed).toBe(false);
    expect(terrible.issues.some((i) => i.severity === 'high')).toBe(true);
    const c = deriveModelNativeCandidate(step({ acceptance: 'manual-review-required' }), entryFiles());
    expect(c.safeToRenderModelNativePreview).toBe(true);
    expect(resolvePreviewMode(c, false, undefined)).toBe('provisional-model-native');
  });

  it('rendered issues carry no authority to demote — they are advisory review input only', () => {
    const bad = evalOf([shot('mobile', { horizontalOverflow: true, blank: true })]);
    const issues = renderedIssuesToReviewIssues(bad);
    // Advisory findings never escalate to 'blocker', which is what a demotion would require.
    expect(issues.every((i: FrontendBuilderReviewIssue) => i.severity !== 'blocker')).toBe(true);
    expect((bad.issues as RenderedVisualIssue[]).length).toBeGreaterThan(0);
  });
});

/* ══ E. Entry-point parity ═══════════════════════════════════════════════════════════════════
 * The original defect this guards: WebsiteBuilder passed the measurement + vision producers and
 * ChatWebBuild did not, so the SAME prompt received materially weaker verification depending on
 * which surface the user happened to start from. The drift was invisible because both call sites
 * type-check fine — every producer option is optional. This asserts on the source so the two
 * fresh-build call sites cannot silently diverge again. */
describe('E. both Web Build entry points request the same verification', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('ChatWebBuild and WebsiteBuilder both wire measurement, vision and owner eligibility', () => {
    const chat = read('src/components/ChatWebBuild.tsx');
    const site = read('src/pages/WebsiteBuilder.tsx');
    for (const [name, src] of [['ChatWebBuild', chat], ['WebsiteBuilder', site]] as const) {
      expect(src, `${name} must build a measurement run id`).toMatch(/measurementRunId/);
      expect(src, `${name} must pass renderedVisualProducer`).toMatch(/createMeasurementProducer\(measurementRunId\)/);
      expect(src, `${name} must pass visionReviewProducer`).toMatch(/createVisionReviewProducer\(measurementRunId\)/);
      expect(src, `${name} must pass ownerEligible`).toMatch(/ownerEligible:\s*ownerEligibleRef\.current/);
    }
  });

  it('binds both producers to ONE run identity per build, so a stale preview cannot leak across', () => {
    for (const p of ['src/components/ChatWebBuild.tsx', 'src/pages/WebsiteBuilder.tsx']) {
      const src = read(p);
      // Exactly one run id is minted per fresh build, and both producers receive that same id.
      expect((src.match(/const measurementRunId =/g) || []).length, p).toBe(1);
    }
  });
});
