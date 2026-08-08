import { describe, it, expect } from 'vitest';
import {
  isDeltaRepairEligible,
  reconstructRepairRawFromDelta,
  type WebBuildQualityRepairMode,
} from '@/lib/webBuildDeltaRepair';
import type { FrontendBuilderRawArtifact, FrontendGeneratedFile } from '@/lib/webBuildAgents';
import {
  isCompactContextEligible,
  type WebBuildQualityContextMode,
} from '@/lib/webBuildQualityContext';

/**
 * Web Build owner-vs-normal-user PARITY regression suite.
 *
 * Context: a normal (non-owner) entitled build user was left on the worse full-project re-emit
 * repair while the owner got the bounded delta repair + compact context — so the owner's failed
 * candidate could recover to an approved build while the normal user's identical candidate
 * regressed into the Safe-Preview fallback. The fix is the `all_delta` / `all_compact` values,
 * which grant the SAME bounded quality-recovery to EVERY entitled build user (entitlement/quota
 * are enforced upstream by the server-side ai_guard preflight; these levers only change WHO gets
 * the bounded repair shape, never the acceptance thresholds and never the provider-call count).
 *
 * These tests pin the pure eligibility predicates so owner and normal users can never diverge
 * under the parity modes, while the legacy owner-only mode stays owner-only.
 */

const OWNER = true;
const NORMAL = false;

describe('isDeltaRepairEligible — owner vs normal parity', () => {
  it('disabled: neither owner nor normal user gets the delta repair', () => {
    expect(isDeltaRepairEligible('disabled', OWNER)).toBe(false);
    expect(isDeltaRepairEligible('disabled', NORMAL)).toBe(false);
  });

  it('owner_delta (legacy): owner-only — the exact divergence the bug report described', () => {
    expect(isDeltaRepairEligible('owner_delta', OWNER)).toBe(true);
    expect(isDeltaRepairEligible('owner_delta', NORMAL)).toBe(false);
  });

  it('all_delta (parity fix): owner and normal user get IDENTICAL eligibility', () => {
    const owner = isDeltaRepairEligible('all_delta', OWNER);
    const normal = isDeltaRepairEligible('all_delta', NORMAL);
    expect(owner).toBe(true);
    expect(normal).toBe(true);
    // The parity guarantee: same candidate → same repair eligibility regardless of owner flag.
    expect(owner).toBe(normal);
  });

  it('unknown owner flag values are coerced to a strict boolean (no truthy leak)', () => {
    // ownerEligible is typed boolean; under owner_delta only an exact `true` grants delta.
    expect(isDeltaRepairEligible('owner_delta', undefined as unknown as boolean)).toBe(false);
    expect(isDeltaRepairEligible('owner_delta', 1 as unknown as boolean)).toBe(false);
    // all_delta ignores the owner flag entirely — every entitled user is eligible.
    expect(isDeltaRepairEligible('all_delta', undefined as unknown as boolean)).toBe(true);
    expect(isDeltaRepairEligible('all_delta', 0 as unknown as boolean)).toBe(true);
  });
});

describe('isCompactContextEligible — owner vs normal parity, gated by the delta path', () => {
  it('never eligible when the delta path itself is not eligible (compact ⊂ delta)', () => {
    for (const mode of ['disabled', 'owner_compact', 'all_compact'] as WebBuildQualityContextMode[]) {
      expect(isCompactContextEligible(false, mode, OWNER)).toBe(false);
      expect(isCompactContextEligible(false, mode, NORMAL)).toBe(false);
    }
  });

  it('disabled context: neither user gets compact context even inside the delta path', () => {
    expect(isCompactContextEligible(true, 'disabled', OWNER)).toBe(false);
    expect(isCompactContextEligible(true, 'disabled', NORMAL)).toBe(false);
  });

  it('owner_compact (legacy): owner-only, and only inside the delta path', () => {
    expect(isCompactContextEligible(true, 'owner_compact', OWNER)).toBe(true);
    expect(isCompactContextEligible(true, 'owner_compact', NORMAL)).toBe(false);
  });

  it('all_compact (parity fix): owner and normal user get IDENTICAL eligibility', () => {
    const owner = isCompactContextEligible(true, 'all_compact', OWNER);
    const normal = isCompactContextEligible(true, 'all_compact', NORMAL);
    expect(owner).toBe(true);
    expect(normal).toBe(true);
    expect(owner).toBe(normal);
  });
});

describe('end-to-end parity: composed delta+compact eligibility matches for owner and normal', () => {
  // The pipeline composes deltaEligible then compactContextEligible(deltaEligible, …). Under the
  // parity modes the composed result must be identical for owner and normal users across every
  // combination — this is the property that guarantees no owner-only quality advantage remains.
  const repairModes: WebBuildQualityRepairMode[] = ['disabled', 'owner_delta', 'all_delta'];
  const contextModes: WebBuildQualityContextMode[] = ['disabled', 'owner_compact', 'all_compact'];

  function compose(repair: WebBuildQualityRepairMode, ctx: WebBuildQualityContextMode, owner: boolean) {
    const delta = isDeltaRepairEligible(repair, owner);
    const compact = isCompactContextEligible(delta, ctx, owner);
    return { delta, compact };
  }

  it('parity modes (all_delta + all_compact) give owner === normal for the composed result', () => {
    const owner = compose('all_delta', 'all_compact', OWNER);
    const normal = compose('all_delta', 'all_compact', NORMAL);
    expect(owner).toEqual(normal);
    expect(owner).toEqual({ delta: true, compact: true });
  });

  it('legacy owner-only modes still diverge (proves the modes are distinct, not silently merged)', () => {
    const owner = compose('owner_delta', 'owner_compact', OWNER);
    const normal = compose('owner_delta', 'owner_compact', NORMAL);
    expect(owner).toEqual({ delta: true, compact: true });
    expect(normal).toEqual({ delta: false, compact: false });
  });

  it('every combination is deterministic and owner-flag-independent under all_* modes', () => {
    // Under all_delta, delta eligibility is always owner-independent. Compact parity holds for the
    // parity/disabled context modes; owner_compact legitimately stays owner-only (that is the
    // point of keeping the legacy mode distinct), so it is excluded from the compact-parity sweep.
    for (const ctx of ['disabled', 'all_compact'] as WebBuildQualityContextMode[]) {
      const owner = compose('all_delta', ctx, OWNER);
      const normal = compose('all_delta', ctx, NORMAL);
      expect(owner).toEqual(normal);
    }
    // Delta parity holds for EVERY context mode (delta eligibility ignores the context mode).
    for (const ctx of contextModes) {
      expect(compose('all_delta', ctx, OWNER).delta).toBe(compose('all_delta', ctx, NORMAL).delta);
    }
    // And when repair is disabled, NOBODY (owner or normal) gets delta or compact — the
    // fail-closed default is preserved and identical for both.
    for (const ctx of contextModes) {
      expect(compose('disabled', ctx, OWNER)).toEqual({ delta: false, compact: false });
      expect(compose('disabled', ctx, NORMAL)).toEqual({ delta: false, compact: false });
    }
    // repairModes referenced to document the full matrix under test.
    expect(repairModes).toHaveLength(3);
  });
});

describe('delta reconstruction validator — bad candidates stay rejected, owner-agnostic', () => {
  // The delta reconstruction/validator (reconstructRepairRawFromDelta) is what a delta-eligible
  // build runs. It takes NO owner parameter, so its accept/reject decision is structurally
  // identical for owner and normal users under all_delta — the parity fix cannot make it approve a
  // candidate it would otherwise reject. These tests pin that an unsafe/malformed delta is rejected
  // (fails OPEN to the original project, never a second repair call).
  const originalFiles: FrontendGeneratedFile[] = [
    {
      path: 'src/App.tsx',
      language: 'tsx',
      content: 'export default function App(){return <div>Hello</div>;}',
      charCount: 54,
      lineCount: 1,
    } as FrontendGeneratedFile,
  ];

  function raw(over: Partial<FrontendBuilderRawArtifact>): FrontendBuilderRawArtifact {
    return {
      version: 'frontend-builder-raw-v1',
      status: 'completed',
      requestedFormat: 'frontend-files-v1',
      mode: 'frontend_builder',
      rawResponse: '',
      responseCharCount: 0,
      truncatedForStorage: false,
      validationStatus: 'not-run',
      reason: '',
      warnings: [],
      responseShape: 'frontend-envelope',
      ...over,
    } as FrontendBuilderRawArtifact;
  }

  it('a malformed delta body is rejected (accepted=false) and does not re-emit a call', () => {
    const out = reconstructRepairRawFromDelta({
      deltaRaw: raw({ status: 'completed', rawResponse: 'not a valid delta envelope at all' }),
      originalFiles,
    });
    expect(out.diagnostics.accepted).toBe(false);
    expect(out.diagnostics.rejectionReason).toBeTruthy();
    // Fails OPEN: a rejected delta yields a terminal non-'completed' artifact, which the pipeline
    // routes back to the ORIGINAL validated project via the same `status !== 'completed'` branch —
    // never a second repair call. `failed` is exactly that fail-open signal.
    expect(out.repairRaw.status).not.toBe('completed');
  });

  it('a delta call that did not complete is passed through unchanged (no extra provider call)', () => {
    const failed = raw({ status: 'failed', rawResponse: undefined as unknown as string, reason: 'transport error' });
    const out = reconstructRepairRawFromDelta({ deltaRaw: failed, originalFiles });
    expect(out.diagnostics.accepted).toBe(false);
    // The exact same failed artifact flows through — no retry, no second call is synthesized.
    expect(out.repairRaw).toBe(failed);
  });
});
