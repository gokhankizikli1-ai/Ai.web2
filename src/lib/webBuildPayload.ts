/**
 * The structured Web Build package persisted onto a Project and rendered by
 * the Claude/Kimi-style build conversation. Everything is derived
 * deterministically from a WebBuildResult so what we show always matches the
 * real build data — we never claim files/sections that aren't in the reply.
 */
import type { BuildSection } from '@/lib/gameBuilderApi';
import { extractBrief, type WebBuildResult, type WebBuildBrief, type WebBuildSource, type WebBuildResearch, type WebBuildParseDiagnostics } from '@/lib/webBuildApi';
import { resolveBuildFiles, parseSectionCopy, synthesizeFromCopies, type SynthFile, type SectionCopy as SynthCopy } from '@/lib/webBuildFiles';
import { inferWebsiteBrief, fallbackSectionItems, checkQuality } from '@/lib/webBuildBrief';
import { deriveLayoutPlan, type WebBuildLayoutPlan } from '@/lib/webBuildLayoutPlan';
import {
  runUpstreamAgents, runLayoutArchitect, runComponentEngineer, runReviewer, runQualityDirector, runAssetDirector, runMotionComposer, runImagePipeline, runFixer, runVerticalIntelligence, WEB_BUILD_AGENTS_ENABLED,
  derivePageArchitectureDecision, deriveVisualSignaturePlan, deriveExperienceBlueprint,
  type WebBuildAgent, type WebBuildArtifacts, type WebBuildEnforcement,
  type FrontendBuildSpecification, type FrontendBuilderRawArtifact,
  type FrontendBuilderValidationArtifact, type FrontendBuilderValidationStatus,
  type FrontendBuilderConsumptionArtifact, type FrontendBuilderQualityPipelineResult,
  type FrontendBuilderContractRepairArtifact,
} from '@/lib/webBuildAgents';
import { deriveAgentSectionArchitecture } from '@/lib/webBuildSectionArchitecture';
import { deriveFrontendBuildSpecification } from '@/lib/webBuildFrontendSpec';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import { detectMessageLanguage, resolveWebsiteOutputLanguage } from '@/lib/locale';
import type { Language } from '@/stores/languageStore';

export type ActivityStatus = 'waiting' | 'running' | 'done' | 'failed';

export interface WebBuildActivityRow {
  id: string;
  /** i18n key for the task label. */
  labelKey: string;
  /** Params for {placeholder} interpolation in the label (e.g. { file }). */
  params?: Record<string, string | number>;
  status: ActivityStatus;
  /** Real, data-tied detail (already resolved to text — may be user-language). */
  detail?: string;
}

export interface WebBuildSectionItem {
  id: string;
  name: string;
  purpose?: string;
  copyPreview?: string;
  component?: string;
  /** Rich copy for the preview (from Generated Copy). */
  headline?: string;
  sub?: string;
  cta?: string;
  bullets?: string[];
}

/** A generated file with a diff status relative to the previous build. */
export interface WebBuildFile {
  path: string;
  content: string;
  language?: string;
  summary?: string;
  status: 'created' | 'modified' | 'unchanged';
  added: number;
  removed: number;
}

/** Structured, real-data summary used to compose the assistant message. */
export interface WebBuildSummary {
  type?: string;
  sectionNames: string[];
  fileCount: number;
  added: number;
  removed: number;
}

/** How much of the build was actually MODEL-planned vs frontend-synthesized —
 *  the honesty gate so a fallback build is never mistaken for a real one. */
export type PlanningQuality = 'model-planned' | 'model-partial' | 'frontend-repaired' | 'frontend-fallback';

/** Real diagnostics about how the final package was assembled (parse + which
 *  frontend fallbacks ran). Optional → old saved builds still load. */
export interface WebBuildPlanningDiagnostics {
  parse?: WebBuildParseDiagnostics;
  usedArchitectureRewrite?: boolean;
  usedQualityFallbackSections?: boolean;
  usedFileSynthesisFallback?: boolean;
  usedSafePayloadFallback?: boolean;
  /** The backend brief carried real Website Experience Plan fields (not inferred). */
  hasModelWebsiteExperiencePlan?: boolean;
  hasStrategyWebsiteExperiencePlan?: boolean;
  hasInteractionContract?: boolean;
  planningQuality: PlanningQuality;
  /** Phase 6D — model-planned Preview but the full Frontend Code contract is
   *  missing/pending (All-Files code parity to follow). Optional → old builds load. */
  codeContractPending?: boolean;
  warnings: string[];
}

/** One build (or revision) turn in the conversation. */
export interface WebBuildStep {
  id: string;
  at: string;
  kind: 'build' | 'revision';
  prompt: string;
  summary: WebBuildSummary;
  files: WebBuildFile[];
  activity: WebBuildActivityRow[];
  reply: string;
  /** Honest research status for THIS turn (fresh builds only; revisions skip
   *  the research pre-pass on the backend). Drives the feed's research line +
   *  the owner/admin debug panel. Optional → old saved steps still load. */
  research?: WebBuildResearch;
  /** The strategy-derived layout plan for this turn (hero composition, section
   *  variants, visual module, rhythm). Recomputed deterministically from
   *  brief + sections, so it's a record — not the source of truth. Optional →
   *  old saved steps still load. */
  layoutPlan?: WebBuildLayoutPlan;
  /** Phase-1 upstream agents for this turn (Research + UI/Art Director) and
   *  their artifacts. Optional → old saved steps still load. */
  agents?: WebBuildAgent[];
  artifacts?: WebBuildArtifacts;
  /** Planning-quality diagnostics for THIS turn (model-planned vs fallback).
   *  Optional → old saved steps render without a quality row. */
  planningDiagnostics?: WebBuildPlanningDiagnostics;
}

export interface WebBuildPayload {
  source: 'web_build';
  prompt: string;
  /** Strategy brief. Core fields + optional richer strategy from the model's
   *  Build Plan / Design Direction (see WebBuildBrief). All optional → old
   *  saved builds still load. */
  brief: WebBuildBrief;
  sectionItems: WebBuildSectionItem[];
  /** Raw parsed markdown sections (Build Plan, Design Direction, …). */
  sections: BuildSection[];
  /** Latest file set (with diff vs the previous build). */
  files: WebBuildFile[];
  /** Full markdown reply of the latest build — source of truth. */
  reply: string;
  /** Real research sources from the backend web_research pre-pass. Present only
   *  when tools actually ran; optional so old saved builds still load. */
  sources?: WebBuildSource[];
  /** Honest research status for the latest fresh build (mirrors the build
   *  step's research). Optional so old saved builds still load. */
  research?: WebBuildResearch;
  /** The strategy-derived layout plan for the latest build (record; recomputed
   *  deterministically from brief + sections). Optional → old builds still load. */
  layoutPlan?: WebBuildLayoutPlan;
  /** Phase-1 upstream agents (Research + UI/Art Director) for the latest build,
   *  and their artifacts. Optional → old saved builds still load. */
  agents?: WebBuildAgent[];
  artifacts?: WebBuildArtifacts;
  activity: WebBuildActivityRow[];
  /** Planning-quality diagnostics for the latest build. Optional → old builds load. */
  planningDiagnostics?: WebBuildPlanningDiagnostics;
  /** Conversation history — one entry per build/revision. */
  steps: WebBuildStep[];
  createdAt: string;
  updatedAt: string;
}

/* ── Phase 12D consumption helpers (pure; never mutate inputs) ───────────────── */

/** The obsolete planning warnings a successful model-native consumption removes —
 *  they describe the FIRST planning response's missing Frontend Code section, which
 *  the dedicated Frontend Builder has now superseded with the active project. */
const OBSOLETE_CODE_CONTRACT_WARNINGS = new Set<string>([
  'No "Frontend Code" section in the backend reply.',
  'Model-planned Preview — Frontend Code contract missing; All Files uses internal synthesis (code parity pending).',
]);

/** Clear the code-contract-pending flag + drop only the obsolete Frontend-Code
 *  warnings when the model-native project is now the active code. Other warnings and
 *  planning-quality fields are preserved. Never mutates. Old builds (no pd) pass through. */
function clearCodeContractPending(pd: WebBuildPlanningDiagnostics | undefined): WebBuildPlanningDiagnostics | undefined {
  if (!pd) return pd;
  const warnings = Array.isArray(pd.warnings) ? pd.warnings.filter((w) => !OBSOLETE_CODE_CONTRACT_WARNINGS.has(w)) : pd.warnings;
  return { ...pd, codeContractPending: false, warnings };
}

/** Recompute file-count/added/removed from the consumed model-native files while
 *  preserving the model's own summary.type + summary.sectionNames. Never mutates. */
function recomputeSummaryForConsumed(prev: WebBuildSummary | undefined, files: WebBuildFile[]): WebBuildSummary {
  const base: WebBuildSummary = prev || { sectionNames: [], fileCount: 0, added: 0, removed: 0 };
  const changed = files.filter((f) => f.status !== 'unchanged');
  return {
    ...base,
    fileCount: files.length,
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  };
}

/**
 * Rebuild a turn's activity for the consumed model-native project: drop the temporary
 * synthesized `file-*` rows and the old `package` row, insert one honest row per
 * consumed file (after `plan`), and one refreshed `package` row (before `save`). The
 * real read/research/plan/preview/save rows + their details/statuses are preserved.
 * Never mutates; never claims a file that is not in the consumed set.
 */
function rebuildActivityForConsumed(activity: WebBuildActivityRow[] | undefined, files: WebBuildFile[]): WebBuildActivityRow[] {
  const base = (Array.isArray(activity) ? activity : []).filter(
    (r) => r && typeof r.id === 'string' && !r.id.startsWith('file-') && r.id !== 'package',
  );
  const fileRows: WebBuildActivityRow[] = files.map((f) => ({
    id: `file-${f.path}`,
    labelKey: f.status === 'modified' ? 'wbActModifyingFile' : 'wbActCreatingFile',
    params: { file: f.path },
    status: 'done' as const,
    detail: f.summary || (f.added ? `+${f.added} −${f.removed}` : undefined),
  }));
  const pkgRow: WebBuildActivityRow = { id: 'package', labelKey: 'wbActPackage', params: { count: files.length }, status: 'done' };
  const out: WebBuildActivityRow[] = [];
  let filesInserted = false;
  let pkgInserted = false;
  for (const r of base) {
    if (r.id === 'save' && !pkgInserted) { out.push(pkgRow); pkgInserted = true; }
    out.push(r);
    if (r.id === 'plan' && !filesInserted) { out.push(...fileRows); filesInserted = true; }
  }
  // Robust fallbacks for atypical activity shapes (should not occur with the
  // canonical read→plan→files→preview→package→save order): never silently drop rows.
  if (!filesInserted) {
    const previewAt = out.findIndex((r) => r.id === 'preview');
    if (previewAt >= 0) out.splice(previewAt, 0, ...fileRows);
    else out.push(...fileRows);
  }
  if (!pkgInserted) out.push(pkgRow);
  return out;
}

/**
 * Attach the dedicated Frontend Builder raw response (Phase 12B) + its STATIC parse
 * and contract validation (Phase 12C) IMMUTABLY to a planning payload. Updates
 * `artifacts.frontendBuilderRaw`, `artifacts.frontendBuilderValidation`, the matching
 * Phase 12A `frontendBuildSpec.generation` metadata, and the Phase 12B + 12C
 * enforcement fields at BOTH the root and the latest step. It NEVER mutates the input
 * and never alters files / sectionItems / sections / reply / layoutPlan / brief /
 * sources / planningDiagnostics / other agent artifacts / timestamps.
 *
 * Phase 12C runs `parseAndValidateFrontendBuilderRaw` EXACTLY ONCE against the
 * authoritative latest specification and records the result — STATIC only (no
 * compilation, execution or Preview consumption). GENERATION status
 * ('generated'/'failed'/'not-run') reflects whether the model returned a body and is
 * NEVER downgraded because parsing or validation failed; VALIDATION status
 * ('valid'/'invalid'/'not-run') is separate.
 *
 * Phase 12D CONSUMES the validated files when — and only when — the strict gate holds
 * (raw completed + validation valid + readyForConsumption + files present). On
 * consumption the model-native files atomically REPLACE `payload.files` +
 * `latestStep.files` (diffed against the previous completed step, not this turn's
 * temporary synthesis) and drive All Files + the isolated Sandpack runtime Preview;
 * activity/summary/planning-diagnostics are refreshed honestly. When the gate fails,
 * the deterministic section renderer + synthesized files remain the active fallback
 * and nothing is claimed as consumed. Consumption ≠ runtime compilation ≠ visual
 * review (Phase 12E). Generated file CONTENT is never rewritten.
 */
export function attachFrontendBuilderRaw(
  payload: WebBuildPayload,
  raw: FrontendBuilderRawArtifact,
): WebBuildPayload {
  try {
    const REASON_GENERATED =
      'Dedicated Frontend Builder returned a raw frontend-files-v1 response; static parse + validation ran without consuming the files.';

    // The authoritative latest specification: prefer the latest step's spec, then the
    // root spec. This is the single contract the validator checks the project against.
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const latestStep = steps.length ? steps[steps.length - 1] : undefined;
    const spec: FrontendBuildSpecification | undefined =
      latestStep?.artifacts?.frontendBuildSpec || payload.artifacts?.frontendBuildSpec;

    // Phase 12C — run the pure, fail-open, non-mutating validator EXACTLY ONCE.
    const validation: FrontendBuilderValidationArtifact = parseAndValidateFrontendBuilderRaw(raw, spec);

    // Map the validation status onto the raw artifact's validationStatus WITHOUT
    // mutating the input: valid → 'valid', invalid → 'invalid', skipped → 'not-run'.
    const nextValidationStatus: FrontendBuilderValidationStatus =
      validation.status === 'valid' ? 'valid' : validation.status === 'invalid' ? 'invalid' : 'not-run';
    const rawWithValidation: FrontendBuilderRawArtifact =
      raw.validationStatus === nextValidationStatus ? raw : { ...raw, validationStatus: nextValidationStatus };

    // GENERATION metadata reflects whether the model returned a body — it is NEVER
    // changed to 'failed' solely because parsing or validation failed. Only the
    // Phase 12A generation.status is touched; the rest of the spec is preserved.
    const applyGeneration = (s: FrontendBuildSpecification | undefined): FrontendBuildSpecification | undefined => {
      if (!s) return s;
      if (raw.status === 'completed') {
        return { ...s, generation: { status: 'generated', provider: raw.provider, model: raw.model, reason: REASON_GENERATED } };
      }
      if (raw.status === 'failed') {
        return { ...s, generation: { status: 'failed', reason: raw.reason } };
      }
      return { ...s, generation: { status: 'not-run', reason: raw.reason } };
    };

    // didRunFrontendBuilder is true whenever a real attempt was made (never 'skipped').
    // didValidateFrontendBuilder is true only when the validator actually parsed +
    // checked a project (a 'skipped' validation → false).
    const enforcePatch: Partial<WebBuildEnforcement> = {
      didRunFrontendBuilder: raw.status !== 'skipped',
      frontendBuilderRawStatus: raw.status,
      frontendBuilderResponseCharCount: raw.responseCharCount,
      frontendBuilderValidationStatus: nextValidationStatus,
      frontendBuilderMode: raw.mode,
      frontendBuilderModel: raw.model,
      frontendBuilderProvider: raw.provider,
      didValidateFrontendBuilder: validation.status !== 'skipped',
      frontendBuilderParsedFileCount: validation.fileCount,
      frontendBuilderParsedCharCount: validation.totalCharCount,
      frontendBuilderValidationErrorCount: validation.errors.length,
      frontendBuilderValidationWarningCount: validation.warnings.length,
      frontendBuilderMissingRequiredFileCount: validation.missingRequiredFiles.length,
      frontendBuilderMissingSectionFileCount: validation.missingRequiredSectionFiles.length,
      frontendBuilderUnresolvedImportCount: validation.unresolvedRelativeImports.length,
      frontendBuilderUnsupportedPackageCount: validation.unsupportedPackageImports.length,
      frontendBuilderReadyForConsumption: validation.readyForConsumption,
    };

    // ── Phase 12D consumption gate — STRICT. Never consume on a weaker signal. ──
    const canConsume =
      raw.status === 'completed' &&
      validation.status === 'valid' &&
      validation.readyForConsumption === true &&
      validation.files.length > 0;

    // Convert validated model-native files to WebBuildFile[] WITHOUT touching content,
    // diffed against the PREVIOUS completed step (a revision) — never this turn's
    // temporary synthesized fallback. A fresh build diffs against nothing.
    const previousFiles: WebBuildFile[] | undefined =
      steps.length >= 2 ? steps[steps.length - 2]?.files : undefined;
    const consumedFiles: WebBuildFile[] = canConsume
      ? diffFiles(previousFiles, validation.files.map((f) => ({
          path: f.path,
          content: f.content,
          language: f.language,
          summary: 'Model-native file generated by the dedicated Frontend Builder',
        })))
      : [];

    const boundedFallbackReason = (
      (validation.reason && validation.reason.trim())
      || (raw.reason && raw.reason.trim())
      || (validation.errors[0]?.message)
      || 'Model-native files were not eligible for consumption.'
    ).slice(0, 240);

    const consumption: FrontendBuilderConsumptionArtifact = canConsume
      ? {
          version: 'frontend-builder-consumption-v1',
          status: 'model-native',
          fileSource: 'model-native',
          allFilesSource: 'model-native',
          previewSource: 'model-native-sandbox',
          consumedFileCount: consumedFiles.length,
          consumedCharCount: validation.totalCharCount,
          validationStatus: validation.status,
          readyForConsumption: true,
          reason: 'Validated Frontend Builder files replaced the temporary internal synthesis and now drive All Files and the isolated runtime Preview.',
        }
      : {
          version: 'frontend-builder-consumption-v1',
          status: 'fallback',
          fileSource: 'internal-synthesis',
          allFilesSource: 'internal-synthesis',
          previewSource: 'legacy-section-renderer',
          consumedFileCount: 0,
          consumedCharCount: 0,
          validationStatus: validation.status,
          readyForConsumption: false,
          reason: 'Model-native files were not eligible for consumption; the existing deterministic fallback remains active.',
          fallbackReason: boundedFallbackReason,
        };

    // Consumption enforcement — a fallback NEVER claims consumption.
    const consumptionEnforce: Partial<WebBuildEnforcement> = canConsume
      ? {
          didConsumeFrontendBuilderFiles: true,
          frontendBuilderConsumptionStatus: 'model-native',
          frontendBuilderFileSource: 'model-native',
          frontendBuilderAllFilesSource: 'model-native',
          frontendBuilderPreviewSource: 'model-native-sandbox',
          frontendBuilderConsumedFileCount: consumedFiles.length,
          frontendBuilderConsumedCharCount: validation.totalCharCount,
          frontendBuilderConsumptionReason: consumption.reason,
        }
      : {
          didConsumeFrontendBuilderFiles: false,
          frontendBuilderConsumptionStatus: 'fallback',
          frontendBuilderFileSource: 'internal-synthesis',
          frontendBuilderAllFilesSource: 'internal-synthesis',
          frontendBuilderPreviewSource: 'legacy-section-renderer',
          frontendBuilderConsumedFileCount: 0,
          frontendBuilderConsumedCharCount: 0,
          frontendBuilderConsumptionReason: consumption.reason,
        };

    const patch = (a: WebBuildArtifacts | undefined): WebBuildArtifacts => ({
      ...(a || {}),
      frontendBuilderRaw: rawWithValidation,
      frontendBuilderValidation: validation,
      frontendBuilderConsumption: consumption,
      frontendBuildSpec: applyGeneration(a?.frontendBuildSpec),
      enforcement: a?.enforcement ? { ...a.enforcement, ...enforcePatch, ...consumptionEnforce } : a?.enforcement,
    });

    // Older steps NEVER change. Only the latest step (this turn) is replaced, and only
    // when the strict gate held do its files/activity/summary/planning-diagnostics switch.
    const nextSteps = steps.length
      ? steps.map((s, i) => {
          if (i !== steps.length - 1) return s;
          if (!canConsume) return { ...s, artifacts: patch(s.artifacts) };
          return {
            ...s,
            files: consumedFiles,
            activity: rebuildActivityForConsumed(s.activity, consumedFiles),
            summary: recomputeSummaryForConsumed(s.summary, consumedFiles),
            planningDiagnostics: clearCodeContractPending(s.planningDiagnostics),
            artifacts: patch(s.artifacts),
          };
        })
      : steps;

    const rootPatched: WebBuildPayload = { ...payload, artifacts: patch(payload.artifacts), steps: nextSteps };
    if (!canConsume) return rootPatched;
    return {
      ...rootPatched,
      files: consumedFiles,
      activity: rebuildActivityForConsumed(payload.activity, consumedFiles),
      planningDiagnostics: clearCodeContractPending(payload.planningDiagnostics),
    };
  } catch {
    return payload;
  }
}

/**
 * Attach the Phase 12E quality-pipeline result (static initial review, optional single
 * bounded repair, static post-repair review, final acceptance) IMMUTABLY to the
 * already-consumed Phase 12D payload, at BOTH the root and the latest step. Older steps
 * NEVER change; no new WebBuild step is created (the repair belongs to the same turn).
 *
 * When NO repaired project is accepted, the ACTIVE project is untouched: files,
 * latest-step files, activity, summary, consumption artifact, Preview source, All Files
 * source and the Phase 12C validation artifact are all preserved — only the Phase 12E
 * artifacts + enforcement diagnostics are added.
 *
 * When a repaired project IS accepted (acceptance 'repaired-approved'), the repaired,
 * re-validated files atomically REPLACE `payload.files` + `latestStep.files` — diffed
 * against the currently active INITIAL model-native project from THIS turn (never a
 * temporary synthesis, an older step, the raw repair output or a previous revision).
 * Generated content is passed byte-for-byte (only a summary label is attached). The
 * active validation artifact becomes the repaired project's validation and the
 * consumption artifact is refreshed while preserving model-native / model-native-sandbox
 * sources. The persisted initial `frontendBuilderRaw` is NEVER overwritten by the repair.
 *
 * Pure + fail-open: never mutates the input; returns the input unchanged on any error.
 */
export function attachFrontendBuilderQualityResult(
  payload: WebBuildPayload,
  result: FrontendBuilderQualityPipelineResult,
): WebBuildPayload {
  try {
    const ir = result.initialReview;
    const rp = result.repair;
    const fr = result.finalReview;
    const acc = result.acceptance;

    const accepted =
      acc.status === 'repaired-approved' &&
      !!result.acceptedRepairedFiles &&
      !!result.acceptedRepairedValidation;

    // Repaired files → WebBuildFile[], diffed against the CURRENT active initial
    // model-native project from this turn (payload.files). Content is byte-identical;
    // only a summary label is attached. Computed once and reused at root + latest step.
    const repairedFiles: WebBuildFile[] = accepted
      ? diffFiles(payload.files, (result.acceptedRepairedFiles || []).map((f) => ({
          path: f.path,
          content: f.content,
          language: f.language,
          summary: 'Model-native file improved by the bounded Phase 12E repair',
        })))
      : [];

    // Refreshed consumption artifact — preserves the model-native / model-native-sandbox
    // sources; only the counts + honest reason change. Only used when accepted.
    const updatedConsumption: FrontendBuilderConsumptionArtifact | undefined = accepted
      ? {
          version: 'frontend-builder-consumption-v1',
          status: 'model-native',
          fileSource: 'model-native',
          allFilesSource: 'model-native',
          previewSource: 'model-native-sandbox',
          consumedFileCount: repairedFiles.length,
          consumedCharCount: result.acceptedRepairedValidation?.totalCharCount ?? 0,
          validationStatus: 'valid',
          readyForConsumption: true,
          reason: 'The accepted Phase 12E repaired model-native project now drives All Files and the isolated runtime Preview.',
        }
      : undefined;

    // Phase 12E enforcement — separate facts, never reusing generation/validation/
    // consumption flags. Consumption fields are refreshed ONLY on an accepted repair.
    const enforcePatch: Partial<WebBuildEnforcement> = {
      didRunFrontendBuilderInitialReview: !!ir && ir.status !== 'skipped',
      frontendBuilderInitialReviewStatus: ir?.status,
      frontendBuilderInitialReviewPassed: ir?.passed,
      frontendBuilderInitialReviewScore: ir?.score,
      frontendBuilderInitialBlockerCount: ir?.blockerCount,
      frontendBuilderInitialMajorCount: ir?.majorCount,
      frontendBuilderInitialMinorCount: ir?.minorCount,
      didAttemptFrontendBuilderRepair: rp?.attempted ?? false,
      didAcceptFrontendBuilderRepair: rp?.accepted ?? false,
      frontendBuilderRepairStatus: rp?.status,
      frontendBuilderRepairValidationStatus: rp?.validationStatus,
      didRunFrontendBuilderFinalReview: !!fr && fr.status !== 'skipped',
      frontendBuilderFinalReviewStatus: fr?.status,
      frontendBuilderFinalReviewPassed: fr?.passed,
      frontendBuilderFinalReviewScore: fr?.score,
      frontendBuilderAcceptanceStatus: acc.status,
      frontendBuilderActiveProject: acc.activeProject,
      frontendBuilderRenderedVisualTestStatus: 'pending-manual-test',
      ...(accepted
        ? {
            didConsumeFrontendBuilderFiles: true,
            frontendBuilderConsumptionStatus: 'model-native' as const,
            frontendBuilderFileSource: 'model-native' as const,
            frontendBuilderAllFilesSource: 'model-native' as const,
            frontendBuilderPreviewSource: 'model-native-sandbox' as const,
            frontendBuilderConsumedFileCount: repairedFiles.length,
            frontendBuilderConsumedCharCount: result.acceptedRepairedValidation?.totalCharCount ?? 0,
            frontendBuilderConsumptionReason: updatedConsumption?.reason,
          }
        : {}),
    };

    // Immutable artifact patch. On accept, the ACTIVE validation + consumption switch to
    // the repaired project; the persisted initial `frontendBuilderRaw` is left untouched.
    const patch = (a: WebBuildArtifacts | undefined): WebBuildArtifacts => {
      const next: WebBuildArtifacts = { ...(a || {}) };
      if (ir) next.frontendBuilderInitialReview = ir;
      if (rp) next.frontendBuilderRepair = rp;
      if (fr) next.frontendBuilderFinalReview = fr;
      next.frontendBuilderAcceptance = acc;
      if (accepted) {
        if (result.acceptedRepairedValidation) next.frontendBuilderValidation = result.acceptedRepairedValidation;
        if (updatedConsumption) next.frontendBuilderConsumption = updatedConsumption;
      }
      next.enforcement = a?.enforcement ? { ...a.enforcement, ...enforcePatch } : a?.enforcement;
      return next;
    };

    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const nextSteps = steps.length
      ? steps.map((s, i) => {
          if (i !== steps.length - 1) return s;
          if (!accepted) return { ...s, artifacts: patch(s.artifacts) };
          return {
            ...s,
            files: repairedFiles,
            activity: rebuildActivityForConsumed(s.activity, repairedFiles),
            summary: recomputeSummaryForConsumed(s.summary, repairedFiles),
            planningDiagnostics: clearCodeContractPending(s.planningDiagnostics),
            artifacts: patch(s.artifacts),
          };
        })
      : steps;

    const rootPatched: WebBuildPayload = { ...payload, artifacts: patch(payload.artifacts), steps: nextSteps };
    if (!accepted) return rootPatched;
    return {
      ...rootPatched,
      files: repairedFiles,
      activity: rebuildActivityForConsumed(payload.activity, repairedFiles),
      planningDiagnostics: clearCodeContractPending(payload.planningDiagnostics),
    };
  } catch {
    return payload;
  }
}

/**
 * Attach the Phase 12F STRUCTURAL contract-repair outcome IMMUTABLY at the root + latest
 * step (older steps never change; no new WebBuild step). When the repair is accepted, the
 * repaired, re-validated project becomes the active model-native project — replacing the
 * internal fallback that the invalid initial project produced: files, activity and summary
 * are refreshed exactly as Phase 12D consumption does, the active validation + consumption
 * artifacts switch to the repaired project (model-native / model-native-sandbox), and the
 * obsolete fallback code-contract diagnostics are cleared. The original `frontendBuilderRaw`
 * is preserved as evidence of the initial generation; the initial invalid-validation
 * evidence is retained inside the contract-repair artifact. When rejected, the fallback is
 * untouched and only the artifact + enforcement are attached. Never claims consumption when
 * the repaired validation is not valid. Pure + fail-open: returns the input on any error.
 *
 * Shares the SAME consumption helpers (diffFiles / rebuildActivityForConsumed /
 * recomputeSummaryForConsumed / clearCodeContractPending) as the initial Phase 12D
 * consumption, so an accepted contract-repair project consumes with identical semantics.
 * Repaired files are diffed against the PREVIOUS completed user turn — never this turn's
 * temporary internal synthesis.
 */
export function attachFrontendBuilderContractRepairResult(
  payload: WebBuildPayload,
  contractRepair: FrontendBuilderContractRepairArtifact,
  acceptedValidation: FrontendBuilderValidationArtifact | null,
): WebBuildPayload {
  try {
    const accepted =
      contractRepair.status === 'accepted' &&
      !!acceptedValidation &&
      acceptedValidation.status === 'valid' &&
      acceptedValidation.readyForConsumption === true &&
      acceptedValidation.files.length > 0;

    // Phase 12F.2 — enrich the artifact with bounded missing-critical-copy diagnostics
    // from the INITIAL (invalid) validation and, when accepted, the repaired validation.
    // Previews only (≤100 chars, ≤8 entries); never the full raw response.
    const initialVal = payload.artifacts?.frontendBuilderValidation;
    const initialMissing = (initialVal?.missingCriticalCopy || []).slice(0, 8).map((s) => s.slice(0, 100));
    const finalMissing = accepted && acceptedValidation
      ? (acceptedValidation.missingCriticalCopy || []).slice(0, 8).map((s) => s.slice(0, 100))
      : undefined;
    const enrichedContractRepair: FrontendBuilderContractRepairArtifact = {
      ...contractRepair,
      initialMissingCriticalCopyCount: initialVal ? (initialVal.missingCriticalCopy || []).length : contractRepair.initialMissingCriticalCopyCount,
      initialMissingCriticalCopy: initialMissing.length ? initialMissing : contractRepair.initialMissingCriticalCopy,
      ...(finalMissing !== undefined
        ? { finalMissingCriticalCopyCount: (acceptedValidation as FrontendBuilderValidationArtifact).missingCriticalCopy?.length ?? finalMissing.length, finalMissingCriticalCopy: finalMissing }
        : {}),
    };

    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const previousFiles: WebBuildFile[] | undefined =
      steps.length >= 2 ? steps[steps.length - 2]?.files : undefined;

    const repairedFiles: WebBuildFile[] = accepted
      ? diffFiles(previousFiles, (acceptedValidation as FrontendBuilderValidationArtifact).files.map((f) => ({
          path: f.path,
          content: f.content,
          language: f.language,
          summary: 'Model-native file recovered by the Phase 12F structural contract repair',
        })))
      : [];

    const consumption: FrontendBuilderConsumptionArtifact | undefined = accepted
      ? {
          version: 'frontend-builder-consumption-v1',
          status: 'model-native',
          fileSource: 'model-native',
          allFilesSource: 'model-native',
          previewSource: 'model-native-sandbox',
          consumedFileCount: repairedFiles.length,
          consumedCharCount: (acceptedValidation as FrontendBuilderValidationArtifact).totalCharCount,
          validationStatus: 'valid',
          readyForConsumption: true,
          reason: 'The structurally repaired model-native project (Phase 12F contract repair) replaced the internal fallback and now drives All Files and the isolated runtime Preview.',
        }
      : undefined;

    const enforcePatch: Partial<WebBuildEnforcement> = {
      didAttemptFrontendBuilderContractRepair: contractRepair.attempted,
      didAcceptFrontendBuilderContractRepair: contractRepair.accepted,
      frontendBuilderContractRepairStatus: contractRepair.status,
      frontendBuilderContractRepairInitialErrorCount: contractRepair.initialErrorCount,
      frontendBuilderContractRepairInitialErrorCodes: contractRepair.initialErrorCodes,
      frontendBuilderContractRepairFinalValidationStatus: contractRepair.finalValidationStatus,
      frontendBuilderContractRepairFinalErrorCount: contractRepair.finalErrorCount,
      ...(accepted
        ? {
            didConsumeFrontendBuilderFiles: true,
            frontendBuilderConsumptionStatus: 'model-native' as const,
            frontendBuilderFileSource: 'model-native' as const,
            frontendBuilderAllFilesSource: 'model-native' as const,
            frontendBuilderPreviewSource: 'model-native-sandbox' as const,
            frontendBuilderConsumedFileCount: repairedFiles.length,
            frontendBuilderConsumedCharCount: (acceptedValidation as FrontendBuilderValidationArtifact).totalCharCount,
            frontendBuilderConsumptionReason: consumption?.reason,
          }
        : {}),
    };

    const patch = (a: WebBuildArtifacts | undefined): WebBuildArtifacts => {
      const next: WebBuildArtifacts = { ...(a || {}) };
      next.frontendBuilderContractRepair = enrichedContractRepair;
      if (accepted && acceptedValidation && consumption) {
        next.frontendBuilderValidation = acceptedValidation;
        next.frontendBuilderConsumption = consumption;
      }
      next.enforcement = a?.enforcement ? { ...a.enforcement, ...enforcePatch } : a?.enforcement;
      return next;
    };

    const nextSteps = steps.length
      ? steps.map((s, i) => {
          if (i !== steps.length - 1) return s;
          if (!accepted) return { ...s, artifacts: patch(s.artifacts) };
          return {
            ...s,
            files: repairedFiles,
            activity: rebuildActivityForConsumed(s.activity, repairedFiles),
            summary: recomputeSummaryForConsumed(s.summary, repairedFiles),
            planningDiagnostics: clearCodeContractPending(s.planningDiagnostics),
            artifacts: patch(s.artifacts),
          };
        })
      : steps;

    const rootPatched: WebBuildPayload = { ...payload, artifacts: patch(payload.artifacts), steps: nextSteps };
    if (!accepted) return rootPatched;
    return {
      ...rootPatched,
      files: repairedFiles,
      activity: rebuildActivityForConsumed(payload.activity, repairedFiles),
      planningDiagnostics: clearCodeContractPending(payload.planningDiagnostics),
    };
  } catch {
    return payload;
  }
}

function pascal(id: string): string {
  return id.replace(/(^|[-_ ]+)(\w)/g, (_, __, c) => c.toUpperCase());
}

/**
 * Parse the page sections with rich copy (headline / sub / cta / bullets) so
 * the preview reflects real generated content. Delegates the copy parsing to
 * webBuildFiles.parseSectionCopy (single source of truth for section copy).
 */
export function parseSectionItems(result: WebBuildResult): WebBuildSectionItem[] {
  return parseSectionCopy(result).map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    copyPreview: (c.headline || c.sub || c.body || '').replace(/\s+/g, ' ').slice(0, 200) || undefined,
    component: `${pascal(c.id)}.tsx`,
    headline: c.headline,
    sub: c.sub,
    cta: c.cta,
    bullets: c.bullets,
  }));
}

/** Line-multiset diff between two file contents → added/removed counts. */
function lineDiff(before: string, after: string): { added: number; removed: number } {
  const count = (s: string) => {
    const map = new Map<string, number>();
    for (const l of s.split('\n')) map.set(l, (map.get(l) || 0) + 1);
    return map;
  };
  const b = count(before), a = count(after);
  let added = 0, removed = 0;
  for (const [l, n] of a) added += Math.max(0, n - (b.get(l) || 0));
  for (const [l, n] of b) removed += Math.max(0, n - (a.get(l) || 0));
  return { added, removed };
}

/** Diff a fresh file set against the previous build's files. */
export function diffFiles(prev: WebBuildFile[] | undefined, next: SynthFile[]): WebBuildFile[] {
  const prevMap = new Map((prev || []).map((f) => [f.path, f.content]));
  return next.map((f) => {
    const lines = f.content ? f.content.split('\n').length : 0;
    const before = prevMap.get(f.path);
    if (before === undefined) return { ...f, status: 'created' as const, added: lines, removed: 0 };
    if (before === f.content) return { ...f, status: 'unchanged' as const, added: 0, removed: 0 };
    const { added, removed } = lineDiff(before, f.content);
    return { ...f, status: 'modified' as const, added, removed };
  });
}

/** The authoritative file set for a result, diffed against the previous build.
 *  An optional `brief` override lets the Art-Director-enriched brief drive the
 *  synthesized files' palette/visual system (so files match the preview). */
export function resolveFiles(result: WebBuildResult, prev?: WebBuildFile[], brief?: WebBuildBrief): WebBuildFile[] {
  return diffFiles(prev, resolveBuildFiles(result, brief));
}

/** Structured summary tied to real data for the assistant message. */
export function summarize(result: WebBuildResult, files: WebBuildFile[]): WebBuildSummary {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const changed = files.filter((f) => f.status !== 'unchanged');
  return {
    type: brief.type,
    sectionNames: items.map((s) => s.name),
    fileCount: files.length,
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  };
}

/**
 * File/component-based "Build Activity" — implementation-focused rows tied to
 * the ACTUAL generated files. One row per created/modified file ("Creating
 * components/Hero.tsx — <summary>"), bracketed by read/plan/preview/package.
 * All 'done' except the save row (flipped once saved). Never claims a file
 * that isn't in `files`.
 */
export function deriveBuildActivity(result: WebBuildResult, files?: WebBuildFile[], sources?: WebBuildSource[], plan?: WebBuildLayoutPlan): WebBuildActivityRow[] {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const fileList = files || resolveFiles(result);
  const briefBits = [brief.type, brief.audience, brief.goal].filter(Boolean).join(' · ');
  // Surface the model's ACTUAL strategy in the activity detail (not template
  // text): what the site is + the insight that shaped it, then the CHOSEN layout
  // architecture (hero composition + visual module) behind the section plan, so
  // the timeline reflects the same plan that drives preview + files (Part 7).
  const layoutPlan = plan || deriveLayoutPlan(brief, items.map((s) => ({ id: s.id, name: s.name })));
  const readDetail = [brief.coreIdea || briefBits, brief.strategyInsight].filter(Boolean).join(' — ') || undefined;
  const planDetail = [
    layoutPlan.pageArchitecture,
    layoutPlan.visualSystem.motif,
    brief.layoutLogic || brief.visualMetaphor,
    items.length ? items.map((s) => s.name).join(', ') : '',
  ].filter(Boolean).join(' · ') || undefined;

  const rows: WebBuildActivityRow[] = [
    { id: 'read', labelKey: 'wbActRead', status: 'done', detail: readDetail },
  ];
  // HONEST research row — only when the backend actually returned real sources.
  // Otherwise no research is claimed (the 'plan' row reads as strategy analysis).
  if (sources && sources.length) {
    rows.push({
      id: 'research', labelKey: 'wbActResearch', status: 'done',
      detail: sources.slice(0, 4).map((s) => s.title).join(' · '),
    });
  }
  rows.push({ id: 'plan', labelKey: 'wbActPlan', status: 'done', detail: planDetail });

  // One row per file actually produced (changed files first; unchanged noted).
  const changed = fileList.filter((f) => f.status !== 'unchanged');
  const shown = changed.length ? changed : fileList;
  for (const f of shown) {
    rows.push({
      id: `file-${f.path}`,
      labelKey: f.status === 'modified' ? 'wbActModifyingFile' : 'wbActCreatingFile',
      params: { file: f.path },
      status: 'done',
      detail: f.summary || (f.added ? `+${f.added} −${f.removed}` : undefined),
    });
  }

  rows.push({ id: 'preview', labelKey: 'wbStagePreview', status: 'done' });
  rows.push({ id: 'package', labelKey: 'wbActPackage', params: { count: fileList.length }, status: 'done' });
  rows.push({ id: 'save', labelKey: 'wbActSave', status: 'waiting' });
  return rows;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Guarantee the section-item invariant the ENTIRE package assembly relies on: an
 * array of plain objects, each with a stable, non-empty string `id` and `name`.
 *
 * Every downstream consumer — deriveLayoutPlan (which calls `pascal(id)` →
 * `id.replace(...)`), itemsToCopies, synthesizeFromCopies, deriveBuildActivity,
 * summarize — maps `s.id` / `s.name`. A section item whose `id` is missing or not
 * a string (a thin/partial backend reply, an old persisted build, or a malformed
 * entry) makes `String.prototype.replace` throw a TypeError MID-ASSEMBLY. Because
 * the core derivations below are not individually guarded, that throw propagates
 * out of buildWebBuildPayload, so the caller never receives a payload and shows
 * the generic "incomplete build package" banner — Preview and All Files never
 * mount. Normalizing here (drop non-objects, synthesize `section-<i>` ids/names)
 * makes the source-of-truth safe without fabricating any real content.
 */
function normalizeSectionItems(items: unknown): WebBuildSectionItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((s): s is WebBuildSectionItem => !!s && typeof s === 'object')
    .map((s, i) => {
      const id = typeof s.id === 'string' && s.id.trim() ? s.id : `section-${i}`;
      const name = typeof s.name === 'string' && s.name.trim()
        ? s.name
        : (typeof s.id === 'string' && s.id.trim() ? s.id : `Section ${i + 1}`);
      return id === s.id && name === s.name ? s : { ...s, id, name };
    });
}

/**
 * Classify how much of the build was actually MODEL-planned vs frontend-synthesized,
 * from real parse diagnostics + which frontend fallbacks ran. Pure. This is the
 * honesty gate: it never blocks a build, it just labels it so a fallback build is
 * not mistaken for a real model-planned one.
 */
function computePlanningDiagnostics(args: {
  parse?: WebBuildParseDiagnostics;
  hasModelWEP: boolean;
  hasStrategyWEP: boolean;
  hasContract: boolean;
  usedArchitectureRewrite: boolean;
  usedQualityFallbackSections: boolean;
  usedFileSynthesisFallback: boolean;
  usedSafePayloadFallback: boolean;
}): WebBuildPlanningDiagnostics {
  const {
    parse, hasModelWEP, hasStrategyWEP, hasContract,
    usedArchitectureRewrite, usedQualityFallbackSections, usedFileSynthesisFallback, usedSafePayloadFallback,
  } = args;
  // Any real signal that the MODEL planned the site: WEP fields in the reply, or a
  // backend brief that already carried the Website Experience Plan.
  const modelWEPSignal = !!(hasModelWEP || parse?.hasWebsiteExperiencePlanFields);

  // Phase 6D — the Preview is driven by the PLANNING contract, so a model-planned
  // build no longer requires a backend Frontend Code section. Prefer the stored
  // planning/full-code flags; fall back to the field checks for old builds.
  const planningContractPresent = typeof parse?.planningContractPresent === 'boolean'
    ? parse.planningContractPresent
    : !!(parse?.hasWebsiteExperiencePlanFields && !parse.usedOverviewFallback && parse.hasPageSectionsSection);
  const fullCodeContractPresent = typeof parse?.fullCodeContractPresent === 'boolean'
    ? parse.fullCodeContractPresent
    : !!(planningContractPresent && parse?.hasFrontendCodeSection);
  let planningQuality: PlanningQuality;
  let codeContractPending = false;
  if (usedSafePayloadFallback) {
    planningQuality = 'frontend-fallback';
  } else if (fullCodeContractPresent && hasStrategyWEP) {
    // Full model-planned package: planning contract + real Frontend Code.
    planningQuality = 'model-planned';
  } else if (planningContractPresent) {
    // Phase 6D — a complete PLANNING contract (Build Plan + Design Direction + WEP +
    // Page Sections + Generated Copy) is a real model-planned Preview even when the
    // full React code contract is missing/pending. NOT a frontend-fallback.
    planningQuality = 'model-planned';
    codeContractPending = !fullCodeContractPresent;
  } else if (parse?.usedOverviewFallback || !modelWEPSignal) {
    // Overview fallback, or no model-native website-experience signal at all.
    planningQuality = 'frontend-fallback';
  } else if (usedArchitectureRewrite || usedQualityFallbackSections || usedFileSynthesisFallback) {
    // The model gave some signal, but the frontend restructured/synthesized content.
    planningQuality = 'frontend-repaired';
  } else {
    // Model signal present, no frontend synthesis, but not a full canonical package.
    planningQuality = 'model-partial';
  }

  const warnings: string[] = [];
  if (usedSafePayloadFallback) warnings.push('Package synthesized after assembly failure — not a model-planned build.');
  if (parse?.usedOverviewFallback) warnings.push('Backend returned no ## sections — used Overview fallback.');
  if (parse && !parse.hasPageSectionsSection && !usedSafePayloadFallback) warnings.push('No "Page Sections" section in the backend reply.');
  if (parse && !parse.hasFrontendCodeSection && !usedSafePayloadFallback) warnings.push('No "Frontend Code" section in the backend reply.');
  if (codeContractPending) warnings.push('Model-planned Preview — Frontend Code contract missing; All Files uses internal synthesis (code parity pending).');
  if (parse && !parse.hasWebsiteExperiencePlanFields) warnings.push('No Website Experience Plan labels in the backend reply.');
  if (usedArchitectureRewrite) warnings.push('Frontend rewrote the section architecture.');
  if (usedQualityFallbackSections) warnings.push('Frontend replaced weak sections with inferred fallback sections.');
  if (usedFileSynthesisFallback) warnings.push('Frontend synthesized files (backend produced none).');
  if (parse?.isPartial && !usedSafePayloadFallback) warnings.push('Backend result flagged partial.');

  return {
    parse,
    usedArchitectureRewrite,
    usedQualityFallbackSections,
    usedFileSynthesisFallback,
    usedSafePayloadFallback,
    hasModelWebsiteExperiencePlan: hasModelWEP,
    hasStrategyWebsiteExperiencePlan: hasStrategyWEP,
    hasInteractionContract: hasContract,
    planningQuality,
    // Phase 6D — true when the Preview is model-planned but the full React code
    // contract is missing (All-Files parity pending). Never means frontend-fallback.
    codeContractPending,
    warnings,
  };
}

/** WebBuildSectionItem → SectionCopy (for synthesizing files from a brief). */
function itemsToCopies(items: WebBuildSectionItem[]): SynthCopy[] {
  return items.map((s) => ({
    id: s.id, name: s.name, purpose: s.purpose,
    headline: s.headline, sub: s.sub, cta: s.cta,
    bullets: s.bullets || [], body: '',
  }));
}

/**
 * Assemble (or extend) the persisted Web Build package. PUBLIC ENTRY POINT — it
 * is self-healing: the normal assembly runs inside a guard so that if any core
 * derivation throws unexpectedly, we still return a COMPLETE, usable package
 * synthesized from concept-appropriate fallback sections instead of propagating
 * the throw (which the callers surface as the "incomplete build package" banner,
 * blocking Preview AND All Files). The banner validation is NOT removed — this
 * guarantees the package it validates is always well-formed at the source.
 */
/**
 * Phase 12F.2 — resolve the WEBSITE-output language for payload assembly. Separate from
 * the app UI language: a fresh build follows an explicit request → the prompt language →
 * the UI; a revision keeps the PREVIOUS website language (read from the persisted
 * specification) unless the prompt explicitly asks to change it. Pure; fail-open.
 */
function resolveBuildWebsiteLanguage(prompt: string, prev: WebBuildPayload | undefined, uiLang?: string): string {
  const prevSteps = prev && Array.isArray(prev.steps) ? prev.steps : [];
  const prevSpecLang =
    prevSteps[prevSteps.length - 1]?.artifacts?.frontendBuildSpec?.language
    || prev?.artifacts?.frontendBuildSpec?.language
    || (prev ? detectMessageLanguage(prev.prompt || '') : undefined);
  return resolveWebsiteOutputLanguage(prompt, {
    existingLanguage: prevSpecLang as Language | undefined,
    uiLanguage: (uiLang as Language) || undefined,
  });
}

export function buildWebBuildPayload(
  prompt: string, result: WebBuildResult, prev?: WebBuildPayload, lang?: string,
): WebBuildPayload {
  try {
    return assembleWebBuildPayload(prompt, result, prev, lang);
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[WebBuild] package assembly failed — synthesizing a safe package', err);
    }
    return synthesizeSafePayload(prompt, result, prev, lang);
  }
}

/**
 * Build (or extend) the persisted payload from a result — with BRIEF
 * INTELLIGENCE. Low-detail prompts ("mobilyacı için site yap") often come back
 * with a thin/generic reply; we infer the industry (`inferWebsiteBrief`), fill
 * any missing brief fields, and — on a FRESH build that fails the quality gate —
 * synthesize an industry-appropriate section set + premium files so the user
 * still gets a real, specific site. Revisions never overwrite a good build.
 */
function assembleWebBuildPayload(
  prompt: string, result: WebBuildResult, prev?: WebBuildPayload, lang?: string,
): WebBuildPayload {
  const now = new Date().toISOString();
  const effLang = resolveBuildWebsiteLanguage(prompt, prev, lang);
  const inferred = inferWebsiteBrief(prompt, effLang);

  const backendBrief = extractBrief(result.sections);
  // Prefer the model's own strategy fields; fall back to inference only for the
  // core four. The richer strategy fields (coreIdea, strategyInsight, visual
  // metaphor, motion direction, …) flow straight through so downstream activity
  // detail, preview and file synthesis are driven by the ACTUAL strategy.
  const brief: WebBuildBrief = {
    ...backendBrief,
    type: backendBrief.type || inferred.businessType,
    audience: backendBrief.audience || inferred.targetAudience,
    goal: backendBrief.goal || inferred.conversionGoal,
    style: backendBrief.style || backendBrief.visualMood || inferred.visualStyle,
    primaryCTA: backendBrief.primaryCTA || inferred.primaryCTA,
    secondaryCTA: backendBrief.secondaryCTA || inferred.secondaryCTA,
  };
  // Revisions keep the first build's strategy fields unless the model restated
  // them (only defined values override), so a small revision never loses the
  // original insight.
  const definedBrief = Object.fromEntries(
    Object.entries(brief).filter(([, v]) => v != null && v !== ''),
  ) as WebBuildBrief;
  const mergedBrief: WebBuildBrief = prev ? { ...prev.brief, ...definedBrief } : brief;

  // Honest research status (needed by the Research Agent). Fresh builds carry the
  // pass result; revisions skip the pre-pass, so keep the original build's status.
  const research: WebBuildResearch | undefined = result.research || prev?.research || undefined;

  // The previous build's files, captured ONCE as a plainly-typed local before any
  // `!prev` narrowing (avoids `prev?.files` narrowing to `never` inside `!prev`).
  const prevFiles: WebBuildFile[] | undefined = prev?.files;

  let sectionItems = normalizeSectionItems(parseSectionItems(result));

  // UPSTREAM AGENTS (Research → UI/Art Director → Strategy). Gated by
  // WEB_BUILD_AGENTS_ENABLED (ON by default; kill-switch via env). They are
  // purely additive: each agent is guarded INTERNALLY (a failing agent is marked
  // skipped and the rest continue) and the whole call is guarded again here, so
  // an agent can NEVER block the build or mark a package incomplete. When they
  // succeed, the enriched brief drives the design system / preview / files.
  let agents: WebBuildAgent[] | undefined;
  let artifacts: WebBuildArtifacts | undefined;
  let artBrief: WebBuildBrief = mergedBrief;
  if (WEB_BUILD_AGENTS_ENABLED) {
    try {
      const up = runUpstreamAgents(
        prompt, mergedBrief, research, inferred,
        sectionItems.map((s) => ({ id: s.id, name: s.name })), effLang,
      );
      agents = up.agents;
      artifacts = up.artifacts;
      artBrief = up.enrichedBrief;
    } catch {
      agents = undefined;
      artifacts = undefined;
      artBrief = mergedBrief;
    }
  }

  // Tracks whether a pass rewrote the section architecture (Section Architecture or
  // the Page Architecture reshape below), so files re-synthesize and Preview + All
  // Files stay aligned. The Section Architecture enforcement pass itself now runs
  // AFTER Vertical Intelligence (Phase 11C) so the resolved sector drives it.
  let didRewriteArchitecture = false;

  // EXPERIENCE BLUEPRINT (Phase 9D-2) — high-level, whole-site experience decision
  // (site type, page mode, conversion path, required/forbidden page groups, CTA
  // strategy, need flags) derived BEFORE the section-level page architecture so it
  // can guide it. Data/planning only: no routing, no image/video/motion, no
  // backend, no fabricated proof. Fully guarded + non-blocking.
  if (WEB_BUILD_AGENTS_ENABLED) {
    try {
      const experienceBlueprint = deriveExperienceBlueprint(
        artBrief,
        sectionItems.map((s) => ({ id: s.id, name: s.name })),
        artifacts?.research?.conceptAuthority,
        artifacts?.pageArchitecture,
        artifacts?.visualSignaturePlan,
        artifacts?.thinkingLedger,
        effLang,
      );
      artifacts = { ...(artifacts || {}), experienceBlueprint };
    } catch {
      /* non-blocking — the page architecture falls back to its 9D-1 rules */
    }
  }

  // VERTICAL INTELLIGENCE (Phase 11A) — deterministic sector engine. Derived AFTER
  // the Experience Blueprint and BEFORE the intent-aware Page Architecture, refining
  // the concept/experience understanding into a sector/subsector-specific decision
  // contract (business model, conversion model, trust model, section policy, VISUAL
  // TRUTH policy, future-research readiness). PLANNING/DATA ONLY: no live research is
  // run here, and the artifact is persisted + diagnosed only — it does NOT alter the
  // renderer, image pipeline, motion or asset behaviour in this phase (Phase 11B+
  // consumes it). A real agent stage; fully guarded + non-blocking + fail-open.
  if (WEB_BUILD_AGENTS_ENABLED) {
    try {
      const vi = runVerticalIntelligence({
        prompt,
        brief: artBrief,
        inferred,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name })),
        conceptAuthority: artifacts?.research?.conceptAuthority,
        experienceBlueprint: artifacts?.experienceBlueprint,
        ledger: artifacts?.thinkingLedger,
        // Phase 11B — consume the EXISTING Research Agent artifact (no new request)
        // to attach honest, source-backed vertical research evidence when real URLs
        // exist. Revisions that preserve the same research artifact recompute the
        // same evidence deterministically.
        research: artifacts?.research,
        lang: effLang,
      });
      // Append the agent row in behavioral order (after Strategy, before Layout
      // Architect) without duplicating it, and persist the real artifact.
      if (agents && !agents.some((a) => a.id === 'vertical_intelligence')) {
        agents = [...agents, vi.agent];
      }
      artifacts = { ...(artifacts || {}), verticalIntelligence: vi.artifact };
    } catch {
      /* non-blocking — old behaviour continues without the sector contract */
    }
  }

  // SECTION ARCHITECTURE ENFORCEMENT (relocated in Phase 11C to run AFTER Vertical
  // Intelligence) — for a FRESH build whose section list is weak or mismatched,
  // replace it with a SECTOR-specific architecture. The resolved Vertical
  // Intelligence sector is now the highest mode authority, so the PRIMARY product
  // sector (not the served audience sector) controls the page structure that both
  // Preview AND All Files render. Runs BEFORE Page Architecture, the Visual
  // Signature Plan, layout generation and file synthesis. Fully guarded + non-
  // blocking + fail-open; fresh-build only; minimum five sections; revision-safe.
  if (WEB_BUILD_AGENTS_ENABLED && !prev) {
    try {
      const arch = deriveAgentSectionArchitecture({
        prompt, sectionItems, brief: artBrief, inferred,
        research: artifacts?.research, artDirection: artifacts?.artDirection, strategy: artifacts?.strategy,
        verticalIntelligence: artifacts?.verticalIntelligence,
        lang: effLang, isRevision: false,
      });
      if (arch.didRewrite && arch.sectionItems.length >= 5) {
        sectionItems = normalizeSectionItems(arch.sectionItems);
        didRewriteArchitecture = true;
      }
    } catch {
      /* non-blocking — keep the original sectionItems */
    }
  }

  // INTENT-AWARE PAGE ARCHITECTURE (Phase 9D-1) — after the section architecture
  // enforcement, apply a SAFE display/selection pass so the page carries only the
  // sections THIS concept actually supports: rename generic flow labels to the
  // concept-specific one (e.g. "Process" → "Shopper Flow"), drop unsupported proof
  // (Testimonials / Case Studies with no real source) and irrelevant pricing, and
  // reorder into a deliberate product-page flow (hero first, footer last). Section
  // IDs are PRESERVED so anchors + the layout plan stay intact; renderer, layout
  // vocabulary and backend are untouched, and nothing is fabricated. When the set
  // actually changes, files re-synthesize from it so Preview and All Files match.
  // Fully guarded + non-blocking; a >= 5 floor keeps the quality gate satisfied.
  // Phase 9D-2: the Experience Blueprint guides removals + CTA strategy.
  if (WEB_BUILD_AGENTS_ENABLED && !prev) {
    try {
      const decision = derivePageArchitectureDecision(
        prompt, artBrief,
        sectionItems.map((s) => ({ id: s.id, name: s.name })),
        artifacts?.research?.conceptAuthority, artifacts?.strategy, artifacts?.thinkingLedger,
        effLang, artifacts?.experienceBlueprint,
      );
      let next = sectionItems.slice();

      // 1) REMOVE unsupported proof / irrelevant pricing by id, keeping a >= 5 floor
      //    (the planner never targets hero/footer/demo/contact for removal).
      const removeIds = new Set(
        decision.removedSections.map((r) => r.id).filter((id): id is string => !!id),
      );
      if (removeIds.size) {
        const filtered = next.filter((s) => !removeIds.has(s.id));
        if (filtered.length >= 5) next = filtered;
      }

      // 2) RENAME a generic flow label to the concept-specific one. Display text
      //    only; the section id (and therefore its anchor) never changes.
      const flowLabel = decision.recommendedSections.find((l) =>
        /shopper\s*flow|how\s*it\s*works|nasıl|akış/i.test(l));
      if (flowLabel) {
        const GENERIC_FLOW = /^(process|our\s*process|the\s*process|workflow|steps?|how\s*it\s*works|süreç|nasıl\s*çalışır)$/i;
        next = next.map((s) =>
          GENERIC_FLOW.test((s.name || '').trim()) && (s.name || '').trim().toLowerCase() !== flowLabel.toLowerCase()
            ? { ...s, name: flowLabel } : s);
      }

      // 3) REORDER into a deliberate product-page flow: hero first, footer last,
      //    otherwise preserve the current relative order (stable sort).
      const rankOf = (s: WebBuildSectionItem): number => {
        const key = `${s.id} ${s.name}`.toLowerCase();
        if (/hero|banner|masthead/.test(key)) return 0;
        if (/footer|colophon/.test(key)) return 100;
        return 50;
      };
      next = next
        .map((s, i) => ({ s, i, r: rankOf(s) }))
        .sort((a, b) => (a.r - b.r) || (a.i - b.i))
        .map((x) => x.s);

      // Only adopt the reshaped set when it actually differs, and force files to
      // re-synthesize from it so Preview / All Files / timeline stay one strategy.
      const before = sectionItems.map((s) => `${s.id}::${s.name}`).join('|');
      const after = next.map((s) => `${s.id}::${s.name}`).join('|');
      if (before !== after && next.length >= 5) {
        sectionItems = normalizeSectionItems(next);
        didRewriteArchitecture = true;
      }
      artifacts = { ...(artifacts || {}), pageArchitecture: decision };
    } catch {
      /* non-blocking — keep the enforced sectionItems, no decision recorded */
    }
  }

  // VISUAL SIGNATURE PLAN (Phase 9E-1) — after the page architecture is settled,
  // derive a concept-specific CSS/SVG visual signature (hero motif + per-section
  // visuals + honest motion hints) so the Preview renders a recognizable identity
  // instead of generic dark SaaS cards. DATA ONLY: never calls an image/video API,
  // never fabricates logos/metrics/proof; the preview consumes it with composed
  // CSS/SVG modules and falls back to the existing generic visual module. Fully
  // guarded + non-blocking; does not change section ids, files, or the layout plan.
  if (WEB_BUILD_AGENTS_ENABLED) {
    try {
      const visualSignaturePlan = deriveVisualSignaturePlan(
        artBrief,
        sectionItems.map((s) => ({ id: s.id, name: s.name })),
        artifacts?.research?.conceptAuthority,
        artifacts?.pageArchitecture,
        artifacts?.artDirection,
        artifacts?.thinkingLedger,
        effLang,
      );
      artifacts = { ...(artifacts || {}), visualSignaturePlan };
    } catch {
      /* non-blocking — the preview falls back to the generic visual module */
    }
  }

  // Files: when the architecture was rewritten, synthesize from the REWRITTEN
  // sections (NOT the original backend result) so preview and files match. When it
  // was not rewritten, keep the backend-parsed resolveFiles behavior unchanged.
  let files: WebBuildFile[];
  if (didRewriteArchitecture) {
    const plan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
    files = diffFiles(prevFiles, synthesizeFromCopies(itemsToCopies(sectionItems), artBrief, plan));
  } else {
    files = resolveFiles(result, prevFiles, artBrief);
  }

  // Quality gate — repair a weak FRESH build with the inferred industry brief.
  // The layout plan is derived from the FINAL section set so preview, files and
  // timeline all share one strategy-driven composition.
  let usedQualityFallbackSections = false;
  if (!prev && !checkQuality(sectionItems, files.length, effLang).ok) {
    sectionItems = normalizeSectionItems(fallbackSectionItems(inferred, effLang));
    const plan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
    files = diffFiles(prevFiles, synthesizeFromCopies(itemsToCopies(sectionItems), artBrief, plan));
    usedQualityFallbackSections = true;
  }

  // FILES MUST ALWAYS EXIST (Part 4). If — for any reason — the build produced no
  // files (e.g. the model returned only agent/design prose with no Page Sections),
  // synthesize a real project from the inferred brief so Preview / All Files /
  // Open Preview always work. Never return an empty file list.
  let usedFileSynthesisFallback = false;
  if (files.length === 0) {
    if (sectionItems.length === 0) sectionItems = normalizeSectionItems(fallbackSectionItems(inferred, effLang));
    const plan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
    files = diffFiles(prevFiles, synthesizeFromCopies(itemsToCopies(sectionItems), artBrief, plan));
    usedFileSynthesisFallback = true;
  }

  const layoutPlan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));

  // LAYOUT ARCHITECT AGENT — runs after the final plan + sections. It records a
  // Page Blueprint that mirrors the composition the renderer actually uses. Fully
  // guarded: on failure it adds a skipped row and the build continues unchanged.
  if (WEB_BUILD_AGENTS_ENABLED && agents) {
    try {
      const la = runLayoutArchitect(
        sectionItems.map((s) => ({ id: s.id, name: s.name })),
        layoutPlan, artifacts?.research, artifacts?.artDirection, artifacts?.strategy, effLang,
      );
      agents = [...agents, la.agent];
      // Thread the blueprint back into the shared pipeline context so the final
      // build package carries the fully-connected artifact chain.
      const ctx = artifacts?.context
        ? { ...artifacts.context, layoutBlueprint: la.blueprint || null }
        : artifacts?.context;
      artifacts = { ...(artifacts || {}), blueprint: la.blueprint, context: ctx };

      // COMPONENT ENGINEER — consumes the plan + blueprint + upstream artifacts and
      // records the concrete component/file plan the synthesizer emits. Guarded.
      const ce = runComponentEngineer(
        layoutPlan, la.blueprint, artifacts?.research, artifacts?.artDirection, artifacts?.strategy, effLang,
      );
      agents = [...agents, ce.agent];
      artifacts = { ...(artifacts || {}), componentEngineer: ce.artifact };

      // REVIEWER AGENT — an ADVISORY quality gate over the FINAL section list,
      // layout plan and generated files + upstream artifacts. It records honest
      // findings + fix instructions for a future Fixer Agent; it never rewrites the
      // site and fails OPEN, so it can never block Preview / All Files.
      const rv = runReviewer({
        prompt, brief: artBrief,
        research: artifacts?.research, artDirection: artifacts?.artDirection, strategy: artifacts?.strategy,
        blueprint: artifacts?.blueprint, componentEngineer: ce.artifact,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name })),
        layoutPlan,
        files: files.map((f) => ({ path: f.path, content: f.content })),
        lang: effLang,
      });
      agents = [...agents, rv.agent];
      artifacts = { ...(artifacts || {}), reviewer: rv.artifact };

      // QUALITY DIRECTOR (Phase 7A) — runs AFTER the Reviewer and BEFORE the Fixer.
      // An ADVISORY premium-quality judge over the real artifacts: it scores the
      // build (copy clarity, CTA consistency, flow coherence, concept specificity,
      // honesty …) and records copy/label/CTA/flow issues + safe rewrite guidance
      // for the Fixer. It never rewrites the site and fails OPEN, so it can never
      // block Preview / All Files.
      const qd = runQualityDirector({
        prompt, brief: artBrief,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name, headline: s.headline, cta: s.cta, sub: s.sub, bullets: s.bullets })),
        strategy: artifacts?.strategy, artDirection: artifacts?.artDirection,
        reviewer: rv.artifact, research: artifacts?.research, layoutPlan,
        // Phase 8A — judge the build against the committed strategic ledger.
        ledger: artifacts?.thinkingLedger,
        lang: effLang,
      });
      agents = [...agents, qd.agent];
      artifacts = { ...(artifacts || {}), qualityDirector: qd.artifact };

      // ASSET DIRECTOR (Phase 10A) — runs AFTER the Quality Director and BEFORE the
      // Fixer. PLANNING/DATA ONLY: it decides which visual assets the site needs and
      // how each should be produced (composed CSS/SVG now, subtle CSS motion now, or
      // a prompt-ready image slot reserved for a LATER provider phase / manual
      // upload) + honest safety constraints. It NEVER generates an image, calls an
      // image/video API, adds video, or touches the backend, and fails OPEN — so it
      // can never block Preview / All Files. The Preview does NOT consume it yet
      // (that arrives in Phase 10B motion / 10C image pipeline).
      const ad = runAssetDirector({
        prompt, brief: artBrief,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name })),
        conceptAuthority: artifacts?.research?.conceptAuthority,
        artDirection: artifacts?.artDirection,
        strategy: artifacts?.strategy,
        experienceBlueprint: artifacts?.experienceBlueprint,
        visualSignaturePlan: artifacts?.visualSignaturePlan,
        ledger: artifacts?.thinkingLedger,
        lang: effLang,
      });
      agents = [...agents, ad.agent];
      artifacts = { ...(artifacts || {}), assetDirector: ad.artifact };

      // MOTION COMPOSER (Phase 10B) — runs AFTER the Asset Director and BEFORE the
      // Fixer. It consumes the Asset Director's motion-css-now slots and composes
      // concept-specific SUBTLE motion LAYERS the Preview renders with framer-motion
      // / CSS only. It NEVER adds video, image generation, a provider, or a backend
      // call, always respects prefers-reduced-motion, never fakes backend work, and
      // fails OPEN — so it can never block Preview / All Files.
      const mc = runMotionComposer({
        brief: artBrief,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name })),
        artDirection: artifacts?.artDirection,
        blueprint: artifacts?.blueprint,
        experienceBlueprint: artifacts?.experienceBlueprint,
        visualSignaturePlan: artifacts?.visualSignaturePlan,
        assetDirector: ad.artifact,
        lang: effLang,
      });
      agents = [...agents, mc.agent];
      artifacts = { ...(artifacts || {}), motionComposer: mc.artifact };

      // IMAGE PIPELINE (Phase 10C) — runs AFTER the Motion Composer and BEFORE the
      // Fixer. It turns the Asset Director's image-prompt-later / image-provider-
      // later / manual-upload-later slots into a structured, provider-READY plan the
      // Preview renders as HONEST placeholders. It NEVER calls an image API,
      // generates a real image, uploads to a backend, or adds video, and fails OPEN.
      const ip = runImagePipeline({
        brief: artBrief,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name })),
        artDirection: artifacts?.artDirection,
        experienceBlueprint: artifacts?.experienceBlueprint,
        assetDirector: ad.artifact,
        motionComposer: mc.artifact,
        lang: effLang,
      });
      agents = [...agents, ip.agent];
      artifacts = { ...(artifacts || {}), imagePipeline: ip.artifact };

      // FIXER AGENT (Phase 6 + 7A) — runs AFTER the Reviewer + Quality Director. It
      // consumes the reviewer artifact AND the quality director's issues / rewrite
      // instructions, and applies a NARROW set of SAFE, deterministic repairs to the
      // FINAL data (fake-metric cleanup, placeholder cleanup, dead CTA-anchor sanity,
      // plus public-facing copy/label/CTA/flow-label cleanup). It never redesigns and
      // fails OPEN, so it can never block Preview / All Files. When it sanitizes file
      // content we recompute the diffs against the previous build so the diff metadata
      // stays honest (no stale/fake stats).
      const fx = runFixer({
        prompt, brief: artBrief, reviewer: rv.artifact,
        sectionItems: sectionItems.map((s) => ({ id: s.id, name: s.name, headline: s.headline, sub: s.sub, cta: s.cta, bullets: s.bullets })),
        files: files.map((f) => ({ path: f.path, content: f.content })),
        // Concept Authority + art direction let the Fixer safely re-assert the
        // primary-concept archetype and add a missing Visual Asset Plan (data only).
        artDirection: artifacts?.artDirection,
        conceptAuthority: artifacts?.research?.conceptAuthority,
        // Quality Director issues + rewrite guidance drive the safe copy/label/CTA
        // repairs; the primary conversion intent normalizes awkward CTA labels.
        qualityDirector: qd.artifact,
        primaryConversionIntent: artifacts?.strategy?.interactionContract?.primaryConversionIntent,
        // Phase 8A — repair generic filler labels to the ledger's concept-specific ones.
        ledger: artifacts?.thinkingLedger,
        // Phase 9D-2B — the blueprint's site type drives the non-SaaS proof/copy guard.
        experienceBlueprint: artifacts?.experienceBlueprint,
        lang: effLang,
      });
      agents = [...agents, fx.agent];
      artifacts = { ...(artifacts || {}), fixer: fx.artifact };
      // Apply the Fixer's concept-drift-corrected art direction back onto the
      // artifacts so the final package + Plan Summary reflect the corrected
      // archetype / Visual Asset Plan. Additive only; never touches Preview/files.
      if (fx.artDirection) {
        artifacts = { ...(artifacts || {}), artDirection: fx.artDirection };
      }

      // Apply the Fixer's sanitized file CONTENT back onto the real WebBuildFile
      // objects (preserving summary/language) and recompute the diff so Preview
      // and All Files consume the same final, honestly-diffed data. Section items
      // are unchanged by the v1 Fixer, so the layout plan stays valid as-is.
      if (fx.artifact.status === 'applied') {
        const fixedByPath = new Map(fx.files.map((f) => [f.path, f.content]));
        const anyContentChanged = files.some((f) => {
          const c = fixedByPath.get(f.path);
          return c !== undefined && c !== f.content;
        });
        if (anyContentChanged) {
          const merged = files.map((f) => ({ ...f, content: fixedByPath.get(f.path) ?? f.content }));
          files = diffFiles(prevFiles, merged);
        }
        // Apply the Fixer's safe, DISPLAY-ONLY copy/label/CTA repairs (Phase 7A/9C-1)
        // back onto the final section items by id, so Preview + All Files + Plan
        // Summary all consume the same cleaned public-facing copy. Phase 9C-1 also
        // repairs headline/sub/bullets (public copy) — all DISPLAY fields; ids are
        // untouched, so the layout plan stays valid as-is (no architecture rewrite).
        const fixedById = new Map(fx.sectionItems.map((s) => [s.id, s]));
        sectionItems = sectionItems.map((s) => {
          const f = fixedById.get(s.id);
          if (!f) return s;
          return {
            ...s,
            name: f.name || s.name,
            cta: f.cta !== undefined ? f.cta : s.cta,
            headline: f.headline !== undefined ? f.headline : s.headline,
            sub: f.sub !== undefined ? f.sub : s.sub,
            bullets: f.bullets !== undefined ? f.bullets : s.bullets,
          };
        });
      }

      // FRONTEND BUILD SPECIFICATION (Phase 12A) — derived AFTER all planning
      // artifacts + the Fixer's final section-copy repairs, and BEFORE enforcement +
      // payload return. Consolidates identity / design / architecture / FINAL copy /
      // interactions / assets / motion / research evidence / honesty rules into ONE
      // authoritative, typed CONTRACT for a FUTURE dedicated Frontend Builder model
      // (Phase 12B). CONTRACT ONLY: it never calls a model/backend/network, never
      // generates code, and is built from planning + the FINAL sectionItems — NEVER
      // from the current synthesized files. It does NOT alter files / sectionItems /
      // layoutPlan / planning diagnostics / reply. Fully guarded + fail-open.
      try {
        const frontendBuildSpec = deriveFrontendBuildSpecification({
          prompt,
          lang: effLang,
          brief: artBrief,
          sectionItems,
          layoutPlan,
          research: artifacts?.research,
          thinkingLedger: artifacts?.thinkingLedger,
          artDirection: artifacts?.artDirection,
          strategy: artifacts?.strategy,
          experienceBlueprint: artifacts?.experienceBlueprint,
          verticalIntelligence: artifacts?.verticalIntelligence,
          pageArchitecture: artifacts?.pageArchitecture,
          visualSignaturePlan: artifacts?.visualSignaturePlan,
          blueprint: artifacts?.blueprint,
          componentEngineer: artifacts?.componentEngineer,
          reviewer: artifacts?.reviewer,
          qualityDirector: artifacts?.qualityDirector,
          assetDirector: artifacts?.assetDirector,
          motionComposer: artifacts?.motionComposer,
          imagePipeline: artifacts?.imagePipeline,
          fixer: artifacts?.fixer,
        });
        artifacts = { ...(artifacts || {}), frontendBuildSpec };
      } catch {
        // deriveFrontendBuildSpecification already fails open; never block the build.
      }

      // ENFORCEMENT — prove the agents drove the build (Part 6). The layout plan is
      // derived from the enriched (agent-steered) brief, so the archetype following
      // the agent decision is verifiable; the generated files come from that same
      // plan, so the component plan is honored 1:1.
      const enforcement: WebBuildEnforcement = {
        didUseResearchAgent: !!artifacts?.research && !artifacts.context?.fallbacks?.includes('research'),
        didUseArtDirection: !!artifacts?.artDirection,
        didUseStrategy: !!artifacts?.strategy,
        didUseLayoutBlueprint: !!artifacts?.blueprint,
        didUseComponentPlan: !!artifacts?.componentEngineer,
        didPlanFollowAgents: !!artBrief.agentArchetype && layoutPlan.archetype === artBrief.agentArchetype,
        // UI / Art Director handoff trace — verifiable from real artifact metadata
        // (each downstream artifact records the art-direction inputs it consumed).
        didUseResearchInputs: !!artifacts?.artDirection?.usedResearchInputs?.length,
        didCreateArtDirection: !!artifacts?.artDirection && artifacts.artDirection.status !== 'failed',
        didPassArtDirectionToStrategy: !!artifacts?.strategy?.usedArtDirectionInputs?.length,
        didPassArtDirectionToLayout: !!artifacts?.blueprint?.usedArtDirectionInputs?.length,
        didPassArtDirectionToComponents: !!artifacts?.componentEngineer?.usedArtDirectionInputs?.length,
        didIncludeArtDirectionInFinalPayload: !!artifacts?.artDirection,
        // Reviewer gate trace (Phase 5) — real artifact presence only.
        didRunReviewer: !!artifacts?.reviewer,
        didReviewerFindCriticalIssues: (artifacts?.reviewer?.findings || []).some((f) => f.severity === 'critical'),
        didIncludeReviewerInFinalPayload: !!artifacts?.reviewer,
        // Fixer trace (Phase 6) — real artifact presence + real applied-change count.
        didRunFixer: !!artifacts?.fixer,
        didFixerApplyChanges: (artifacts?.fixer?.appliedChanges || []).length > 0,
        didIncludeFixerInFinalPayload: !!artifacts?.fixer,
        // Concept Authority + Visual Quality gate (Phase 5) — real artifact data only.
        primaryConcept: artifacts?.research?.conceptAuthority?.primaryConcept,
        targetVertical: artifacts?.research?.conceptAuthority?.targetVertical
          || artifacts?.research?.conceptAuthority?.audienceVertical,
        conceptAuthorityConfidence: artifacts?.research?.conceptAuthority?.confidence,
        didDetectConceptDrift: (artifacts?.reviewer?.findings || []).some((f) => f.category === 'concept-drift'),
        didFixConceptDrift: (artifacts?.fixer?.appliedChanges || []).some((c) => c.category === 'concept-drift')
          || !!artifacts?.artDirection?.correctedConceptDrift,
        didCreateVisualAssetPlan: !!artifacts?.artDirection?.visualAssetPlan?.assetSlots?.length,
        // Quality Director + Copy/CTA Fixer (Phase 7A) — real artifact data only.
        didRunQualityDirector: !!artifacts?.qualityDirector,
        qualityScore: artifacts?.qualityDirector?.score,
        qualityStatus: artifacts?.qualityDirector?.status,
        qualityCriticalCount: (artifacts?.qualityDirector?.issues || []).filter((i) => i.severity === 'critical').length,
        qualityWarningCount: (artifacts?.qualityDirector?.issues || []).filter((i) => i.severity === 'warning').length,
        didFixCopyLabels: (artifacts?.fixer?.qualityAppliedChanges || []).some((c) => c.category === 'copy-label'),
        didFixCtaConsistency: (artifacts?.fixer?.qualityAppliedChanges || []).some((c) => c.category === 'cta-consistency'),
        didFixFlowLabels: (artifacts?.fixer?.qualityAppliedChanges || []).some((c) => c.category === 'flow-label'),
        // Asset Director (Phase 10A) — real artifact data only (planning; no assets generated).
        didRunAssetDirector: !!artifacts?.assetDirector,
        assetSlotCount: (artifacts?.assetDirector?.slots || []).length,
        cssSvgAssetSlotCount: (artifacts?.assetDirector?.cssSvgNowSlots || []).length,
        motionAssetSlotCount: (artifacts?.assetDirector?.motionNowSlots || []).length,
        imageLaterAssetSlotCount: (artifacts?.assetDirector?.imageLaterSlots || []).length,
        manualUploadAssetSlotCount: (artifacts?.assetDirector?.slots || []).filter((s) => s.generationMode === 'manual-upload-later').length,
        imageProviderNeeded: !!artifacts?.assetDirector?.providerReadiness?.imageProviderNeeded,
        motionProviderNeeded: !!artifacts?.assetDirector?.providerReadiness?.motionProviderNeeded,
        // Motion Composer (Phase 10B) — real artifact data only (subtle CSS motion).
        didRunMotionComposer: !!artifacts?.motionComposer,
        motionLayerCount: (artifacts?.motionComposer?.layers || []).length,
        globalMotionLayerCount: (artifacts?.motionComposer?.globalMotion || []).length,
        heroMotionLayerCount: (artifacts?.motionComposer?.heroMotion || []).length,
        sectionMotionLayerCount: (artifacts?.motionComposer?.sectionMotion || []).length,
        consumedMotionAssetSlotCount: (artifacts?.motionComposer?.consumedAssetSlots || []).length,
        reducedMotionReady: !!artifacts?.motionComposer && !!artifacts.motionComposer.reducedMotionPolicy,
        // Image Pipeline (Phase 10C) — real artifact data only (no images generated/uploaded).
        didRunImagePipeline: !!artifacts?.imagePipeline,
        imageAssetSlotCount: (artifacts?.imagePipeline?.slots || []).length,
        manualUploadImageSlotCount: (artifacts?.imagePipeline?.manualUploadSlots || []).length,
        providerReadyImageSlotCount: (artifacts?.imagePipeline?.providerReadySlots || []).length,
        promptReadyImageSlotCount: (artifacts?.imagePipeline?.promptReadySlots || []).length,
        cssPlaceholderImageSlotCount: (artifacts?.imagePipeline?.cssPlaceholderSlots || []).length,
        imageProviderReady: !!artifacts?.imagePipeline?.providerReadiness?.readyForProvider,
        generatedImagePolicy: artifacts?.imagePipeline?.generatedImagePolicy,
        // Visual Exploration + anti-template gate (Phase 7B) — real artifact data only.
        visualCandidateCount: (artifacts?.artDirection?.visualExploration?.candidates || []).length,
        selectedVisualCandidate: artifacts?.artDirection?.visualExploration?.selectedCandidateId,
        rejectedVisualCandidates: artifacts?.artDirection?.visualExploration?.rejectedCandidateIds,
        selectionReason: artifacts?.artDirection?.visualExploration?.selectionReason,
        paletteFamily: artifacts?.artDirection?.paletteFamily
          || artifacts?.artDirection?.visualExploration?.candidates.find((c) => c.id === artifacts?.artDirection?.visualExploration?.selectedCandidateId)?.paletteFamily,
        antiTemplateWarnings: (artifacts?.qualityDirector?.issues || []).filter((i) => ['same-template-risk', 'accent-overuse', 'dashboard-overuse', 'palette-mismatch', 'visual-monotony', 'weak-visual-exploration'].includes(i.category)).length,
        correctedAntiTemplateDrift: !!artifacts?.artDirection?.correctedAntiTemplateDrift
          || (artifacts?.fixer?.appliedChanges || []).some((c) => ['visual-direction', 'palette-family', 'accent-strategy', 'anti-template-copy'].includes(c.category)),
        qualitySameTemplateIssues: (artifacts?.qualityDirector?.issues || []).filter((i) => i.category === 'same-template-risk').length,
        // Vertical Intelligence (Phase 11A) — real artifact data only (deterministic
        // sector classification; no live research is ever run in this phase).
        didDeriveVerticalIntelligence: !!artifacts?.verticalIntelligence,
        verticalSector: artifacts?.verticalIntelligence?.sector,
        verticalSubsector: artifacts?.verticalIntelligence?.subsector,
        verticalAudienceSector: artifacts?.verticalIntelligence?.audienceSector,
        verticalClassificationBasis: artifacts?.verticalIntelligence?.classificationBasis,
        verticalBusinessModel: artifacts?.verticalIntelligence?.businessModel,
        verticalConfidence: artifacts?.verticalIntelligence?.confidence,
        verticalRequiredSectionCount: (artifacts?.verticalIntelligence?.sectionPolicy?.required || []).length,
        verticalRecommendedSectionCount: (artifacts?.verticalIntelligence?.sectionPolicy?.recommended || []).length,
        verticalForbiddenSectionCount: (artifacts?.verticalIntelligence?.sectionPolicy?.forbidden || []).length,
        verticalRealSourceVisualCount: (artifacts?.verticalIntelligence?.visualPolicy?.realSourceRequired || []).length,
        verticalAiIllustrativeVisualCount: (artifacts?.verticalIntelligence?.visualPolicy?.aiIllustrativeAllowed || []).length,
        verticalCssSvgVisualCount: (artifacts?.verticalIntelligence?.visualPolicy?.cssSvgPreferred || []).length,
        verticalMotionSuitableCount: (artifacts?.verticalIntelligence?.visualPolicy?.motionSuitable || []).length,
        verticalResearchRecommended: !!artifacts?.verticalIntelligence?.researchPlan?.recommended,
        verticalResearchStatus: artifacts?.verticalIntelligence?.researchPlan?.status,
        // Phase 11B — source-backed evidence trace (real Research Agent data only).
        verticalResearchDidUseSources: !!artifacts?.verticalIntelligence?.researchPlan?.evidence?.didResearch,
        verticalResearchSourceCount: artifacts?.verticalIntelligence?.researchPlan?.evidence?.sourceCount,
        verticalResearchProvider: artifacts?.verticalIntelligence?.researchPlan?.evidence?.provider,
        // Frontend Build Specification (Phase 12A) — diagnostics only; generation is
        // always 'not-run' (no model-native code generation occurred).
        didCreateFrontendBuildSpec: !!artifacts?.frontendBuildSpec,
        frontendBuildSpecStatus: artifacts?.frontendBuildSpec?.status,
        frontendBuildSpecSectionCount: artifacts?.frontendBuildSpec?.architecture.sections.length,
        frontendBuildSpecRequiredFileCount: artifacts?.frontendBuildSpec?.outputContract.requiredFiles.length,
        frontendBuildSpecResearchSourceCount: artifacts?.frontendBuildSpec?.researchEvidence.sources.length,
        frontendGenerationStatus: artifacts?.frontendBuildSpec?.generation.status,
        fallbackReason: (artifacts?.context?.fallbacks?.length
          ? `agents degraded: ${artifacts.context.fallbacks.join(', ')}`
          : undefined),
      };
      artifacts = { ...(artifacts || {}), enforcement };
    } catch {
      /* non-blocking — keep the upstream agents as-is */
    }
  }

  const changed = files.filter((f) => f.status !== 'unchanged');
  const summary: WebBuildSummary = {
    type: mergedBrief.type,
    sectionNames: sectionItems.map((s) => s.name),
    fileCount: files.length,
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  };
  // Real research sources (backend web_research). Keep the first build's
  // sources on later revisions unless a new pass returned some.
  const sources: WebBuildSource[] | undefined =
    (result.sources && result.sources.length ? result.sources : prev?.sources) || undefined;
  const activity = deriveBuildActivity(result, files, sources, layoutPlan);

  // Planning-quality gate — honest label of model-planned vs frontend-synthesized.
  // `hasModelWEP` reads the BACKEND brief (not the inferred fallback), so an inferred
  // industry brief never counts as a model-returned Website Experience Plan.
  const planningDiagnostics = computePlanningDiagnostics({
    parse: result.parseDiagnostics,
    hasModelWEP: !!(backendBrief.websiteExperienceModel || backendBrief.pageScreenModel || backendBrief.primaryWebsiteExperience),
    hasStrategyWEP: !!artifacts?.strategy?.websiteExperiencePlan,
    hasContract: !!artifacts?.strategy?.interactionContract,
    usedArchitectureRewrite: didRewriteArchitecture,
    usedQualityFallbackSections,
    usedFileSynthesisFallback,
    usedSafePayloadFallback: false,
  });

  const step: WebBuildStep = {
    id: `step-${uid()}`,
    at: now,
    kind: prev ? 'revision' : 'build',
    prompt,
    summary,
    files,
    activity,
    reply: result.reply,
    // Only a fresh build actually ran research; a revision step has none.
    research: prev ? undefined : result.research,
    agents,
    artifacts,
    layoutPlan,
    planningDiagnostics,
  };
  return {
    source: 'web_build',
    prompt: prev?.prompt || prompt,
    // The Art-Director-enriched brief IS the persisted brief so the preview and
    // any recompute use the same art-direction palette + strategy fields.
    brief: artBrief,
    sectionItems,
    sections: result.sections,
    files,
    reply: result.reply,
    sources,
    research,
    layoutPlan,
    agents,
    artifacts,
    activity,
    planningDiagnostics,
    steps: prev ? [...prev.steps, step] : [step],
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Absolute last-resort real file set — used ONLY when both concept synthesis and
 * backend file resolution fail or return nothing, so All Files is never empty. It
 * serializes the REAL section copy (no fabricated metrics, prices, sources or
 * institutions), which keeps the package honest and openable.
 */
function minimalProjectFiles(items: WebBuildSectionItem[], brief: WebBuildBrief): SynthFile[] {
  const data = {
    type: brief.type || '',
    sections: items.map((s) => ({
      id: s.id, name: s.name,
      headline: s.headline || '', sub: s.sub || '', cta: s.cta || '',
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
    })),
  };
  return [{
    path: 'src/data/siteContent.ts',
    language: 'ts',
    summary: 'Structured site content (section copy)',
    content: `export const siteContent = ${JSON.stringify(data, null, 2)} as const;\n`,
  }];
}

/**
 * Self-healing fallback assembly. Runs only when the normal assembly threw. It
 * rebuilds a COMPLETE package (non-empty sectionItems / files / steps / activity
 * + a usable brief) from concept-appropriate sections — reusing the deterministic
 * section-architecture playbook (archive → archive structure, etc.) so the result
 * is never generic SaaS filler. Every step is independently guarded so this path
 * itself can never throw. No fabricated data — only real inferred/structural copy.
 */
function synthesizeSafePayload(
  prompt: string, result: WebBuildResult, prev?: WebBuildPayload, lang?: string,
): WebBuildPayload {
  const now = new Date().toISOString();
  const effLang = resolveBuildWebsiteLanguage(prompt, prev, lang);
  const inferred = inferWebsiteBrief(prompt, effLang);

  let brief: WebBuildBrief;
  try {
    const backendBrief = extractBrief(result.sections);
    brief = {
      ...backendBrief,
      type: backendBrief.type || inferred.businessType,
      audience: backendBrief.audience || inferred.targetAudience,
      goal: backendBrief.goal || inferred.conversionGoal,
      style: backendBrief.style || backendBrief.visualMood || inferred.visualStyle,
      primaryCTA: backendBrief.primaryCTA || inferred.primaryCTA,
      secondaryCTA: backendBrief.secondaryCTA || inferred.secondaryCTA,
    };
  } catch {
    brief = { type: inferred.businessType };
  }
  const mergedBrief: WebBuildBrief = prev ? { ...prev.brief, ...brief } : brief;

  // Concept-appropriate sections: prefer the (normalized) parsed set, upgrade to
  // the deterministic architecture playbook when it yields a real structure, and
  // finally fall back to the inferred industry section set. Always normalized.
  let sectionItems: WebBuildSectionItem[] = [];
  try { sectionItems = normalizeSectionItems(parseSectionItems(result)); } catch { sectionItems = []; }
  try {
    const arch = deriveAgentSectionArchitecture({
      prompt, sectionItems, brief: mergedBrief, inferred, lang: effLang, isRevision: !!prev,
    });
    if (arch.sectionItems.length >= 5) sectionItems = normalizeSectionItems(arch.sectionItems);
  } catch { /* keep parsed items */ }
  if (sectionItems.length === 0) {
    try { sectionItems = normalizeSectionItems(fallbackSectionItems(inferred, effLang)); } catch { sectionItems = []; }
  }

  const prevFiles: WebBuildFile[] | undefined = prev?.files;
  let files: WebBuildFile[] = [];
  try {
    const plan = deriveLayoutPlan(mergedBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
    files = diffFiles(prevFiles, synthesizeFromCopies(itemsToCopies(sectionItems), mergedBrief, plan));
  } catch {
    try { files = resolveFiles(result, prevFiles, mergedBrief); } catch { files = []; }
  }
  if (files.length === 0) files = diffFiles(prevFiles, minimalProjectFiles(sectionItems, mergedBrief));

  let layoutPlan: WebBuildLayoutPlan | undefined;
  try { layoutPlan = deriveLayoutPlan(mergedBrief, sectionItems.map((s) => ({ id: s.id, name: s.name }))); }
  catch { layoutPlan = undefined; }

  let activity: WebBuildActivityRow[];
  try { activity = deriveBuildActivity(result, files, result.sources, layoutPlan); }
  catch {
    activity = [
      { id: 'plan', labelKey: 'wbActPlan', status: 'done' },
      { id: 'package', labelKey: 'wbActPackage', params: { count: files.length }, status: 'done' },
      { id: 'save', labelKey: 'wbActSave', status: 'waiting' },
    ];
  }

  const changed = files.filter((f) => f.status !== 'unchanged');
  const summary: WebBuildSummary = {
    type: mergedBrief.type,
    sectionNames: sectionItems.map((s) => s.name),
    fileCount: files.length,
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  };
  // This path only runs after the normal assembly THREW — force a frontend-fallback
  // planning label so a synthesized package is never mistaken for a model-planned one.
  const planningDiagnostics = computePlanningDiagnostics({
    parse: result.parseDiagnostics,
    hasModelWEP: false,
    hasStrategyWEP: false,
    hasContract: false,
    usedArchitectureRewrite: false,
    usedQualityFallbackSections: false,
    usedFileSynthesisFallback: false,
    usedSafePayloadFallback: true,
  });

  const step: WebBuildStep = {
    id: `step-${uid()}`, at: now, kind: prev ? 'revision' : 'build', prompt,
    summary, files, activity, reply: result.reply,
    research: prev ? undefined : result.research,
    layoutPlan,
    planningDiagnostics,
  };
  return {
    source: 'web_build',
    prompt: prev?.prompt || prompt,
    brief: mergedBrief,
    sectionItems,
    sections: result.sections,
    files,
    reply: result.reply,
    sources: (result.sources && result.sources.length ? result.sources : prev?.sources) || undefined,
    research: result.research || prev?.research || undefined,
    layoutPlan,
    activity,
    planningDiagnostics,
    steps: prev ? [...prev.steps, step] : [step],
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Steps for rendering — with a fallback for OLD payloads saved before the
 * conversation model existed (they have no `steps`). Synthesizes one build
 * step from whatever the old payload has, so existing projects still render.
 */
export function payloadSteps(p: WebBuildPayload): WebBuildStep[] {
  if (p.steps && p.steps.length) return p.steps;
  const legacyFiles: WebBuildFile[] = Array.isArray(p.files)
    ? (p.files as unknown[]).map((f) =>
        typeof f === 'string'
          ? { path: f, content: '', status: 'created' as const, added: 0, removed: 0 }
          : (f as WebBuildFile),
      )
    : [];
  return [{
    id: `step-legacy`,
    at: p.createdAt || new Date().toISOString(),
    kind: 'build',
    prompt: p.prompt,
    summary: {
      type: p.brief?.type,
      sectionNames: (p.sectionItems || []).map((s) => s.name),
      fileCount: legacyFiles.length,
      added: legacyFiles.reduce((n, f) => n + (f.added || 0), 0),
      removed: 0,
    },
    files: legacyFiles,
    activity: p.activity || [],
    reply: p.reply || '',
  }];
}
