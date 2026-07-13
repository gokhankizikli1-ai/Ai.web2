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
 * can never pass. Issue file paths are validated against the active project and
 * SANITIZED (Phase 13C): unknown paths on an issue are removed, an issue with no valid
 * path is resolved to a deterministic real file by category (or dropped alone) — one bad
 * path never discards the whole review, and no nonexistent file is ever invented.
 *
 * All cross-module imports are TYPE-ONLY, so there is no runtime import cycle.
 */
import type {
  FrontendBuilderReviewArtifact, FrontendBuilderReviewRawArtifact, FrontendBuilderReviewStage,
  FrontendBuilderReviewVerdict, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendBuilderReviewIssue, FrontendBuilderReviewDimensions, FrontendBuilderValidationArtifact,
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
/* Phase 13C — bounded parser diagnostics for issue-path sanitization. */
const MAX_PARSER_WARNINGS = 6;
const MAX_PARSER_WARNING_CHARS = 180;
/* Phase 13C — a bounded score for the deterministic quality fallback review: clearly
 *  below the pass bar so it always requires the single existing quality repair. */
const DETERMINISTIC_FALLBACK_SCORE = 45;

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
  opts?: { heroComponentPath?: string },
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

    // Phase 13C — TOLERANT issue-file sanitization. One reviewer issue referencing a
    // nonexistent file must no longer discard the entire (otherwise valid) review — that
    // was the confirmed blocker that prevented the single quality repair from running.
    // For each issue: keep only real project paths; if none remain, resolve a deterministic
    // REAL file from the issue category; if that also fails, drop only that one issue.
    const realByNorm = new Map<string, string>();
    for (const f of activeFiles) realByNorm.set(normalizePathForCompare(f.path), f.path);
    const fallbackCtx: FallbackPathContext = {
      stylesPath: realByNorm.get('src/styles.css'),
      appPath: realByNorm.get('src/app.tsx'),
      heroPath: opts?.heroComponentPath ? realByNorm.get(normalizePathForCompare(opts.heroComponentPath)) : undefined,
    };
    let reviewIssuePathsSanitized = 0;
    let reviewIssuesDroppedForInvalidPaths = 0;
    const reviewParserWarnings: string[] = [];
    const pushParserWarning = (msg: string): void => {
      if (reviewParserWarnings.length < MAX_PARSER_WARNINGS) reviewParserWarnings.push(trunc(msg, MAX_PARSER_WARNING_CHARS));
    };

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
      const cat = category as FrontendBuilderReviewCategory;

      // Retain valid real paths, drop unknown ones, dedupe — never invent a file.
      const filesRaw = Array.isArray(issue.files) ? issue.files : [];
      const validPaths: string[] = [];
      const seenReal = new Set<string>();
      let removedAny = false;
      for (const fp of filesRaw.slice(0, MAX_FILES_PER_ISSUE * 3)) {
        if (typeof fp !== 'string' || !fp.trim()) { removedAny = true; continue; }
        const real = realByNorm.get(normalizePathForCompare(fp));
        if (!real) { removedAny = true; continue; }
        if (seenReal.has(real)) continue;
        seenReal.add(real);
        validPaths.push(real);
        if (validPaths.length >= MAX_FILES_PER_ISSUE) break;
      }

      let files: string[];
      if (validPaths.length > 0) {
        files = validPaths;
        if (removedAny || !Array.isArray(issue.files)) {
          reviewIssuePathsSanitized += 1;
          pushParserWarning(`Issue "${id}" (${cat}): removed unknown file path(s); kept ${validPaths.length} valid.`);
        }
      } else {
        // No valid path — resolve one deterministic REAL file from the category.
        const resolved = resolveFallbackPath(cat, fallbackCtx);
        if (resolved) {
          files = [resolved];
          reviewIssuePathsSanitized += 1;
          pushParserWarning(`Issue "${id}" (${cat}): all paths invalid → resolved to ${resolved}.`);
        } else {
          reviewIssuesDroppedForInvalidPaths += 1;
          pushParserWarning(`Issue "${id}" (${cat}): all paths invalid and no real fallback → dropped.`);
          continue;
        }
      }
      const evidence = typeof issue.evidence === 'string' ? trunc(issue.evidence, MAX_EVIDENCE_CHARS) : '';
      const repairInstruction = typeof issue.repairInstruction === 'string'
        ? trunc(issue.repairInstruction, MAX_REPAIR_INSTRUCTION_CHARS) : '';
      issues.push({
        id: trunc(id, MAX_ISSUE_ID_CHARS),
        severity: severity as FrontendBuilderReviewSeverity,
        category: cat,
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
      reviewIssuePathsSanitized: reviewIssuePathsSanitized || undefined,
      reviewIssuesDroppedForInvalidPaths: reviewIssuesDroppedForInvalidPaths || undefined,
      reviewParserWarnings: reviewParserWarnings.length ? reviewParserWarnings : undefined,
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

/* ── Phase 13C — deterministic issue plumbing (pure, bounded, real-paths-only) ──────
 * When a reviewer issue has no valid file path, resolve it to a deterministic REAL
 * project file from its category. Never fabricates a filename — returns undefined when
 * no honest real target exists, and the caller drops that single issue. */
interface FallbackPathContext {
  stylesPath?: string;
  appPath?: string;
  heroPath?: string;
}
function resolveFallbackPath(category: FrontendBuilderReviewCategory, ctx: FallbackPathContext): string | undefined {
  switch (category) {
    case 'typography':
    case 'palette-and-surfaces':
      return ctx.stylesPath || ctx.appPath;
    case 'visual-hierarchy':
      return ctx.heroPath || ctx.appPath;
    default:
      // generic-template, layout-rhythm, concept-*, component-composition, copy-fidelity,
      // contract-fidelity, honesty, maintainability, motion/responsive/accessibility-intent.
      return ctx.appPath;
  }
}

/** Category assigned to each severe deterministic validation warning. */
const SEVERE_WARNING_CATEGORY: Record<string, FrontendBuilderReviewCategory> = {
  'shallow-project': 'generic-template',
  'shallow-section': 'component-composition',
  'minimal-styles': 'palette-and-surfaces',
  'repetitive-section-structure': 'layout-rhythm',
  'internal-copy-leak': 'copy-fidelity',
  'missing-hero-visual-layer': 'visual-hierarchy',
};

/**
 * Convert the static validator's SEVERE quality warnings into bounded, actionable review
 * issues that reference ONLY real project files. Pure, deterministic, non-mutating. These
 * become the repair evidence when the model reviewer is malformed, or are merged into a
 * healthy model review so a severe skeleton cannot be silently approved.
 */
export function synthesizeDeterministicReviewIssues(
  validation: FrontendBuilderValidationArtifact | undefined,
  activeFiles: WebBuildFile[],
): FrontendBuilderReviewIssue[] {
  if (!validation) return [];
  const realByNorm = new Map<string, string>();
  for (const f of activeFiles) realByNorm.set(normalizePathForCompare(f.path), f.path);
  const real = (p: string | undefined): string | undefined => (p ? realByNorm.get(normalizePathForCompare(p)) : undefined);
  const appPath = real('src/App.tsx');
  const stylesPath = real('src/styles.css');
  const shallowPaths = (validation.shallowSectionPaths || []).map(real).filter((x): x is string => !!x);
  const repetitivePaths = (validation.repetitiveSectionPaths || []).map(real).filter((x): x is string => !!x);
  const leakPaths = (validation.internalCopyLeakFiles || []).map(real).filter((x): x is string => !!x);
  const heroReal = real(validation.heroComponentPath) || appPath;

  const out: FrontendBuilderReviewIssue[] = [];
  const add = (
    id: string, severity: FrontendBuilderReviewSeverity, category: FrontendBuilderReviewCategory,
    files: Array<string | undefined>, evidence: string, repairInstruction: string,
  ): void => {
    const realFiles = Array.from(new Set(files.filter((x): x is string => !!x))).slice(0, MAX_FILES_PER_ISSUE);
    if (!realFiles.length) return; // never emit an issue with no real file
    out.push({ id, severity, category, files: realFiles, evidence: trunc(evidence, MAX_EVIDENCE_CHARS), repairInstruction: trunc(repairInstruction, MAX_REPAIR_INSTRUCTION_CHARS) });
  };

  if (validation.shallowProjectDetected) {
    add('det-shallow-project', 'major', SEVERE_WARNING_CATEGORY['shallow-project'],
      [appPath, ...shallowPaths],
      'Deterministic validation: the project is shallow overall (skeleton sections, minimal source).',
      'Expand the existing concept-specific page into meaningful composed sections. Preserve public copy and section order. Do not replace the project with another skeleton.');
  }
  if ((validation.shallowSectionCount ?? 0) > 0 && shallowPaths.length) {
    const severe = shallowPaths.length > 1;
    for (const p of shallowPaths.slice(0, 6)) {
      add(`det-shallow-section:${p}`, severe ? 'major' : 'minor', SEVERE_WARNING_CATEGORY['shallow-section'],
        [p],
        `Deterministic validation: ${p} renders very little content (skeleton section).`,
        'Add meaningful nested layout, supporting content structure, concept-specific visual treatment and responsive composition. Do not add filler.');
    }
  }
  if (validation.minimalStylesDetected && stylesPath) {
    add('det-minimal-styles', 'major', SEVERE_WARNING_CATEGORY['minimal-styles'],
      [stylesPath],
      'Deterministic validation: the project CSS is essentially only the Tailwind directives.',
      'Add a coherent design-token layer, typography, surfaces, spacing rhythm, background treatment and reusable styling beyond Tailwind directives and browser defaults.');
  }
  if (validation.repetitiveSectionStructureDetected && repetitivePaths.length) {
    add('det-repetitive-structure', 'major', SEVERE_WARNING_CATEGORY['repetitive-section-structure'],
      repetitivePaths,
      'Deterministic validation: several sections share one near-identical heading/paragraph/equal-card structure.',
      'Replace repeated heading/paragraph/equal-card composition with concept-appropriate varied section structures.');
  }
  if ((validation.internalCopyLeakCount ?? 0) > 0 && leakPaths.length) {
    add('det-internal-copy-leak', 'major', SEVERE_WARNING_CATEGORY['internal-copy-leak'],
      leakPaths,
      'Deterministic validation: internal planning vocabulary appears in visible source copy.',
      'Remove internal planning language from visible copy and replace it with real audience-facing copy while preserving authoritative public copy.');
  }
  if (validation.missingHeroVisualLayerDetected && heroReal) {
    add('det-missing-hero-visual', 'major', SEVERE_WARNING_CATEGORY['missing-hero-visual-layer'],
      [heroReal],
      'Deterministic validation: the hero renders text with no composed visual layer.',
      'Add a concept-specific visual second layer to the hero using local CSS/SVG/placeholder composition without fake remote imagery.');
  }
  return out.slice(0, MAX_ISSUES);
}

/**
 * Merge deterministic severe issues into an existing (healthy) model review's issues,
 * bounded and de-duplicated: a synthesized issue whose category already appears in the
 * model review is skipped (do not duplicate an equivalent valid model issue). Returns the
 * merged, bounded issue list and how many deterministic issues were actually added.
 */
export function mergeDeterministicIssues(
  modelIssues: FrontendBuilderReviewIssue[],
  deterministicIssues: FrontendBuilderReviewIssue[],
): { issues: FrontendBuilderReviewIssue[]; added: number } {
  const existingCategories = new Set(modelIssues.map((i) => i.category));
  const merged = [...modelIssues];
  let added = 0;
  for (const det of deterministicIssues) {
    if (merged.length >= MAX_ISSUES) break;
    if (existingCategories.has(det.category)) continue;
    merged.push(det);
    existingCategories.add(det.category);
    added += 1;
  }
  return { issues: merged.slice(0, MAX_ISSUES), added };
}

/**
 * Build a DETERMINISTIC quality-fallback review artifact from synthesized severe issues.
 * This is LOCAL code, never a model opinion and never a rendered/browser review. Its
 * status is 'completed' with verdict 'repair' and a bounded sub-pass score so the single
 * existing quality repair runs. It preserves the raw model-review failure reason.
 */
export function buildDeterministicFallbackReview(
  stage: FrontendBuilderReviewStage,
  deterministicIssues: FrontendBuilderReviewIssue[],
  priorModelReview: FrontendBuilderReviewArtifact,
): FrontendBuilderReviewArtifact {
  const issues = deterministicIssues.slice(0, MAX_ISSUES);
  const blockerCount = issues.filter((i) => i.severity === 'blocker').length;
  const majorCount = issues.filter((i) => i.severity === 'major').length;
  const minorCount = issues.filter((i) => i.severity === 'minor').length;
  const priorReason = trunc(priorModelReview.reason || 'the model review did not yield actionable issues', 160);
  return {
    version: 'frontend-review-v1',
    stage,
    status: 'completed',
    reviewKind: 'deterministic-quality-fallback',
    renderedScreenshotReviewed: false,
    runtimeCompilationReviewed: false,
    verdict: 'repair',
    score: DETERMINISTIC_FALLBACK_SCORE,
    strengths: [],
    issues,
    resolvedIssueIds: [],
    blockerCount,
    majorCount,
    minorCount,
    passed: false,
    summary: 'Deterministic quality-fallback review synthesized from severe static validation warnings (not a model opinion, not a rendered visual review).',
    reason: trunc(`Deterministic quality fallback: ${issues.length} severe validation issue(s) require repair (model review unusable: ${priorReason}).`, MAX_REASON_CHARS),
    usedDeterministicFallback: true,
    deterministicIssueCount: issues.length,
    reviewParserWarnings: priorModelReview.reviewParserWarnings,
    mode: 'frontend_builder',
    model: priorModelReview.model,
    provider: priorModelReview.provider,
    requestId: priorModelReview.requestId,
    responseCharCount: priorModelReview.responseCharCount,
  };
}
