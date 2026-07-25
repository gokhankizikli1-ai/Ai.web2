/**
 * Web Build RENDERED VISION REVIEW — deterministic foundation (PR #519, Part B).
 *
 * This is the flag-gated, testable FOUNDATION for a CONDITIONAL single-desktop-screenshot vision
 * review: the conditional TRIGGER (decide when a vision call is worth it), the response
 * SANITIZER (validate/bound an untrusted provider JSON into a typed `RenderedVisionReview`), and
 * the vision→repair ADAPTER (major/blocker findings enter the EXISTING single bounded repair).
 *
 * It creates NO evaluator pipeline and NO repair loop — major/blocker findings ride the existing
 * `mergeDeterministicIssues` path. The live screenshot capture + backend vision call are wired in
 * the follow-up; this module is what they plug into. All fail-open.
 *
 * Feature flag (default OFF → no vision review, unchanged behaviour):
 *     VITE_ENABLE_RENDERED_VISION_REVIEW=false
 */
import type {
  FrontendBuilderValidationArtifact, ExperienceArchitecturePlan, RenderedVisionReview,
  VisionReviewIssue, VisionReviewSeverity, RenderedVisualEvaluationArtifact,
  FrontendBuilderReviewIssue, FrontendBuilderReviewCategory, FrontendBuilderReviewSeverity,
} from '@/lib/webBuildAgents';

export function isRenderedVisionReviewEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_RENDERED_VISION_REVIEW;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/* ── Conditional trigger ──────────────────────────────────────────────────────*/
export interface VisionReviewEvidence {
  validation?: FrontendBuilderValidationArtifact;
  plan?: ExperienceArchitecturePlan;
  renderedEvaluation?: RenderedVisualEvaluationArtifact;
  /** Owner/debug force-review escape hatch. */
  forceOwner?: boolean;
}

/**
 * Decide whether a screenshot vision review is worth one model call. Vision runs ONLY when the
 * flag is on AND the build is structurally valid AND at least one signal indicates review is
 * valuable. Clean minimal / typography-first / no-marketing app builds do NOT trigger. Pure.
 */
export function shouldRunVisionReview(ev: VisionReviewEvidence): boolean {
  try {
    if (!isRenderedVisionReviewEnabled()) return false;
    const { validation, plan } = ev;
    // Never review a structurally-failing build (repair the structure first).
    if (!validation || validation.status !== 'valid' || validation.readyForConsumption !== true) return false;
    if (ev.forceOwner === true) return true;

    // Intentionally minimal / typography-first / app-first-with-no-marketing → not worth vision.
    const minimal = plan?.textDensity === 'low' || plan?.layoutStrategy?.contentDensity === 'minimal'
      || plan?.signature?.interactionPattern === 'minimal_static';
    const productUiRequired = plan?.primaryVisualMedium === 'product_ui' || plan?.primaryVisualMedium === 'interactive_demo'
      || (plan?.sectionContracts || []).some((c) => c.visualMedium === 'product_ui' || c.visualMedium === 'interactive_demo');

    const sem = validation.semanticContent;
    const vis = validation.visualEvaluation;
    const exp = validation.experienceCompliance;
    const rendered = ev.renderedEvaluation;

    const templateWarning = !!sem?.genericPatternDetected
      || !!vis && [...vis.overallIssues, ...vis.layoutIssues].some((i) => i.code === 'repeated-template-pattern' || i.code === 'generic-gradient-hero');
    const proofWeak = !!sem && sem.proofCoverage !== 'strong';
    const decorativeProof = !!sem && sem.sectionFindings.some((f) => f.issueType === 'decorative-proof' || f.issueType === 'missing-business-proof');
    const renderedMajor = !!rendered && rendered.issues.some((i) => i.severity === 'high');
    const experienceConflict = !!exp && exp.compliant === false;

    const anySignal = templateWarning || proofWeak || decorativeProof || renderedMajor || experienceConflict || productUiRequired;
    if (!anySignal) return false;
    // A clean minimal build with only a "weak proof" hint (expected for minimal) is not worth it.
    if (minimal && !templateWarning && !decorativeProof && !renderedMajor && !experienceConflict) return false;
    return true;
  } catch {
    return false;
  }
}

/* ── Response sanitizer ───────────────────────────────────────────────────────*/
const MAX_TEXT = 400;
const MAX_ISSUES = 20;
const MAX_SIGNALS = 12;
const SEVERITIES: ReadonlySet<string> = new Set<VisionReviewSeverity>(['minor', 'major', 'blocker']);
const str = (v: unknown, n = MAX_TEXT): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

function sanitizeIssue(raw: unknown): VisionReviewIssue | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const severity = (typeof r.severity === 'string' && SEVERITIES.has(r.severity) ? r.severity : 'minor') as VisionReviewSeverity;
  const message = str(r.message);
  const repairInstruction = str(r.repairInstruction);
  if (!message && !repairInstruction) return null;
  return {
    code: str(r.code, 60) || 'vision-issue',
    area: str(r.area, 60) || 'composition',
    severity,
    message,
    repairInstruction,
  };
}

/**
 * Validate + bound an untrusted provider JSON into a typed `RenderedVisionReview`. Returns
 * `undefined` for a malformed/empty payload (fail-open). Never throws.
 *
 * The FINAL verdict is NORMALIZED from the (bounded) issues so the review is always internally
 * consistent — the provider's self-reported verdict is used only as a validity gate, never
 * trusted directly:
 *   - any major/blocker issue  → `needs-repair`  (a "pass" can never hide a real defect)
 *   - zero actionable issues   → `pass`          (minor-only findings stay advisory)
 * This guarantees "pass" never coexists with a major/blocker, and a "needs-repair" without an
 * actionable finding is normalized back to "pass" (fail-open — never force an empty repair).
 */
export function sanitizeVisionReview(raw: unknown): RenderedVisionReview | undefined {
  try {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    // Validity gate only: a payload with no recognizable verdict is malformed → fail-open.
    const rawVerdict = r.verdict === 'needs-repair' ? 'needs-repair' : r.verdict === 'pass' ? 'pass' : null;
    if (!rawVerdict) return undefined;
    const scoreNum = typeof r.score === 'number' && Number.isFinite(r.score) ? Math.max(0, Math.min(100, r.score)) : 0;
    const issues = Array.isArray(r.issues)
      ? r.issues.map(sanitizeIssue).filter((i): i is VisionReviewIssue => !!i).slice(0, MAX_ISSUES) : [];
    const signals = Array.isArray(r.templateSimilaritySignals)
      ? r.templateSimilaritySignals.map((x) => str(x, 80)).filter(Boolean).slice(0, MAX_SIGNALS) : [];
    // Normalize the verdict from the actual issues (see doc-comment) — never from the provider's
    // self-report. An actionable finding is a major/blocker; minor findings are advisory only.
    const hasActionable = issues.some((i) => i.severity === 'major' || i.severity === 'blocker');
    const verdict: 'pass' | 'needs-repair' = hasActionable ? 'needs-repair' : 'pass';
    return {
      version: 'rendered-vision-review-v1',
      verdict,
      score: scoreNum,
      issues,
      templateSimilaritySignals: signals,
      proofAssessment: str(r.proofAssessment),
      hierarchyAssessment: str(r.hierarchyAssessment),
      compositionAssessment: str(r.compositionAssessment),
    };
  } catch {
    return undefined;
  }
}

/* ── Vision → repair adapter ──────────────────────────────────────────────────*/
function categoryFor(area: string, code: string): FrontendBuilderReviewCategory {
  const t = `${area} ${code}`.toLowerCase();
  if (/template|generic|saas/.test(t)) return 'generic-template';
  if (/proof|evidence|contract/.test(t)) return 'contract-fidelity';
  if (/hierarch/.test(t)) return 'visual-hierarchy';
  if (/typograph/.test(t)) return 'typography';
  if (/colou?r|palette|style/.test(t)) return 'palette-and-surfaces';
  if (/composition|layout|balance|rhythm/.test(t)) return 'layout-rhythm';
  return 'concept-fidelity';
}
/** How many distinct observations/instructions per category ride into the repair — a small
 *  bound so a category with many findings informs the repair without flooding the prompt. */
const MAX_FINDINGS_PER_CATEGORY = 3;
const dedupe = (xs: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = x.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
};

/**
 * Convert a vision review's MAJOR/BLOCKER findings → review issues for the EXISTING bounded
 * repair. MINOR findings are intentionally excluded so they never force a repair (advisory).
 *
 * Findings are GROUPED by review category and each group becomes ONE bounded merged issue: the
 * earlier per-category dedup silently dropped every distinct finding after the first, so a
 * category with several genuine defects lost all but one. The merged issue preserves up to
 * `MAX_FINDINGS_PER_CATEGORY` distinct observations + their targeted repair instructions (and
 * escalates to `blocker` when any finding in the group is a blocker), so no distinct major
 * finding is discarded, yet the repair prompt is not flooded. The caller adds the preservation
 * instruction the repair prompt already includes.
 */
export function visionReviewToReviewIssues(review: RenderedVisionReview | undefined): FrontendBuilderReviewIssue[] {
  if (!review || review.version !== 'rendered-vision-review-v1') return [];
  // Preserve first-seen category order; collect every actionable finding per category.
  const groups = new Map<FrontendBuilderReviewCategory, VisionReviewIssue[]>();
  for (const i of review.issues) {
    if (i.severity === 'minor') continue;                       // minor never forces repair
    const category = categoryFor(i.area, i.code);
    const bucket = groups.get(category);
    if (bucket) bucket.push(i);
    else groups.set(category, [i]);
  }
  const out: FrontendBuilderReviewIssue[] = [];
  for (const [category, findings] of groups) {
    const top = findings.slice(0, MAX_FINDINGS_PER_CATEGORY);
    const severity: FrontendBuilderReviewSeverity = top.some((f) => f.severity === 'blocker') ? 'blocker' : 'major';
    const observations = dedupe(top.map((f) => f.message));
    const repairs = dedupe(top.map((f) => f.repairInstruction));
    out.push({
      id: `vision:${category}`.slice(0, 80),
      severity,
      category,
      files: [],
      evidence: `Rendered vision review: ${observations.join(' | ')}`.slice(0, 400),
      repairInstruction: repairs.join(' ').slice(0, 400),
    });
  }
  return out;
}
