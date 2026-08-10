import { describe, it, expect } from 'vitest';
import {
  betaBlockMessageKey, betaBlockKind, betaBlockRetryable, isBetaBlockCode,
} from '@/lib/aiGuard';

/**
 * Guard-code classification contract. Pins the exact backend codes that surface the visible
 * "temporarily at capacity" message (wbBetaCapacity) and the bounded kind/retryable diagnostics
 * used to explain a guard-blocked quality repair. Pure functions — no IO, no enforcement.
 */
describe('aiGuard — capacity message + bounded diagnostics', () => {
  it('ONLY global_spend_limit_reached and credit_unavailable map to the capacity message', () => {
    expect(betaBlockMessageKey('global_spend_limit_reached')).toBe('wbBetaCapacity');
    expect(betaBlockMessageKey('credit_unavailable')).toBe('wbBetaCapacity');
    // Everything else maps elsewhere — the capacity message is NOT a catch-all.
    expect(betaBlockMessageKey('operation_in_progress')).toBe('wbBetaInProgress');
    expect(betaBlockMessageKey('rate_limited')).toBe('wbBetaRateLimited');
    expect(betaBlockMessageKey('ai_temporarily_disabled')).toBe('wbBetaAiDisabled');
    expect(betaBlockMessageKey('daily_limit_reached', 'web_build_full')).toBe('wbBetaDailyLimitFull');
  });

  it('classifies codes into coarse kinds for triage', () => {
    expect(betaBlockKind('global_spend_limit_reached')).toBe('capacity');
    expect(betaBlockKind('credit_unavailable')).toBe('capacity');
    expect(betaBlockKind('daily_limit_reached')).toBe('quota');
    expect(betaBlockKind('rate_limited')).toBe('rate-limit');
    expect(betaBlockKind('operation_in_progress')).toBe('in-progress');
    expect(betaBlockKind('operation_disabled')).toBe('disabled');
    expect(betaBlockKind('idempotency_conflict')).toBe('conflict');
    expect(betaBlockKind('something_else')).toBe('other');
  });

  it('marks transient blocks retryable and quota/disabled/conflict not-retryable', () => {
    // Transient — a later retry can clear these (capacity resets / burst clears / prior op finishes).
    for (const c of ['global_spend_limit_reached', 'credit_unavailable', 'rate_limited', 'operation_in_progress', 'ai_temporarily_disabled']) {
      expect(betaBlockRetryable(c)).toBe(true);
    }
    // Not cleared by a plain retry — needs a reset / config / new key.
    for (const c of ['daily_limit_reached', 'operation_disabled', 'idempotency_conflict']) {
      expect(betaBlockRetryable(c)).toBe(false);
    }
  });

  it('recognizes only the known stable block codes', () => {
    expect(isBetaBlockCode('global_spend_limit_reached')).toBe(true);
    expect(isBetaBlockCode('nope')).toBe(false);
    expect(isBetaBlockCode(undefined)).toBe(false);
  });
});
