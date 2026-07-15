/**
 * Web Build FRONTEND QUALITY PIPELINE (Phase 12E) — the SINGLE shared frontend-builder
 * sequence for BOTH build entry points (ChatWebBuild + WebsiteBuilder) and for both
 * fresh builds and revisions. Neither entry point may duplicate this orchestration.
 *
 * Sequence:
 *   generateFrontendBuilderRaw + attachFrontendBuilderRaw   (Phase 12B/12C/12D, unchanged)
 *     → eligibility gate (consumption model-native + validation valid + ready + files>0)
 *     → STATIC initial design review (parseFrontendBuilderReview)
 *         PASS  → acceptance 'approved', keep the initial model-native files
 *         FAIL  → (only when the review parsed AND lists actionable issues) exactly ONE
 *                 bounded repair → UNCHANGED Phase 12C re-validation → STATIC post-repair
 *                 review → guarded acceptance (valid + final pass + score improved).
 *
 * Model-call ceiling per turn: initial builder ×1, initial review ≤1, repair ≤1,
 * post-repair review ≤1. Fallback (non-eligible) builds make ZERO Phase 12E calls.
 *
 * HONESTY BOUNDARY: this is a STATIC review of specification + source only. No
 * screenshot, browser DOM, runtime compilation or Sandpack output is observed. Every
 * artifact records renderedScreenshotReviewed:false, runtimeCompilationReviewed:false
 * and renderedVisualTestStatus:'pending-manual-test'. A real rendered visual test is
 * performed MANUALLY after Phase 12E merges.
 *
 * FAIL-OPEN: every Phase 12E problem (reviewer timeout/network/malformed JSON/oversize,
 * repair timeout/network/malformed envelope, invalid repaired project, post-repair
 * review failure, no score improvement) preserves the existing active Phase 12D project
 * and its Preview / All Files. ONLY an explicit caller cancellation propagates.
 */
import {
  generateFrontendBuilderRaw, generateFrontendBuilderReviewRaw, generateFrontendBuilderRepairRaw,
  generateFrontendBuilderContractRepairRaw, WebBuildError, mapFrontendGenerationError,
} from '@/lib/webBuildApi';
import {
  attachFrontendBuilderRaw, attachFrontendBuilderQualityResult,
  attachFrontendBuilderContractRepairResult,
  type WebBuildPayload, type WebBuildFile,
} from '@/lib/webBuildPayload';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import {
  parseFrontendBuilderReview, synthesizeDeterministicReviewIssues,
  mergeDeterministicIssues, buildDeterministicFallbackReview,
} from '@/lib/webBuildFrontendReview';
import type {
  FrontendBuildSpecification, FrontendGeneratedFile,
  FrontendBuilderRepairArtifact, FrontendBuilderAcceptanceArtifact,
  FrontendBuilderContractRepairArtifact, FrontendBuilderValidationArtifact, FrontendBuilderRawArtifact,
  FrontendBuilderReviewArtifact, FrontendBuilderReviewIssue,
} from '@/lib/webBuildAgents';
import type { WebBuildActivityDetailRow, WebBuildActivityReporter, WebBuildActivityStatus } from '@/lib/webBuildActivity';

/* ── Phase 13H — bounded, SAFE activity detail builders. These describe REAL pipeline
 * results only (counts / statuses / durations); they never expose generated source, raw
 * responses, provider request ids or background job ids. Activity reporting is pure UI
 * telemetry: it adds ZERO model calls and can never change generation/acceptance. */
function generationRows(raw: FrontendBuilderRawArtifact): WebBuildActivityDetailRow[] {
  const rows: WebBuildActivityDetailRow[] = [
    { label: 'transport', value: raw.backgroundMode ? 'background' : 'sync' },
  ];
  if (typeof raw.backgroundWaitMs === 'number') rows.push({ label: 'waited', value: `${Math.round(raw.backgroundWaitMs / 1000)}s` });
  if (typeof raw.configuredMaxOutputTokens === 'number') rows.push({ label: 'outputBudget', value: `${raw.configuredMaxOutputTokens} tok` });
  return rows;
}
function validationRows(v: FrontendBuilderValidationArtifact | undefined): WebBuildActivityDetailRow[] | undefined {
  if (!v) return undefined;
  const rows: WebBuildActivityDetailRow[] = [
    { label: 'files', value: String(v.fileCount ?? 0) },
    { label: 'validation', value: v.status },
    { label: 'errors', value: String(v.errors?.length ?? 0) },
    { label: 'warnings', value: String(v.warnings?.length ?? 0) },
  ];
  if (typeof v.presentRequiredFileCount === 'number') rows.push({ label: 'entryFiles', value: `${v.presentRequiredFileCount}/${v.requiredFileCount}` });
  return rows;
}
function reviewRows(r: FrontendBuilderReviewArtifact): WebBuildActivityDetailRow[] {
  const rows: WebBuildActivityDetailRow[] = [{ label: 'result', value: r.passed ? 'passed' : 'needs work' }];
  if (typeof r.score === 'number') rows.push({ label: 'score', value: String(r.score) });
  rows.push({ label: 'issues', value: String(r.issues?.length ?? 0) });
  return rows;
}
function acceptanceRows(
  status: FrontendBuilderAcceptanceArtifact['status'],
  activeProject: FrontendBuilderAcceptanceArtifact['activeProject'],
): WebBuildActivityDetailRow[] {
  return [
    { label: 'candidate', value: status },
    { label: 'activeProject', value: activeProject },
    { label: 'manualReview', value: status === 'manual-review-required' ? 'yes' : 'no' },
  ];
}

/** The minimum improvement gate: an accepted repair must beat the initial score. */
const MIN_ACCEPT_SCORE = 82;

/* ── Phase 13B — thread the STATIC validator's deterministic quality WARNINGS into the
 * bounded review + repair prompts WITHOUT any extra model call. These are advisory
 * signals (shallow-project / shallow-section / minimal-styles / repetitive-section-
 * structure / internal-copy-leak / missing-hero-visual-layer); the reviewer still judges
 * independently and the repair still preserves public copy. Bounded to 8 summaries. */
function warningSummaries(validation: FrontendBuilderValidationArtifact | undefined): string[] | undefined {
  const ws = validation?.warnings;
  if (!Array.isArray(ws) || ws.length === 0) return undefined;
  const out = ws.slice(0, 8).map((w) => `${w.code}: ${w.message}`.slice(0, 240));
  return out.length ? out : undefined;
}

/* ── Phase 13C — SEVERE deterministic quality warnings. A model reviewer must never be
 * able to approve a project (initial OR post-repair) while the static validator still
 * proves a severe skeleton. Project-level severe = shallow-project / internal-copy-leak /
 * missing-hero-visual-layer / minimal-styles / repetitive-section-structure. The allowance
 * is: zero project-level severe warnings + at most ONE minor shallow-section warning. */
function severeWarningCodes(v: FrontendBuilderValidationArtifact | undefined): string[] {
  if (!v) return [];
  const codes: string[] = [];
  if (v.shallowProjectDetected) codes.push('shallow-project');
  if ((v.internalCopyLeakCount ?? 0) > 0) codes.push('internal-copy-leak');
  if (v.missingHeroVisualLayerDetected) codes.push('missing-hero-visual-layer');
  if (v.minimalStylesDetected) codes.push('minimal-styles');
  if (v.repetitiveSectionStructureDetected) codes.push('repetitive-section-structure');
  if ((v.shallowSectionCount ?? 0) > 1) codes.push(`shallow-section×${v.shallowSectionCount}`);
  else if ((v.shallowSectionCount ?? 0) === 1) codes.push('shallow-section×1');
  return codes;
}

/** True when the project clears the severe-warning acceptance gate (Phase 13C). */
function severeWarningGatePassed(v: FrontendBuilderValidationArtifact | undefined): boolean {
  if (!v) return true;
  const projectLevelSevere = !!v.shallowProjectDetected
    || (v.internalCopyLeakCount ?? 0) > 0
    || !!v.missingHeroVisualLayerDetected
    || !!v.minimalStylesDetected
    || !!v.repetitiveSectionStructureDetected;
  if (projectLevelSevere) return false;
  if ((v.shallowSectionCount ?? 0) > 1) return false; // at most one minor shallow-section allowed
  return true;
}

/** Recompute a healthy model review after merging deterministic severe issues into it.
 *  `passed` is recomputed from the merged severity counts, so a model "pass" that ignored
 *  a severe skeleton becomes a repair. Pure; never fabricates score/verdict. */
function recomputeReviewWithMergedIssues(
  base: FrontendBuilderReviewArtifact,
  mergedIssues: FrontendBuilderReviewIssue[],
  addedDeterministic: number,
): FrontendBuilderReviewArtifact {
  const blockerCount = mergedIssues.filter((i) => i.severity === 'blocker').length;
  const majorCount = mergedIssues.filter((i) => i.severity === 'major').length;
  const minorCount = mergedIssues.filter((i) => i.severity === 'minor').length;
  const passed = base.verdict === 'pass' && (base.score ?? 0) >= MIN_ACCEPT_SCORE && blockerCount === 0 && majorCount === 0;
  return {
    ...base,
    issues: mergedIssues,
    blockerCount,
    majorCount,
    minorCount,
    passed,
    usedDeterministicFallback: base.usedDeterministicFallback || addedDeterministic > 0,
    deterministicIssueCount: (base.deterministicIssueCount ?? 0) + addedDeterministic,
    reason: passed
      ? base.reason
      : `${base.reason} + ${addedDeterministic} deterministic severe issue(s) merged (skeleton evidence blocks approval).`.slice(0, 300),
  };
}

/* ── Phase 12F.3 — deterministic preservation-gate thresholds (no model call). A genuine
 * structural contract repair may restructure, but it must not COLLAPSE the parsed initial
 * project into a technically-valid skeleton. These bounds reject the observed failure mode
 * (a rich project reduced to ~12 tiny 15–17 line components / ~4.7k chars). */
const PRESERVATION_MIN_CHAR_RATIO = 0.5;   // repaired total chars ≥ 50% of the initial
const PRESERVATION_MIN_RETAINED_RATIO = 0.6; // ≥ 60% of initial file paths must survive
const PRESERVATION_MAX_SHRUNK_RATIO = 0.34;  // ≤ 34% of retained files may severely shrink
const SHRINK_FLOOR_CHARS = 200;            // only files that WERE substantial can "shrink"
const SHRINK_RATIO = 0.4;                  // retained file kept < 40% of its size = shrunk

interface PreservationGate {
  passed: boolean;
  rejectionReason?: string;
  initialFileCount: number;
  repairedFileCount: number;
  initialCharCount: number;
  repairedCharCount: number;
  retainedPathCount: number;
  removedPaths: string[];
  severelyShrunkFiles: string[];
  preservationRatio: number;
}

/**
 * Compare a structurally-valid repaired project against the parsed INITIAL project and
 * decide whether the repair PRESERVED it (vs collapsed it). Pure, deterministic, bounded.
 * Used ONLY for genuine structural repairs — a missing-critical-copy-only project never
 * reaches structural repair, so this gate is not consulted for it.
 */
function evaluatePreservationGate(
  initialFiles: FrontendGeneratedFile[],
  repairedFiles: FrontendGeneratedFile[],
): PreservationGate {
  const initialByPath = new Map(initialFiles.map((f) => [f.path, f]));
  const repairedByPath = new Map(repairedFiles.map((f) => [f.path, f]));
  const initialCharCount = initialFiles.reduce((n, f) => n + f.charCount, 0);
  const repairedCharCount = repairedFiles.reduce((n, f) => n + f.charCount, 0);

  const removedPaths: string[] = [];
  let retainedPathCount = 0;
  const severelyShrunkFiles: string[] = [];
  for (const [p, f] of initialByPath) {
    const r = repairedByPath.get(p);
    if (!r) { removedPaths.push(p); continue; }
    retainedPathCount += 1;
    if (f.charCount >= SHRINK_FLOOR_CHARS && r.charCount < f.charCount * SHRINK_RATIO) {
      severelyShrunkFiles.push(p);
    }
  }

  const preservationRatio = Math.round((repairedCharCount / Math.max(1, initialCharCount)) * 100) / 100;
  const retainedRatio = retainedPathCount / Math.max(1, initialByPath.size);
  const shrunkRatio = severelyShrunkFiles.length / Math.max(1, retainedPathCount);

  let rejectionReason: string | undefined;
  if (preservationRatio < PRESERVATION_MIN_CHAR_RATIO) {
    rejectionReason = `Repaired project collapsed to ${Math.round(preservationRatio * 100)}% of the initial source size (${repairedCharCount}/${initialCharCount} chars).`;
  } else if (retainedRatio < PRESERVATION_MIN_RETAINED_RATIO) {
    rejectionReason = `Repair removed ${removedPaths.length}/${initialByPath.size} initial files (only ${Math.round(retainedRatio * 100)}% retained): ${removedPaths.slice(0, 4).join(', ')}.`;
  } else if (shrunkRatio > PRESERVATION_MAX_SHRUNK_RATIO) {
    rejectionReason = `Repair reduced ${severelyShrunkFiles.length}/${retainedPathCount} retained files to placeholder/skeleton size: ${severelyShrunkFiles.slice(0, 4).join(', ')}.`;
  }

  return {
    passed: !rejectionReason,
    rejectionReason,
    initialFileCount: initialByPath.size,
    repairedFileCount: repairedByPath.size,
    initialCharCount,
    repairedCharCount,
    retainedPathCount,
    removedPaths: removedPaths.slice(0, 12),
    severelyShrunkFiles: severelyShrunkFiles.slice(0, 12),
    preservationRatio,
  };
}

/** True when EVERY validation error is a missing-critical-copy error (a bounded copy
 *  issue, never a structural blocker). Such a project must not enter structural repair. */
function onlyCriticalCopyErrors(validation: FrontendBuilderValidationArtifact | undefined): boolean {
  const errs = validation?.errors || [];
  return errs.length > 0 && errs.every((e) => e.code === 'missing-critical-copy');
}

/** Resolve the authoritative specification the validator used — latest step then root. */
function authoritativeSpec(payload: WebBuildPayload): FrontendBuildSpecification | undefined {
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const latest = steps.length ? steps[steps.length - 1] : undefined;
  return latest?.artifacts?.frontendBuildSpec || payload.artifacts?.frontendBuildSpec;
}

/** Map validated generated files to the WebBuildFile shape for review input + parser
 *  path validation ONLY (never persisted here). */
function toActiveFiles(files: FrontendGeneratedFile[]): WebBuildFile[] {
  return files.map((f) => ({
    path: f.path,
    content: f.content,
    language: f.language,
    status: 'unchanged' as const,
    added: 0,
    removed: 0,
  }));
}

/** A repair artifact with honest, bounded defaults. */
function repairArtifact(
  status: FrontendBuilderRepairArtifact['status'],
  reason: string,
  extra?: Partial<FrontendBuilderRepairArtifact>,
): FrontendBuilderRepairArtifact {
  return {
    version: 'frontend-repair-v1',
    status,
    attempted: status !== 'not-run',
    accepted: status === 'accepted',
    validationStatus: 'not-run',
    generatedFileCount: 0,
    generatedCharCount: 0,
    reason: reason.slice(0, 300),
    mode: 'frontend_builder',
    ...extra,
  };
}

/** Build the Phase 12F structural contract-repair artifact from the initial (invalid)
 *  validation, the repair raw response and its re-validation. */
function contractRepairArtifact(
  initialValidation: FrontendBuilderValidationArtifact,
  repairRaw: FrontendBuilderRawArtifact,
  repairValidation: FrontendBuilderValidationArtifact | undefined,
  accepted: boolean,
  gate?: PreservationGate,
): FrontendBuilderContractRepairArtifact {
  const structurallyValid = repairValidation?.status === 'valid' && repairValidation?.readyForConsumption === true;
  const status: FrontendBuilderContractRepairArtifact['status'] =
    accepted ? 'accepted'
    : repairRaw.status !== 'completed' ? 'failed'
    : 'rejected';
  const finalValidationStatus: FrontendBuilderContractRepairArtifact['finalValidationStatus'] =
    !repairValidation ? 'not-run'
    : repairValidation.status === 'valid' ? 'valid'
    : repairValidation.status === 'invalid' ? 'invalid'
    : 'not-run';
  const reason = accepted
    ? `Structural contract repair fixed ${initialValidation.errors.length} validation error(s); the repaired project passed Phase 12C validation and the preservation gate.`
    : repairRaw.status !== 'completed'
      ? `The structural contract-repair call did not complete: ${repairRaw.reason}`
      : gate && structurallyValid && !gate.passed
        ? `The structural repair passed validation but FAILED the preservation gate (destructive collapse): ${gate.rejectionReason}`
        : `The structural repair still failed Phase 12C validation (${repairValidation?.errors.length ?? 0} error(s) remain).`;
  return {
    version: 'frontend-contract-repair-v1',
    status,
    attempted: true,
    accepted,
    initialValidationStatus: 'invalid',
    initialErrorCount: initialValidation.errors.length,
    initialWarningCount: initialValidation.warnings.length,
    initialErrorCodes: Array.from(new Set(initialValidation.errors.map((e) => e.code))).slice(0, 12),
    finalValidationStatus,
    finalErrorCount: repairValidation ? repairValidation.errors.length : 0,
    finalWarningCount: repairValidation ? repairValidation.warnings.length : 0,
    generatedFileCount: repairValidation ? repairValidation.fileCount : 0,
    generatedCharCount: repairValidation ? repairValidation.totalCharCount : 0,
    ...(gate
      ? {
          initialFileCount: gate.initialFileCount,
          repairedFileCount: gate.repairedFileCount,
          initialCharCount: gate.initialCharCount,
          repairedCharCount: gate.repairedCharCount,
          retainedPathCount: gate.retainedPathCount,
          removedPaths: gate.removedPaths,
          severelyShrunkFiles: gate.severelyShrunkFiles,
          preservationRatio: gate.preservationRatio,
          preservationGatePassed: gate.passed,
          preservationRejectionReason: gate.rejectionReason,
        }
      : {}),
    reason: reason.slice(0, 300),
    mode: 'frontend_builder',
    model: repairRaw.model,
    provider: repairRaw.provider,
    requestId: repairRaw.requestId,
  };
}

/** The final acceptance record — renderedVisualTestStatus is ALWAYS pending-manual-test. */
function acceptanceArtifact(
  status: FrontendBuilderAcceptanceArtifact['status'],
  activeProject: FrontendBuilderAcceptanceArtifact['activeProject'],
  fields: {
    initialReviewPassed: boolean;
    repairAttempted: boolean;
    repairAccepted: boolean;
    finalReviewPassed: boolean;
    reason: string;
  },
  extra?: Partial<Pick<FrontendBuilderAcceptanceArtifact,
    'usedDeterministicFallback' | 'repairTriggeredByShallowQuality'
    | 'severeWarningsBeforeRepair' | 'severeWarningsAfterRepair'>>,
): FrontendBuilderAcceptanceArtifact {
  return {
    version: 'frontend-acceptance-v1',
    status,
    activeProject,
    initialReviewPassed: fields.initialReviewPassed,
    repairAttempted: fields.repairAttempted,
    repairAccepted: fields.repairAccepted,
    finalReviewPassed: fields.finalReviewPassed,
    renderedVisualTestStatus: 'pending-manual-test',
    renderedScreenshotReviewed: false,
    runtimeCompilationReviewed: false,
    ...(extra || {}),
    reason: fields.reason.slice(0, 300),
  };
}

/**
 * Run the full Phase 12E pipeline on a planning payload and return the finished payload
 * (artifacts + any accepted repaired-file consumption attached). This is the ONLY place
 * that orchestrates review/repair; the entry points just call it and persist the result.
 */
export async function runFrontendBuilderQualityPipeline(
  plannedPayload: WebBuildPayload,
  opts?: { signal?: AbortSignal; reporter?: WebBuildActivityReporter },
): Promise<WebBuildPayload> {
  // Phase 13H — emit REAL pipeline boundaries to the activity timeline. Wrapped so a
  // reporter error can never affect the build; `emit` is a no-op when no reporter is given.
  const emit = (phase: string, status: WebBuildActivityStatus, detailRows?: WebBuildActivityDetailRow[]): void => {
    try { opts?.reporter?.({ phase, status, detailRows }); } catch { /* activity telemetry only */ }
  };

  // ── Step 1 — initial generation + Phase 12B/12C/12D consumption ──
  emit('frontend-generation', 'active');
  const raw = await generateFrontendBuilderRaw(plannedPayload.artifacts?.frontendBuildSpec, { signal: opts?.signal });
  // ── Phase 13F — an initial frontend TRANSPORT/PROVIDER failure (client timeout, backend
  // timeout, incomplete, access, quota, rate-limit, or any other explicit failure with no
  // usable output) is NOT a website. Throw the mapped typed error HERE, before
  // attachFrontendBuilderRaw turns the planned payload into a deterministic-fallback
  // consumption that would be persisted as a completed fresh build. Zero parser / contract
  // repair / review / quality-repair calls follow. A completed-but-structurally-invalid
  // response has raw.status === 'completed' and is handled by the existing contract-repair
  // path below — it is NOT a transport failure. Caller cancellation already threw inside
  // generateFrontendBuilderRaw. `skipped` (no spec) keeps its legacy behavior. ──
  if (raw.status === 'failed') {
    emit('frontend-generation', 'failed');
    throw mapFrontendGenerationError(raw);
  }
  emit('frontend-generation', 'completed', generationRows(raw));

  // ── Validation — the raw response is parsed + Phase 12C validated inside attach ──
  emit('frontend-validation', 'active');
  const consumed = attachFrontendBuilderRaw(plannedPayload, raw);
  emit('frontend-validation', 'completed', validationRows(consumed.artifacts?.frontendBuilderValidation));

  try {
    // ── Phase 12F — STRUCTURAL contract repair BEFORE Phase 12E eligibility. When the
    //    initial project PARSED but FAILED Phase 12C validation, attempt EXACTLY ONE
    //    bounded contract repair before falling back to internal synthesis. ──
    let working = consumed;
    let initialProjectName: FrontendBuilderAcceptanceArtifact['activeProject'] = 'initial-model-native';
    const spec0 = authoritativeSpec(consumed);
    const initialValidation = consumed.artifacts?.frontendBuilderValidation;
    const contractEligible =
      raw.status === 'completed' &&
      initialValidation?.status === 'invalid' &&
      initialValidation?.didParse === true &&
      (initialValidation?.files?.length ?? 0) > 0 &&
      (initialValidation?.errors?.length ?? 0) > 0 &&
      // Phase 12F.3 — a project whose ONLY failures are missing-critical-copy is a bounded
      // COPY-QUALITY issue, never a structural blocker: it must NOT enter full structural
      // contract repair (that collapsed rich projects into skeletons). Such a project is
      // now 'valid' at the validator layer (copy is a warning), so this guard is normally
      // redundant — it is kept as an explicit, self-documenting backstop.
      !onlyCriticalCopyErrors(initialValidation) &&
      !!spec0 && spec0.status !== 'failed-open';

    if (contractEligible && spec0 && initialValidation) {
      // Exactly ONE contract-repair call (the request-cap pre-check + fail-open live inside).
      emit('structural-repair', 'active');
      const crRaw = await generateFrontendBuilderContractRepairRaw(spec0, initialValidation, { signal: opts?.signal });
      const crValidation = crRaw.status === 'completed' ? parseAndValidateFrontendBuilderRaw(crRaw, spec0) : undefined;
      const crStructurallyValid =
        crRaw.status === 'completed' && !!crValidation &&
        crValidation.status === 'valid' && crValidation.readyForConsumption === true && crValidation.files.length > 0;
      // Phase 12F.3 — a structurally-valid repair is accepted ONLY when it also PRESERVED
      // the parsed initial project (no destructive collapse). Deterministic; no model call.
      const gate = crStructurallyValid
        ? evaluatePreservationGate(initialValidation.files, (crValidation as FrontendBuilderValidationArtifact).files)
        : undefined;
      const crAccepted = crStructurallyValid && (!gate || gate.passed);
      const contractArtifact = contractRepairArtifact(initialValidation, crRaw, crValidation, crAccepted, gate);
      working = attachFrontendBuilderContractRepairResult(consumed, contractArtifact, crAccepted ? (crValidation as FrontendBuilderValidationArtifact) : null);
      emit('structural-repair', 'completed', [
        { label: 'result', value: crAccepted ? 'accepted' : 'rejected' },
        { label: 'errors', value: String((crValidation as FrontendBuilderValidationArtifact | undefined)?.errors?.length ?? initialValidation.errors.length) },
      ]);
      if (!crAccepted) {
        // Rejected → fallback stays active; Phase 12E does NOT run; full diagnostics kept.
        // A structurally-valid-but-collapsed repair is rejected by the preservation gate:
        // the degraded skeleton NEVER becomes the active project.
        const gateReason = gate && !gate.passed
          ? `The single structural contract repair was rejected by the preservation gate (${gate.rejectionReason}); the collapsed skeleton was discarded and the deterministic safe fallback stays active. Phase 12E did not run.`
          : 'The initial model-native project and its single structural contract repair did not pass static validation; the internal fallback stays active and Phase 12E did not run.';
        const skipped = acceptanceArtifact('skipped', 'internal-fallback', {
          initialReviewPassed: false, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
          reason: gateReason,
        });
        emit('quality-review', 'skipped');
        emit('quality-repair', 'skipped');
        emit('acceptance', 'completed', acceptanceRows('skipped', 'internal-fallback'));
        return attachFrontendBuilderQualityResult(working, { ran: false, acceptance: skipped });
      }
      // Accepted → the structurally repaired project is now the active model-native project.
      initialProjectName = 'contract-repaired-model-native';
    } else {
      // No structural repair was needed/eligible (the common case for a valid project).
      emit('structural-repair', 'skipped');
    }

    // ── Step 2 — Phase 12E review eligibility, evaluated over the (possibly contract-
    //    repaired) active project. Only a genuinely consumed model-native project
    //    (valid + ready + files present) is reviewed; a fallback makes ZERO Phase 12E calls. ──
    const consumption = working.artifacts?.frontendBuilderConsumption;
    const validation = working.artifacts?.frontendBuilderValidation;
    const activeFiles = Array.isArray(working.files) ? working.files : [];
    const eligible =
      consumption?.status === 'model-native' &&
      validation?.status === 'valid' &&
      validation?.readyForConsumption === true &&
      activeFiles.length > 0;

    if (!eligible) {
      const skipped = acceptanceArtifact('skipped', 'internal-fallback', {
        initialReviewPassed: false, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
        reason: 'Phase 12E did not run: no consumed model-native project (the deterministic fallback stays active).',
      });
      emit('quality-review', 'skipped');
      emit('quality-repair', 'skipped');
      emit('acceptance', 'completed', acceptanceRows('skipped', 'internal-fallback'));
      return attachFrontendBuilderQualityResult(working, { ran: false, acceptance: skipped });
    }

    const spec = authoritativeSpec(working);

    // ── Step 3 — STATIC initial design review (exactly one parse) ──
    emit('quality-review', 'active');
    const activeWarnings = warningSummaries(validation);
    const heroComponentPath = validation?.heroComponentPath;
    const initialReviewRaw = await generateFrontendBuilderReviewRaw(spec, activeFiles, 'initial', undefined, { signal: opts?.signal, deterministicWarnings: activeWarnings });
    const parsedInitialReview = parseFrontendBuilderReview(initialReviewRaw, 'initial', activeFiles, { heroComponentPath });

    // ── Phase 13C — deterministic recovery. Convert the static validator's SEVERE quality
    //    warnings into bounded, real-file review issues. When the model review is healthy,
    //    MERGE any missing severe issues (so a model "pass" cannot ignore a skeleton). When
    //    the model review is malformed/empty BUT severe evidence exists, build a
    //    deterministic-quality-fallback review so the SINGLE existing quality repair runs.
    //    No extra model call — this is pure local code. ──
    const deterministicIssues = synthesizeDeterministicReviewIssues(validation, activeFiles);
    const severeWarningsBeforeRepair = severeWarningCodes(validation);
    let initialReview = parsedInitialReview;
    let repairTriggeredByShallowQuality = false;
    if (parsedInitialReview.status === 'completed') {
      if (deterministicIssues.length) {
        const { issues: merged, added } = mergeDeterministicIssues(parsedInitialReview.issues, deterministicIssues);
        if (added > 0) {
          initialReview = recomputeReviewWithMergedIssues(parsedInitialReview, merged, added);
          repairTriggeredByShallowQuality = !initialReview.passed;
        }
      }
    } else if (deterministicIssues.length > 0) {
      initialReview = buildDeterministicFallbackReview('initial', deterministicIssues, parsedInitialReview);
      repairTriggeredByShallowQuality = true;
    }
    const usedDeterministicFallback = !!initialReview.usedDeterministicFallback;
    emit('quality-review', 'completed', reviewRows(initialReview));

    // Fast path — a passing initial review keeps the initial project; no repair/final call.
    // Phase 13C — a model "pass" can NEVER approve while severe deterministic warnings remain.
    if (initialReview.passed && severeWarningGatePassed(validation)) {
      const acceptance = acceptanceArtifact('approved', initialProjectName, {
        initialReviewPassed: true, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
        reason: `Initial static design review passed (score ${initialReview.score ?? '?'}); no severe quality warnings. Rendered visual test pending.`,
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality: false, severeWarningsBeforeRepair });
      emit('quality-repair', 'skipped');
      emit('acceptance', 'completed', acceptanceRows('approved', initialProjectName));
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair: repairArtifact('not-run', 'No repair needed — the initial review passed and no severe quality warnings remain.'), acceptance,
      });
    }

    // ── Step 4 — repair eligibility. NEVER repair on an untrusted/failed/empty review
    //    UNLESS deterministic severe evidence exists (then the fallback review above made it
    //    trustworthy + actionable). ──
    const reviewTrustworthy = initialReview.status === 'completed';
    const hasActionableIssue = initialReview.issues.length > 0;
    if (!reviewTrustworthy || !hasActionableIssue) {
      const reason = !reviewTrustworthy
        ? 'The initial static design review did not complete (timeout / malformed / failed) and no severe deterministic warnings were present; no repair was attempted.'
        : 'The initial review requested changes without actionable issues and no severe deterministic warnings were present; no repair was attempted.';
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
        reason: `${reason} The validated project stays active; manual rendered review required.`,
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality: false, severeWarningsBeforeRepair });
      emit('quality-repair', 'skipped');
      emit('acceptance', 'completed', acceptanceRows('manual-review-required', initialProjectName));
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair: repairArtifact('not-run', reason), acceptance,
      });
    }

    // ── Step 5 — exactly ONE bounded repair call. It receives the sanitized model issues,
    //    the deterministic severe issues (already merged into initialReview.issues), the
    //    warning summaries and — Phase 13C — the explicit real-file quality evidence. ──
    const qualityEvidence = {
      shallowProjectDetected: !!validation?.shallowProjectDetected,
      minimalStylesDetected: !!validation?.minimalStylesDetected,
      repetitiveSectionStructureDetected: !!validation?.repetitiveSectionStructureDetected,
      missingHeroVisualLayerDetected: !!validation?.missingHeroVisualLayerDetected,
      shallowSectionPaths: validation?.shallowSectionPaths || [],
      repetitiveSectionPaths: validation?.repetitiveSectionPaths || [],
      internalCopyLeakFiles: validation?.internalCopyLeakFiles || [],
      heroComponentPath: validation?.heroComponentPath,
    };
    emit('quality-repair', 'active');
    const repairRaw = await generateFrontendBuilderRepairRaw(spec, activeFiles, initialReview, { signal: opts?.signal, deterministicWarnings: activeWarnings, qualityEvidence });
    if (repairRaw.status !== 'completed') {
      const repair = repairArtifact('failed', repairRaw.reason || 'The repair call did not complete.', {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId, initialScore: initialReview.score,
      });
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: false, finalReviewPassed: false,
        reason: 'The bounded repair call did not complete; the initial validated project stays active. Manual rendered review required.',
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair });
      emit('quality-repair', 'completed', [{ label: 'result', value: 'not applied' }]);
      emit('acceptance', 'completed', acceptanceRows('manual-review-required', initialProjectName));
      return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, acceptance });
    }

    // ── Step 6 — UNCHANGED Phase 12C re-validation of the repair ──
    const repairValidation = parseAndValidateFrontendBuilderRaw(repairRaw, spec);
    const repairValid =
      repairValidation.status === 'valid' &&
      repairValidation.readyForConsumption === true &&
      repairValidation.files.length > 0;
    if (!repairValid) {
      const repair = repairArtifact('rejected', `The repaired project failed Phase 12C validation: ${repairValidation.reason}`.slice(0, 300), {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId,
        validationStatus: repairValidation.status === 'valid' ? 'valid' : 'invalid',
        generatedFileCount: repairValidation.fileCount,
        generatedCharCount: repairValidation.totalCharCount,
        initialScore: initialReview.score,
      });
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: false, finalReviewPassed: false,
        reason: 'The repaired project did not pass static validation; the initial validated project stays active. No post-repair review ran. Manual rendered review required.',
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair });
      emit('quality-repair', 'completed', [{ label: 'result', value: 'rejected' }]);
      emit('acceptance', 'completed', acceptanceRows('manual-review-required', initialProjectName));
      return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, acceptance });
    }

    // Phase 13C — severe warnings in the REPAIRED project (real-file evidence, no model call).
    const severeWarningsAfterRepair = severeWarningCodes(repairValidation);
    const repairSevereGatePassed = severeWarningGatePassed(repairValidation);

    // ── Step 7 — STATIC post-repair review of the repaired files (exactly one parse) ──
    const repairedActiveFiles = toActiveFiles(repairValidation.files);
    const finalReviewRaw = await generateFrontendBuilderReviewRaw(spec, repairedActiveFiles, 'post-repair', initialReview, { signal: opts?.signal, deterministicWarnings: warningSummaries(repairValidation) });
    const finalReview = parseFrontendBuilderReview(finalReviewRaw, 'post-repair', repairedActiveFiles, { heroComponentPath: repairValidation.heroComponentPath });

    // ── Step 8 — repair acceptance gate: valid + final pass + strict score improvement +
    //    Phase 13C severe-warning gate (a model "pass" cannot approve a still-shallow repair). ──
    const initialScore = initialReview.score ?? 0;
    const finalScore = finalReview.score ?? 0;
    const accept =
      finalReview.status === 'completed' &&
      finalReview.passed &&
      finalScore >= MIN_ACCEPT_SCORE &&
      finalReview.blockerCount === 0 &&
      finalReview.majorCount === 0 &&
      finalScore > initialScore &&
      repairSevereGatePassed;

    if (accept) {
      const repair = repairArtifact('accepted', `Repair accepted: score improved ${initialScore} → ${finalScore} and the post-repair review passed with no blocker/major issues and no severe quality warnings.`, {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId,
        validationStatus: 'valid',
        generatedFileCount: repairValidation.fileCount,
        generatedCharCount: repairValidation.totalCharCount,
        initialScore, finalScore,
      });
      const acceptance = acceptanceArtifact('repaired-approved', 'repaired-model-native', {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: true, finalReviewPassed: true,
        reason: `One bounded repair accepted after static validation, a passing post-repair review (score ${initialScore} → ${finalScore}) and a clear severe-warning gate. Rendered visual test pending.`,
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair, severeWarningsAfterRepair });
      emit('quality-repair', 'completed', [{ label: 'result', value: 'accepted' }, { label: 'score', value: `${initialScore} → ${finalScore}` }]);
      emit('acceptance', 'completed', acceptanceRows('repaired-approved', 'repaired-model-native'));
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair, finalReview, acceptance,
        acceptedRepairedFiles: repairValidation.files,
        acceptedRepairedValidation: repairValidation,
      });
    }

    // Repair validated but was not accepted (final review failed / malformed / no improvement /
    // severe warnings still remain). Phase 13C — a repair that stays shallow is rejected by the
    // deterministic severe-warning gate even if the model reviewer "passed" it.
    const rejectReason = !repairSevereGatePassed
      ? `The repaired project still shows severe quality warnings (${severeWarningsAfterRepair.slice(0, 4).join(', ')}); the repair was not accepted.`
      : finalReview.status !== 'completed'
        ? 'The post-repair static review did not complete; the repair was not accepted.'
        : !finalReview.passed
          ? 'The post-repair review still reports blocker/major issues or a sub-82 score; the repair was not accepted.'
          : `The repair did not improve the score (${initialScore} → ${finalScore}); it was not accepted.`;
    const repair = repairArtifact('rejected', rejectReason, {
      model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId,
      validationStatus: 'valid',
      generatedFileCount: repairValidation.fileCount,
      generatedCharCount: repairValidation.totalCharCount,
      initialScore, finalScore: finalReview.status === 'completed' ? finalScore : undefined,
    });
    const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
      initialReviewPassed: false, repairAttempted: true, repairAccepted: false,
      finalReviewPassed: finalReview.passed,
      reason: `${rejectReason} The initial validated project stays active for owner inspection; normal users continue to see Safe Preview. Manual rendered review required.`,
    }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair, severeWarningsAfterRepair });
    emit('quality-repair', 'completed', [{ label: 'result', value: 'rejected' }]);
    emit('acceptance', 'completed', acceptanceRows('manual-review-required', initialProjectName));
    return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, finalReview, acceptance });
  } catch (err) {
    // Explicit caller cancellation must propagate so a cancelled turn is not persisted.
    if (err instanceof WebBuildError && err.kind === 'cancelled') throw err;
    if (opts?.signal?.aborted) throw err;
    // Any other Phase 12E error fails open: return the already-consumed Phase 12D payload
    // untouched (Preview + All Files + validated project remain usable) with a skipped record.
    // Phase 13H — mark any still-active review/repair stage skipped (no-op if already terminal)
    // so a fail-open success never leaves a stage stuck "active" in the summary timeline.
    emit('quality-review', 'skipped');
    emit('quality-repair', 'skipped');
    emit('acceptance', 'completed', acceptanceRows('skipped', 'internal-fallback'));
    const skipped = acceptanceArtifact('skipped', 'internal-fallback', {
      initialReviewPassed: false, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
      reason: 'Phase 12E failed open on an unexpected error; the existing validated project stays active.',
    });
    try {
      // `working` is scoped to the try; the catch only has the pre-try `consumed`.
      return attachFrontendBuilderQualityResult(consumed, { ran: false, acceptance: skipped });
    } catch {
      return consumed;
    }
  }
}
