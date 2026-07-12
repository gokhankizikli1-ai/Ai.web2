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
  generateFrontendBuilderContractRepairRaw, WebBuildError,
} from '@/lib/webBuildApi';
import {
  attachFrontendBuilderRaw, attachFrontendBuilderQualityResult,
  attachFrontendBuilderContractRepairResult,
  type WebBuildPayload, type WebBuildFile,
} from '@/lib/webBuildPayload';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import { parseFrontendBuilderReview } from '@/lib/webBuildFrontendReview';
import type {
  FrontendBuildSpecification, FrontendGeneratedFile,
  FrontendBuilderRepairArtifact, FrontendBuilderAcceptanceArtifact,
  FrontendBuilderContractRepairArtifact, FrontendBuilderValidationArtifact, FrontendBuilderRawArtifact,
} from '@/lib/webBuildAgents';

/** The minimum improvement gate: an accepted repair must beat the initial score. */
const MIN_ACCEPT_SCORE = 82;

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
  opts?: { signal?: AbortSignal },
): Promise<WebBuildPayload> {
  // ── Step 1 — initial generation + Phase 12B/12C/12D consumption (unchanged) ──
  const raw = await generateFrontendBuilderRaw(plannedPayload.artifacts?.frontendBuildSpec, { signal: opts?.signal });
  const consumed = attachFrontendBuilderRaw(plannedPayload, raw);

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
        return attachFrontendBuilderQualityResult(working, { ran: false, acceptance: skipped });
      }
      // Accepted → the structurally repaired project is now the active model-native project.
      initialProjectName = 'contract-repaired-model-native';
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
      return attachFrontendBuilderQualityResult(working, { ran: false, acceptance: skipped });
    }

    const spec = authoritativeSpec(working);

    // ── Step 3 — STATIC initial design review (exactly one parse) ──
    const initialReviewRaw = await generateFrontendBuilderReviewRaw(spec, activeFiles, 'initial', undefined, { signal: opts?.signal });
    const initialReview = parseFrontendBuilderReview(initialReviewRaw, 'initial', activeFiles);

    // Fast path — a passing initial review keeps the initial project; no repair/final call.
    if (initialReview.passed) {
      const acceptance = acceptanceArtifact('approved', initialProjectName, {
        initialReviewPassed: true, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
        reason: `Initial static design review passed (score ${initialReview.score ?? '?'}). Rendered visual test pending.`,
      });
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair: repairArtifact('not-run', 'No repair needed — the initial review passed.'), acceptance,
      });
    }

    // ── Step 4 — repair eligibility. NEVER repair on an untrusted/failed/empty review. ──
    const reviewTrustworthy = initialReview.status === 'completed';
    const hasActionableIssue = initialReview.issues.length > 0;
    if (!reviewTrustworthy || !hasActionableIssue) {
      const reason = !reviewTrustworthy
        ? 'The initial static design review did not complete (timeout / malformed / failed); no repair was attempted.'
        : 'The initial review requested changes without actionable issues; no repair was attempted.';
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
        reason: `${reason} The validated project stays active; manual rendered review required.`,
      });
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair: repairArtifact('not-run', reason), acceptance,
      });
    }

    // ── Step 5 — exactly ONE bounded repair call ──
    const repairRaw = await generateFrontendBuilderRepairRaw(spec, activeFiles, initialReview, { signal: opts?.signal });
    if (repairRaw.status !== 'completed') {
      const repair = repairArtifact('failed', repairRaw.reason || 'The repair call did not complete.', {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId, initialScore: initialReview.score,
      });
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: false, finalReviewPassed: false,
        reason: 'The bounded repair call did not complete; the initial validated project stays active. Manual rendered review required.',
      });
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
      });
      return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, acceptance });
    }

    // ── Step 7 — STATIC post-repair review of the repaired files (exactly one parse) ──
    const repairedActiveFiles = toActiveFiles(repairValidation.files);
    const finalReviewRaw = await generateFrontendBuilderReviewRaw(spec, repairedActiveFiles, 'post-repair', initialReview, { signal: opts?.signal });
    const finalReview = parseFrontendBuilderReview(finalReviewRaw, 'post-repair', repairedActiveFiles);

    // ── Step 8 — repair acceptance gate: valid + final pass + strict score improvement ──
    const initialScore = initialReview.score ?? 0;
    const finalScore = finalReview.score ?? 0;
    const accept =
      finalReview.status === 'completed' &&
      finalReview.passed &&
      finalScore >= MIN_ACCEPT_SCORE &&
      finalReview.blockerCount === 0 &&
      finalReview.majorCount === 0 &&
      finalScore > initialScore;

    if (accept) {
      const repair = repairArtifact('accepted', `Repair accepted: score improved ${initialScore} → ${finalScore} and the post-repair review passed with no blocker/major issues.`, {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId,
        validationStatus: 'valid',
        generatedFileCount: repairValidation.fileCount,
        generatedCharCount: repairValidation.totalCharCount,
        initialScore, finalScore,
      });
      const acceptance = acceptanceArtifact('repaired-approved', 'repaired-model-native', {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: true, finalReviewPassed: true,
        reason: `One bounded repair accepted after static validation and a passing post-repair review (score ${initialScore} → ${finalScore}). Rendered visual test pending.`,
      });
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair, finalReview, acceptance,
        acceptedRepairedFiles: repairValidation.files,
        acceptedRepairedValidation: repairValidation,
      });
    }

    // Repair validated but was not accepted (final review failed / malformed / no improvement).
    const rejectReason = finalReview.status !== 'completed'
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
      reason: `${rejectReason} The initial validated project stays active. Manual rendered review required.`,
    });
    return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, finalReview, acceptance });
  } catch (err) {
    // Explicit caller cancellation must propagate so a cancelled turn is not persisted.
    if (err instanceof WebBuildError && err.kind === 'cancelled') throw err;
    if (opts?.signal?.aborted) throw err;
    // Any other Phase 12E error fails open: return the already-consumed Phase 12D payload
    // untouched (Preview + All Files + validated project remain usable) with a skipped record.
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
