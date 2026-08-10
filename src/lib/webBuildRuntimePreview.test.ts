import { describe, it, expect } from 'vitest';
import {
  deriveModelNativeCandidate,
  resolvePreviewMode,
  candidateHasEntryFiles,
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
 * Mirror of the panel's runtime-failure gate (WebBuildPreviewPanel: `candidateFailed` /
 * `usingSafeFallback`) so case G can be asserted purely. The panel uses the REAL exported
 * `candidateHasEntryFiles` for the entry-file health check — we exercise the same function
 * here — plus the runtime snapshot phase. This is the single runtime-safety path shared by
 * BOTH approved and provisional model-native modes (no second safety system).
 */
function panelUsesSafeFallback(
  mode: WebBuildPreviewMode,
  nativeFiles: WebBuildFile[],
  phase: ModelNativeRuntimePhase | undefined,
): boolean {
  const showModelNative = mode === 'approved-model-native' || mode === 'provisional-model-native' || mode === 'owner-candidate';
  const candidateEligible = showModelNative && nativeFiles.length > 0;
  const candidateEntryOk = candidateHasEntryFiles(nativeFiles);
  const candidateFailed = candidateEligible && (!candidateEntryOk || phase === 'error' || phase === 'timeout');
  return candidateEligible && candidateFailed;
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

  it('legacy: consumed + unknown acceptance WITHOUT validation metadata → approved, not render-safe → still approved-model-native', () => {
    // Pre-Phase-12E builds consumed model-native as the finished preview with no acceptance
    // artifact and often no Phase 12C validation. approvedForUserPreview stays true; the
    // render-safety gate must NOT regress them to safe-fallback for non-owners.
    const c = deriveModelNativeCandidate(
      step({ consumption: 'model-native' }),
      entryFiles(),
    );
    expect(c.source).toBe('consumed-model-native');
    expect(c.acceptance).toBe('unknown');
    expect(c.approvedForUserPreview).toBe(true);
    expect(c.safeToRenderModelNativePreview).toBe(false);
    expect(resolvePreviewMode(c, false, undefined)).toBe('approved-model-native');
    expect(resolvePreviewMode(c, true, undefined)).toBe('approved-model-native');
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

  it('G: a runtime failure still forces Safe in the panel for BOTH approved and provisional modes', () => {
    const files = entryFiles();
    for (const mode of ['approved-model-native', 'provisional-model-native'] as WebBuildPreviewMode[]) {
      // Healthy running project → not forced to Safe.
      expect(panelUsesSafeFallback(mode, files, 'running')).toBe(false);
      // Sandbox compile/runtime error → Safe.
      expect(panelUsesSafeFallback(mode, files, 'error')).toBe(true);
      // Startup timeout → Safe.
      expect(panelUsesSafeFallback(mode, files, 'timeout')).toBe(true);
      // Missing entry file at render time → Safe.
      expect(panelUsesSafeFallback(mode, entryFilesMissingOne(), 'running')).toBe(true);
    }
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
