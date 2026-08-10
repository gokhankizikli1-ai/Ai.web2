import { describe, it, expect } from 'vitest';
import {
  modelNativePreviewFields,
  buildLatestPreviewStash,
  previewAuthorityRank,
  pickHighestAuthorityPreview,
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
