import { describe, it, expect } from 'vitest';
import { resolveAppQualityRepairRouting, isDeltaRepairEligible } from '@/lib/webBuildDeltaRepair';

/**
 * Cost Phase 3 — an app quality repair defaults to targeted DELTA + COMPACT context; a FULL re-emit
 * is a bounded pre-call fallback only for a wholesale problem. Web repair mode is unaffected.
 */
describe('app quality-repair routing', () => {
  it('A/B/C. a localized issue (one/few files) → delta + compact, no full fallback', () => {
    for (const issueFileCount of [1, 2, 3]) {
      const r = resolveAppQualityRepairRouting({ fileCount: 8, issueFileCount, blockingCount: 2 });
      expect(r.deltaEligible).toBe(true);
      expect(r.compactEligible).toBe(true);
      expect(r.fullFallbackReason).toBeUndefined();
    }
  });

  it('a build with many issues but NOT project-wide still stays delta (delta can upsert many files)', () => {
    const r = resolveAppQualityRepairRouting({ fileCount: 10, issueFileCount: 5, blockingCount: 4 }); // 50% span
    expect(r.deltaEligible).toBe(true);
    expect(r.fullFallbackReason).toBeUndefined();
  });

  it('F. genuinely widespread issues (>=5 files, >=80% span, >=3 blockers) → justified FULL fallback', () => {
    const r = resolveAppQualityRepairRouting({ fileCount: 6, issueFileCount: 6, blockingCount: 4 });
    expect(r.deltaEligible).toBe(false);
    expect(r.compactEligible).toBe(false);
    expect(r.fullFallbackReason).toMatch(/widespread issues .*full re-emit/);
  });

  it('the full fallback requires ALL three signals (span alone, or blockers alone, is not enough)', () => {
    // High span but few blockers → still delta.
    expect(resolveAppQualityRepairRouting({ fileCount: 6, issueFileCount: 6, blockingCount: 1 }).deltaEligible).toBe(true);
    // Many blockers but low span → still delta.
    expect(resolveAppQualityRepairRouting({ fileCount: 10, issueFileCount: 2, blockingCount: 5 }).deltaEligible).toBe(true);
    // Small project (<5 files) never forces full.
    expect(resolveAppQualityRepairRouting({ fileCount: 3, issueFileCount: 3, blockingCount: 3 }).deltaEligible).toBe(true);
  });

  it('is deterministic and safe on degenerate input', () => {
    const a = resolveAppQualityRepairRouting({ fileCount: 0, issueFileCount: 0, blockingCount: 0 });
    const b = resolveAppQualityRepairRouting({ fileCount: 0, issueFileCount: 0, blockingCount: 0 });
    expect(a).toEqual(b);
    expect(a.deltaEligible).toBe(true); // no evidence of a wholesale problem
  });

  it('I. web repair mode logic is untouched (env-driven eligibility only)', () => {
    expect(isDeltaRepairEligible('disabled', false)).toBe(false);
    expect(isDeltaRepairEligible('disabled', true)).toBe(false);
    expect(isDeltaRepairEligible('owner_delta', false)).toBe(false);
    expect(isDeltaRepairEligible('owner_delta', true)).toBe(true);
    expect(isDeltaRepairEligible('all_delta', false)).toBe(true);
  });
});
