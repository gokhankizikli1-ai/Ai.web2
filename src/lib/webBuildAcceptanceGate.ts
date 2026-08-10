/* ── Web Build — deterministic post-repair ACCEPTANCE GATE (pure, observable) ──────────────────
 *
 * WHY THIS MODULE EXISTS
 * A repaired frontend candidate is accepted or rejected by a DETERMINISTIC gate that is entirely
 * independent of the model "Reviewer Agent". The reviewer only produces a verdict/score/issue
 * counts; the gate then ANDs that with a strict numeric score-improvement requirement, a
 * severe-warning gate computed from real files, nine deterministic blocking-analyzer gates
 * (binding, research, composition, visual-system, content, experience, visual, experience-identity,
 * motion), and an obligation-regression gate. So the reviewer can honestly report "no blocking
 * issues" while the gate still rejects — because the reviewer never evaluated those other gates.
 *
 * Previously the exact failing condition was computed but only ever rendered as a coarse status
 * label ("manual-review-required") in the activity timeline, so an owner could not see WHICH gate
 * rejected a candidate without another (paid) build. This module makes the decision a PURE,
 * unit-tested function that ALSO returns a bounded, sanitized diagnostic exposing every gate
 * signal and the single most-specific rejection reason.
 *
 * IMPORTANT: this module changes NO thresholds and makes NO decision the previous inline
 * expression did not already make — `evaluateAcceptanceGate().accept` is byte-for-byte the same
 * conjunction. It only surfaces the reason. It performs NO IO and NO model call.
 */

/** The minimum post-repair score an accepted repair must reach. Mirrors MIN_ACCEPT_SCORE /
 *  MIN_PASS_SCORE (the review parser already requires score ≥ this for `passed`). */
export const ACCEPTANCE_MIN_SCORE = 82;

/** The single most-specific reason a candidate was rejected, ordered to match the human-readable
 *  rejection cascade the acceptance/repair `reason` strings use. `accepted` when every gate passed. */
export type FrontendAcceptanceGateReasonCode =
  | 'accepted'
  | 'blocking-experience'
  | 'blocking-content'
  | 'blocking-visual-system'
  | 'blocking-visual'
  | 'blocking-experience-identity'
  | 'blocking-motion'
  | 'obligation-regression'
  | 'blocking-composition'
  | 'blocking-research'
  | 'blocking-binding'
  | 'severe-warnings'
  | 'post-repair-review-incomplete'
  | 'review-not-passed'
  | 'score-not-improved';

/** The raw, already-computed signals the deterministic gate ANDs together. Booleans are passed in
 *  (not analyzer objects) so this module stays dependency-free and trivially testable. Every
 *  `blocking*` field is TRUE when that analyzer found a BLOCKING (accept-rejecting) finding. */
export interface AcceptanceGateInput {
  /** The post-repair static review parsed/completed. */
  finalReviewCompleted: boolean;
  /** The post-repair review `passed` flag (already requires score ≥ ACCEPTANCE_MIN_SCORE and
   *  zero blocker/major in the review parser). */
  finalReviewPassed: boolean;
  /** Pre-repair baseline score (post deterministic-merge). */
  initialScore: number;
  /** Post-repair score. */
  finalScore: number;
  /** Minimum required score (ACCEPTANCE_MIN_SCORE). */
  minRequiredScore: number;
  blockerCount: number;
  majorCount: number;
  /** The Phase 13C severe-warning gate over the REPAIRED files. */
  severeWarningGatePassed: boolean;
  blockingBinding: boolean;
  blockingResearch: boolean;
  blockingComposition: boolean;
  blockingVisualSystem: boolean;
  blockingContent: boolean;
  blockingExperience: boolean;
  blockingVisual: boolean;
  blockingExperienceIdentity: boolean;
  blockingMotionExecution: boolean;
  /** The obligation-regression gate rejected the repair (a previously-fulfilled required
   *  obligation regressed). Fails open (false) when the comparison is ambiguous. */
  obligationRegressionRejects: boolean;

  /* ── Bounded observability extras (do NOT affect the decision) ── */
  /** Owner-delta / all-delta reconstruction ran for this repair. */
  deltaRepairUsed?: boolean;
  /** The delta reconstruction was accepted (a complete project was rebuilt from bounded upserts). */
  deltaRepairAccepted?: boolean;
  /** Number of required obligations that regressed (for the diagnostic only). */
  obligationRegressedCount?: number;
  /** Bounded severe-warning codes present after the repair (for the diagnostic only). */
  severeWarningCodes?: string[];
}

/** Bounded, sanitized acceptance-gate diagnostic. Counts / booleans / bounded codes only — never
 *  source, prompts, provider output, ids, secrets or PII. Safe to persist on the acceptance
 *  artifact and to render in the owner activity timeline. Additive + backward compatible. */
export interface FrontendAcceptanceGateDiagnostics {
  version: 'frontend-acceptance-gate-v1';
  outcome: 'accepted' | 'rejected';
  primaryReasonCode: FrontendAcceptanceGateReasonCode;

  // ── numeric score gates ──
  initialScore: number;
  finalScore: number;
  minRequiredScore: number;
  /** finalScore ≥ minRequiredScore. */
  scoreMeetsThreshold: boolean;
  /** finalScore > initialScore (the strict-improvement gate — the one numeric gate the model
   *  reviewer does NOT evaluate). */
  scoreImproved: boolean;

  // ── model review gates ──
  finalReviewCompleted: boolean;
  finalReviewPassed: boolean;
  blockerCount: number;
  majorCount: number;

  // ── deterministic severe-warning gate ──
  severeWarningGatePassed: boolean;
  severeWarningCodes?: string[];

  // ── nine deterministic blocking-analyzer gates (true = blocking i.e. rejecting) ──
  blockingBinding: boolean;
  blockingResearch: boolean;
  blockingComposition: boolean;
  blockingVisualSystem: boolean;
  blockingContent: boolean;
  blockingExperience: boolean;
  blockingVisual: boolean;
  blockingExperienceIdentity: boolean;
  blockingMotionExecution: boolean;
  /** True when ANY of the nine analyzer gates blocked. */
  anyBlockingAnalyzer: boolean;

  // ── obligation-regression gate ──
  obligationRegressionRejects: boolean;
  obligationRegressedCount?: number;

  // ── delta reconstruction (owner_delta / all_delta only) ──
  deltaRepairUsed: boolean;
  deltaRepairAccepted?: boolean;
}

export interface AcceptanceGateResult {
  /** The acceptance decision. Byte-for-byte identical to the previous inline conjunction. */
  accept: boolean;
  /** The single most-specific reason (mirrors the human-readable cascade). */
  reasonCode: FrontendAcceptanceGateReasonCode;
  diagnostics: FrontendAcceptanceGateDiagnostics;
}

/**
 * Evaluate the deterministic post-repair acceptance gate.
 *
 * `accept` is EXACTLY:
 *   finalReviewCompleted && finalReviewPassed && finalScore ≥ minRequiredScore &&
 *   blockerCount === 0 && majorCount === 0 && finalScore > initialScore &&
 *   severeWarningGatePassed && none of the nine analyzer gates block &&
 *   !obligationRegressionRejects
 *
 * The gate is owner-agnostic: it receives only already-computed signals and contains no
 * owner/entitlement branch, so an owner and a normal user with the SAME candidate get the SAME
 * decision, reason, and diagnostic.
 */
export function evaluateAcceptanceGate(input: AcceptanceGateInput): AcceptanceGateResult {
  const scoreMeetsThreshold = input.finalScore >= input.minRequiredScore;
  const scoreImproved = input.finalScore > input.initialScore;
  const anyBlockingAnalyzer =
    input.blockingBinding ||
    input.blockingResearch ||
    input.blockingComposition ||
    input.blockingVisualSystem ||
    input.blockingContent ||
    input.blockingExperience ||
    input.blockingVisual ||
    input.blockingExperienceIdentity ||
    input.blockingMotionExecution;

  const accept =
    input.finalReviewCompleted &&
    input.finalReviewPassed &&
    scoreMeetsThreshold &&
    input.blockerCount === 0 &&
    input.majorCount === 0 &&
    scoreImproved &&
    input.severeWarningGatePassed &&
    !anyBlockingAnalyzer &&
    !input.obligationRegressionRejects;

  const reasonCode = resolveReasonCode(accept, input);

  const diagnostics: FrontendAcceptanceGateDiagnostics = {
    version: 'frontend-acceptance-gate-v1',
    outcome: accept ? 'accepted' : 'rejected',
    primaryReasonCode: reasonCode,
    initialScore: input.initialScore,
    finalScore: input.finalScore,
    minRequiredScore: input.minRequiredScore,
    scoreMeetsThreshold,
    scoreImproved,
    finalReviewCompleted: input.finalReviewCompleted,
    finalReviewPassed: input.finalReviewPassed,
    blockerCount: input.blockerCount,
    majorCount: input.majorCount,
    severeWarningGatePassed: input.severeWarningGatePassed,
    ...(input.severeWarningCodes && input.severeWarningCodes.length
      ? { severeWarningCodes: input.severeWarningCodes.slice(0, 8) }
      : {}),
    blockingBinding: input.blockingBinding,
    blockingResearch: input.blockingResearch,
    blockingComposition: input.blockingComposition,
    blockingVisualSystem: input.blockingVisualSystem,
    blockingContent: input.blockingContent,
    blockingExperience: input.blockingExperience,
    blockingVisual: input.blockingVisual,
    blockingExperienceIdentity: input.blockingExperienceIdentity,
    blockingMotionExecution: input.blockingMotionExecution,
    anyBlockingAnalyzer,
    obligationRegressionRejects: input.obligationRegressionRejects,
    ...(typeof input.obligationRegressedCount === 'number'
      ? { obligationRegressedCount: input.obligationRegressedCount }
      : {}),
    deltaRepairUsed: input.deltaRepairUsed === true,
    ...(typeof input.deltaRepairAccepted === 'boolean'
      ? { deltaRepairAccepted: input.deltaRepairAccepted }
      : {}),
  };

  return { accept, reasonCode, diagnostics };
}

/** The single most-specific reason, in the SAME priority order as the human-readable rejection
 *  cascade in the pipeline (blocking analyzers first, then obligation regression / composition /
 *  research / binding, then the severe-warning gate, then review-completion, review-pass, and
 *  finally the strict score-improvement gate). */
function resolveReasonCode(accept: boolean, input: AcceptanceGateInput): FrontendAcceptanceGateReasonCode {
  if (accept) return 'accepted';
  if (input.blockingExperience) return 'blocking-experience';
  if (input.blockingContent) return 'blocking-content';
  if (input.blockingVisualSystem) return 'blocking-visual-system';
  if (input.blockingVisual) return 'blocking-visual';
  if (input.blockingExperienceIdentity) return 'blocking-experience-identity';
  if (input.blockingMotionExecution) return 'blocking-motion';
  if (input.obligationRegressionRejects) return 'obligation-regression';
  if (input.blockingComposition) return 'blocking-composition';
  if (input.blockingResearch) return 'blocking-research';
  if (input.blockingBinding) return 'blocking-binding';
  if (!input.severeWarningGatePassed) return 'severe-warnings';
  if (!input.finalReviewCompleted) return 'post-repair-review-incomplete';
  if (!input.finalReviewPassed) return 'review-not-passed';
  // Reachable only when the review passed (⇒ score ≥ threshold, zero blocker/major) and every
  // deterministic gate cleared: the sole failing condition is the strict score-improvement gate.
  return 'score-not-improved';
}

/** A short, human-readable label for the activity timeline row. Bounded + safe. */
export function acceptanceReasonLabel(code: FrontendAcceptanceGateReasonCode): string {
  switch (code) {
    case 'accepted': return 'accepted';
    case 'blocking-experience': return 'blocked: integrated experience';
    case 'blocking-content': return 'blocked: content narrative';
    case 'blocking-visual-system': return 'blocked: visual system';
    case 'blocking-visual': return 'blocked: visual concept';
    case 'blocking-experience-identity': return 'blocked: experience identity';
    case 'blocking-motion': return 'blocked: motion execution';
    case 'obligation-regression': return 'blocked: obligation regression';
    case 'blocking-composition': return 'blocked: repeated composition';
    case 'blocking-research': return 'blocked: sector research drift';
    case 'blocking-binding': return 'blocked: binding requirement / drift';
    case 'severe-warnings': return 'blocked: severe quality warnings';
    case 'post-repair-review-incomplete': return 'blocked: post-repair review incomplete';
    case 'review-not-passed': return 'blocked: review not passed (blocker/major or sub-threshold score)';
    case 'score-not-improved': return 'blocked: score did not improve';
  }
}

/** A short, SAFE, non-technical category name for a blocking-analyzer reason code — used in the
 *  end-user-facing sentence. Never exposes internal module/implementation names, prompts, ids or
 *  provider data. Returns null for non-analyzer reason codes. */
function safeBlockingCategory(code: FrontendAcceptanceGateReasonCode): { en: string; tr: string } | null {
  const map: Partial<Record<FrontendAcceptanceGateReasonCode, { en: string; tr: string }>> = {
    'blocking-experience': { en: 'integrated experience', tr: 'bütünleşik deneyim' },
    'blocking-content': { en: 'content', tr: 'içerik' },
    'blocking-visual-system': { en: 'visual system', tr: 'görsel sistem' },
    'blocking-visual': { en: 'visual concept', tr: 'görsel konsept' },
    'blocking-experience-identity': { en: 'experience identity', tr: 'deneyim kimliği' },
    'blocking-motion': { en: 'motion', tr: 'hareket' },
    'blocking-composition': { en: 'layout composition', tr: 'yerleşim düzeni' },
    'blocking-research': { en: 'sector fit', tr: 'sektör uyumu' },
    'blocking-binding': { en: 'requirement coverage', tr: 'gereksinim kapsamı' },
  };
  return map[code] ?? null;
}

/**
 * Build the bounded, SAFE, end-user-facing rejection reason for a build that was NOT approved.
 *
 * This is what a NORMAL (non-owner) user is allowed to see about THEIR OWN build. It reads ONLY
 * the safe fields of the persisted diagnostic — the reason code, the numeric quality scores
 * (initial / final / minimum), the score-improvement / threshold booleans, a sanitized blocking
 * category name, and the obligation-regression / severe-warning booleans. It NEVER exposes prompts,
 * source, provider output, ids, secrets, token usage, internal routing, delta/owner diagnostics, or
 * raw blocking counts/codes. Returns null when the candidate was accepted (no rejection to explain).
 */
export function buildUserFacingAcceptanceReason(
  gate: FrontendAcceptanceGateDiagnostics | undefined,
): { en: string; tr: string } | null {
  if (!gate || gate.outcome !== 'rejected') return null;
  const init = gate.initialScore;
  const fin = gate.finalScore;
  const min = gate.minRequiredScore;
  switch (gate.primaryReasonCode) {
    case 'score-not-improved':
      return {
        en: `Quality gate: the design-quality score did not improve after the automatic repair (${init} → ${fin}; minimum ${min}).`,
        tr: `Kalite kapısı: otomatik düzeltmeden sonra tasarım kalite puanı yükselmedi (${init} → ${fin}; asgari ${min}).`,
      };
    case 'review-not-passed':
      return gate.scoreMeetsThreshold
        ? {
            en: 'Quality gate: the design-quality review still reported blocking issues after the repair.',
            tr: 'Kalite kapısı: düzeltmeden sonra tasarım kalite incelemesi hâlâ engelleyici sorunlar bildirdi.',
          }
        : {
            en: `Quality gate: the score after repair stayed below the minimum (${fin}; minimum ${min}).`,
            tr: `Kalite kapısı: düzeltme sonrası puan asgarinin altında kaldı (${fin}; asgari ${min}).`,
          };
    case 'post-repair-review-incomplete':
      return {
        en: 'Quality gate: the automatic quality review did not complete, so the build was not approved.',
        tr: 'Kalite kapısı: otomatik kalite incelemesi tamamlanmadı; bu nedenle yapı onaylanmadı.',
      };
    case 'severe-warnings':
      return {
        en: 'Quality gate: severe quality warnings remained after the repair.',
        tr: 'Kalite kapısı: düzeltmeden sonra ciddi kalite uyarıları devam etti.',
      };
    case 'obligation-regression':
      return {
        en: 'Quality gate: the repair regressed a previously-completed requirement, so the earlier version was kept.',
        tr: 'Kalite kapısı: düzeltme daha önce tamamlanmış bir gereksinimi bozdu; bu nedenle önceki sürüm korundu.',
      };
    default: {
      // Any of the nine blocking-analyzer reason codes → a sanitized category sentence.
      const cat = safeBlockingCategory(gate.primaryReasonCode);
      if (cat) {
        return {
          en: `Quality gate: the ${cat.en} quality check still did not pass after the repair.`,
          tr: `Kalite kapısı: ${cat.tr} kalite kontrolü düzeltmeden sonra hâlâ geçemedi.`,
        };
      }
      // Fallback — a generic, safe sentence (should be unreachable for a rejected gate).
      return GENERIC_ACCEPTANCE_REASON;
    }
  }
}

/* ── Pre-gate / non-gate SAFE-PREVIEW fallback reasons ─────────────────────────────────────────
 * A build can fall to Safe Preview WITHOUT ever reaching the deterministic acceptance gate — the
 * repair call did not complete, the repaired project failed static re-validation, the initial
 * review produced no actionable fix, the structural contract repair failed, the project was not
 * consumable, or the pipeline errored open. Those acceptance artifacts carry NO `acceptanceGate`,
 * so before this they surfaced NO user-facing reason (the reported "Quality gate line missing"
 * bug). Each such path now stamps a bounded `fallbackReasonCode` that maps to a safe sentence here.
 * Counts/booleans/bounded codes only — never source, prompts, provider output, ids or PII. */
export type FrontendAcceptanceFallbackReasonCode =
  | 'repair-call-incomplete'
  | 'repair-failed-validation'
  | 'repair-guard-blocked'
  | 'no-actionable-issue'
  | 'initial-review-incomplete'
  | 'contract-repair-failed'
  | 'not-consumable'
  | 'pipeline-error';

/** The single, always-safe generic sentence — used when a build fell back but no specific reason
 *  code is present, so a Safe-Preview build NEVER shows a blank explanation. */
const GENERIC_ACCEPTANCE_REASON: { en: string; tr: string } = {
  en: 'Quality gate: the build did not pass the automatic design-quality checks, so the safe preview is shown.',
  tr: 'Kalite kapısı: yapı otomatik tasarım kalitesi kontrollerini geçemedi; bu nedenle güvenli önizleme gösteriliyor.',
};

function fallbackReasonSentence(code: FrontendAcceptanceFallbackReasonCode): { en: string; tr: string } {
  switch (code) {
    case 'repair-call-incomplete':
      return {
        en: 'Quality gate: the automatic repair did not complete, so the build was not approved.',
        tr: 'Kalite kapısı: otomatik düzeltme tamamlanmadı; bu nedenle yapı onaylanmadı.',
      };
    case 'repair-failed-validation':
      return {
        en: 'Quality gate: the repaired project failed static validation, so it was not approved.',
        tr: 'Kalite kapısı: düzeltilen proje statik doğrulamayı geçemedi; bu nedenle onaylanmadı.',
      };
    case 'repair-guard-blocked':
      return {
        en: 'Quality gate: the optional quality repair was temporarily at capacity, so the validated build is shown as-is.',
        tr: 'Kalite kapısı: isteğe bağlı kalite düzeltmesi geçici olarak yoğundu; bu nedenle doğrulanmış yapı olduğu gibi gösteriliyor.',
      };
    case 'no-actionable-issue':
      return {
        en: 'Quality gate: the review requested changes but produced no actionable fix, so the build was not approved.',
        tr: 'Kalite kapısı: inceleme değişiklik istedi ancak uygulanabilir bir düzeltme üretmedi; bu nedenle yapı onaylanmadı.',
      };
    case 'initial-review-incomplete':
      return {
        en: 'Quality gate: the automatic design-quality review did not complete, so the build was not approved.',
        tr: 'Kalite kapısı: otomatik tasarım kalitesi incelemesi tamamlanmadı; bu nedenle yapı onaylanmadı.',
      };
    case 'contract-repair-failed':
      return {
        en: 'Quality gate: the generated project failed structural validation and its repair did not pass, so the safe preview is shown.',
        tr: 'Kalite kapısı: oluşturulan proje yapısal doğrulamayı geçemedi ve düzeltmesi de geçmedi; bu nedenle güvenli önizleme gösteriliyor.',
      };
    case 'not-consumable':
      return {
        en: 'Quality gate: the generated project was not usable, so the safe preview is shown.',
        tr: 'Kalite kapısı: oluşturulan proje kullanılabilir değildi; bu nedenle güvenli önizleme gösteriliyor.',
      };
    case 'pipeline-error':
      return {
        en: 'Quality gate: the quality check could not finish, so the safe preview is shown.',
        tr: 'Kalite kapısı: kalite kontrolü tamamlanamadı; bu nedenle güvenli önizleme gösteriliyor.',
      };
  }
}

/** The minimal shape of the acceptance artifact this resolver reads (keeps it dependency-light and
 *  testable without importing the full artifact type). */
export interface AcceptanceReasonSource {
  status: 'approved' | 'repaired-approved' | 'manual-review-required' | 'skipped' | string;
  activeProject?: string;
  acceptanceGate?: FrontendAcceptanceGateDiagnostics;
  fallbackReasonCode?: FrontendAcceptanceFallbackReasonCode;
}

/**
 * The SINGLE entry point the UI uses to get a bounded, safe, user-facing reason for a build that
 * fell to Safe Preview — from ANY path, gate or non-gate. Resolution order:
 *   1. an approved / repaired-approved build → null (nothing to explain);
 *   2. a rejected deterministic gate diagnostic → the precise gate sentence;
 *   3. a pre-gate `fallbackReasonCode` → its safe sentence;
 *   4. any other Safe-Preview build (manual-review-required, or a skipped internal-fallback) →
 *      the generic safe sentence, so a fallen-back build is NEVER shown with a blank reason.
 * Returns null only for approved builds and for non-fallback statuses. Never leaks internal data.
 */
export function buildUserFacingAcceptanceReasonFromArtifact(
  acceptance: AcceptanceReasonSource | undefined,
): { en: string; tr: string } | null {
  if (!acceptance) return null;
  if (acceptance.status === 'approved' || acceptance.status === 'repaired-approved') return null;
  const isFallback =
    acceptance.status === 'manual-review-required' ||
    (acceptance.status === 'skipped' && acceptance.activeProject === 'internal-fallback');
  if (!isFallback) return null;
  // Prefer the precise deterministic-gate reason when the candidate reached the gate.
  const gateReason = buildUserFacingAcceptanceReason(acceptance.acceptanceGate);
  if (gateReason) return gateReason;
  // Otherwise a bounded pre-gate fallback code, else the always-safe generic sentence.
  if (acceptance.fallbackReasonCode) return fallbackReasonSentence(acceptance.fallbackReasonCode);
  return GENERIC_ACCEPTANCE_REASON;
}
