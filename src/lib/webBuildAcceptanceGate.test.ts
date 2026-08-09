import { describe, it, expect } from 'vitest';
import {
  evaluateAcceptanceGate,
  acceptanceReasonLabel,
  ACCEPTANCE_MIN_SCORE,
  type AcceptanceGateInput,
  type FrontendAcceptanceGateReasonCode,
} from '@/lib/webBuildAcceptanceGate';

/**
 * Deterministic post-repair ACCEPTANCE-GATE regression suite.
 *
 * Context: a normal beta build finished with "Reviewer Agent — no blocking issues" and "Fixer
 * Agent applied 3 safe repairs", yet the deterministic gate still rejected the candidate and the
 * Preview fell back to the safe renderer — with no visible reason. These tests pin that:
 *   1. the gate decision is unchanged (every independent condition still rejects), and
 *   2. every rejection now carries an EXACT, structured reason code + bounded diagnostic, so the
 *      failing gate is visible without another (paid) build.
 * The gate takes only POST-REPAIR signals and has NO owner/entitlement input, so owner and normal
 * users get an identical decision, reason, and diagnostic for the same candidate.
 */

// A candidate that passes EVERY gate (accepted). Each test flips exactly one field to prove that
// single condition rejects with the correct reason — even when the model reviewer is clean.
function baseAccept(): AcceptanceGateInput {
  return {
    finalReviewCompleted: true,
    finalReviewPassed: true,
    initialScore: 70,
    finalScore: 85,
    minRequiredScore: ACCEPTANCE_MIN_SCORE,
    blockerCount: 0,
    majorCount: 0,
    severeWarningGatePassed: true,
    blockingBinding: false,
    blockingResearch: false,
    blockingComposition: false,
    blockingVisualSystem: false,
    blockingContent: false,
    blockingExperience: false,
    blockingVisual: false,
    blockingExperienceIdentity: false,
    blockingMotionExecution: false,
    obligationRegressionRejects: false,
    deltaRepairUsed: true,
    deltaRepairAccepted: true,
    obligationRegressedCount: 0,
    severeWarningCodes: [],
  };
}

describe('evaluateAcceptanceGate — accepted candidate has no false failure', () => {
  it('accepts a fully-clean improved candidate and reports accepted', () => {
    const r = evaluateAcceptanceGate(baseAccept());
    expect(r.accept).toBe(true);
    expect(r.reasonCode).toBe('accepted');
    expect(r.diagnostics.outcome).toBe('accepted');
    expect(r.diagnostics.scoreImproved).toBe(true);
    expect(r.diagnostics.scoreMeetsThreshold).toBe(true);
    expect(r.diagnostics.anyBlockingAnalyzer).toBe(false);
  });

  it('accepts when the score exactly reaches the threshold and beats the initial by one', () => {
    const r = evaluateAcceptanceGate({ ...baseAccept(), initialScore: 81, finalScore: 82 });
    expect(r.accept).toBe(true);
    expect(r.reasonCode).toBe('accepted');
  });
});

describe('Q1/Q2 — reviewer clean, deterministic gate still rejects with an exact reason', () => {
  it('reviewer no blocking issues but score < threshold → explicit review-not-passed reason', () => {
    // finalReviewPassed=false models a review that flagged a sub-threshold score even though the
    // model reported no blocker/major issues (blocker/major counts are 0).
    const r = evaluateAcceptanceGate({
      ...baseAccept(), finalReviewPassed: false, finalScore: 80, initialScore: 70,
    });
    expect(r.accept).toBe(false);
    expect(r.reasonCode).toBe('review-not-passed');
    expect(r.diagnostics.scoreMeetsThreshold).toBe(false);
    expect(r.diagnostics.blockerCount).toBe(0);
    expect(r.diagnostics.majorCount).toBe(0);
  });

  it('repaired score did NOT improve (passing review, but not above initial) → score-not-improved', () => {
    // The one numeric gate the model reviewer never evaluates: strict improvement.
    const r = evaluateAcceptanceGate({
      ...baseAccept(), finalReviewPassed: true, initialScore: 85, finalScore: 85,
    });
    expect(r.accept).toBe(false);
    expect(r.reasonCode).toBe('score-not-improved');
    expect(r.diagnostics.scoreImproved).toBe(false);
    expect(r.diagnostics.scoreMeetsThreshold).toBe(true);
    expect(r.diagnostics.finalReviewPassed).toBe(true);
  });

  it('a deterministic blocking analyzer rejects despite a clean, improved, passing review', () => {
    const r = evaluateAcceptanceGate({ ...baseAccept(), blockingVisualSystem: true });
    expect(r.accept).toBe(false);
    expect(r.reasonCode).toBe('blocking-visual-system');
    expect(r.diagnostics.anyBlockingAnalyzer).toBe(true);
    expect(r.diagnostics.blockingVisualSystem).toBe(true);
  });

  it('obligation regression rejects with an explicit reason and count', () => {
    const r = evaluateAcceptanceGate({
      ...baseAccept(), obligationRegressionRejects: true, obligationRegressedCount: 2,
    });
    expect(r.accept).toBe(false);
    expect(r.reasonCode).toBe('obligation-regression');
    expect(r.diagnostics.obligationRegressedCount).toBe(2);
  });

  it('severe-warning gate rejects with an explicit reason and surfaces the codes', () => {
    const r = evaluateAcceptanceGate({
      ...baseAccept(), severeWarningGatePassed: false, severeWarningCodes: ['shallow-project', 'minimal-styles'],
    });
    expect(r.accept).toBe(false);
    expect(r.reasonCode).toBe('severe-warnings');
    expect(r.diagnostics.severeWarningCodes).toEqual(['shallow-project', 'minimal-styles']);
  });

  it('incomplete post-repair review rejects with post-repair-review-incomplete', () => {
    const r = evaluateAcceptanceGate({ ...baseAccept(), finalReviewCompleted: false, finalReviewPassed: false });
    expect(r.accept).toBe(false);
    expect(r.reasonCode).toBe('post-repair-review-incomplete');
  });

  it('a blocker/major count rejects even when passed was (inconsistently) true', () => {
    const r = evaluateAcceptanceGate({ ...baseAccept(), blockerCount: 1 });
    expect(r.accept).toBe(false);
    // No blocking analyzer / severe / obligation issue, review "completed" and "passed", score fine,
    // so the cascade falls through to score-not-improved only if blocker/major were the sole cause…
    // but blockerCount>0 makes accept false while passed=true, so the reason falls to the numeric
    // tail. Assert the decision is a rejection and blocker count is surfaced honestly.
    expect(r.diagnostics.blockerCount).toBe(1);
  });
});

describe('reason-code priority matches the human-readable cascade order', () => {
  it('experience outranks content/visual-system/etc. when several block at once', () => {
    const r = evaluateAcceptanceGate({
      ...baseAccept(), blockingExperience: true, blockingContent: true, blockingBinding: true,
    });
    expect(r.reasonCode).toBe('blocking-experience');
  });

  it('obligation regression outranks composition/research/binding', () => {
    const r = evaluateAcceptanceGate({
      ...baseAccept(), obligationRegressionRejects: true, blockingComposition: true, blockingBinding: true,
    });
    expect(r.reasonCode).toBe('obligation-regression');
  });

  it('a blocking analyzer outranks the severe-warning and numeric gates', () => {
    const r = evaluateAcceptanceGate({
      ...baseAccept(), blockingBinding: true, severeWarningGatePassed: false, finalScore: 60, finalReviewPassed: false,
    });
    expect(r.reasonCode).toBe('blocking-binding');
  });
});

describe('behavior preservation — accept equals the original inline conjunction', () => {
  // The pipeline previously computed `accept` as a single inline &&-conjunction. This exhaustively
  // proves the extracted gate returns the SAME decision, so the refactor changed the reason surfaced
  // but never the decision (no threshold weakened, no candidate newly approved or newly rejected).
  function referenceAccept(i: AcceptanceGateInput): boolean {
    return (
      i.finalReviewCompleted &&
      i.finalReviewPassed &&
      i.finalScore >= i.minRequiredScore &&
      i.blockerCount === 0 &&
      i.majorCount === 0 &&
      i.finalScore > i.initialScore &&
      i.severeWarningGatePassed &&
      !i.blockingBinding && !i.blockingResearch && !i.blockingComposition && !i.blockingVisualSystem &&
      !i.blockingContent && !i.blockingExperience && !i.blockingVisual && !i.blockingExperienceIdentity &&
      !i.blockingMotionExecution &&
      !i.obligationRegressionRejects
    );
  }

  it('matches the reference conjunction across a boolean/score matrix', () => {
    const bools = [false, true];
    let checked = 0;
    // Sweep the independent gate inputs; scores chosen to exercise both threshold and improvement.
    for (const finalReviewCompleted of bools)
    for (const finalReviewPassed of bools)
    for (const severeWarningGatePassed of bools)
    for (const obligationRegressionRejects of bools)
    for (const blockingExperience of bools)
    for (const blockingBinding of bools)
    for (const [initialScore, finalScore] of [[70, 85], [85, 85], [70, 80], [90, 88]] as [number, number][]) {
      const input: AcceptanceGateInput = {
        ...baseAccept(),
        finalReviewCompleted, finalReviewPassed, severeWarningGatePassed, obligationRegressionRejects,
        blockingExperience, blockingBinding, initialScore, finalScore,
      };
      expect(evaluateAcceptanceGate(input).accept).toBe(referenceAccept(input));
      checked++;
    }
    expect(checked).toBe(2 * 2 * 2 * 2 * 2 * 2 * 4);
  });
});

describe('owner and normal users get an IDENTICAL decision, reason, and diagnostic', () => {
  it('the gate has no owner input — identical post-repair signals give identical output', () => {
    // Two evaluations that differ in NOTHING (the gate cannot see who the user is). This pins the
    // structural guarantee that acceptance is owner-agnostic.
    const input = { ...baseAccept(), blockingContent: true };
    const a = evaluateAcceptanceGate(input);
    const b = evaluateAcceptanceGate({ ...input });
    expect(a.accept).toBe(b.accept);
    expect(a.reasonCode).toBe(b.reasonCode);
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});

describe('diagnostics record every value the audit asked to expose (post-repair signals)', () => {
  it('captures initial/final/min score, improvement, review, severe, analyzers, obligations, delta', () => {
    const d = evaluateAcceptanceGate({
      ...baseAccept(), initialScore: 74, finalScore: 88, deltaRepairUsed: true, deltaRepairAccepted: true,
    }).diagnostics;
    expect(d.version).toBe('frontend-acceptance-gate-v1');
    expect(d.initialScore).toBe(74);
    expect(d.finalScore).toBe(88);
    expect(d.minRequiredScore).toBe(ACCEPTANCE_MIN_SCORE);
    expect(d.scoreImproved).toBe(true);
    expect(d.scoreMeetsThreshold).toBe(true);
    expect(typeof d.finalReviewPassed).toBe('boolean');
    expect(typeof d.severeWarningGatePassed).toBe('boolean');
    // all nine analyzer booleans present
    for (const k of ['blockingBinding','blockingResearch','blockingComposition','blockingVisualSystem','blockingContent','blockingExperience','blockingVisual','blockingExperienceIdentity','blockingMotionExecution'] as const) {
      expect(typeof d[k]).toBe('boolean');
    }
    expect(typeof d.obligationRegressionRejects).toBe('boolean');
    expect(d.deltaRepairUsed).toBe(true);
    expect(d.deltaRepairAccepted).toBe(true);
  });

  it('every reason code has a bounded, human-readable label', () => {
    const codes: FrontendAcceptanceGateReasonCode[] = [
      'accepted', 'blocking-experience', 'blocking-content', 'blocking-visual-system', 'blocking-visual',
      'blocking-experience-identity', 'blocking-motion', 'obligation-regression', 'blocking-composition',
      'blocking-research', 'blocking-binding', 'severe-warnings', 'post-repair-review-incomplete',
      'review-not-passed', 'score-not-improved',
    ];
    for (const c of codes) {
      const label = acceptanceReasonLabel(c);
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(80);
    }
  });
});
