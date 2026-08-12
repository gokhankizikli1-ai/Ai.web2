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
  generateFrontendBuilderDeltaRepairRaw,
  generateFrontendBuilderContractRepairRaw, WebBuildError, mapFrontendGenerationError,
  selectBoundedRepairIssues,
} from '@/lib/webBuildApi';
// Owner-only DELTA quality-repair — pure, deterministic delta parser/validator/merger. No
// network. Flag-gated + owner-gated by the caller; fail-open never triggers a second repair call.
import { resolveWebBuildQualityRepairMode, isDeltaRepairEligible, reconstructRepairRawFromDelta, resolveAppQualityRepairRouting } from '@/lib/webBuildDeltaRepair';
// Pure guard-code classifiers (no IO) — turn a bounded raw guardBlock into the repair-artifact guard
// diagnostic when the OPTIONAL quality repair was refused by the server ai_guard. Never enforcement.
import { betaBlockKind, betaBlockRetryable } from '@/lib/aiGuard';
// Deterministic post-repair acceptance gate — pure, owner-agnostic, no IO. Returns the SAME
// accept decision the previous inline conjunction made, plus a bounded, sanitized diagnostic
// exposing the exact rejection reason and every gate signal for the activity timeline.
import { evaluateAcceptanceGate, acceptanceReasonLabel } from '@/lib/webBuildAcceptanceGate';
import type { FrontendAcceptanceGateReasonCode } from '@/lib/webBuildAcceptanceGate';
// Owner-only COMPACT quality-context — pure, deterministic, network-free selection of a bounded,
// safe source subset for the delta-repair request + post-repair review. Fully safe-fallback: an
// undefined context means the EXISTING full-context request is used (before the single call).
import {
  resolveWebBuildQualityContextMode, isCompactContextEligible, selectCompactRepairContext, selectCompactPostRepairContext,
  disabledQualityContextDiagnostics,
} from '@/lib/webBuildQualityContext';
import type { CompactSourceContext } from '@/lib/webBuildQualityContext';
import {
  attachFrontendBuilderRaw, attachFrontendBuilderQualityResult,
  attachFrontendBuilderContractRepairResult,
  type WebBuildPayload, type WebBuildFile,
} from '@/lib/webBuildPayload';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import { sourceStockImagesForPayload } from '@/lib/webBuildImageSourcing';
import { runVisualIntelligence } from '@/lib/webBuildVisualIntelligence';
import type { VisualStrategy } from '@/lib/webBuildVisualStrategy';
import {
  parseFrontendBuilderReview, synthesizeDeterministicReviewIssues,
  mergeDeterministicIssues, buildDeterministicFallbackReview,
} from '@/lib/webBuildFrontendReview';
// PR #516 — advisory Rendered Visual Evaluation (a leaf; pure + fail-open). Its HIGH findings
// are merged into the EXISTING review so the EXISTING bounded repair addresses them — no new
// repair system. Flag-gated and only when the caller supplies a rendered input.
import {
  isRenderedVisualEvaluationEnabled, evaluateRenderedVisual, renderedIssuesToReviewIssues,
} from '@/lib/webBuildRenderedVisualEvaluation';
// PR #519 — hard generation contract static enforcement (a leaf; pure + fail-open). Findings
// ride the EXISTING deterministic-issue merge → EXISTING single bounded repair.
import {
  isHardGenerationContractEnabled, evaluateContractCompliance, contractFindingsToReviewIssues,
} from '@/lib/webBuildGenerationContract';
// Phase 12G — binding user-requirements satisfaction + cross-sector drift (pure, network-free).
// The SAME authoritative contract drives generation and this acceptance analysis; findings ride
// the EXISTING deterministic-issue merge → the EXISTING single repair. No new model call.
import {
  analyzeBindingAcceptance, bindingIssuesToReviewIssues, hasBlockingBindingFindings, bindingIssueCodes,
  type BindingAcceptanceResult, type DriftPolicy,
} from '@/lib/webBuildRequirementAnalysis';
import {
  analyzeResearchGrounding, researchGroundingToReviewIssues, hasBlockingResearchFindings,
  researchGroundingIssueCodes, buildResearchDirectionDiagnostics, renderResearchDirectionBlock,
  type ResearchGroundingResult,
} from '@/lib/webBuildResearchDirection';
// Phase (composition) — BINDING page-composition contract acceptance (pure, network-free). The
// SAME contract rendered into the builder request is analyzed here; only template-collapse blocks
// and rides the EXISTING deterministic-issue merge → the EXISTING single repair. No new model call.
import {
  analyzeComposition, compositionToReviewIssues, hasBlockingCompositionFindings,
  compositionIssueCodes, buildCompositionDiagnostics, renderCompositionBlock,
  type CompositionAcceptanceResult,
} from '@/lib/webBuildComposition';
// Phase (premium visual system) — BINDING visual-system acceptance (pure, network-free). The SAME
// contract rendered into the builder request is analyzed here; only strongly-proven collapse blocks
// and rides the EXISTING deterministic-issue merge → the EXISTING single repair. No new model call.
import {
  analyzeVisualSystem, visualSystemToReviewIssues, hasBlockingVisualSystemFindings,
  visualSystemIssueCodes, buildVisualSystemDiagnostics, renderVisualSystemBlock,
  type VisualSystemAcceptanceResult,
} from '@/lib/webBuildVisualSystem';
// Phase (content narrative) — BINDING content/conversion-narrative acceptance (pure, network-free).
// The SAME contract rendered into the builder request is analyzed here; only strongly-proven failures
// block and ride the EXISTING deterministic-issue merge → the EXISTING single repair. No new model call.
import {
  analyzeContentNarrative, contentNarrativeToReviewIssues, hasBlockingContentFindings,
  contentNarrativeIssueCodes, buildContentNarrativeDiagnostics, renderContentNarrativeBlock,
  type ContentAcceptanceResult,
} from '@/lib/webBuildContentNarrative';
// Phase 2 (site depth & completeness) — the SAME site-depth contract rendered into the builder request is
// analyzed here; only strongly-proven STRUCTURAL completeness failures (a planned core browse/decision
// surface rendered heading-only, or the core decision content never rendering) block and ride the EXISTING
// deterministic-issue merge → the EXISTING single repair. No new model call.
import {
  analyzeSiteDepth, siteDepthToReviewIssues, hasBlockingSiteDepthFindings,
  siteDepthIssueCodes, buildSiteDepthDiagnostics, renderSiteDepthBlock,
  type SiteDepthAcceptanceResult,
} from '@/lib/webBuildContentNarrative';
// Phase (integrated experience quality) — unified cross-system acceptance (pure, network-free). The
// SAME contract rendered into the builder request is analyzed here; only strongly-proven cross-cutting
// failures block and ride the EXISTING deterministic-issue merge → the EXISTING single repair.
import {
  analyzeExperienceQuality, experienceToReviewIssues, hasBlockingExperienceFindings,
  experienceIssueCodes, buildExperienceDiagnostics, renderExperienceQualityBlock,
  type ExperienceAcceptanceResult,
} from '@/lib/webBuildExperienceQuality';
// Phase (visual concept & art direction) — the SAME dominant-visual-idea contract rendered into the builder
// request is analyzed here; only the three genuinely-unowned visual defects block and ride the EXISTING
// deterministic-issue merge → the EXISTING single repair. Non-duplicative with experience/imageCoverage.
import {
  analyzeVisualContribution, visualToReviewIssues, hasBlockingVisualFindings,
  visualIssueCodes, buildVisualConceptDiagnostics, renderVisualConceptBlock,
  type VisualAcceptanceResult,
} from '@/lib/webBuildVisualConcept';
// Phase (experience identity & product storytelling) — the SAME product-specific experience contract
// rendered into the builder request is analyzed here; only the high-stakes disclaimer floor blocks and
// rides the EXISTING deterministic-issue merge → single repair. Non-duplicative with research/content.
import {
  analyzeExperienceIdentity, experienceIdentityToReviewIssues, hasBlockingExperienceIdentityFindings,
  experienceIdentityIssueCodes, buildExperienceIdentityDiagnostics, renderExperienceIdentityBlock,
  type ExperienceIdentityAcceptanceResult,
} from '@/lib/webBuildExperienceIdentity';
// Phase (motion visual execution) — the SAME implementation contract rendered into the builder request is
// analyzed here; only a required signature scene rendered provably STATIC blocks. Rides the EXISTING
// deterministic-issue merge → single repair. Non-duplicative with visualConcept/experienceQuality.
import {
  analyzeMotionExecution, motionExecutionToReviewIssues, hasBlockingMotionExecutionFindings,
  motionExecutionIssueCodes, buildMotionExecutionDiagnostics, renderMotionExecutionBlock,
  type MotionExecutionAcceptanceResult,
} from '@/lib/webBuildMotionExecution';
// Phase (execution obligations) — accountability spine. The SAME registry rendered as a builder manifest is
// evaluated here (pre + post repair) for diagnostics and for the pre/post REGRESSION gate that rejects a
// repair which breaks a previously-fulfilled required obligation. Blocking stays with the owner analyzers
// (no duplicate issues); this contributes prevention (manifest) + preservation (regression) + diagnostics.
import {
  analyzeObligationFulfillment, compareObligationFulfillment, buildObligationDiagnostics,
  renderObligationManifestBlock,
  type ObligationFulfillmentResult, type ObligationComparison,
} from '@/lib/webBuildExecutionObligations';
// PR #521 — CONDITIONAL rendered VISION review (fresh-build only, at most one screenshot + one
// vision call). Its major/blocker findings ride the SAME existing merge → single bounded repair.
import {
  isRenderedVisionReviewEnabled, shouldRunVisionReview, sanitizeVisionReview, visionReviewToReviewIssues,
  buildVisionReviewContext, buildRenderedVisionReviewArtifact,
  type VisionReviewProducerContext,
} from '@/lib/webBuildVisionReview';
import type { RenderedVisualInput, RenderedVisualEvaluationArtifact, RenderedVisionReviewArtifact } from '@/lib/webBuildAgents';
import type {
  FrontendBuildSpecification, FrontendGeneratedFile,
  FrontendBuilderRepairArtifact, FrontendBuilderAcceptanceArtifact,
  FrontendBuilderContractRepairArtifact, FrontendBuilderValidationArtifact, FrontendBuilderRawArtifact,
  FrontendBuilderReviewArtifact, FrontendBuilderReviewIssue, ImageAssetManifest,
  FrontendDeltaRepairArtifact, FrontendQualityContextDiagnostics,
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
function visualPlanningRows(s: VisualStrategy): WebBuildActivityDetailRow[] {
  const photos = s.imageSlots.filter((x) => x.mediaType === 'photograph').length;
  const modeLabel: Record<string, string> = {
    none: 'typography-first', minimal: 'minimal', balanced: 'balanced', 'image-led': 'image-led',
  };
  const rows: WebBuildActivityDetailRow[] = [{ label: 'direction', value: modeLabel[s.photographyMode] || s.photographyMode }];
  rows.push({ label: 'photos', value: photos === 0 ? 'none needed' : String(photos) });
  return rows;
}
function imageSourcingRows(m: ImageAssetManifest): WebBuildActivityDetailRow[] {
  const rows: WebBuildActivityDetailRow[] = [
    { label: 'images', value: `${m.sourced}/${m.requested}` },
  ];
  if (m.providers) rows.push({ label: 'providers', value: `pexels ${m.providers.pexels} · unsplash ${m.providers.unsplash}` });
  if (typeof m.elapsedMs === 'number' && m.elapsedMs > 0) rows.push({ label: 'elapsed', value: `${Math.round(m.elapsedMs / 1000)}s` });
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
  // Truthful result: a review whose STATUS is not 'completed' (transport/parser/truncation failure)
  // is reported as 'incomplete' — never as 'passed'/'needs work', which would imply the model
  // actually judged the project. Distinguishes the stage finishing from the review completing.
  const result = r.status !== 'completed' ? 'incomplete' : r.passed ? 'passed' : 'needs work';
  const rows: WebBuildActivityDetailRow[] = [{ label: 'result', value: result }];
  if (typeof r.score === 'number') rows.push({ label: 'score', value: String(r.score) });
  rows.push({ label: 'issues', value: String(r.issues?.length ?? 0) });
  return rows;
}
function acceptanceRows(
  status: FrontendBuilderAcceptanceArtifact['status'],
  activeProject: FrontendBuilderAcceptanceArtifact['activeProject'],
  // Optional exact deterministic gate reason code. When present it is surfaced as a bounded
  // activity row so the owner sees WHICH gate accepted/rejected the candidate — not just the
  // coarse status label. Never carries source, prompts, provider output or PII.
  reasonCode?: FrontendAcceptanceGateReasonCode,
): WebBuildActivityDetailRow[] {
  return [
    { label: 'candidate', value: status },
    { label: 'activeProject', value: activeProject },
    { label: 'manualReview', value: status === 'manual-review-required' ? 'yes' : 'no' },
    ...(reasonCode ? [{ label: 'reason', value: acceptanceReasonLabel(reasonCode) }] : []),
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

// PR #517 — hard upper bound on how long the pipeline will wait for the rendered measurement
// producer. Defence in depth: the producer is itself bounded/fail-open, but this guarantees a
// flag-on build never blocks indefinitely on a hung/inaccessible preview.
const RENDERED_MEASUREMENT_BUDGET_MS = 20_000;

/** Await a rendered-input producer under a bounded timeout + the caller's abort signal.
 *  Resolves `undefined` on timeout / abort / error — never rejects, never blocks forever. */
async function withRenderedMeasurementBudget(
  work: Promise<RenderedVisualInput | undefined>,
  signal?: AbortSignal,
): Promise<RenderedVisualInput | undefined> {
  return new Promise<RenderedVisualInput | undefined>((resolve) => {
    let settled = false;
    const done = (v: RenderedVisualInput | undefined) => { if (!settled) { settled = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(v); } };
    const onAbort = () => done(undefined);
    const timer = setTimeout(() => done(undefined), RENDERED_MEASUREMENT_BUDGET_MS);
    if (signal) { if (signal.aborted) { done(undefined); return; } signal.addEventListener('abort', onAbort, { once: true }); }
    work.then((v) => done(v)).catch(() => done(undefined));
  });
}

// PR #521 — the vision review adds the round-trip to the authenticated route on top of the
// screenshot capture; keep it bounded so a flag-on build never blocks on a hung provider/network.
const VISION_REVIEW_BUDGET_MS = 35_000;

/** Await the vision producer under a bounded timeout + abort. Resolves `undefined` on timeout /
 *  abort / error — never rejects, never blocks forever. */
async function withVisionBudget<T>(work: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const done = (v: T | undefined) => { if (!settled) { settled = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(v); } };
    const onAbort = () => done(undefined);
    const timer = setTimeout(() => done(undefined), VISION_REVIEW_BUDGET_MS);
    if (signal) { if (signal.aborted) { done(undefined); return; } signal.addEventListener('abort', onAbort, { once: true }); }
    work.then((v) => done(v)).catch(() => done(undefined));
  });
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
  // Widened (Phase 12G) to the full acceptance shape so the bounded binding/drift diagnostics can
  // ride alongside the existing severe-warning/rendered-review fields. Positional fields
  // (version/status/activeProject/…/reason) are set explicitly and are not overridden by callers.
  extra?: Partial<FrontendBuilderAcceptanceArtifact>,
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
  opts?: {
    signal?: AbortSignal;
    reporter?: WebBuildActivityReporter;
    // Owner-only DELTA quality-repair gate. TRUE only when the caller resolved a TRUSTED
    // owner session (backend-confirmed via useOwnerMode) — never inferred here from request
    // content, query params, localStorage or headers. When true AND the mode flag is
    // `owner_delta`, the single quality-repair returns bounded file upserts that are merged
    // into the original validated project and re-validated by the UNCHANGED validator +
    // acceptance gates. Absent / false ⇒ the existing full-project quality-repair is used,
    // byte-for-byte unchanged. It NEVER changes the model-call ceiling.
    ownerEligible?: boolean;
    // PR #516 — OPTIONAL rendered visual input (caller-captured screenshot metadata + viewport
    // + optional runtime-compiled flag). When absent (or the flag is off) the rendered visual
    // evaluation is skipped entirely and the pipeline is byte-for-byte unchanged.
    renderedVisualInput?: RenderedVisualInput;
    // PR #517 — OPTIONAL async producer that measures the just-generated files in an isolated
    // preview and returns a RenderedVisualInput. Awaited (bounded) BEFORE the rendered-eval
    // merge, so acceptance is computed ONCE with rendered findings folded into the SAME single
    // repair — no second pipeline, no duplicate persistence. Fail-open: any timeout/error is
    // treated as "no measurement" and the pipeline continues unchanged.
    renderedVisualProducer?: (ctx: {
      files?: FrontendGeneratedFile[]; spec?: FrontendBuildSpecification; signal?: AbortSignal;
      // PR #521 — when true, capture ONE desktop screenshot in the same session (vision review).
      captureScreenshot?: boolean;
    }) => Promise<RenderedVisualInput | undefined>;
    // PR #521 — OPTIONAL producer that calls the authenticated vision route ONCE with the captured
    // screenshot + bounded context and returns the RAW review JSON (sanitized here). Absent (or
    // flag off) ⇒ no vision call. Fresh builds only; the revision path never receives it.
    visionReviewProducer?: (ctx: VisionReviewProducerContext) => Promise<unknown>;
  },
): Promise<WebBuildPayload> {
  // Phase 13H — emit REAL pipeline boundaries to the activity timeline. Wrapped so a
  // reporter error can never affect the build; `emit` is a no-op when no reporter is given.
  const emit = (phase: string, status: WebBuildActivityStatus, detailRows?: WebBuildActivityDetailRow[]): void => {
    try { opts?.reporter?.({ phase, status, detailRows }); } catch { /* activity telemetry only */ }
  };

  // ── Step 0 (Phase 14K.4) — source REAL stock images for this NEW build BEFORE the
  //    coding model runs, so it receives approved assets + knows where to place them.
  //    FAIL-OPEN: on any problem the payload is returned unchanged and generation
  //    proceeds typography-first. Only affects THIS new generation; old builds untouched. ──
  let basePayload = plannedPayload;

  // ── Step 0a (Phase 14K.7) — Visual Intelligence: decide the photography strategy
  //    + per-slot media plan + coherent stock queries BEFORE sourcing. FAIL-OPEN:
  //    on any problem the deterministic planner is used. Runs ONCE per fresh build. ──
  emit('visual-planning', 'active');
  try {
    const vi = await runVisualIntelligence(basePayload.artifacts?.frontendBuildSpec, { signal: opts?.signal });
    if (vi.strategy) {
      basePayload = {
        ...basePayload,
        artifacts: { ...(basePayload.artifacts || {}), visualStrategy: vi.strategy },
      };
      emit('visual-planning', 'completed', visualPlanningRows(vi.strategy));
    } else {
      emit('visual-planning', 'skipped', [{ label: 'plan', value: 'standard' }]);
    }
  } catch {
    emit('visual-planning', 'skipped');
  }

  emit('image-sourcing', 'active');
  try {
    const sourced = await sourceStockImagesForPayload(basePayload, { signal: opts?.signal });
    basePayload = sourced.payload;
    emit('image-sourcing', sourced.manifest.sourced > 0 ? 'completed' : 'skipped', imageSourcingRows(sourced.manifest));
  } catch {
    emit('image-sourcing', 'skipped');
  }

  // ── Step 1 — initial generation + Phase 12B/12C/12D consumption ──
  emit('frontend-generation', 'active');
  const raw = await generateFrontendBuilderRaw(basePayload.artifacts?.frontendBuildSpec, { signal: opts?.signal });
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
  const consumed = attachFrontendBuilderRaw(basePayload, raw);
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
        }, { fallbackReasonCode: 'contract-repair-failed' });
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
      }, { fallbackReasonCode: 'not-consumable' });
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

    // ── PR #519 — HARD generation contract: deterministic static enforcement. Flag-gated;
    //    strong-evidence-only findings are mapped to review issues and merged (by NEW category)
    //    into the initial review, so the EXISTING single bounded repair addresses them. No new
    //    validator, no new repair, no model call. Fail-open. ──
    if (isHardGenerationContractEnabled() && spec?.experienceArchitecture && initialReview.status === 'completed') {
      try {
        const contractFindings = evaluateContractCompliance(validation?.files, spec.experienceArchitecture, spec.prompt, spec);
        if (contractFindings.length) {
          const contractIssues = contractFindingsToReviewIssues(contractFindings);
          const { issues: mergedC, added: addedC } = mergeDeterministicIssues(initialReview.issues, contractIssues);
          if (addedC > 0) {
            initialReview = recomputeReviewWithMergedIssues(initialReview, mergedC, addedC);
            repairTriggeredByShallowQuality = repairTriggeredByShallowQuality || !initialReview.passed;
          }
        }
      } catch { /* fail-open: contract enforcement must never break a build */ }
    }

    // ── Phase 12G — BINDING user-requirements satisfaction + cross-sector semantic drift on the
    //    COMPLETE initial project. The SAME authoritative contract (spec.bindingRequirements) that
    //    drove generation is analyzed here; blocking findings become deterministic review issues
    //    that ride the EXISTING single repair (no new model call). Drift is sector-generic (software
    //    modules blocked only for a non-software operator sector). Fully fail-open. ──
    const bindingReqs = spec?.bindingRequirements;
    const imageCoverage = spec?.imageCoverage;
    const coverageDiag = basePayload.artifacts?.imageAssetManifest?.coverage;
    const imageIntelDiag = basePayload.artifacts?.imageAssetManifest?.imageIntelligence;
    // Phase (research-grounded direction) — the sector/research direction contract drives BOTH the
    // sector-aware drift policy (forbidden modules) AND research-grounding acceptance.
    const researchDirection = spec?.researchDirection;
    const driftPolicy: DriftPolicy = {
      isSoftwareSector: spec?.identity?.sector === 'ai-saas' || spec?.identity?.sector === 'marketplace'
        || spec?.identity?.classificationBasis === 'product-concept',
      // Sector-incompatible modules become explicit drift labels (research/Vertical Intelligence
      // evidence now materially controls the EXISTING cross-sector drift analyzer).
      forbiddenModuleLabels: researchDirection?.artDirection?.forbiddenModules,
    };
    const researchDirectionChars = renderResearchDirectionBlock(researchDirection).join('\n').length;
    // Phase (composition) — the BINDING page-composition contract drives composition acceptance.
    const composition = spec?.composition;
    const compositionChars = renderCompositionBlock(composition).join('\n').length;
    // Phase (premium visual system) — the BINDING visual-system contract drives visual-system acceptance.
    const visualSystem = spec?.visualSystem;
    const visualSystemChars = renderVisualSystemBlock(visualSystem).join('\n').length;
    // Phase (content narrative) — the BINDING content/conversion-narrative contract drives content acceptance.
    const contentNarrative = spec?.contentNarrative;
    const contentNarrativeChars = renderContentNarrativeBlock(contentNarrative).join('\n').length;
    // Phase 2 (site depth & completeness) — the BINDING site-depth contract drives structural-completeness acceptance.
    const siteDepth = spec?.siteDepth;
    const siteDepthChars = renderSiteDepthBlock(siteDepth).join('\n').length;
    // Phase (integrated experience quality) — the BINDING cross-system experience contract drives acceptance.
    const experienceQuality = spec?.experienceQuality;
    const experienceQualityChars = renderExperienceQualityBlock(experienceQuality).join('\n').length;
    // Phase (visual concept & art direction) — the AUTHORITATIVE dominant-visual-idea contract drives acceptance.
    const visualConcept = spec?.visualConcept;
    const visualConceptChars = renderVisualConceptBlock(visualConcept).join('\n').length;
    // Phase (experience identity & product storytelling) — the AUTHORITATIVE product-experience contract.
    const experienceIdentity = spec?.experienceIdentity;
    const experienceIdentityChars = renderExperienceIdentityBlock(experienceIdentity).join('\n').length;
    // Phase (motion visual execution) — the implementation contract; hero region located via the visual
    // concept's peak (rhythm) section id.
    const motionExecution = spec?.motionExecution;
    const motionExecutionChars = renderMotionExecutionBlock(motionExecution).join('\n').length;
    const motionHeroSectionId = visualConcept?.rhythm?.peakSectionId;
    // Phase (execution obligations) — the accountability registry (evaluated pre + post for the regression gate).
    const executionObligations = spec?.executionObligations;
    const obligationManifestChars = renderObligationManifestBlock(executionObligations).join('\n').length;
    let initialObligations: ObligationFulfillmentResult | undefined;
    let repairObligations: ObligationFulfillmentResult | undefined;
    let obligationComparison: ObligationComparison | undefined;
    let initialBinding: BindingAcceptanceResult | undefined;
    let initialResearch: ResearchGroundingResult | undefined;
    let initialComposition: CompositionAcceptanceResult | undefined;
    let initialVisualSystem: VisualSystemAcceptanceResult | undefined;
    let initialContent: ContentAcceptanceResult | undefined;
    let initialDepth: SiteDepthAcceptanceResult | undefined;
    let initialExperience: ExperienceAcceptanceResult | undefined;
    let initialVisual: VisualAcceptanceResult | undefined;
    let initialExperienceIdentity: ExperienceIdentityAcceptanceResult | undefined;
    let initialMotion: MotionExecutionAcceptanceResult | undefined;
    try {
      initialBinding = analyzeBindingAcceptance(validation?.files, bindingReqs, driftPolicy, imageCoverage);
      initialResearch = analyzeResearchGrounding(validation?.files, researchDirection);
      initialComposition = analyzeComposition(validation?.files, composition);
      initialVisualSystem = analyzeVisualSystem(validation?.files, visualSystem);
      initialContent = analyzeContentNarrative(validation?.files, contentNarrative);
      initialDepth = analyzeSiteDepth(validation?.files, siteDepth);
      initialExperience = analyzeExperienceQuality(validation?.files, experienceQuality);
      initialVisual = analyzeVisualContribution(validation?.files, visualConcept);
      initialExperienceIdentity = analyzeExperienceIdentity(validation?.files, experienceIdentity);
      initialMotion = analyzeMotionExecution(validation?.files, motionExecution, motionHeroSectionId);
      initialObligations = analyzeObligationFulfillment(validation?.files, executionObligations);
      // Every deterministic issue here maps to a hard ACCEPTANCE-GATE analyzer, so tag them
      // gate-critical: a non-minor one must reach the single repair as its own explicit obligation
      // and must NOT be collapsed away by category-dedup when it collides with another gate blocker
      // sharing a review category (e.g. binding + research both use `contract-fidelity`).
      const detIssues = [
        ...(initialBinding ? bindingIssuesToReviewIssues(initialBinding) : []),
        ...(initialResearch ? researchGroundingToReviewIssues(initialResearch) : []),
        ...(initialComposition ? compositionToReviewIssues(initialComposition) : []),
        ...(initialVisualSystem ? visualSystemToReviewIssues(initialVisualSystem) : []),
        ...(initialContent ? contentNarrativeToReviewIssues(initialContent) : []),
        ...(initialDepth ? siteDepthToReviewIssues(initialDepth) : []),
        ...(initialExperience ? experienceToReviewIssues(initialExperience) : []),
        ...(initialVisual ? visualToReviewIssues(initialVisual) : []),
        ...(initialExperienceIdentity ? experienceIdentityToReviewIssues(initialExperienceIdentity) : []),
        ...(initialMotion ? motionExecutionToReviewIssues(initialMotion) : []),
      ].map((i) => ({ ...i, gateCritical: true }));
      if (detIssues.length && initialReview.status === 'completed') {
        const { issues: mergedB, added: addedB } = mergeDeterministicIssues(initialReview.issues, detIssues);
        if (addedB > 0) {
          initialReview = recomputeReviewWithMergedIssues(initialReview, mergedB, addedB);
          repairTriggeredByShallowQuality = repairTriggeredByShallowQuality || !initialReview.passed;
        }
      }
    } catch { /* fail-open: deterministic analysis must never break a build */ }
    // Post-repair binding analysis is computed later over the RECONSTRUCTED complete project
    // (full or owner-delta — both revalidate a complete project, so there is no analysis gap).
    let repairBinding: BindingAcceptanceResult | undefined;
    let repairResearch: ResearchGroundingResult | undefined;
    let repairComposition: CompositionAcceptanceResult | undefined;
    let repairVisualSystem: VisualSystemAcceptanceResult | undefined;
    let repairContent: ContentAcceptanceResult | undefined;
    let repairDepth: SiteDepthAcceptanceResult | undefined;
    let repairExperience: ExperienceAcceptanceResult | undefined;
    let repairVisual: VisualAcceptanceResult | undefined;
    let repairExperienceIdentity: ExperienceIdentityAcceptanceResult | undefined;
    let repairMotion: MotionExecutionAcceptanceResult | undefined;
    // Bounded, non-sensitive binding/drift diagnostics for the acceptance artifact.
    const bindingExtra = (): Partial<FrontendBuilderAcceptanceArtifact> => {
      const hasAny = !!bindingReqs || !!(initialBinding && initialBinding.driftIssueCount) || !!(repairBinding && repairBinding.driftIssueCount)
        || !!imageCoverage || !!coverageDiag || !!researchDirection || !!composition || !!visualSystem || !!contentNarrative || !!siteDepth || !!experienceQuality || !!visualConcept || !!experienceIdentity || !!motionExecution || !!executionObligations || !!imageIntelDiag;
      if (!hasAny) return {};
      const b = repairBinding || initialBinding;
      const c = bindingReqs?.counts;
      return {
        ...(bindingReqs ? { bindingContractVersion: bindingReqs.version } : {}),
        ...(c ? {
          bindingRequirementCount: c.total, bindingSectionCount: c.section, bindingInteractionCount: c.interaction,
          bindingControlCount: c.control, bindingDynamicOutcomeCount: c.dynamicOutcome, bindingBehaviorCount: c.behavior,
          bindingMediaCount: c.media, bindingProhibitionCount: c.prohibition,
        } : {}),
        ...(b ? {
          bindingSatisfiedCount: b.satisfiedCount, bindingMissingCount: b.missingCount, bindingAmbiguousCount: b.ambiguousCount,
          bindingSatisfiedControlCount: b.satisfiedControlCount, semanticDriftIssueCount: b.driftIssueCount,
          semanticAcceptanceStatus: b.status, bindingIssueCodes: bindingIssueCodes(b), legacyContractUsed: b.legacyContractUsed,
        } : {}),
        ...(initialBinding ? { bindingInitialAnalysisStatus: initialBinding.status } : {}),
        ...(repairBinding ? { bindingPostRepairAnalysisStatus: repairBinding.status } : {}),
        // ── Phase (image coverage) — separate, truthful stock / AI / coverage diagnostics. ──
        ...(imageCoverage ? { imageCoverageMode: imageCoverage.mode } : (coverageDiag ? { imageCoverageMode: coverageDiag.coverageMode } : {})),
        ...(b && b.requiredImageCount != null ? {
          requiredSemanticImageCount: b.requiredImageCount,
          renderedRequiredImageCount: b.renderedRequiredImageCount,
          uncoveredRequiredImageCount: b.uncoveredRequiredImageCount,
          imageCoverageAcceptanceStatus: b.imageCoverageStatus,
        } : {}),
        ...(coverageDiag ? {
          stockRequestedCount: coverageDiag.stockRequestedCount,
          stockSourcedCount: coverageDiag.stockSourcedCount,
          automaticAiFallbackAttemptCount: coverageDiag.automaticAiFallbackAttemptCount,
          automaticAiFallbackUsableCount: coverageDiag.automaticAiFallbackUsableCount,
          deterministicCoverageFallbackUsed: coverageDiag.deterministicCoverageFallbackUsed,
          visualStrategyPhotographyMode: coverageDiag.visualStrategyPhotographyMode,
          visualStrategyPhotoSlotCount: coverageDiag.visualStrategyPhotoSlotCount,
          imageAssetManifestStatus: coverageDiag.imageAssetManifestStatus,
          pexelsStatus: coverageDiag.pexelsStatus,
          unsplashStatus: coverageDiag.unsplashStatus,
          imageCoverageReasonCodes: coverageDiag.reasonCodes,
          ...(coverageDiag.requiredSemanticImageCount && b?.requiredImageCount == null ? { requiredSemanticImageCount: coverageDiag.requiredSemanticImageCount } : {}),
          ...(coverageDiag.uncoveredRequiredImageCount != null && b?.uncoveredRequiredImageCount == null ? { uncoveredRequiredImageCount: coverageDiag.uncoveredRequiredImageCount } : {}),
        } : {}),
        // ── Phase (research-grounded direction) — bounded, secret-free diagnostics. ──
        ...(researchDirection ? { researchDirection: buildResearchDirectionDiagnostics(researchDirection, repairResearch || initialResearch, researchDirectionChars) } : {}),
        // ── Phase (composition) — bounded, secret-free composition diagnostics (truthful consumption). ──
        ...(composition ? { composition: buildCompositionDiagnostics(composition, repairComposition || initialComposition, compositionChars) } : {}),
        // ── Phase (premium visual system) — bounded, secret-free visual-system diagnostics (truthful consumption). ──
        ...(visualSystem ? { visualSystem: buildVisualSystemDiagnostics(visualSystem, repairVisualSystem || initialVisualSystem, visualSystemChars) } : {}),
        // ── Phase (content narrative) — bounded, secret-free content diagnostics (truthful consumption). ──
        ...(contentNarrative ? { contentNarrative: buildContentNarrativeDiagnostics(contentNarrative, repairContent || initialContent, contentNarrativeChars) } : {}),
        // ── Phase 2 (site depth & completeness) — bounded, secret-free structural-completeness diagnostics. ──
        ...(siteDepth ? { siteDepth: buildSiteDepthDiagnostics(siteDepth, repairDepth || initialDepth, siteDepthChars) } : {}),
        // ── Phase (integrated experience quality) — bounded, secret-free diagnostics (truthful consumption). ──
        ...(experienceQuality ? { experienceQuality: buildExperienceDiagnostics(experienceQuality, repairExperience || initialExperience, experienceQualityChars) } : {}),
        // ── Phase (visual concept & art direction) — bounded, secret-free diagnostics (truthful consumption). ──
        ...(visualConcept ? { visualConcept: buildVisualConceptDiagnostics(visualConcept, repairVisual || initialVisual, visualConceptChars) } : {}),
        // ── Phase (experience identity & product storytelling) — bounded, secret-free diagnostics. ──
        ...(experienceIdentity ? { experienceIdentity: buildExperienceIdentityDiagnostics(experienceIdentity, repairExperienceIdentity || initialExperienceIdentity, experienceIdentityChars) } : {}),
        // ── Phase (motion visual execution) — bounded, secret-free diagnostics (truthful consumption). ──
        ...(motionExecution ? { motionExecution: buildMotionExecutionDiagnostics(motionExecution, repairMotion || initialMotion, motionExecutionChars) } : {}),
        // ── Phase (execution obligations) — bounded, secret-free obligation-lifecycle diagnostics. ──
        ...(executionObligations ? { executionObligations: buildObligationDiagnostics(executionObligations, initialObligations, repairObligations, obligationComparison, obligationManifestChars) } : {}),
        // ── Phase (image intelligence) — bounded, secret-free sourcing-intelligence diagnostics (from manifest). ──
        ...(imageIntelDiag ? { imageIntelligence: imageIntelDiag } : {}),
      };
    };

    // ── PR #516 — OPTIONAL advisory rendered visual evaluation. Runs ONLY when the flag is on
    //    AND the caller supplied a rendered input (screenshot metadata). It NEVER replaces
    //    validation and creates NO new repair: its HIGH findings are mapped to review issues and
    //    merged (by NEW category only) into the initial review, so the EXISTING bounded repair
    //    addresses them. Adds no model call. Fully fail-open — any problem leaves the review as
    //    it was. ──
    let renderedVisualEvaluation: RenderedVisualEvaluationArtifact | undefined;
    let renderedVisionReviewArtifact: RenderedVisionReviewArtifact | undefined;
    let renderedInputForVision: RenderedVisualInput | undefined;
    if (isRenderedVisualEvaluationEnabled() && (opts?.renderedVisualInput || opts?.renderedVisualProducer)) {
      try {
        // PR #521 — decide the CONDITIONAL vision-review capture BEFORE measuring, from the static
        // signals (validation + plan). Only when the trigger says a review is worthwhile do we ask
        // the producer to ALSO capture ONE desktop screenshot in the SAME measurement session.
        const wantCapture = isRenderedVisionReviewEnabled() && !!spec?.experienceArchitecture
          && shouldRunVisionReview({ validation, plan: spec?.experienceArchitecture });
        // PR #517 — resolve the rendered input: a caller-supplied static value (#516) OR the
        // async producer (measures the just-generated files in an isolated preview). The
        // producer is awaited under a bounded timeout + the caller's abort signal so a flag-on
        // build can NEVER block indefinitely; any timeout/error yields no measurement.
        let renderedInput = opts?.renderedVisualInput;
        if (!renderedInput && opts?.renderedVisualProducer) {
          renderedInput = await withRenderedMeasurementBudget(
            opts.renderedVisualProducer({ files: validation?.files, spec, signal: opts?.signal, captureScreenshot: wantCapture }),
            opts?.signal,
          );
        }
        if (!renderedInput) throw new Error('no-rendered-input');
        renderedInputForVision = renderedInput;
        renderedVisualEvaluation = evaluateRenderedVisual({
          ...renderedInput,
          // The parsed generated files (FrontendGeneratedFile[]) carry the source the reused
          // static evaluation reads; fall back to the caller's files when validation is absent.
          files: renderedInput.files ?? validation?.files,
          spec,
        });
        if (renderedVisualEvaluation && !renderedVisualEvaluation.passed && initialReview.status === 'completed') {
          const renderedReviewIssues = renderedIssuesToReviewIssues(renderedVisualEvaluation);
          const { issues: mergedR, added: addedR } = mergeDeterministicIssues(initialReview.issues, renderedReviewIssues);
          if (addedR > 0) {
            initialReview = recomputeReviewWithMergedIssues(initialReview, mergedR, addedR);
            repairTriggeredByShallowQuality = repairTriggeredByShallowQuality || !initialReview.passed;
          }
        }
      } catch { /* fail-open: advisory only, never affect the build */ }
    }

    // ── PR #521 — CONDITIONAL rendered VISION review. Runs at MOST ONCE per fresh build, ONLY
    //    when: the flag is on, the conditional trigger (now WITH the rendered evaluation) says a
    //    review is worthwhile, a REAL screenshot was captured for THIS run, and a vision producer
    //    was supplied. Its major/blocker findings ride the SAME existing merge → the SAME single
    //    bounded repair (no second repair, no post-repair vision call). The revision path never
    //    supplies a producer, so this is fresh-build only. Fully fail-open; `screenshotReviewed`
    //    is honest — true ONLY when the capture AND the sanitized review both succeeded. ──
    if (isRenderedVisionReviewEnabled() && spec?.experienceArchitecture) {
      const triggered = shouldRunVisionReview({ validation, plan: spec.experienceArchitecture, renderedEvaluation: renderedVisualEvaluation });
      const captured = renderedInputForVision?.capturedScreenshot;
      if (!triggered) {
        renderedVisionReviewArtifact = buildRenderedVisionReviewArtifact({
          triggered: false, captureSucceeded: !!captured, reviewSucceeded: false, screenshotReviewed: false,
          issueCount: 0, repairTriggered: false, note: 'vision review not triggered for this build',
        });
      } else if (!captured) {
        renderedVisionReviewArtifact = buildRenderedVisionReviewArtifact({
          triggered: true, captureSucceeded: false, reviewSucceeded: false, screenshotReviewed: false,
          issueCount: 0, repairTriggered: false, note: 'screenshot capture failed or unavailable',
        });
      } else if (!opts?.visionReviewProducer) {
        renderedVisionReviewArtifact = buildRenderedVisionReviewArtifact({
          triggered: true, captureSucceeded: true, reviewSucceeded: false, screenshotReviewed: false,
          capturePartial: captured.partial, inputByteLength: captured.byteLength,
          issueCount: 0, repairTriggered: false, note: 'no vision producer wired',
        });
      } else {
        try {
          const context = buildVisionReviewContext(spec, renderedInputForVision);
          const raw = await withVisionBudget(opts.visionReviewProducer({
            capturedScreenshot: captured, contractSummary: context.contractSummary,
            planSummary: context.planSummary, runtimeFindings: context.runtimeFindings, signal: opts?.signal,
          }), opts?.signal);
          const review = sanitizeVisionReview(raw);
          let repairFromVision = false;
          let issueCount = 0;
          if (review && initialReview.status === 'completed') {
            const visionIssues = visionReviewToReviewIssues(review);
            issueCount = visionIssues.length;
            if (visionIssues.length) {
              const { issues: mergedV, added: addedV } = mergeDeterministicIssues(initialReview.issues, visionIssues);
              if (addedV > 0) {
                initialReview = recomputeReviewWithMergedIssues(initialReview, mergedV, addedV);
                repairFromVision = !initialReview.passed;
                repairTriggeredByShallowQuality = repairTriggeredByShallowQuality || !initialReview.passed;
              }
            }
          }
          renderedVisionReviewArtifact = buildRenderedVisionReviewArtifact({
            triggered: true, captureSucceeded: true, reviewSucceeded: !!review,
            screenshotReviewed: !!review, capturePartial: captured.partial, inputByteLength: captured.byteLength,
            issueCount, verdict: review?.verdict, repairTriggered: repairFromVision,
            note: review ? `vision review ${review.verdict}` : 'vision call returned no usable review',
          });
        } catch {
          renderedVisionReviewArtifact = buildRenderedVisionReviewArtifact({
            triggered: true, captureSucceeded: true, reviewSucceeded: false, screenshotReviewed: false,
            capturePartial: captured.partial, inputByteLength: captured.byteLength,
            issueCount: 0, repairTriggered: false, note: 'vision review failed open',
          });
        }
      }
    }
    emit('quality-review', 'completed', reviewRows(initialReview));

    // Fast path — a passing initial review keeps the initial project; no repair/final call.
    // Phase 13C — a model "pass" can NEVER approve while severe deterministic warnings remain.
    //    Phase 12G — a blocking binding-requirement or cross-sector-drift finding can NEVER be
    //    fast-approved (the merge above already flips passed=false, but this is an explicit guard).
    if (initialReview.passed && severeWarningGatePassed(validation) && !hasBlockingBindingFindings(initialBinding) && !hasBlockingResearchFindings(initialResearch) && !hasBlockingCompositionFindings(initialComposition) && !hasBlockingVisualSystemFindings(initialVisualSystem) && !hasBlockingContentFindings(initialContent) && !hasBlockingSiteDepthFindings(initialDepth) && !hasBlockingExperienceFindings(initialExperience) && !hasBlockingVisualFindings(initialVisual) && !hasBlockingExperienceIdentityFindings(initialExperienceIdentity) && !hasBlockingMotionExecutionFindings(initialMotion)) {
      const acceptance = acceptanceArtifact('approved', initialProjectName, {
        initialReviewPassed: true, repairAttempted: false, repairAccepted: false, finalReviewPassed: false,
        reason: `Initial static design review passed (score ${initialReview.score ?? '?'}); no severe quality warnings. Rendered visual test pending.`,
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality: false, severeWarningsBeforeRepair, renderedVisualEvaluation, renderedVisionReview: renderedVisionReviewArtifact, ...bindingExtra() });
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
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality: false, severeWarningsBeforeRepair, fallbackReasonCode: !reviewTrustworthy ? 'initial-review-incomplete' : 'no-actionable-issue', ...bindingExtra() });
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
    // ── Owner-only DELTA repair branch. The SINGLE quality-repair call still runs at most once.
    //    In `owner_delta` mode AND a trusted owner session, the repair returns bounded file
    //    upserts which the pure delta module merges into the ORIGINAL validated project and
    //    reconstructs into a complete frontend-files-v1 project; that reconstructed project then
    //    flows through the IDENTICAL Phase 12C validation + post-repair review + acceptance gates
    //    below. Disabled / non-owner ⇒ the existing full-project repair runs, byte-for-byte
    //    unchanged. A malformed / unsafe / rejected delta fails OPEN to the original project via
    //    the same `repairRaw.status !== 'completed'` branch — NEVER a second repair call. ──
    const repairMode = resolveWebBuildQualityRepairMode();
    // Delta repair eligibility: owner_delta → owners only (legacy); all_delta → every entitled
    // build user (parity — a normal beta/paid user gets the same bounded quality-recovery the owner
    // gets, so their build is not left on a worse full re-emit that can regress into Safe Preview).
    const ownerEligible = opts?.ownerEligible === true;
    // Cost Phase 3 — an APP quality repair defaults to TARGETED DELTA + COMPACT context (the SAME
    // single repair, shaped as bounded upserts over only the affected files) instead of a
    // full-project re-emit. Unaffected screens/files are preserved byte-for-byte by the delta merge.
    // FULL re-emit is a bounded PRE-CALL fallback, chosen ONLY when the review indicates the fix
    // spans essentially the whole project (a wholesale problem a delta cannot express). Exactly ONE
    // repair call either way — a delta that cannot safely apply fails OPEN to the validated project,
    // never a second call. WEB is unchanged (env-driven owner_delta/all_delta/disabled).
    const isAppBuild = spec?.buildType === 'app';
    const appRouting = isAppBuild
      ? resolveAppQualityRepairRouting({
          fileCount: validation?.files?.length ?? 0,
          issueFileCount: new Set(
            (initialReview?.issues || []).flatMap((i) => i.files || []).filter((p): p is string => typeof p === 'string' && !!p),
          ).size,
          blockingCount: (initialReview?.issues || []).filter((i) => i.severity === 'blocker').length,
        })
      : undefined;
    const appFullFallbackReason = appRouting?.fullFallbackReason;
    const deltaEligible = isAppBuild ? appRouting!.deltaEligible : isDeltaRepairEligible(repairMode, ownerEligible);
    // Compact quality-context is eligible ONLY inside the delta path. It never touches the
    // full-project repair, the initial review, revisions or any disabled path. App delta always
    // pairs with compact context (the whole point is a small, targeted repair request).
    const contextMode = resolveWebBuildQualityContextMode();
    const compactContextEligible = isAppBuild ? appRouting!.compactEligible : isCompactContextEligible(deltaEligible, contextMode, ownerEligible);
    let deltaDiagnostics: FrontendDeltaRepairArtifact | undefined;
    let repairRaw: FrontendBuilderRawArtifact;
    // Internal-only: the normalized changed/upsert paths from a valid reconstruction (used to build
    // the compact post-repair review context) and the sanitized per-stage compact-context diagnostics.
    let changedPaths: string[] | undefined;
    let qualityContextRepairDiag: FrontendQualityContextDiagnostics | undefined;
    let qualityContextPostDiag: FrontendQualityContextDiagnostics | undefined;
    if (deltaEligible) {
      // Compact repair context (safe-fallback → undefined ⇒ the existing FULL delta request, before
      // the single call; NEVER a second call). Only computed when the context flag is owner_compact.
      let compactRepair: CompactSourceContext | undefined;
      if (compactContextEligible) {
        const sel = selectCompactRepairContext({ spec, activeFiles, initialReview, qualityEvidence });
        compactRepair = sel.context;
        qualityContextRepairDiag = sel.diagnostics;
      } else {
        qualityContextRepairDiag = disabledQualityContextDiagnostics('repair', activeFiles);
      }
      const deltaRaw = await generateFrontendBuilderDeltaRepairRaw(spec, activeFiles, initialReview, { signal: opts?.signal, deterministicWarnings: activeWarnings, qualityEvidence, compact: compactRepair });
      const reconstruction = reconstructRepairRawFromDelta({ deltaRaw, originalFiles: validation?.files ?? [] });
      repairRaw = reconstruction.repairRaw;
      deltaDiagnostics = reconstruction.diagnostics;
      changedPaths = reconstruction.changedPaths;
    } else {
      repairRaw = await generateFrontendBuilderRepairRaw(spec, activeFiles, initialReview, { signal: opts?.signal, deterministicWarnings: activeWarnings, qualityEvidence });
    }
    // Bounded, sanitized compact-context diagnostics for the repair artifact (repair + post-repair
    // stages). Absent entirely for non-delta / disabled / non-owner repairs and old saved builds.
    const qcExtra = (): Partial<FrontendBuilderRepairArtifact> => {
      if (!qualityContextRepairDiag && !qualityContextPostDiag) return {};
      return {
        qualityContext: {
          ...(qualityContextRepairDiag ? { repair: qualityContextRepairDiag } : {}),
          ...(qualityContextPostDiag ? { postReview: qualityContextPostDiag } : {}),
        },
      };
    };
    // Cost Phase 3 — app quality-repair routing diagnostics (delta+compact vs justified full).
    const appRepairExtra = (): Partial<FrontendBuilderRepairArtifact> => {
      if (!isAppBuild) return {};
      const inputFileCount = validation?.files?.length ?? 0;
      const upserts = deltaDiagnostics?.returnedUpsertCount ?? 0;
      return {
        appRepair: {
          mode: deltaEligible ? 'delta' : 'full',
          contextMode: compactContextEligible ? 'compact' : 'full',
          ...(appFullFallbackReason ? { fullFallbackReason: appFullFallbackReason } : {}),
          targetFileCount: changedPaths?.length ?? upserts,
          inputFileCount,
          outputFileCount: deltaEligible ? upserts : inputFileCount,
          unaffectedFilesPreserved: deltaEligible === true,
        },
      };
    };
    if (repairRaw.status !== 'completed') {
      // An AI-usage-guard block on the OPTIONAL repair is recorded as bounded, safe diagnostics (the
      // exact guard code / kind / retryability) so the failure is diagnosable from a SAVED build; the
      // VALIDATED initial project stays active either way (fail-open). The guard already prevented the
      // extra repair spend — this never retries, re-calls or bypasses it.
      const gb = repairRaw.guardBlock;
      const guardExtra: Partial<FrontendBuilderRepairArtifact> = gb
        ? { guardBlock: { startResult: 'blocked', code: gb.code, kind: betaBlockKind(gb.code), httpStatus: gb.httpStatus, retryable: betaBlockRetryable(gb.code), taskKind: 'quality-repair', retryAfterSeconds: gb.retryAfterSeconds } }
        : {};
      const repair = repairArtifact('failed', repairRaw.reason || 'The repair call did not complete.', {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId, initialScore: initialReview.score,
        ...(deltaDiagnostics ? { deltaRepair: deltaDiagnostics } : {}),
        ...guardExtra,
        ...qcExtra(),
        ...appRepairExtra(),
      });
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: false, finalReviewPassed: false,
        reason: gb
          ? `The bounded repair was refused by the AI usage guard (${gb.code}); the initial validated project stays active. Manual rendered review required.`
          : 'The bounded repair call did not complete; the initial validated project stays active. Manual rendered review required.',
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair, fallbackReasonCode: gb ? 'repair-guard-blocked' : 'repair-call-incomplete', ...bindingExtra() });
      emit('quality-repair', 'completed', [{ label: 'result', value: gb ? `guard-blocked (${gb.code})` : 'not applied' }]);
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
        ...(deltaDiagnostics ? { deltaRepair: deltaDiagnostics } : {}),
        ...qcExtra(),
        ...appRepairExtra(),
      });
      const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: false, finalReviewPassed: false,
        reason: 'The repaired project did not pass static validation; the initial validated project stays active. No post-repair review ran. Manual rendered review required.',
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair, fallbackReasonCode: 'repair-failed-validation', ...bindingExtra() });
      emit('quality-repair', 'completed', [{ label: 'result', value: 'rejected' }]);
      emit('acceptance', 'completed', acceptanceRows('manual-review-required', initialProjectName));
      return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, acceptance });
    }

    // Phase 13C — severe warnings in the REPAIRED project (real-file evidence, no model call).
    const severeWarningsAfterRepair = severeWarningCodes(repairValidation);
    const repairSevereGatePassed = severeWarningGatePassed(repairValidation);

    // ── Step 7 — STATIC post-repair review of the repaired files (exactly one parse). The
    //    COMPLETE reconstructed project is ALWAYS parsed/validated locally above; only the model's
    //    review CONTEXT is compacted (owner_delta compact mode + resolvable changed paths), never
    //    the local gates. Safe-fallback → undefined ⇒ the existing full-source review request. ──
    const repairedActiveFiles = toActiveFiles(repairValidation.files);
    let compactPost: CompactSourceContext | undefined;
    if (compactContextEligible) {
      // Post-repair compaction seeds on the reconstruction's changed paths; the selector itself
      // safe-falls-back (context undefined) when they are absent/inconsistent or any bound fails.
      const sel = selectCompactPostRepairContext({ spec, reconstructedFiles: repairedActiveFiles, changedPaths: changedPaths ?? [], initialReview });
      compactPost = sel.context;
      qualityContextPostDiag = sel.diagnostics;
    }
    const finalReviewRaw = await generateFrontendBuilderReviewRaw(spec, repairedActiveFiles, 'post-repair', initialReview, { signal: opts?.signal, deterministicWarnings: warningSummaries(repairValidation), compact: compactPost });
    let finalReview = parseFrontendBuilderReview(finalReviewRaw, 'post-repair', repairedActiveFiles, { heroComponentPath: repairValidation.heroComponentPath });

    // ── Phase 12G — re-run the SAME authoritative binding/drift analyzer on the COMPLETE
    //    reconstructed repaired project (full OR owner-delta — both revalidate a complete project,
    //    so there is NO analysis gap). A repaired project can NEVER be accepted merely because the
    //    review score improved: a blocking binding requirement or cross-sector drift still blocks. ──
    try {
      repairBinding = analyzeBindingAcceptance(repairValidation.files, bindingReqs, driftPolicy, imageCoverage);
      repairResearch = analyzeResearchGrounding(repairValidation.files, researchDirection);
      repairComposition = analyzeComposition(repairValidation.files, composition);
      repairVisualSystem = analyzeVisualSystem(repairValidation.files, visualSystem);
      repairContent = analyzeContentNarrative(repairValidation.files, contentNarrative);
      repairDepth = analyzeSiteDepth(repairValidation.files, siteDepth);
      repairExperience = analyzeExperienceQuality(repairValidation.files, experienceQuality);
      repairVisual = analyzeVisualContribution(repairValidation.files, visualConcept);
      repairExperienceIdentity = analyzeExperienceIdentity(repairValidation.files, experienceIdentity);
      repairMotion = analyzeMotionExecution(repairValidation.files, motionExecution, motionHeroSectionId);
      repairObligations = analyzeObligationFulfillment(repairValidation.files, executionObligations);
      obligationComparison = compareObligationFulfillment(initialObligations, repairObligations);
      const detIssuesFB = [
        ...(repairBinding ? bindingIssuesToReviewIssues(repairBinding) : []),
        ...(repairResearch ? researchGroundingToReviewIssues(repairResearch) : []),
        ...(repairComposition ? compositionToReviewIssues(repairComposition) : []),
        ...(repairVisualSystem ? visualSystemToReviewIssues(repairVisualSystem) : []),
        ...(repairContent ? contentNarrativeToReviewIssues(repairContent) : []),
        ...(repairDepth ? siteDepthToReviewIssues(repairDepth) : []),
        ...(repairExperience ? experienceToReviewIssues(repairExperience) : []),
        ...(repairVisual ? visualToReviewIssues(repairVisual) : []),
        ...(repairExperienceIdentity ? experienceIdentityToReviewIssues(repairExperienceIdentity) : []),
        ...(repairMotion ? motionExecutionToReviewIssues(repairMotion) : []),
      ].map((i) => ({ ...i, gateCritical: true }));
      if (detIssuesFB.length && finalReview.status === 'completed') {
        const { issues: mergedFB, added: addedFB } = mergeDeterministicIssues(finalReview.issues, detIssuesFB);
        if (addedFB > 0) finalReview = recomputeReviewWithMergedIssues(finalReview, mergedFB, addedFB);
      }
    } catch { /* fail-open: post-repair deterministic analysis must never break a build */ }

    // ── Step 8 — repair acceptance gate: valid + final pass + strict score improvement +
    //    Phase 13C severe-warning gate (a model "pass" cannot approve a still-shallow repair) +
    //    Phase 12G binding/drift gate (blocking binding or cross-sector-drift findings block). ──
    const initialScore = initialReview.score ?? 0;
    const finalScore = finalReview.score ?? 0;
    // Hoist the nine deterministic blocking-analyzer results + the obligation-regression flag so the
    // acceptance decision, the human-readable rejection cascade, and the bounded gate diagnostic all
    // read the SAME single evaluation (no divergence, no double analysis).
    const blockingBinding = hasBlockingBindingFindings(repairBinding);
    const blockingResearch = hasBlockingResearchFindings(repairResearch);
    const blockingComposition = hasBlockingCompositionFindings(repairComposition);
    const blockingVisualSystem = hasBlockingVisualSystemFindings(repairVisualSystem);
    const blockingContent = hasBlockingContentFindings(repairContent);
    const blockingSiteDepth = hasBlockingSiteDepthFindings(repairDepth);
    const blockingExperience = hasBlockingExperienceFindings(repairExperience);
    const blockingVisual = hasBlockingVisualFindings(repairVisual);
    const blockingExperienceIdentity = hasBlockingExperienceIdentityFindings(repairExperienceIdentity);
    const blockingMotionExecution = hasBlockingMotionExecutionFindings(repairMotion);
    // Phase 8 — reject a repair that regressed a previously-fulfilled REQUIRED obligation (fails open
    // when the comparison is ambiguous). Preserves already-good sections; never blocks an initial build.
    const obligationRegressionRejects = !!(obligationComparison && obligationComparison.regressionRejectsRepair);
    // ── Deterministic acceptance gate (pure, owner-agnostic). `gate.accept` is byte-for-byte the
    //    same conjunction as before; `gate.diagnostics` surfaces the exact failing/passing condition
    //    (numeric score gates, model-review gates, severe-warning gate, each blocking analyzer, the
    //    obligation-regression gate, delta-reconstruction result) for the activity timeline. ──
    const gate = evaluateAcceptanceGate({
      finalReviewCompleted: finalReview.status === 'completed',
      finalReviewPassed: finalReview.passed,
      initialScore,
      finalScore,
      minRequiredScore: MIN_ACCEPT_SCORE,
      blockerCount: finalReview.blockerCount ?? 0,
      majorCount: finalReview.majorCount ?? 0,
      severeWarningGatePassed: repairSevereGatePassed,
      blockingBinding,
      blockingResearch,
      blockingComposition,
      blockingVisualSystem,
      blockingContent,
      blockingSiteDepth,
      blockingExperience,
      blockingVisual,
      blockingExperienceIdentity,
      blockingMotionExecution,
      obligationRegressionRejects,
      deltaRepairUsed: !!deltaDiagnostics,
      deltaRepairAccepted: deltaDiagnostics ? deltaDiagnostics.accepted : undefined,
      obligationRegressedCount: obligationComparison ? obligationComparison.regressed.length : undefined,
      severeWarningCodes: severeWarningsAfterRepair,
    });
    const accept = gate.accept;

    // ── Bounded acceptance-gate / repair ALIGNMENT diagnostics (safe metadata only). Proves every
    //    acceptance-gate blocker became an explicit repair obligation and how many survived one repair,
    //    so "score improved but a gate still blocks" is diagnosable from the saved build. Per-dimension
    //    blocking state pre vs post; research-pattern counts; the exact remaining research reasons. ──
    const gateAlignment: NonNullable<FrontendBuilderRepairArtifact['gateAlignment']> = (() => {
      const dims: Array<[boolean, boolean]> = [
        [hasBlockingBindingFindings(initialBinding), blockingBinding],
        [hasBlockingResearchFindings(initialResearch), blockingResearch],
        [hasBlockingCompositionFindings(initialComposition), blockingComposition],
        [hasBlockingVisualSystemFindings(initialVisualSystem), blockingVisualSystem],
        [hasBlockingContentFindings(initialContent), blockingContent],
        [hasBlockingSiteDepthFindings(initialDepth), blockingSiteDepth],
        [hasBlockingExperienceFindings(initialExperience), blockingExperience],
        [hasBlockingVisualFindings(initialVisual), blockingVisual],
        [hasBlockingExperienceIdentityFindings(initialExperienceIdentity), blockingExperienceIdentity],
        [hasBlockingMotionExecutionFindings(initialMotion), blockingMotionExecution],
      ];
      const requiredBlockers = dims.filter(([pre]) => pre).length;
      const unresolvedBlockers = dims.filter(([pre, post]) => pre && post).length;
      const nonMinorMissing = (r: ResearchGroundingResult | undefined) =>
        r ? r.issues.filter((i) => i.severity !== 'minor' && i.code === 'research-required-pattern-missing').length : 0;
      const researchRequirementsCount = nonMinorMissing(initialResearch);
      const researchRequirementsAddressed = Math.max(0, researchRequirementsCount - nonMinorMissing(repairResearch));
      const finalResearchBlockingReasons = repairResearch
        ? repairResearch.issues.filter((i) => i.severity !== 'minor').map((i) => `${i.code}:${i.label}`.slice(0, 80)).slice(0, 6)
        : [];
      return {
        requiredBlockers,
        addressedBlockers: Math.max(0, requiredBlockers - unresolvedBlockers),
        unresolvedBlockers,
        researchRequirementsCount,
        researchRequirementsAddressed,
        finalResearchBlockingReasons,
      };
    })();

    // ── Bounded MAJOR-issue alignment diagnostics. Proves whether the highest-priority majors reached
    //    the single repair (selection size + dropped majors) and how many the final review still flags,
    //    so "score improved but majors remain" is diagnosable. Safe metadata only (counts + category:file). ──
    const majorAlignment: NonNullable<FrontendBuilderRepairArtifact['majorAlignment']> = (() => {
      const isMajor = (i: FrontendBuilderReviewIssue) => i.severity === 'major';
      const initialMajors = (initialReview.issues || []).filter(isMajor);
      const selected = selectBoundedRepairIssues(initialReview.issues || []);
      const selectedMajorCount = selected.filter(isMajor).length;
      const finalMajors = finalReview.status === 'completed' ? (finalReview.issues || []).filter(isMajor) : [];
      return {
        requiredMajors: initialMajors.length,
        addressedMajors: Math.max(0, initialMajors.length - finalMajors.length),
        unresolvedMajors: finalMajors.length,
        issueSelectionCount: selected.length,
        issueSelectionDroppedMajors: Math.max(0, initialMajors.length - selectedMajorCount),
        finalMajorReasons: finalMajors.map((i) => `${i.category}:${(i.files && i.files[0]) || '?'}`.slice(0, 80)).slice(0, 6),
      };
    })();

    if (accept) {
      const repair = repairArtifact('accepted', `Repair accepted: score improved ${initialScore} → ${finalScore} and the post-repair review passed with no blocker/major issues and no severe quality warnings.`, {
        model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId,
        validationStatus: 'valid',
        generatedFileCount: repairValidation.fileCount,
        generatedCharCount: repairValidation.totalCharCount,
        initialScore, finalScore,
        ...(deltaDiagnostics ? { deltaRepair: deltaDiagnostics } : {}),
        gateAlignment,
        majorAlignment,
        ...qcExtra(),
        ...appRepairExtra(),
      });
      const acceptance = acceptanceArtifact('repaired-approved', 'repaired-model-native', {
        initialReviewPassed: false, repairAttempted: true, repairAccepted: true, finalReviewPassed: true,
        reason: `One bounded repair accepted after static validation, a passing post-repair review (score ${initialScore} → ${finalScore}), a clear severe-warning gate and a clear binding/drift gate. Rendered visual test pending.`,
      }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair, severeWarningsAfterRepair, renderedVisualEvaluation, renderedVisionReview: renderedVisionReviewArtifact, acceptanceGate: gate.diagnostics, ...bindingExtra() });
      emit('quality-repair', 'completed', [{ label: 'result', value: 'accepted' }, { label: 'score', value: `${initialScore} → ${finalScore}` }]);
      emit('acceptance', 'completed', acceptanceRows('repaired-approved', 'repaired-model-native', gate.reasonCode));
      return attachFrontendBuilderQualityResult(working, {
        ran: true, initialReview, repair, finalReview, acceptance,
        acceptedRepairedFiles: repairValidation.files,
        acceptedRepairedValidation: repairValidation,
      });
    }

    // Repair validated but was not accepted (final review failed / malformed / no improvement /
    // severe warnings still remain). Phase 13C — a repair that stays shallow is rejected by the
    // deterministic severe-warning gate even if the model reviewer "passed" it.
    // Same priority order as the deterministic gate's reasonCode cascade; uses the hoisted
    // blocking booleans so the human text and the structured `gate.reasonCode` can never disagree.
    const rejectReason = blockingExperience
      ? `The repaired project still fails the binding integrated experience (${experienceIssueCodes(repairExperience).slice(0, 4).join(', ')} — e.g. a desktop-only/broken-mobile layout, clipped required copy, a shallow interaction with no feedback, an inaccessible control, or eager/oversized media); the repair was not accepted.`
      : blockingContent
      ? `The repaired project still fails the binding content narrative (${contentNarrativeIssueCodes(repairContent).slice(0, 4).join(', ')} — e.g. a required section with no substantive public copy, generic/duplicated propositions across sections, leaked internal planning copy, or no actionable CTA); the repair was not accepted.`
      : blockingSiteDepth
      ? `The repaired project is still materially underdeveloped for its site type (${siteDepthIssueCodes(repairDepth).slice(0, 4).join(', ')} — e.g. a core browse/decision surface rendered heading-only, or the core decision content never rendering); the repair was not accepted.`
      : blockingVisualSystem
      ? `The repaired project still fails the binding visual system (${visualSystemIssueCodes(repairVisualSystem).slice(0, 4).join(', ')} — e.g. no coherent token source, declared tokens bypassed, repeated generic card chrome, or unreadable body text); the repair was not accepted.`
      : blockingVisual
      ? `The repaired project still fails the binding visual concept (${visualIssueCodes(repairVisual).slice(0, 4).join(', ')} — e.g. the signature hero visual is absent or a placeholder, or one image is reused across distinct required roles); the repair was not accepted.`
      : blockingExperienceIdentity
      ? `The repaired project still fails the binding experience identity (${experienceIdentityIssueCodes(repairExperienceIdentity).slice(0, 4).join(', ')} — e.g. a regulated/high-stakes experience with no visible limitation/disclaimer language); the repair was not accepted.`
      : blockingMotionExecution
      ? `The repaired project still fails the binding motion execution (${motionExecutionIssueCodes(repairMotion).slice(0, 4).join(', ')} — e.g. a required signature animated scene rendered as a static visual with no animation); the repair was not accepted.`
      : obligationRegressionRejects
      ? `The repair regressed ${obligationComparison!.regressed.length} already-fulfilled required obligation(s) (${obligationComparison!.regressed.slice(0, 3).map((r) => `${r.type}: ${r.before}→${r.after}`).join(', ')}); the pre-repair project is preserved instead.`
      : blockingComposition
      ? `The repaired project still collapses into a repeated template composition (${compositionIssueCodes(repairComposition).slice(0, 4).join(', ')} — distinct sections rendered as the same generic grid); the repair was not accepted.`
      : blockingResearch
      ? `The repaired project still contradicts the researched sector direction (${researchGroundingIssueCodes(repairResearch).slice(0, 4).join(', ')} — e.g. a sector-incompatible module, a fabricated public claim, or a missing required sector pattern); the repair was not accepted.`
      : blockingBinding
      ? `The repaired project still fails a binding user-requirement or shows cross-sector drift (${bindingIssueCodes(repairBinding).slice(0, 4).join(', ')}); the repair was not accepted.`
      : !repairSevereGatePassed
      ? `The repaired project still shows severe quality warnings (${severeWarningsAfterRepair.slice(0, 4).join(', ')}); the repair was not accepted.`
      : finalReview.status !== 'completed'
        ? 'The post-repair static review did not complete; the repair was not accepted.'
        : !finalReview.passed
          ? `The post-repair review still reports blocker/major issues or a sub-${MIN_ACCEPT_SCORE} score (score ${finalScore}); the repair was not accepted.`
          : `The repair reached a passing review (score ${finalScore}) but did not exceed the initial score (${initialScore} → ${finalScore}), so the strict-improvement gate did not accept it.`;
    const repair = repairArtifact('rejected', rejectReason, {
      model: repairRaw.model, provider: repairRaw.provider, requestId: repairRaw.requestId,
      validationStatus: 'valid',
      generatedFileCount: repairValidation.fileCount,
      generatedCharCount: repairValidation.totalCharCount,
      initialScore, finalScore: finalReview.status === 'completed' ? finalScore : undefined,
      ...(deltaDiagnostics ? { deltaRepair: deltaDiagnostics } : {}),
      gateAlignment,
      majorAlignment,
      ...qcExtra(),
      ...appRepairExtra(),
    });
    const acceptance = acceptanceArtifact('manual-review-required', initialProjectName, {
      initialReviewPassed: false, repairAttempted: true, repairAccepted: false,
      finalReviewPassed: finalReview.passed,
      reason: `${rejectReason} The initial validated project stays active; a structurally valid, consumed, runnable model-native project is shown to users as a PROVISIONAL preview pending final approval (not as an approved site), and only a genuinely non-render-safe project falls back to Safe Preview. Manual rendered review required.`,
    }, { usedDeterministicFallback, repairTriggeredByShallowQuality, severeWarningsBeforeRepair, severeWarningsAfterRepair, renderedVisualEvaluation, renderedVisionReview: renderedVisionReviewArtifact, acceptanceGate: gate.diagnostics, ...bindingExtra() });
    emit('quality-repair', 'completed', [{ label: 'result', value: 'rejected' }]);
    emit('acceptance', 'completed', acceptanceRows('manual-review-required', initialProjectName, gate.reasonCode));
    return attachFrontendBuilderQualityResult(working, { ran: true, initialReview, repair, finalReview, acceptance });
  } catch (err) {
    // Explicit caller cancellation must propagate so a cancelled turn is not persisted.
    if (err instanceof WebBuildError && err.kind === 'cancelled') throw err;
    // A usage/entitlement BLOCK on a Web Build sub-call (e.g. the design-quality review is
    // gated by ai_guard) is a policy outcome, not a quality failure. Propagate it so the caller
    // surfaces the HONEST localized limit/concurrency message (the same path generation uses) —
    // instead of swallowing it into a generic Safe-Preview "quality check could not finish".
    if (err instanceof WebBuildError && err.kind === 'beta_limit') throw err;
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
    }, { fallbackReasonCode: 'pipeline-error' });
    try {
      // `working` is scoped to the try; the catch only has the pre-try `consumed`.
      return attachFrontendBuilderQualityResult(consumed, { ran: false, acceptance: skipped });
    } catch {
      return consumed;
    }
  }
}
