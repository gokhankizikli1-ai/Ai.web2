/**
 * Web Build RENDERED VISUAL EVALUATION (PR #516).
 *
 * A post-generation, ADVISORY evaluation of the RENDERED page. It consumes the caller's
 * screenshot metadata + viewport, the existing frontend build artifacts, and the
 * ExperienceArchitecturePlan (when available), and produces a bounded, typed
 * RenderedVisualEvaluationArtifact of quality findings.
 *
 * It does NOT replace validation, makes NO unnecessary model call (the screenshot IMAGE is
 * never sent anywhere — only the caller's measured signals are used, combined with the
 * existing STATIC visual evaluation), is bounded, and FAILS OPEN: on any problem it returns a
 * safe non-blocking artifact (passed=true, no issues) so a build is never blocked.
 *
 * Its HIGH findings are fed into the EXISTING bounded repair via
 * :func:`renderedIssuesToReviewIssues` (mapped to existing review categories) — this creates NO
 * new repair system.
 *
 * Feature flag (governs the pipeline integration; the evaluator itself is a pure function):
 *
 *     VITE_ENABLE_RENDERED_VISUAL_EVAL=false
 */
import { computeVisualEvaluation } from '@/lib/webBuildVisualEvaluation';
import type {
  RenderedVisualInput, RenderedVisualEvaluationArtifact, RenderedVisualIssue,
  RenderedVisualDimension, RenderedVisualSeverity, RenderedScreenshotMeta,
  FrontendBuilderReviewIssue, FrontendBuilderReviewCategory, FrontendBuilderReviewSeverity,
  VisualEvaluationReport,
} from '@/lib/webBuildAgents';

export function isRenderedVisualEvaluationEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_RENDERED_VISUAL_EVAL;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const PASS_THRESHOLD = 70;
const MAX_ISSUES = 24;
const SEVERITY_PENALTY: Record<RenderedVisualSeverity, number> = { high: 18, medium: 9, low: 3 };
const SEVERITY_RANK: Record<RenderedVisualSeverity, number> = { high: 0, medium: 1, low: 2 };

function rIssue(code: string, dimension: RenderedVisualDimension, severity: RenderedVisualSeverity, message: string, suggestion: string): RenderedVisualIssue {
  return { code, dimension, severity, message, suggestion };
}

/** A safe, non-blocking artifact — used on failure and when there is nothing to review. */
function safeArtifact(screenshotReviewed: boolean, runtimeReviewed: boolean): RenderedVisualEvaluationArtifact {
  return { version: 'rendered-visual-eval-v1', score: 100, passed: true, issues: [], screenshotReviewed, runtimeReviewed };
}

/* Map a static VisualEvaluation issue code → a rendered dimension (reuse, no duplication). */
const CODE_TO_DIMENSION: Record<string, RenderedVisualDimension> = {
  'hero-imbalance': 'hero-impact',
  'missing-visual-assets': 'composition',
  'excessive-whitespace': 'spacing',
  'poor-section-rhythm': 'composition',
  'weak-hierarchy': 'typography',
  'cta-placement': 'cta-visibility',
  'repeated-template-pattern': 'template-pattern',
  'generic-gradient-hero': 'template-pattern',
  'mobile-overflow-risk': 'mobile-readiness',
  'mobile-nowrap-risk': 'mobile-readiness',
};

function fromStaticReport(report: VisualEvaluationReport | undefined, seen: Set<string>): RenderedVisualIssue[] {
  if (!report) return [];
  const all = [
    ...report.overallIssues, ...report.layoutIssues, ...report.visualIssues,
    ...report.uxIssues, ...report.mobileIssues,
  ];
  const out: RenderedVisualIssue[] = [];
  for (const i of all) {
    const dimension = CODE_TO_DIMENSION[i.code];
    if (!dimension) continue;
    const key = `${dimension}:${i.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rIssue(i.code, dimension, i.severity, i.message, i.suggestion));
  }
  return out;
}

/* Screenshot-metadata signals (the caller's measurements; the image is never parsed). */
function fromScreenshots(shots: RenderedScreenshotMeta[], seen: Set<string>): RenderedVisualIssue[] {
  const out: RenderedVisualIssue[] = [];
  const add = (i: RenderedVisualIssue) => { const k = `${i.dimension}:${i.code}`; if (!seen.has(k)) { seen.add(k); out.push(i); } };
  for (const shot of shots) {
    const isMobile = shot.viewport === 'mobile';
    if (shot.blank) {
      add(rIssue('rendered-blank', 'composition', 'high',
        `The ${shot.viewport} capture rendered blank/near-empty.`,
        'Ensure the page renders real content at first paint (no blank hero / failed mount).'));
    }
    if (shot.horizontalOverflow) {
      add(rIssue('rendered-horizontal-overflow', 'mobile-readiness', isMobile ? 'high' : 'medium',
        `Horizontal overflow was detected at the ${shot.viewport} viewport.`,
        'Constrain fixed widths and make multi-column layouts responsive so nothing scrolls sideways.'));
    }
    if (typeof shot.whitespaceRatio === 'number') {
      if (shot.whitespaceRatio >= 0.85) {
        add(rIssue('rendered-excessive-whitespace', 'spacing', 'medium',
          `The ${shot.viewport} capture is mostly empty (≈${Math.round(shot.whitespaceRatio * 100)}% background).`,
          'Tighten oversized spacing or add real supporting content so the page does not read as empty.'));
      }
    }
    // A viewport whose content is far taller than the fold with no distinct hero can signal weak
    // hero impact — only flagged when the caller measured content height.
    if (isMobile && typeof shot.contentHeight === 'number' && shot.height > 0 && shot.contentHeight > shot.height * 12) {
      add(rIssue('rendered-endless-scroll', 'composition', 'low',
        'The mobile page is extremely long relative to the viewport.',
        'Consider tightening section count/length so the mobile experience is not an endless scroll.'));
    }
  }
  return out;
}

/**
 * Evaluate the rendered page. Pure + deterministic + fail-open. Never throws. Advisory only —
 * it changes nothing; its findings are surfaced (and, in the pipeline, fed into the existing
 * repair). Returns a safe passing artifact when there is nothing to review or on any error.
 */
export function evaluateRenderedVisual(input: RenderedVisualInput | undefined): RenderedVisualEvaluationArtifact {
  const screenshots = Array.isArray(input?.screenshots) ? input!.screenshots.filter((s) => s && typeof s === 'object') : [];
  const screenshotReviewed = screenshots.length > 0;
  const runtimeReviewed = input?.runtimeCompiled === true;
  try {
    if (!input) return safeArtifact(false, false);
    // Nothing to review at all → safe pass (fail-open).
    if (!screenshotReviewed && (!Array.isArray(input.files) || input.files.length === 0)) {
      return safeArtifact(false, runtimeReviewed);
    }

    const seen = new Set<string>();
    const issues: RenderedVisualIssue[] = [];
    // 1) Screenshot-metadata signals (rendered truth the static pass cannot see).
    issues.push(...fromScreenshots(screenshots, seen));
    // 2) Reuse the EXISTING static visual evaluation over the artifacts (no duplication).
    const staticReport = computeVisualEvaluation(input.files, input.spec);
    issues.push(...fromStaticReport(staticReport, seen));
    // A template-pattern hit is also a visual-uniqueness concern (one derived note, deduped).
    if (issues.some((i) => i.dimension === 'template-pattern') && !seen.has('visual-uniqueness:low-uniqueness')) {
      seen.add('visual-uniqueness:low-uniqueness');
      issues.push(rIssue('low-uniqueness', 'visual-uniqueness', 'low',
        'The composition leans on a generic template pattern, reducing visual uniqueness.',
        'Differentiate the layout so the page reads as bespoke to the business, not a template.'));
    }

    const bounded = issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, MAX_ISSUES);
    let score = 100;
    for (const i of bounded) score -= SEVERITY_PENALTY[i.severity];
    score = Math.max(0, Math.min(100, score));
    const passed = score >= PASS_THRESHOLD && !bounded.some((i) => i.severity === 'high');

    return {
      version: 'rendered-visual-eval-v1',
      score,
      passed,
      issues: bounded,
      screenshotReviewed,
      runtimeReviewed,
    };
  } catch {
    // Fail open — advisory only, never block a build.
    return safeArtifact(screenshotReviewed, runtimeReviewed);
  }
}

/* Map a rendered dimension → an EXISTING review category, so findings ride the existing
 * repair pipeline (mergeDeterministicIssues dedups by category). */
const DIMENSION_TO_CATEGORY: Record<RenderedVisualDimension, FrontendBuilderReviewCategory> = {
  composition: 'layout-rhythm',
  spacing: 'layout-rhythm',
  typography: 'typography',
  'hero-impact': 'visual-hierarchy',
  'cta-visibility': 'visual-hierarchy',
  'template-pattern': 'generic-template',
  'visual-uniqueness': 'generic-template',
  'mobile-readiness': 'responsive-intent',
};

/** Rendered severity → review severity. Advisory findings never escalate to a 'blocker'; a
 *  HIGH rendered issue maps to 'major' (which drives the existing repair), the rest to 'minor'. */
function toReviewSeverity(sev: RenderedVisualSeverity): FrontendBuilderReviewSeverity {
  return sev === 'high' ? 'major' : 'minor';
}

/**
 * Convert a rendered evaluation into review issues for the EXISTING bounded repair. Only issues
 * whose category is not already present will be merged (mergeDeterministicIssues dedups by
 * category), so this never duplicates the model reviewer's own findings.
 */
export function renderedIssuesToReviewIssues(artifact: RenderedVisualEvaluationArtifact | undefined): FrontendBuilderReviewIssue[] {
  if (!artifact || artifact.version !== 'rendered-visual-eval-v1') return [];
  const out: FrontendBuilderReviewIssue[] = [];
  const seenCat = new Set<FrontendBuilderReviewCategory>();
  for (const i of artifact.issues) {
    const category = DIMENSION_TO_CATEGORY[i.dimension];
    if (!category || seenCat.has(category)) continue;
    seenCat.add(category);
    out.push({
      id: `rendered:${i.code}`.slice(0, 80),
      severity: toReviewSeverity(i.severity),
      category,
      files: [],
      evidence: `Rendered visual review: ${i.message}`.slice(0, 240),
      repairInstruction: i.suggestion.slice(0, 240),
    });
  }
  return out;
}
