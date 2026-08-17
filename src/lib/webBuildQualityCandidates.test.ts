/**
 * Quality V2 — BEST-CANDIDATE SELECTION.
 *
 * These tests pin the safety rules that let a NON-approved repair be delivered without ever
 * inflating a quality claim. The headline property: a repaired candidate is promoted only when it
 * is provably better and worse on nothing — and NEVER on the model review score alone.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeCandidate, selectBestCandidate, promotesUnapprovedRepair,
  type CandidateBlockingFlags,
} from '@/lib/webBuildQualityCandidates';
import type { FrontendBuilderValidationArtifact, WebBuildCandidateSummary } from '@/lib/webBuildAgents';

const VALID = {
  status: 'valid', readyForConsumption: true, files: [{ path: 'src/App.tsx' }], fileCount: 6, totalCharCount: 9000,
} as unknown as FrontendBuilderValidationArtifact;

const INVALID = {
  status: 'invalid', readyForConsumption: false, files: [], fileCount: 0, totalCharCount: 0,
} as unknown as FrontendBuilderValidationArtifact;

function candidate(
  label: 'initial' | 'repaired',
  over: Partial<{
    blocking: CandidateBlockingFlags; severe: string[]; renderedHigh: number;
    score: number; runtimeFailure: boolean; validation: FrontendBuilderValidationArtifact;
  }> = {},
): WebBuildCandidateSummary {
  return summarizeCandidate({
    label,
    validation: over.validation ?? VALID,
    blocking: over.blocking ?? {},
    severeWarningCodes: over.severe ?? [],
    renderedHighFindingCount: over.renderedHigh ?? 0,
    runtimeFailure: over.runtimeFailure ?? false,
    reviewScore: over.score ?? 70,
  });
}

const BASE = {
  strictGateAccepted: false,
  obligationRegressionRejects: false,
  renderRegressed: false,
  preservationPassed: true,
};

describe('best-candidate selection — promotes a genuinely better repair', () => {
  it('delivers a repair that resolved blocking dimensions and regressed nothing', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { content: true, composition: true, visual: true } }),
      repaired: candidate('repaired', { blocking: { visual: true } }),
    });
    expect(sel.winner).toBe('repaired');
    expect(sel.reason).toBe('repaired-strictly-better');
    expect(sel.improvedDimensions.sort()).toEqual(['composition', 'content']);
    expect(sel.regressedDimensions).toEqual([]);
    expect(promotesUnapprovedRepair(sel)).toBe(true);
  });

  it('delivers a repair that removed severe quality warnings', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { severe: ['shallow-project', 'minimal-styles'] }),
      repaired: candidate('repaired', { severe: [] }),
    });
    expect(sel.winner).toBe('repaired');
    expect(sel.detail).toContain('severe quality warning');
  });

  it('delivers a repair that removed severe RENDERED defects', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { renderedHigh: 3 }),
      repaired: candidate('repaired', { renderedHigh: 1 }),
    });
    expect(sel.winner).toBe('repaired');
    expect(sel.detail).toContain('rendered defect');
  });
});

describe('best-candidate selection — never promotes on a weak signal', () => {
  it('REFUSES to promote on a higher model review score alone', () => {
    // This is the central guard. Identical deterministic evidence, much better model score.
    // "The reviewer liked it more" is not proof of a better website.
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { content: true }, score: 40 }),
      repaired: candidate('repaired', { blocking: { content: true }, score: 95 }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-better');
    expect(promotesUnapprovedRepair(sel)).toBe(false);
  });

  it('keeps the earlier candidate on an exact tie (stability beats churn)', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { visual: true } }),
      repaired: candidate('repaired', { blocking: { visual: true } }),
    });
    expect(sel.winner).toBe('initial');
  });

  it('refuses a repair that fixed one dimension but broke another', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: { experience: true } }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-better');
    expect(sel.regressedDimensions).toEqual(['experience']);
  });

  it('refuses a repair that resolved a dimension but added severe warnings', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { content: true }, severe: [] }),
      repaired: candidate('repaired', { blocking: {}, severe: ['shallow-project'] }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-better');
  });

  it('refuses a repair that resolved a dimension but rendered worse', () => {
    const sel = selectBestCandidate({
      ...BASE,
      renderRegressed: true,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: {} }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-render');
  });

  it('refuses a repair that regressed a fulfilled obligation', () => {
    const sel = selectBestCandidate({
      ...BASE,
      obligationRegressionRejects: true,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: {} }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-obligations');
  });

  it('refuses a repair that scored better by COLLAPSING the project into a skeleton', () => {
    const sel = selectBestCandidate({
      ...BASE,
      preservationPassed: false,
      initial: candidate('initial', { blocking: { content: true, composition: true } }),
      repaired: candidate('repaired', { blocking: {} }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-preserving');
  });

  it('refuses a repaired candidate that is not structurally render-safe', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: {}, validation: INVALID }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-render-safe');
  });

  it('refuses a repair that newly fails at runtime even when the comparison was unavailable', () => {
    const sel = selectBestCandidate({
      ...BASE,
      initial: candidate('initial', { blocking: { content: true }, runtimeFailure: false }),
      repaired: candidate('repaired', { blocking: {}, runtimeFailure: true }),
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-render');
  });
});

describe('best-candidate selection — never overrides or inflates approval', () => {
  it('agrees with the strict gate when it accepted, and claims no credit for it', () => {
    const sel = selectBestCandidate({
      ...BASE,
      strictGateAccepted: true,
      initial: candidate('initial', { blocking: { content: true } }),
      repaired: candidate('repaired', { blocking: {} }),
    });
    expect(sel.winner).toBe('repaired');
    expect(sel.reason).toBe('strict-gate-accepted');
    // Only 'repaired-strictly-better' promotes an UNAPPROVED repair. A gate-accepted repair is
    // consumed through the existing approval path, not through promotion.
    expect(promotesUnapprovedRepair(sel)).toBe(false);
  });

  it('summarizes render-safety from validation, not from the review score', () => {
    expect(candidate('repaired', { validation: VALID }).renderSafe).toBe(true);
    expect(candidate('repaired', { validation: INVALID, score: 100 }).renderSafe).toBe(false);
  });
});
