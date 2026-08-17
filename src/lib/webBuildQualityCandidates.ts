/**
 * Web Build BEST-CANDIDATE SELECTION (Quality V2).
 *
 * THE BOTTLENECK THIS FIXES
 * The existing deterministic acceptance gate is a conjunction of ~15 conditions. A repair is
 * accepted only if it clears EVERY one of them. That is correct for the question "may this be
 * called APPROVED?" — but it was also being used to answer a completely different question:
 * "which of the two candidates should the user actually receive?"
 *
 * The consequence was a real quality loss. A repair that resolved four of five blocking
 * dimensions, regressed nothing, and improved the render was discarded wholesale, and the user
 * was shown the WORSE pre-repair project. The pipeline did the work, paid for the model call,
 * produced a better artifact — and threw it away.
 *
 * This module separates the two questions:
 *   • APPROVAL stays exactly where it was — the unchanged strict acceptance gate. Nothing here
 *     can make a build "approved"; a promoted candidate is still surfaced as PROVISIONAL.
 *   • DELIVERY becomes a deterministic comparison: when the strict gate rejects, the pipeline
 *     still delivers whichever candidate is PROVABLY better, and otherwise keeps the earlier one.
 *
 * SAFETY RULES ENCODED HERE (all enforced by tests):
 *   1. The repaired candidate must be structurally render-safe (valid + ready + files present).
 *   2. It must have PRESERVED the earlier project (no destructive collapse into a skeleton).
 *   3. It must not have regressed a fulfilled obligation.
 *   4. It must not have regressed the RENDERED page.
 *   5. It must not be worse on ANY deterministic dimension.
 *   6. It must be strictly better on at least one DETERMINISTIC dimension. The model review score
 *      is a TIEBREAK ONLY and is never sufficient on its own — "the reviewer liked it more" must
 *      not be able to promote a project that is deterministically no better.
 *   7. On a tie, the EARLIER candidate wins. Stability beats churn.
 *
 * Pure, deterministic, network-free, no model call, never mutates its inputs, never throws.
 */
import type {
  FrontendBuilderValidationArtifact,
  WebBuildCandidateSummary, WebBuildCandidateSelection, WebBuildCandidateSelectionReason,
} from '@/lib/webBuildAgents';

/** The deterministic blocking dimensions compared between candidates. These are exactly the
 *  analyzer gates the acceptance gate already evaluates — no new authority is introduced. */
export const CANDIDATE_DIMENSIONS = [
  'binding', 'research', 'composition', 'visualSystem', 'content',
  'siteDepth', 'experience', 'visual', 'experienceIdentity', 'motion',
] as const;
export type CandidateDimension = (typeof CANDIDATE_DIMENSIONS)[number];

/** The per-dimension blocking flags, in the SAME shape the pipeline already computes. */
export type CandidateBlockingFlags = Partial<Record<CandidateDimension, boolean>>;

export interface SummarizeCandidateInput {
  label: WebBuildCandidateSummary['label'];
  validation?: FrontendBuilderValidationArtifact;
  blocking: CandidateBlockingFlags;
  severeWarningCodes?: string[];
  /** HIGH-severity findings from the rendered evaluation of THIS candidate (0 when unmeasured). */
  renderedHighFindingCount?: number;
  /** True when the rendered evaluation of THIS candidate observed a runtime failure/blank page. */
  runtimeFailure?: boolean;
  /** The model review score for this candidate (tiebreak only). */
  reviewScore?: number;
}

/** Build the deterministic quality summary of one candidate. Pure; never throws. */
export function summarizeCandidate(input: SummarizeCandidateInput): WebBuildCandidateSummary {
  const v = input.validation;
  const blockingDimensions = CANDIDATE_DIMENSIONS.filter((d) => input.blocking[d] === true);
  const severe = Array.isArray(input.severeWarningCodes) ? input.severeWarningCodes.slice(0, 8) : [];
  return {
    label: input.label,
    renderSafe: v?.status === 'valid' && v?.readyForConsumption === true && (v?.files?.length ?? 0) > 0,
    runtimeFailure: input.runtimeFailure === true,
    blockingDimensions: [...blockingDimensions],
    blockingCount: blockingDimensions.length,
    severeWarningCodes: severe,
    severeWarningCount: severe.length,
    renderedHighFindingCount: Math.max(0, input.renderedHighFindingCount ?? 0),
    reviewScore: Math.max(0, input.reviewScore ?? 0),
    fileCount: v?.fileCount ?? 0,
    charCount: v?.totalCharCount ?? 0,
  };
}

export interface SelectBestCandidateInput {
  initial: WebBuildCandidateSummary;
  repaired: WebBuildCandidateSummary;
  /** The unchanged strict acceptance gate already accepted the repair. */
  strictGateAccepted: boolean;
  /** The repair regressed a previously-fulfilled required obligation. */
  obligationRegressionRejects: boolean;
  /** The rendered comparison PROVED the repair broke the rendered page. */
  renderRegressed: boolean;
  /** The repaired project preserved the earlier project (no destructive collapse). Defaults to
   *  true only when a preservation verdict genuinely could not be computed. */
  preservationPassed: boolean;
}

/**
 * Choose the candidate the user should actually receive.
 *
 * When the strict gate already accepted, this simply agrees with it (`strict-gate-accepted`) —
 * this module never overrides an approval. Otherwise it applies the safety rules above and
 * returns `repaired` only when that candidate is provably better and worse on nothing.
 */
export function selectBestCandidate(input: SelectBestCandidateInput): WebBuildCandidateSelection {
  const { initial, repaired } = input;

  const improvedDimensions = initial.blockingDimensions.filter((d) => !repaired.blockingDimensions.includes(d));
  const regressedDimensions = repaired.blockingDimensions.filter((d) => !initial.blockingDimensions.includes(d));

  const base = {
    version: 'web-build-candidate-selection-v1' as const,
    improvedDimensions: improvedDimensions.slice(0, 10),
    regressedDimensions: regressedDimensions.slice(0, 10),
    initial,
    repaired,
  };
  const pick = (
    winner: WebBuildCandidateSelection['winner'],
    reason: WebBuildCandidateSelectionReason,
    detail: string,
  ): WebBuildCandidateSelection => ({ ...base, winner, reason, detail: detail.slice(0, 240) });

  // The strict gate is the only path to APPROVAL; this module agrees and adds nothing.
  if (input.strictGateAccepted) {
    return pick('repaired', 'strict-gate-accepted', 'The unchanged strict acceptance gate approved the repaired candidate.');
  }

  // ── Rule 1 — a candidate that is not structurally render-safe can never be delivered. ──
  if (!repaired.renderSafe) {
    return pick('initial', 'repaired-not-render-safe', 'The repaired candidate is not structurally render-safe; the earlier validated project is kept.');
  }
  // ── Rule 2 — a repair that collapsed the project is never an improvement, however it scores. ──
  if (!input.preservationPassed) {
    return pick('initial', 'repaired-not-preserving', 'The repaired candidate did not preserve the earlier project (destructive collapse); the earlier project is kept.');
  }
  // ── Rule 3 — a regressed obligation is a hard reject, matching the acceptance gate. ──
  if (input.obligationRegressionRejects) {
    return pick('initial', 'repaired-regressed-obligations', 'The repair regressed a previously-fulfilled required obligation; the earlier project is kept.');
  }
  // ── Rule 4 — a proven rendered regression is a hard reject. ──
  if (input.renderRegressed) {
    return pick('initial', 'repaired-regressed-render', 'The repaired candidate rendered worse than the earlier project; the earlier project is kept.');
  }
  // A repaired candidate that fails at runtime while the earlier one did not is a rendered
  // regression even when the before/after comparison itself could not be completed.
  if (repaired.runtimeFailure && !initial.runtimeFailure) {
    return pick('initial', 'repaired-regressed-render', 'The repaired candidate reported a runtime failure the earlier project did not; the earlier project is kept.');
  }

  // ── Rule 5 — worse on ANY deterministic dimension disqualifies promotion. ──
  const worseSomewhere =
    regressedDimensions.length > 0 ||
    repaired.blockingCount > initial.blockingCount ||
    repaired.severeWarningCount > initial.severeWarningCount ||
    repaired.renderedHighFindingCount > initial.renderedHighFindingCount;
  if (worseSomewhere) {
    return pick('initial', 'repaired-not-better', 'The repaired candidate is worse on at least one deterministic quality dimension; the earlier project is kept.');
  }

  // ── Rule 6 — strictly better on at least one DETERMINISTIC dimension. The review score is
  //    deliberately excluded here: a higher model score with identical deterministic evidence is
  //    not proof of a better website, and must not be able to promote a candidate on its own. ──
  const betterDimensions = improvedDimensions.length > 0;
  const betterSevere = repaired.severeWarningCount < initial.severeWarningCount;
  const betterRendered = repaired.renderedHighFindingCount < initial.renderedHighFindingCount;
  if (!betterDimensions && !betterSevere && !betterRendered) {
    // ── Rule 7 — a tie keeps the earlier candidate. Stability beats churn. ──
    return pick('initial', 'repaired-not-better', 'The repaired candidate is not deterministically better than the earlier project; the earlier project is kept.');
  }

  const wins: string[] = [];
  if (betterDimensions) wins.push(`resolved ${improvedDimensions.length} blocking dimension(s) (${improvedDimensions.slice(0, 3).join(', ')})`);
  if (betterSevere) wins.push(`removed ${initial.severeWarningCount - repaired.severeWarningCount} severe quality warning(s)`);
  if (betterRendered) wins.push(`removed ${initial.renderedHighFindingCount - repaired.renderedHighFindingCount} severe rendered defect(s)`);
  return pick(
    'repaired',
    'repaired-strictly-better',
    `The repaired candidate is strictly better and worse on nothing: ${wins.join('; ')}.`,
  );
}

/** True when the selection promotes a repaired candidate that the strict gate did NOT approve.
 *  This is the ONLY signal the pipeline uses to consume a non-approved repaired project, and it
 *  never changes the acceptance STATUS — the build stays provisional, not approved. */
export function promotesUnapprovedRepair(sel: WebBuildCandidateSelection | undefined): boolean {
  return !!sel && sel.winner === 'repaired' && sel.reason === 'repaired-strictly-better';
}
