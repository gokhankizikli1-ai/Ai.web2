import { describe, it, expect } from 'vitest';
import {
  deriveModelNativeCandidate,
  resolvePreviewMode,
  candidateHasEntryFiles,
  isModelNativeRuntimeFailure,
  type WebBuildPreviewMode,
  type ModelNativeRuntimePhase,
} from '@/lib/webBuildRuntimePreview';
import type { WebBuildFile, WebBuildStep } from '@/lib/webBuildPayload';

/**
 * Preview-AUTHORITY regression (Phase 13A → provisional split).
 *
 * The bug this guards: a structurally valid, consumed, runnable model-native project was
 * forced to the deterministic Safe fallback for a normal user SOLELY because
 * frontendBuilderAcceptance was 'manual-review-required'. The fix decouples "safe/valid
 * enough to render" (`safeToRenderModelNativePreview`) from "approved as finished"
 * (`approvedForUserPreview`) and adds a 'provisional-model-native' mode — WITHOUT
 * auto-approving anything, and WITHOUT weakening any structural/runtime safety gate.
 *
 * These tests are pure: no model call, no live build, no Sandpack render, no network.
 */

/** Three non-empty model-native entry files → a render-safe file set. */
function entryFiles(): WebBuildFile[] {
  return [
    { path: 'src/main.tsx', content: 'import App from "./App";\n', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
    { path: 'src/App.tsx', content: 'export default function App(){return null;}\n', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
    { path: 'src/styles.css', content: ':root{color:#fff;}\n', language: 'css', status: 'unchanged', added: 0, removed: 0 },
  ];
}

/** Same set but missing the styles.css entry → NOT a valid model-native entry set. */
function entryFilesMissingOne(): WebBuildFile[] {
  return entryFiles().filter((f) => f.path !== 'src/styles.css');
}

/**
 * Minimal step carrying only the artifact sub-fields the derivation reads. Cast through
 * `unknown` (the artifacts have many unrelated required fields the pure derivation ignores).
 */
function step(opts: {
  consumption?: 'model-native' | 'fallback';
  validationStatus?: 'valid' | 'invalid' | 'skipped';
  readyForConsumption?: boolean;
  didParse?: boolean;
  validationFiles?: Array<{ path: string; content: string; language?: string }>;
  acceptance?: string;
}): WebBuildStep {
  return {
    artifacts: {
      ...(opts.consumption ? { frontendBuilderConsumption: { status: opts.consumption } } : {}),
      ...(opts.validationStatus || opts.readyForConsumption !== undefined || opts.didParse !== undefined || opts.validationFiles
        ? {
            frontendBuilderValidation: {
              status: opts.validationStatus,
              readyForConsumption: opts.readyForConsumption,
              didParse: opts.didParse,
              files: opts.validationFiles,
            },
          }
        : {}),
      ...(opts.acceptance ? { frontendBuilderAcceptance: { status: opts.acceptance } } : {}),
    },
  } as unknown as WebBuildStep;
}

/**
 * The runtime→Safe decision, expressed with the SAME shared primitives both real surfaces use:
 * the exported `candidateHasEntryFiles` (entry-file health) and `isModelNativeRuntimeFailure`
 * (confirmed runtime failure). The embedded panel computes `candidateFailed = !entryOk ||
 * isModelNativeRuntimeFailure(phase)`; the standalone page computes `runtimeFailed =
 * isModelNativeRuntimeFailure(phase)` under the same entry-file gate. Because BOTH call the same
 * pure helper, this single function models both — so a parity test here proves they cannot drift.
 */
function usesSafeFallback(
  mode: WebBuildPreviewMode,
  nativeFiles: WebBuildFile[],
  phase: ModelNativeRuntimePhase | undefined,
): boolean {
  const showModelNative = mode === 'approved-model-native' || mode === 'provisional-model-native' || mode === 'owner-candidate';
  const candidateEligible = showModelNative && nativeFiles.length > 0;
  const candidateEntryOk = candidateHasEntryFiles(nativeFiles);
  return candidateEligible && (!candidateEntryOk || isModelNativeRuntimeFailure(phase));
}

describe('deriveModelNativeCandidate — render-safety vs approval split', () => {
  it('A: consumed + valid + ready + approved → approved & render-safe → approved-model-native', () => {
    const c = deriveModelNativeCandidate(
      step({ consumption: 'model-native', validationStatus: 'valid', readyForConsumption: true, acceptance: 'approved' }),
      entryFiles(),
    );
    expect(c.source).toBe('consumed-model-native');
    expect(c.approvedForUserPreview).toBe(true);
    expect(c.safeToRenderModelNativePreview).toBe(true);
    expect(resolvePreviewMode(c, false, undefined)).toBe('approved-model-native');
    expect(resolvePreviewMode(c, true, undefined)).toBe('approved-model-native');
  });

  it('B: consumed + valid + ready + manual-review-required → render-safe but NOT approved → provisional for user, owner-candidate for owner', () => {
    const c = deriveModelNativeCandidate(
      step({ consumption: 'model-native', validationStatus: 'valid', readyForConsumption: true, acceptance: 'manual-review-required' }),
      entryFiles(),
    );
    expect(c.approvedForUserPreview).toBe(false);
    expect(c.safeToRenderModelNativePreview).toBe(true);
    // The core fix: a valid/consumed/runnable build is no longer forced to Safe for a normal user.
    expect(resolvePreviewMode(c, false, undefined)).toBe('provisional-model-native');
    // Owner behaviour is unchanged: it inspects the unapproved candidate.
    expect(resolvePreviewMode(c, true, undefined)).toBe('owner-candidate');
    // acceptance is NOT rewritten to approved — the artifact state is preserved.
    expect(c.acceptance).toBe('manual-review-required');
  });

  it('C: consumed but validation INVALID → NOT render-safe → safe-fallback (structural safety intact)', () => {
    const c = deriveModelNativeCandidate(
      step({ consumption: 'model-native', validationStatus: 'invalid', readyForConsumption: true, acceptance: 'manual-review-required' }),
      entryFiles(),
    );
    expect(c.safeToRenderModelNativePreview).toBe(false);
    expect(resolvePreviewMode(c, false, undefined)).toBe('safe-fallback');
  });

  it('D: consumed + valid but NOT readyForConsumption → NOT render-safe → safe-fallback', () => {
    const c = deriveModelNativeCandidate(
      step({ consumption: 'model-native', validationStatus: 'valid', readyForConsumption: false, acceptance: 'manual-review-required' }),
      entryFiles(),
    );
    expect(c.safeToRenderModelNativePreview).toBe(false);
    expect(resolvePreviewMode(c, false, undefined)).toBe('safe-fallback');
  });

  it('E: consumed + valid + ready but MISSING an entry file → not a consumed candidate → safe-fallback', () => {
    const c = deriveModelNativeCandidate(
      step({ consumption: 'model-native', validationStatus: 'valid', readyForConsumption: true, acceptance: 'approved' }),
      entryFilesMissingOne(),
    );
    // Missing an entry file drops out of the consumed branch entirely (no user authority).
    expect(c.safeToRenderModelNativePreview).toBe(false);
    expect(c.approvedForUserPreview).toBe(false);
    expect(resolvePreviewMode(c, false, undefined)).toBe('safe-fallback');
  });

  it('F: parsed-initial candidate NOT consumed → NO user authority (safe-fallback), owner may still inspect', () => {
    const c = deriveModelNativeCandidate(
      step({
        consumption: 'fallback',
        validationStatus: 'valid',
        readyForConsumption: true,
        didParse: true,
        validationFiles: entryFiles().map((f) => ({ path: f.path, content: f.content, language: f.language })),
        acceptance: 'manual-review-required',
      }),
      // the ACTIVE files are the deterministic fallback (no model-native entry files consumed)
      [{ path: 'index.html', content: '<!doctype html>', language: 'html', status: 'unchanged', added: 0, removed: 0 }],
    );
    expect(c.source).toBe('parsed-initial-candidate');
    expect(c.available).toBe(true);
    // A parsed-but-unconsumed candidate NEVER gains normal-user authority...
    expect(c.approvedForUserPreview).toBe(false);
    expect(c.safeToRenderModelNativePreview).toBe(false);
    expect(resolvePreviewMode(c, false, undefined)).toBe('safe-fallback');
    // ...but the owner can still inspect it.
    expect(resolvePreviewMode(c, true, undefined)).toBe('owner-candidate');
  });

  it('F(runtime): a CONFIRMED runtime failure still forces Safe for BOTH approved and provisional modes', () => {
    const files = entryFiles();
    for (const mode of ['approved-model-native', 'provisional-model-native'] as WebBuildPreviewMode[]) {
      // Healthy running project → not forced to Safe.
      expect(usesSafeFallback(mode, files, 'running')).toBe(false);
      // Sandbox compile/runtime error → Safe.
      expect(usesSafeFallback(mode, files, 'error')).toBe(true);
      // Genuine sandbox timeout → Safe.
      expect(usesSafeFallback(mode, files, 'timeout')).toBe(true);
      // Missing entry file at render time → Safe.
      expect(usesSafeFallback(mode, entryFilesMissingOne(), 'running')).toBe(true);
    }
  });

  it('G: a host-side slow-start / no-signal observation ALONE must NOT force Safe (Finding 2)', () => {
    const files = entryFiles();
    // 'slow-start' is a host soft-timeout observation, never a confirmed failure.
    expect(isModelNativeRuntimeFailure('slow-start')).toBe(false);
    // Non-terminal phases are likewise never failures.
    for (const phase of ['not-started', 'initializing', 'running', 'slow-start', 'unknown', undefined] as Array<ModelNativeRuntimePhase | undefined>) {
      expect(isModelNativeRuntimeFailure(phase)).toBe(false);
    }
    // Only the two CONFIRMED failure phases return true.
    expect(isModelNativeRuntimeFailure('error')).toBe(true);
    expect(isModelNativeRuntimeFailure('timeout')).toBe(true);
    // A structurally valid model-native project that is merely slow keeps rendering (not Safe)…
    for (const mode of ['approved-model-native', 'provisional-model-native', 'owner-candidate'] as WebBuildPreviewMode[]) {
      expect(usesSafeFallback(mode, files, 'slow-start')).toBe(false);
      expect(usesSafeFallback(mode, files, 'initializing')).toBe(false);
    }
  });

  it('H: standalone and embedded ultimately SHOW Safe under the exact same conditions (no drift)', () => {
    // Compare the HOLISTIC "does this surface end up showing the Safe renderer?" decision. The two
    // surfaces reach Safe through different structural gates but the same shared primitives, so they
    // must agree for every mode × phase × file-shape. Missing entry files reach Safe on BOTH: the
    // panel via candidateFailed(!entryOk), the page via !modelNative — same outcome, different path.
    const embeddedShowsSafe = (mode: WebBuildPreviewMode, f: WebBuildFile[], phase?: ModelNativeRuntimePhase) => {
      const showMN = mode === 'approved-model-native' || mode === 'provisional-model-native' || mode === 'owner-candidate';
      const eligible = showMN && f.length > 0;
      const failed = eligible && (!candidateHasEntryFiles(f) || isModelNativeRuntimeFailure(phase));
      return !eligible || failed; // panel renders Safe when not eligible, or when the candidate failed
    };
    const standaloneShowsSafe = (mode: WebBuildPreviewMode, f: WebBuildFile[], phase?: ModelNativeRuntimePhase) => {
      const modelNative = mode !== 'safe-fallback' && candidateHasEntryFiles(f);
      return !modelNative || isModelNativeRuntimeFailure(phase); // page renders Safe when not model-native, or on runtime failure
    };
    const phases: Array<ModelNativeRuntimePhase | undefined> = ['not-started', 'initializing', 'slow-start', 'running', 'error', 'timeout', 'unknown', undefined];
    const shapes = [entryFiles(), entryFilesMissingOne(), [] as WebBuildFile[]];
    for (const mode of ['approved-model-native', 'provisional-model-native', 'owner-candidate'] as WebBuildPreviewMode[]) {
      for (const phase of phases) {
        for (const f of shapes) {
          expect(standaloneShowsSafe(mode, f, phase)).toBe(embeddedShowsSafe(mode, f, phase));
        }
      }
    }
    // And both keep a healthy/slow project OUT of Safe, but send a confirmed failure INTO Safe.
    const files = entryFiles();
    expect(embeddedShowsSafe('provisional-model-native', files, 'slow-start')).toBe(false);
    expect(standaloneShowsSafe('provisional-model-native', files, 'slow-start')).toBe(false);
    expect(embeddedShowsSafe('provisional-model-native', files, 'error')).toBe(true);
    expect(standaloneShowsSafe('provisional-model-native', files, 'error')).toBe(true);
  });
});

describe('resolvePreviewMode — owner selection unchanged', () => {
  const provisional = deriveModelNativeCandidate(
    step({ consumption: 'model-native', validationStatus: 'valid', readyForConsumption: true, acceptance: 'manual-review-required' }),
    entryFiles(),
  );

  it('owner can still switch a render-safe unapproved build to the safe fallback', () => {
    expect(resolvePreviewMode(provisional, true, 'safe')).toBe('safe-fallback');
    expect(resolvePreviewMode(provisional, true, 'model-native')).toBe('owner-candidate');
  });

  it('a non-render-safe / unavailable candidate is safe-fallback for everyone', () => {
    const none = deriveModelNativeCandidate(step({}), []);
    expect(none.available).toBe(false);
    expect(resolvePreviewMode(none, false, undefined)).toBe('safe-fallback');
    expect(resolvePreviewMode(none, true, undefined)).toBe('safe-fallback');
  });
});
