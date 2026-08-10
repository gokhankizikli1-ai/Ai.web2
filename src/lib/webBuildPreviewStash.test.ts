import { describe, it, expect } from 'vitest';
import {
  modelNativePreviewFields,
  buildLatestPreviewStash,
  previewAuthorityRank,
  pickHighestAuthorityPreview,
  resolvePreviewSources,
  canonicalWebBuildFilesFingerprint,
  type WebBuildPreviewData,
} from '@/lib/webBuildPreviewStash';
import type { WebBuildFile, WebBuildStep, WebBuildPayload } from '@/lib/webBuildPayload';

/**
 * Defect 1 — a section-only / Safe stash must not mask a healthier persisted model-native build.
 * These cover BOTH sides of the fix purely (no storage, no render):
 *   • producer: buildLatestPreviewStash preserves the real model-native render authority;
 *   • consumer: pickHighestAuthorityPreview prefers the highest-authority representation for a run.
 */

const ENTRY = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];
function entryFiles(): WebBuildFile[] {
  return ENTRY.map((p) => ({ path: p, content: 'x', language: 'tsx', status: 'unchanged' as const, added: 0, removed: 0 }));
}

/** A step whose artifacts describe a consumed model-native build at a given acceptance/validation. */
function mnStep(opts: { id?: string; acceptance?: string; validation?: 'valid' | 'invalid'; ready?: boolean; files?: WebBuildFile[] }): WebBuildStep {
  return {
    id: opts.id || 'run1',
    files: opts.files ?? entryFiles(),
    artifacts: {
      frontendBuilderConsumption: { status: 'model-native' },
      frontendBuilderValidation: { status: opts.validation ?? 'valid', readyForConsumption: opts.ready !== false },
      frontendBuilderAcceptance: opts.acceptance ? { status: opts.acceptance } : undefined,
    },
  } as unknown as WebBuildStep;
}

function payload(step: WebBuildStep, sectionItems: unknown[] = []): WebBuildPayload {
  return { prompt: 'p', brief: {}, sectionItems, steps: [step] } as unknown as WebBuildPayload;
}

const sectionStash = (runId: string): WebBuildPreviewData =>
  ({ runId, sectionItems: [{ id: 's1', name: 'Hero' }], brief: {} } as unknown as WebBuildPreviewData);
const mnStash = (runId: string, previewMode: 'approved-model-native' | 'provisional-model-native'): WebBuildPreviewData =>
  ({ runId, sectionItems: [], brief: {}, files: entryFiles(), previewSource: 'model-native-sandbox', previewMode } as unknown as WebBuildPreviewData);

describe('modelNativePreviewFields — non-owner authority (Defect 1 producer)', () => {
  it('returns provisional model-native for a render-safe manual-review build', () => {
    const mn = modelNativePreviewFields(mnStep({ acceptance: 'manual-review-required' }), entryFiles());
    expect(mn?.previewMode).toBe('provisional-model-native');
    expect(mn?.previewSource).toBe('model-native-sandbox');
  });
  it('returns approved model-native for an approved build', () => {
    expect(modelNativePreviewFields(mnStep({ acceptance: 'approved' }), entryFiles())?.previewMode).toBe('approved-model-native');
  });
  it('returns null for a non-render-safe build (never owner-candidate on cold restore)', () => {
    expect(modelNativePreviewFields(mnStep({ validation: 'invalid' }), entryFiles())).toBeNull();
    expect(modelNativePreviewFields(mnStep({ ready: false }), entryFiles())).toBeNull();
    expect(modelNativePreviewFields(mnStep({ files: entryFiles().slice(0, 2) }), entryFiles().slice(0, 2))).toBeNull();
  });
});

describe('buildLatestPreviewStash — preserves model-native authority (Defect 1 producer)', () => {
  it('stashes files + previewSource + provisional previewMode for a render-safe manual-review build', () => {
    const data = buildLatestPreviewStash(payload(mnStep({ id: 'r', acceptance: 'manual-review-required' })), { slug: 's' });
    expect(data?.previewSource).toBe('model-native-sandbox');
    expect(data?.previewMode).toBe('provisional-model-native');
    expect(data?.files?.length).toBe(3);
    expect(data?.runId).toBe('r');
  });
  it('stashes the SECTION representation for a genuinely-safe build', () => {
    const data = buildLatestPreviewStash(payload(mnStep({ id: 'r', validation: 'invalid' }), [{ id: 's1' }]), {});
    expect(data?.previewSource).toBeUndefined();
    expect(Array.isArray(data?.sectionItems) && data!.sectionItems.length).toBeTruthy();
  });
  it('returns null (no stash) when nothing usable exists — never plants an empty masking stash', () => {
    expect(buildLatestPreviewStash(payload(mnStep({ id: 'r', validation: 'invalid', files: [] }), []), {})).toBeNull();
    expect(buildLatestPreviewStash({ prompt: 'p', brief: {}, sectionItems: [], steps: [] } as unknown as WebBuildPayload)).toBeNull();
  });
  it('carries the return context through', () => {
    const data = buildLatestPreviewStash(payload(mnStep({ id: 'r', acceptance: 'approved' })), { returnTo: '#/chat', returnChatSessionId: 'c', returnWebBuildRunId: 'w' });
    expect(data?.returnTo).toBe('#/chat');
    expect(data?.returnWebBuildRunId).toBe('w');
  });
});

describe('preview authority precedence (Defect 1 consumer)', () => {
  it('A: section-only stash + provisional model-native session → provisional wins (not legacy/Safe)', () => {
    expect(pickHighestAuthorityPreview([sectionStash('r'), mnStash('r', 'provisional-model-native')])?.previewMode).toBe('provisional-model-native');
  });
  it('B: section-only stash + approved model-native session → approved wins', () => {
    expect(pickHighestAuthorityPreview([sectionStash('r'), mnStash('r', 'approved-model-native')])?.previewMode).toBe('approved-model-native');
  });
  it('C: model-native stash + same session → model-native preserved (stash order kept on tie)', () => {
    const picked = pickHighestAuthorityPreview([mnStash('r', 'provisional-model-native'), mnStash('r', 'approved-model-native')]);
    expect(picked?.previewSource).toBe('model-native-sandbox');
    expect(picked?.previewMode).toBe('provisional-model-native'); // stash (first) wins the equal-authority tie
  });
  it('D: genuinely-safe session + section-only stash → stays a section/Safe representation', () => {
    const picked = pickHighestAuthorityPreview([sectionStash('r'), sectionStash('r')]);
    expect(picked?.previewSource).toBeUndefined();
    expect(picked!.sectionItems.length).toBeGreaterThan(0);
  });
  it('E: stale/empty unusable stash + healthy session → session wins', () => {
    const emptyStash = { runId: 'r', sectionItems: [], brief: {} } as unknown as WebBuildPreviewData;
    expect(pickHighestAuthorityPreview([emptyStash, mnStash('r', 'approved-model-native')])?.previewMode).toBe('approved-model-native');
  });
  it('F: saved project is the only healthy source → model-native project restores', () => {
    expect(pickHighestAuthorityPreview([null, null, mnStash('r', 'provisional-model-native')])?.previewMode).toBe('provisional-model-native');
  });
  it('returns null when no source is usable', () => {
    expect(pickHighestAuthorityPreview([null, { runId: 'r', sectionItems: [], brief: {} } as unknown as WebBuildPreviewData])).toBeNull();
  });
  it('previewAuthorityRank: model-native (2) > section/safe (1) > unusable (0)', () => {
    expect(previewAuthorityRank(mnStash('r', 'approved-model-native'))).toBe(2);
    expect(previewAuthorityRank(sectionStash('r'))).toBe(1);
    expect(previewAuthorityRank({ runId: 'r', sectionItems: [], brief: {} } as unknown as WebBuildPreviewData)).toBe(0);
  });
});

/* ── Finding 1 — handoff PROVENANCE: an explicit renderer handoff is honored exactly, while the
 *  automatic latest-preview cache never stale-masks the authoritative persisted session/project.
 *  These exercise resolvePreviewSources(stash, [session, project]) — the real restore decision. */

const explicitSafe = (runId: string): WebBuildPreviewData =>
  ({ runId, sectionItems: [{ id: 's1', name: 'Hero' }], brief: {}, previewMode: 'safe-fallback', handoffKind: 'explicit' } as unknown as WebBuildPreviewData);
const explicitOwnerCandidate = (runId: string): WebBuildPreviewData =>
  ({ runId, sectionItems: [], brief: {}, files: entryFiles(), previewSource: 'model-native-sandbox', previewMode: 'owner-candidate', handoffKind: 'explicit' } as unknown as WebBuildPreviewData);
const explicitMn = (runId: string, mode: 'approved-model-native' | 'provisional-model-native'): WebBuildPreviewData =>
  ({ runId, sectionItems: [], brief: {}, files: entryFiles(), previewSource: 'model-native-sandbox', previewMode: mode, handoffKind: 'explicit' } as unknown as WebBuildPreviewData);
const autoSection = (runId: string): WebBuildPreviewData =>
  ({ runId, sectionItems: [{ id: 's1', name: 'Hero' }], brief: {}, handoffKind: 'automatic' } as unknown as WebBuildPreviewData);
const autoMn = (runId: string, mode: 'approved-model-native' | 'provisional-model-native', marker = 'x'): WebBuildPreviewData =>
  ({ runId, sectionItems: [], brief: {}, files: entryFiles().map((f) => ({ ...f, content: marker })), previewSource: 'model-native-sandbox', previewMode: mode, handoffKind: 'automatic' } as unknown as WebBuildPreviewData);
// Persisted sources are derived from saved step artifacts (no handoffKind) — the authoritative current state.
const persistedMn = (runId: string, mode: 'approved-model-native' | 'provisional-model-native', marker = 'p'): WebBuildPreviewData =>
  ({ runId, sectionItems: [], brief: {}, files: entryFiles().map((f) => ({ ...f, content: marker })), previewSource: 'model-native-sandbox', previewMode: mode } as unknown as WebBuildPreviewData);

describe('resolvePreviewSources — handoff provenance (Finding 1)', () => {
  it('A: explicit safe-fallback stash + provisional persisted session → explicit Safe wins', () => {
    const picked = resolvePreviewSources(explicitSafe('r'), [persistedMn('r', 'provisional-model-native')]);
    expect(picked?.previewMode).toBe('safe-fallback');
    expect(picked?.previewSource).toBeUndefined();
  });
  it('B: explicit owner-candidate + provisional persisted session → owner-candidate handoff preserved (route owner-gates it)', () => {
    expect(resolvePreviewSources(explicitOwnerCandidate('r'), [persistedMn('r', 'provisional-model-native')])?.previewMode).toBe('owner-candidate');
  });
  it('C: automatic section stash + provisional persisted session → provisional persisted wins', () => {
    const picked = resolvePreviewSources(autoSection('r'), [persistedMn('r', 'provisional-model-native')]);
    expect(picked?.previewMode).toBe('provisional-model-native');
    expect(picked?.previewSource).toBe('model-native-sandbox');
  });
  it('D: automatic provisional model-native stash + newer approved persisted session → persisted authoritative render wins, not the stale stash', () => {
    const picked = resolvePreviewSources(autoMn('r', 'provisional-model-native'), [persistedMn('r', 'approved-model-native')]);
    expect(picked?.previewMode).toBe('approved-model-native'); // persisted render authority, not the cache's provisional
    expect(picked?.previewSource).toBe('model-native-sandbox');
  });
  it('E: automatic stale model-native files + persisted same-mode model-native files → persisted files win', () => {
    const picked = resolvePreviewSources(autoMn('r', 'provisional-model-native', 'STALE'), [persistedMn('r', 'provisional-model-native', 'FRESH')]);
    expect(picked?.files?.[0]?.content).toBe('FRESH'); // authoritative files, never the stale cache's
  });
  it('when persisted render authority wins, the automatic stash’s fresh Back-context is still carried', () => {
    const stash = { ...autoMn('r', 'provisional-model-native'), returnTo: '#/chat?x=1', returnChatSessionId: 'chat-1', returnWebBuildRunId: 'wb-1', slug: 'site.korvix.build' } as unknown as WebBuildPreviewData;
    const picked = resolvePreviewSources(stash, [persistedMn('r', 'approved-model-native')]);
    expect(picked?.previewMode).toBe('approved-model-native'); // render authority from persisted
    expect(picked?.returnTo).toBe('#/chat?x=1');               // navigation context from the stash
    expect(picked?.returnChatSessionId).toBe('chat-1');
    expect(picked?.returnWebBuildRunId).toBe('wb-1');
    expect(picked?.slug).toBe('site.korvix.build');
  });
  it('F: explicit approved/provisional handoff survives regardless of persisted state', () => {
    const handoff = explicitMn('r', 'approved-model-native');
    expect(resolvePreviewSources(handoff, [persistedMn('r', 'provisional-model-native')])).toBe(handoff);
    const prov = explicitMn('r', 'provisional-model-native');
    expect(resolvePreviewSources(prov, [null])).toBe(prov);
  });
  it('G: a cold restore from automatic/persisted state can never resolve to owner-candidate', () => {
    // No explicit handoff in play — only the automatic cache + persisted sources, neither of which
    // is ever owner-candidate. Cover section-cache, model-native-cache, and empty-cache cases.
    for (const stash of [autoSection('r'), autoMn('r', 'provisional-model-native'), null, undefined]) {
      for (const persisted of [persistedMn('r', 'approved-model-native'), persistedMn('r', 'provisional-model-native'), null]) {
        const picked = resolvePreviewSources(stash, [persisted]);
        expect(picked?.previewMode).not.toBe('owner-candidate');
      }
    }
  });
  it('fallback: no usable persisted source → the automatic stash still loads the preview', () => {
    expect(resolvePreviewSources(autoMn('r', 'provisional-model-native'), [null, null])?.previewMode).toBe('provisional-model-native');
    expect(resolvePreviewSources(autoSection('r'), [null])?.sectionItems.length).toBeGreaterThan(0);
  });
  it('an UNUSABLE explicit stash falls through to persisted (never returns an empty handoff)', () => {
    const emptyExplicit = { runId: 'r', sectionItems: [], brief: {}, handoffKind: 'explicit' } as unknown as WebBuildPreviewData;
    expect(resolvePreviewSources(emptyExplicit, [persistedMn('r', 'approved-model-native')])?.previewMode).toBe('approved-model-native');
  });
  it('returns null when neither the stash nor any persisted source is usable', () => {
    expect(resolvePreviewSources(null, [null, undefined])).toBeNull();
  });
});

/* ── Defect 2 — an explicit handoff must not stale-mask a NEWER version of the same run forever.
 *  A same-step image replacement keeps the step id but changes file content, so a source-version
 *  fingerprint (not runId) is what distinguishes VERSION A from VERSION B. */

const filesA = (): WebBuildFile[] => entryFiles(); // content 'x'
const filesB = (): WebBuildFile[] => entryFiles().map((f) => ({ ...f, content: 'y' })); // content 'y'
const FP_A = canonicalWebBuildFilesFingerprint(filesA());
const FP_B = canonicalWebBuildFilesFingerprint(filesB());

const explicitMode = (mode: 'approved-model-native' | 'provisional-model-native' | 'owner-candidate' | 'safe-fallback', fp?: string): WebBuildPreviewData => {
  const base = { runId: 'r', sectionItems: [{ id: 's1' }], brief: {}, previewMode: mode, handoffKind: 'explicit', sourceFingerprint: fp } as unknown as WebBuildPreviewData;
  if (mode !== 'safe-fallback') return { ...base, sectionItems: [], files: entryFiles(), previewSource: 'model-native-sandbox' } as unknown as WebBuildPreviewData;
  return base;
};
const persistedVersion = (mode: 'approved-model-native' | 'provisional-model-native', fp: string): WebBuildPreviewData =>
  ({ runId: 'r', sectionItems: [], brief: {}, files: entryFiles(), previewSource: 'model-native-sandbox', previewMode: mode, sourceFingerprint: fp } as unknown as WebBuildPreviewData);

describe('canonicalWebBuildFilesFingerprint (Defect 2)', () => {
  it('J: same paths, different content → different fingerprint', () => {
    expect(FP_A).not.toBe(FP_B);
  });
  it('K: same files in a different array order → identical fingerprint', () => {
    const forward = entryFiles();
    const reversed = [...entryFiles()].reverse();
    expect(canonicalWebBuildFilesFingerprint(forward)).toBe(canonicalWebBuildFilesFingerprint(reversed));
  });
  it('is empty/missing-safe and deterministic', () => {
    expect(canonicalWebBuildFilesFingerprint([])).toBe(canonicalWebBuildFilesFingerprint(undefined));
    expect(canonicalWebBuildFilesFingerprint(entryFiles())).toBe(canonicalWebBuildFilesFingerprint(entryFiles()));
  });
  it('ignores malformed entries the same way sanitizeFiles does (raw vs sanitized match)', () => {
    const raw = [...entryFiles(), { path: 'x', content: 123 } as unknown as WebBuildFile, null as unknown as WebBuildFile];
    expect(canonicalWebBuildFilesFingerprint(raw)).toBe(canonicalWebBuildFilesFingerprint(entryFiles()));
  });
});

describe('resolvePreviewSources — explicit handoff source-version staleness (Defect 2)', () => {
  it('A: explicit provisional VERSION A + persisted provisional VERSION A → explicit honored', () => {
    const picked = resolvePreviewSources(explicitMode('provisional-model-native', FP_A), [persistedVersion('provisional-model-native', FP_A)]);
    expect(picked?.handoffKind).toBe('explicit');
    expect(picked?.previewMode).toBe('provisional-model-native');
  });
  it('B: explicit Safe VERSION A + persisted model-native VERSION A → explicit Safe honored', () => {
    const picked = resolvePreviewSources(explicitMode('safe-fallback', FP_A), [persistedVersion('provisional-model-native', FP_A)]);
    expect(picked?.previewMode).toBe('safe-fallback');
    expect(picked?.previewSource).toBeUndefined();
  });
  it('C: explicit owner-candidate VERSION A + persisted provisional VERSION A → owner-candidate honored (route owner-gates)', () => {
    expect(resolvePreviewSources(explicitMode('owner-candidate', FP_A), [persistedVersion('provisional-model-native', FP_A)])?.previewMode).toBe('owner-candidate');
  });
  it('D: explicit provisional VERSION A + persisted provisional VERSION B → persisted B wins (stale explicit)', () => {
    const picked = resolvePreviewSources(explicitMode('provisional-model-native', FP_A), [persistedVersion('provisional-model-native', FP_B)]);
    expect(picked?.sourceFingerprint).toBe(FP_B);
    expect(picked?.handoffKind).toBeUndefined(); // the persisted representation, not the explicit stash
  });
  it('E: explicit Safe VERSION A + persisted approved VERSION B → stale Safe no longer masks B', () => {
    const picked = resolvePreviewSources(explicitMode('safe-fallback', FP_A), [persistedVersion('approved-model-native', FP_B)]);
    expect(picked?.previewMode).toBe('approved-model-native');
    expect(picked?.sourceFingerprint).toBe(FP_B);
  });
  it('F: explicit owner-candidate VERSION A + persisted VERSION B → stale owner-candidate does not mask B', () => {
    const picked = resolvePreviewSources(explicitMode('owner-candidate', FP_A), [persistedVersion('provisional-model-native', FP_B)]);
    expect(picked?.previewMode).toBe('provisional-model-native');
    expect(picked?.sourceFingerprint).toBe(FP_B);
  });
  it('G: automatic VERSION A + persisted VERSION B → persisted B wins', () => {
    const auto = { ...persistedVersion('provisional-model-native', FP_A), handoffKind: 'automatic' } as unknown as WebBuildPreviewData;
    expect(resolvePreviewSources(auto, [persistedVersion('approved-model-native', FP_B)])?.sourceFingerprint).toBe(FP_B);
  });
  it('H: explicit stash, no persisted source → explicit still works', () => {
    const explicit = explicitMode('provisional-model-native', FP_A);
    expect(resolvePreviewSources(explicit, [null, null])).toBe(explicit);
  });
  it('I: legacy explicit stash WITHOUT fingerprint + current model-native persisted → conservative: persisted wins (no permanent masking)', () => {
    const legacy = explicitMode('safe-fallback', undefined); // no sourceFingerprint
    const picked = resolvePreviewSources(legacy, [persistedVersion('provisional-model-native', FP_B)]);
    expect(picked?.previewMode).toBe('provisional-model-native'); // model-native persisted wins
    // …but a legacy explicit + only a SECTION/Safe persisted source (rank 1) is still honored:
    const sectionPersisted = { runId: 'r', sectionItems: [{ id: 's1' }], brief: {}, sourceFingerprint: FP_B } as unknown as WebBuildPreviewData;
    expect(resolvePreviewSources(legacy, [sectionPersisted])?.previewMode).toBe('safe-fallback');
  });
  it('current source without a fingerprint cannot prove staleness → explicit honored', () => {
    const persistedNoFp = { runId: 'r', sectionItems: [], brief: {}, files: entryFiles(), previewSource: 'model-native-sandbox', previewMode: 'approved-model-native' } as unknown as WebBuildPreviewData;
    expect(resolvePreviewSources(explicitMode('safe-fallback', FP_A), [persistedNoFp])?.previewMode).toBe('safe-fallback');
  });
});
