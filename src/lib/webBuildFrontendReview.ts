/**
 * Web Build FRONTEND DESIGN-QUALITY REVIEW PARSER (Phase 12E).
 *
 * Parses the raw `frontend-review-v1` JSON returned by the dedicated
 * `frontend_builder` model when it is asked to perform a STATIC design-quality
 * review of an already-validated model-native project (Phase 12D).
 *
 * STATIC ONLY. `parseFrontendBuilderReview` is pure, synchronous, deterministic,
 * non-mutating, network-free, JSON-serializable, bounded and FAILS OPEN (never
 * throws). It performs NO eval, code execution, TS/Babel compilation, DOM/iframe
 * inspection, Sandpack access, worker or dynamic import. A parsed review is a model's
 * opinion about SOURCE + specification — it is NOT proof the project compiles, renders
 * or looks good in a browser. Every artifact it returns records
 * `renderedScreenshotReviewed: false`, `runtimeCompilationReviewed: false`.
 *
 * The `passed` flag is computed INDEPENDENTLY of the model's own `verdict`, so a
 * review that claims "pass" while carrying a blocker/major issue or a sub-82 score
 * can never pass. Issue file paths are validated against the active project — an issue
 * referencing an unknown file makes the whole review a bounded parser failure rather
 * than silently pretending the file exists.
 *
 * All cross-module imports are TYPE-ONLY, so there is no runtime import cycle.
 */
import type {
  FrontendBuilderReviewArtifact, FrontendBuilderReviewRawArtifact, FrontendBuilderReviewStage,
  FrontendBuilderReviewVerdict, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendBuilderReviewIssue, FrontendBuilderReviewDimensions,
} from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/* ── Bounds (safe against untrusted model output) ───────────────────────────── */
const MAX_RAW_REVIEW_CHARS = 30_000;
const MAX_ISSUES = 12;
const MAX_STRENGTHS = 6;
const MAX_RESOLVED_IDS = 12;
const MAX_FILES_PER_ISSUE = 6;
const MAX_EVIDENCE_CHARS = 300;
const MAX_REPAIR_INSTRUCTION_CHARS = 360;
const MAX_SUMMARY_CHARS = 500;
const MAX_REASON_CHARS = 300;
const MAX_ISSUE_ID_CHARS = 80;
const MAX_STRENGTH_CHARS = 240;

/** The independent pass bar. A review may only pass with a genuine 'pass' verdict, a
 *  score of at least 82, and zero blocker/major issues. */
const MIN_PASS_SCORE = 82;

const REVIEW_SEVERITIES: ReadonlySet<FrontendBuilderReviewSeverity> = new Set([
  'blocker', 'major', 'minor',
]);
const REVIEW_CATEGORIES: ReadonlySet<FrontendBuilderReviewCategory> = new Set([
  'concept-fidelity', 'concept-drift', 'generic-template', 'visual-hierarchy',
  'layout-rhythm', 'typography', 'palette-and-surfaces', 'component-composition',
  'motion-and-interaction', 'responsive-intent', 'accessibility-intent',
  'copy-fidelity', 'contract-fidelity', 'honesty', 'maintainability',
]);
const DIMENSION_KEYS: readonly (keyof FrontendBuilderReviewDimensions)[] = [
  'conceptSpecificity', 'visualHierarchy', 'layoutRhythm', 'typography',
  'paletteAndSurfaces', 'componentComposition', 'motionAndInteraction',
  'responsiveIntent', 'accessibilityIntent', 'copyAndContractFidelity',
  'honesty', 'maintainability',
];

const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Normalize a path for COMPARISON only (never persisted). Strips a leading `./`
 *  or `/` and lower-cases, so `src/App.tsx`, `/src/App.tsx` and `./SRC/app.tsx`
 *  compare equal against the active project's paths. */
function normalizePathForCompare(p: string): string {
  return p.trim().replace(/^\.?\//, '').toLowerCase();
}

function isInt0to100(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
}

/** Build a non-passing review artifact for a failed/skipped call or a malformed body.
 *  Never throws; carries the honest phase-boundary flags. */
function nonPassing(
  stage: FrontendBuilderReviewStage,
  status: 'failed' | 'skipped',
  reason: string,
  raw?: FrontendBuilderReviewRawArtifact,
): FrontendBuilderReviewArtifact {
  return {
    version: 'frontend-review-v1',
    stage,
    status,
    reviewKind: 'model-static-design-review',
    renderedScreenshotReviewed: false,
    runtimeCompilationReviewed: false,
    strengths: [],
    issues: [],
    resolvedIssueIds: [],
    blockerCount: 0,
    majorCount: 0,
    minorCount: 0,
    passed: false,
    reason: trunc(reason, MAX_REASON_CHARS),
    mode: 'frontend_builder',
    model: raw?.model,
    provider: raw?.provider,
    requestId: raw?.requestId,
    responseCharCount: raw?.responseCharCount ?? 0,
  };
}

/**
 * Parse + strictly validate a raw reviewer response into a persisted review artifact.
 * Pure, deterministic, non-mutating, fail-open. `activeFiles` is the project the
 * reviewer was shown (Phase 12D active model-native files or the repaired project),
 * used only to reject issues that reference files outside the project.
 */
export function parseFrontendBuilderReview(
  raw: FrontendBuilderReviewRawArtifact,
  stage: FrontendBuilderReviewStage,
  activeFiles: WebBuildFile[],
): FrontendBuilderReviewArtifact {
  try {
    // Prerequisites — no usable body to parse.
    if (!raw || raw.status === 'skipped') {
      return nonPassing(stage, 'skipped', raw?.reason || 'No reviewer response to parse.', raw);
    }
    if (raw.status === 'failed') {
      return nonPassing(stage, 'failed', raw.reason || 'The reviewer call failed.', raw);
    }
    if (raw.stage !== stage) {
      return nonPassing(stage, 'failed', `Reviewer stage mismatch (expected ${stage}, got ${raw.stage}).`, raw);
    }

    const body = typeof raw.rawResponse === 'string' ? raw.rawResponse : '';
    if (!body.trim()) return nonPassing(stage, 'failed', 'Reviewer response is absent or empty.', raw);
    if (body.length > MAX_RAW_REVIEW_CHARS) {
      return nonPassing(stage, 'failed', `Reviewer response (${body.length} chars) exceeds the ${MAX_RAW_REVIEW_CHARS} cap.`, raw);
    }

    // Reject Markdown fences / prose surrounding the JSON — require a single pure object.
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return nonPassing(stage, 'failed', 'Reviewer response is not a single JSON object (fences or prose present).', raw);
    }

    let obj: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return nonPassing(stage, 'failed', 'Reviewer response did not parse to a JSON object.', raw);
      }
      obj = parsed as Record<string, unknown>;
    } catch {
      return nonPassing(stage, 'failed', 'Reviewer response is not valid JSON.', raw);
    }

    // ── Envelope + contract fields ──
    if (obj.version !== 'frontend-review-v1') return nonPassing(stage, 'failed', 'Reviewer response has the wrong version.', raw);
    if (obj.stage !== stage) return nonPassing(stage, 'failed', `Reviewer JSON stage mismatch (expected ${stage}).`, raw);

    const verdict = obj.verdict;
    if (verdict !== 'pass' && verdict !== 'repair') {
      return nonPassing(stage, 'failed', 'Reviewer verdict is not pass|repair.', raw);
    }
    if (!isInt0to100(obj.score)) return nonPassing(stage, 'failed', 'Reviewer score is not an integer 0–100.', raw);
    const score = obj.score;

    // ── All 12 dimensions present as integers 0–100 ──
    const dimsRaw = obj.dimensions;
    if (!dimsRaw || typeof dimsRaw !== 'object' || Array.isArray(dimsRaw)) {
      return nonPassing(stage, 'failed', 'Reviewer dimensions object is missing.', raw);
    }
    const dimsObj = dimsRaw as Record<string, unknown>;
    const dimensions = {} as FrontendBuilderReviewDimensions;
    for (const key of DIMENSION_KEYS) {
      const v = dimsObj[key];
      if (!isInt0to100(v)) return nonPassing(stage, 'failed', `Reviewer dimension "${key}" is missing or out of range.`, raw);
      dimensions[key] = v;
    }

    // ── Issues (bounded; each validated against the active project) ──
    const issuesRaw = obj.issues;
    if (!Array.isArray(issuesRaw)) return nonPassing(stage, 'failed', 'Reviewer issues is not an array.', raw);
    if (issuesRaw.length > MAX_ISSUES) return nonPassing(stage, 'failed', `Reviewer returned more than ${MAX_ISSUES} issues.`, raw);

    const activePathSet = new Set(activeFiles.map((f) => normalizePathForCompare(f.path)));
    const issues: FrontendBuilderReviewIssue[] = [];
    for (const it of issuesRaw) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        return nonPassing(stage, 'failed', 'Reviewer issue is not an object.', raw);
      }
      const issue = it as Record<string, unknown>;
      const id = issue.id;
      if (typeof id !== 'string' || !id.trim() || id.length > MAX_ISSUE_ID_CHARS) {
        return nonPassing(stage, 'failed', 'Reviewer issue id is missing or too long.', raw);
      }
      const severity = issue.severity;
      if (typeof severity !== 'string' || !REVIEW_SEVERITIES.has(severity as FrontendBuilderReviewSeverity)) {
        return nonPassing(stage, 'failed', `Reviewer issue "${id}" has an unknown severity.`, raw);
      }
      const category = issue.category;
      if (typeof category !== 'string' || !REVIEW_CATEGORIES.has(category as FrontendBuilderReviewCategory)) {
        return nonPassing(stage, 'failed', `Reviewer issue "${id}" has an unknown category.`, raw);
      }
      const filesRaw = issue.files;
      if (!Array.isArray(filesRaw) || filesRaw.length === 0 || filesRaw.length > MAX_FILES_PER_ISSUE) {
        return nonPassing(stage, 'failed', `Reviewer issue "${id}" has an invalid files list.`, raw);
      }
      const files: string[] = [];
      for (const fp of filesRaw) {
        if (typeof fp !== 'string' || !fp.trim()) {
          return nonPassing(stage, 'failed', `Reviewer issue "${id}" has a non-string file path.`, raw);
        }
        if (!activePathSet.has(normalizePathForCompare(fp))) {
          // Do not pretend an unknown file exists — a bounded parser failure.
          return nonPassing(stage, 'failed', `Reviewer issue "${id}" references a file outside the project.`, raw);
        }
        files.push(fp);
      }
      const evidence = typeof issue.evidence === 'string' ? trunc(issue.evidence, MAX_EVIDENCE_CHARS) : '';
      const repairInstruction = typeof issue.repairInstruction === 'string'
        ? trunc(issue.repairInstruction, MAX_REPAIR_INSTRUCTION_CHARS) : '';
      issues.push({
        id: trunc(id, MAX_ISSUE_ID_CHARS),
        severity: severity as FrontendBuilderReviewSeverity,
        category: category as FrontendBuilderReviewCategory,
        files,
        evidence,
        repairInstruction,
      });
    }

    // ── Strengths + resolvedIssueIds (bounded) ──
    const strengthsRaw = obj.strengths;
    if (strengthsRaw !== undefined && !Array.isArray(strengthsRaw)) {
      return nonPassing(stage, 'failed', 'Reviewer strengths is not an array.', raw);
    }
    if (Array.isArray(strengthsRaw) && strengthsRaw.length > MAX_STRENGTHS) {
      return nonPassing(stage, 'failed', `Reviewer returned more than ${MAX_STRENGTHS} strengths.`, raw);
    }
    const strengths = Array.isArray(strengthsRaw)
      ? strengthsRaw.filter((s): s is string => typeof s === 'string').map((s) => trunc(s, MAX_STRENGTH_CHARS)).slice(0, MAX_STRENGTHS)
      : [];

    const resolvedRaw = obj.resolvedIssueIds;
    if (resolvedRaw !== undefined && !Array.isArray(resolvedRaw)) {
      return nonPassing(stage, 'failed', 'Reviewer resolvedIssueIds is not an array.', raw);
    }
    if (Array.isArray(resolvedRaw) && resolvedRaw.length > MAX_RESOLVED_IDS) {
      return nonPassing(stage, 'failed', `Reviewer returned more than ${MAX_RESOLVED_IDS} resolvedIssueIds.`, raw);
    }
    const resolvedIssueIds = Array.isArray(resolvedRaw)
      ? resolvedRaw.filter((s): s is string => typeof s === 'string').map((s) => trunc(s, MAX_ISSUE_ID_CHARS)).slice(0, MAX_RESOLVED_IDS)
      : [];

    const summary = typeof obj.summary === 'string' ? trunc(obj.summary, MAX_SUMMARY_CHARS) : undefined;

    // ── Severity counts + INDEPENDENT pass computation ──
    const blockerCount = issues.filter((i) => i.severity === 'blocker').length;
    const majorCount = issues.filter((i) => i.severity === 'major').length;
    const minorCount = issues.filter((i) => i.severity === 'minor').length;
    const passed = verdict === 'pass' && score >= MIN_PASS_SCORE && blockerCount === 0 && majorCount === 0;

    const reason = passed
      ? `Static design review passed (score ${score}); ${minorCount} minor note(s). Rendered visual test still pending.`
      : `Static design review requests changes (verdict ${verdict}, score ${score}, ${blockerCount} blocker / ${majorCount} major / ${minorCount} minor).`;

    return {
      version: 'frontend-review-v1',
      stage,
      status: 'completed',
      reviewKind: 'model-static-design-review',
      renderedScreenshotReviewed: false,
      runtimeCompilationReviewed: false,
      verdict: verdict as FrontendBuilderReviewVerdict,
      score,
      dimensions,
      strengths,
      issues,
      resolvedIssueIds,
      blockerCount,
      majorCount,
      minorCount,
      passed,
      summary,
      reason: trunc(reason, MAX_REASON_CHARS),
      mode: 'frontend_builder',
      model: raw.model,
      provider: raw.provider,
      requestId: raw.requestId,
      responseCharCount: raw.responseCharCount,
    };
  } catch {
    // Absolute fail-open backstop — a parser error never throws into the build.
    return nonPassing(stage, 'failed', 'Internal review-parse error — treated as a non-passing review (fail-open).', raw);
  }
}
